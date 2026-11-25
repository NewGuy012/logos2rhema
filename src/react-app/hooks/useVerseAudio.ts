import { useCallback, useEffect, useRef, useState } from "react";

import { hasVerseTimings } from "../../shared/audio-timings";
import { isSafeAudioSrc } from "../../shared/url";
import { loadSyncedChapterAudio } from "../lib/bible-loader";
import { speakKoreanWord } from "../lib/speech";
import { resolveTimeForVerse } from "./useHumanAudio";

export interface VerseAudioTarget {
	usfm: string;
	chapter: number;
	verseStart: number;
	verseEnd?: number;
	fallbackKoText?: string;
}

type VerseAudioSource = "supertonic" | "speech" | null;

const NEXT_VERSE_STOP_LEAD_SEC = 0.12;
const MIN_VERSE_SLICE_SEC = 0.25;

export function resolveVerseSliceBounds(
	timings: Record<number, number> | undefined,
	verseStart: number,
	verseEnd = verseStart,
): { startSec: number; stopAtSec: number | null } | null {
	if (!hasVerseTimings(timings)) return null;
	const startSec = resolveTimeForVerse(timings, verseStart);
	if (startSec === null) return null;

	const effectiveEnd = Math.max(verseStart, verseEnd);
	let nextVerse = Number.POSITIVE_INFINITY;
	let nextStartSec: number | null = null;
	for (const [vStr, sec] of Object.entries(timings!)) {
		const vNum = Number.parseInt(vStr, 10);
		if (!Number.isNaN(vNum) && vNum > effectiveEnd && vNum < nextVerse && sec > startSec) {
			nextVerse = vNum;
			nextStartSec = sec;
		}
	}

	const stopAtSec =
		nextStartSec !== null
			? Math.max(startSec + MIN_VERSE_SLICE_SEC, nextStartSec - NEXT_VERSE_STOP_LEAD_SEC)
			: null;
	return { startSec, stopAtSec };
}

function safeSeekAudio(audio: HTMLAudioElement, seconds: number): void {
	const max =
		Number.isFinite(audio.duration) && audio.duration > 0
			? audio.duration
			: Number.POSITIVE_INFINITY;
	const clamped = Math.max(0, Math.min(seconds, max));
	try {
		audio.currentTime = clamped;
	} catch {}
}

function stopSpeechSynthesis(): void {
	if (typeof window === "undefined") return;
	try {
		window.speechSynthesis?.cancel?.();
	} catch {}
}

/**
 * Plays Supertonic 3 Korean chapter narration sliced to a specific verse range,
 * falling back to Web Speech (`ko-KR`) only if Supertonic audio is unavailable.
 */
export function useVerseAudio(resetKey?: string) {
	const [isPlaying, setIsPlaying] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [source, setSource] = useState<VerseAudioSource>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const audioRef = useRef<HTMLAudioElement | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const playSeqRef = useRef(0);
	const activeTargetKeyRef = useRef<string | null>(null);
	const pendingSeekRef = useRef<number | null>(null);
	const boundsRef = useRef<{
		seq: number;
		stopAtSec: number | null;
		fallbackKoText?: string;
	} | null>(null);

	const isPlayingRef = useRef(isPlaying);
	isPlayingRef.current = isPlaying;
	const isLoadingRef = useRef(isLoading);
	isLoadingRef.current = isLoading;

	const playFallbackSpeech = useCallback((text: string | undefined, seq: number) => {
		const trimmed = text?.trim();
		if (!trimmed) {
			if (seq === playSeqRef.current) {
				setIsPlaying(false);
				setIsLoading(false);
				setSource(null);
				setErrorMessage("Korean audio unavailable.");
			}
			return;
		}
		if (seq !== playSeqRef.current) return;
		setSource("speech");
		setIsLoading(false);
		speakKoreanWord(trimmed, {
			onStart: () => {
				if (seq === playSeqRef.current) {
					setIsPlaying(true);
					setIsLoading(false);
				}
			},
			onEnd: () => {
				if (seq === playSeqRef.current) {
					setIsPlaying(false);
					setIsLoading(false);
					activeTargetKeyRef.current = null;
				}
			},
			onError: () => {
				if (seq === playSeqRef.current) {
					setIsPlaying(false);
					setIsLoading(false);
					setSource(null);
					activeTargetKeyRef.current = null;
					setErrorMessage("Korean audio unavailable.");
				}
			},
		});
	}, []);

	const stop = useCallback(() => {
		playSeqRef.current++;
		activeTargetKeyRef.current = null;
		pendingSeekRef.current = null;
		boundsRef.current = null;
		abortRef.current?.abort();
		abortRef.current = null;
		stopSpeechSynthesis();
		const audio = audioRef.current;
		if (audio) {
			audio.pause();
			audio.muted = false;
		}
		setIsPlaying(false);
		setIsLoading(false);
	}, []);

	const ensureAudioElement = useCallback((): HTMLAudioElement | null => {
		if (audioRef.current) return audioRef.current;
		if (typeof Audio === "undefined") return null;
		const audio = new Audio();
		audio.preload = "auto";

		const applyPendingSeek = () => {
			const pending = pendingSeekRef.current;
			if (pending !== null && (typeof audio.readyState !== "number" || audio.readyState >= 1)) {
				safeSeekAudio(audio, pending);
				pendingSeekRef.current = null;
				audio.muted = false;
			}
		};

		audio.addEventListener("loadedmetadata", applyPendingSeek);
		audio.addEventListener("canplay", applyPendingSeek);
		audio.addEventListener("play", () => {
			if (!boundsRef.current || boundsRef.current.seq !== playSeqRef.current) return;
			setSource("supertonic");
			setIsPlaying(true);
			setIsLoading(false);
			setErrorMessage(null);
		});
		audio.addEventListener("pause", () => {
			if (boundsRef.current && boundsRef.current.seq === playSeqRef.current) {
				setIsPlaying(false);
			}
		});
		audio.addEventListener("waiting", () => {
			if (boundsRef.current && boundsRef.current.seq === playSeqRef.current) {
				setIsLoading(true);
			}
		});
		audio.addEventListener("timeupdate", () => {
			if (pendingSeekRef.current !== null) {
				applyPendingSeek();
				return;
			}
			const bounds = boundsRef.current;
			if (
				bounds &&
				bounds.seq === playSeqRef.current &&
				bounds.stopAtSec !== null &&
				(audio.currentTime || 0) >= bounds.stopAtSec
			) {
				audio.pause();
				activeTargetKeyRef.current = null;
				setIsPlaying(false);
				setIsLoading(false);
			}
		});
		audio.addEventListener("ended", () => {
			if (boundsRef.current && boundsRef.current.seq === playSeqRef.current) {
				activeTargetKeyRef.current = null;
				setIsPlaying(false);
				setIsLoading(false);
			}
		});
		audio.addEventListener("error", () => {
			if (!audio.getAttribute("src")) return;
			const bounds = boundsRef.current;
			if (!bounds || bounds.seq !== playSeqRef.current) return;
			audio.muted = false;
			pendingSeekRef.current = null;
			boundsRef.current = null;
			playFallbackSpeech(bounds.fallbackKoText, bounds.seq);
		});

		audioRef.current = audio;
		return audio;
	}, [playFallbackSpeech]);

	useEffect(() => {
		return () => {
			stop();
			const audio = audioRef.current;
			if (audio) {
				audio.removeAttribute("src");
				audio.load();
				audioRef.current = null;
			}
		};
	}, [stop]);

	useEffect(() => {
		if (resetKey === undefined) return;
		stop();
		setSource(null);
		setErrorMessage(null);
	}, [resetKey, stop]);

	const togglePlay = useCallback(
		(target: VerseAudioTarget) => {
			const targetKey = `${target.usfm}:${target.chapter}:${target.verseStart}-${target.verseEnd ?? target.verseStart}`;
			if (
				(isPlayingRef.current || isLoadingRef.current) &&
				activeTargetKeyRef.current === targetKey
			) {
				stop();
				return;
			}

			stop();
			const seq = ++playSeqRef.current;
			activeTargetKeyRef.current = targetKey;
			setIsLoading(true);
			setErrorMessage(null);
			setSource(null);

			const controller = new AbortController();
			abortRef.current = controller;

			loadSyncedChapterAudio({
				usfm: target.usfm,
				chapter: target.chapter,
				language: "ko",
				signal: controller.signal,
			})
				.then((res) => {
					if (controller.signal.aborted || seq !== playSeqRef.current) return;
					const koTrack = res.tracks.find((t) => t.language === "ko" && isSafeAudioSrc(t.url));
					const slice = resolveVerseSliceBounds(
						koTrack?.verseTimings,
						target.verseStart,
						target.verseEnd,
					);
					const audio = koTrack && slice ? ensureAudioElement() : null;

					if (!koTrack || !slice || !audio) {
						playFallbackSpeech(target.fallbackKoText, seq);
						return;
					}

					boundsRef.current = {
						seq,
						stopAtSec: slice.stopAtSec,
						fallbackKoText: target.fallbackKoText,
					};

					const srcChanged = audio.getAttribute("src") !== koTrack.url;
					if (srcChanged) {
						audio.src = koTrack.url;
						audio.load();
					}

					if (typeof audio.readyState === "number" && audio.readyState < 1) {
						pendingSeekRef.current = slice.startSec;
						audio.muted = true;
					} else {
						pendingSeekRef.current = null;
						audio.muted = false;
						safeSeekAudio(audio, slice.startSec);
					}

					setSource("supertonic");
					audio.play().catch((err: unknown) => {
						if (seq !== playSeqRef.current) return;
						if (err instanceof Error && err.name === "AbortError") return;
						audio.muted = false;
						pendingSeekRef.current = null;
						boundsRef.current = null;
						playFallbackSpeech(target.fallbackKoText, seq);
					});
				})
				.catch(() => {
					if (controller.signal.aborted || seq !== playSeqRef.current) return;
					playFallbackSpeech(target.fallbackKoText, seq);
				});
		},
		[stop, ensureAudioElement, playFallbackSpeech],
	);

	return {
		isPlaying,
		isLoading,
		source,
		errorMessage,
		togglePlay,
		stop,
	};
}
