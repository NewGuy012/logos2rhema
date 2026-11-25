import { useCallback, useEffect, useRef, useState } from "react";

import { hasVerseTimings } from "../../shared/audio-timings";
import { isSafeAudioSrc } from "../../shared/url";
import { loadSyncedChapterAudio } from "../lib/bible-loader";
import { speakKoreanWord, stopKoreanSpeech } from "../lib/speech";
import { resolveTimeForVerse, safeSetCurrentTime } from "./useHumanAudio";

export interface VerseAudioTarget {
	usfm: string;
	chapter: number;
	verseStart: number;
	verseEnd?: number;
	fallbackKoText?: string;
}

export function getVerseAudioTargetKey(
	target: Pick<VerseAudioTarget, "usfm" | "chapter" | "verseStart" | "verseEnd">,
): string {
	return `${target.usfm}:${target.chapter}:${target.verseStart}-${target.verseEnd ?? target.verseStart}`;
}

const NEXT_VERSE_STOP_LEAD_SEC = 0.12;
const MIN_VERSE_SLICE_SEC = 0.25;

function resolveVerseSliceBounds(
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

/**
 * Plays Supertonic 3 Korean chapter narration sliced to a specific verse range,
 * falling back to Web Speech (`ko-KR`) only if Supertonic audio is unavailable.
 */
export function useVerseAudio() {
	const [isPlaying, setIsPlaying] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [activeTargetKey, setActiveTargetKey] = useState<string | null>(null);

	const audioRef = useRef<HTMLAudioElement | null>(null);
	const cleanupAudioRef = useRef<(() => void) | null>(null);
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

	const setActiveTarget = useCallback((key: string | null) => {
		activeTargetKeyRef.current = key;
		setActiveTargetKey(key);
	}, []);

	const playFallbackSpeech = useCallback(
		(text: string | undefined, seq: number) => {
			const trimmed = text?.trim();
			if (!trimmed) {
				if (seq === playSeqRef.current) {
					setIsPlaying(false);
					setIsLoading(false);
					setActiveTarget(null);
				}
				return;
			}
			if (seq !== playSeqRef.current) return;
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
						setActiveTarget(null);
					}
				},
				onError: () => {
					if (seq === playSeqRef.current) {
						setIsPlaying(false);
						setIsLoading(false);
						setActiveTarget(null);
					}
				},
			});
		},
		[setActiveTarget],
	);

	const stop = useCallback(() => {
		playSeqRef.current++;
		setActiveTarget(null);
		pendingSeekRef.current = null;
		boundsRef.current = null;
		abortRef.current?.abort();
		abortRef.current = null;
		stopKoreanSpeech();
		const audio = audioRef.current;
		if (audio) {
			audio.pause();
			audio.muted = false;
		}
		setIsPlaying(false);
		setIsLoading(false);
	}, [setActiveTarget]);

	const ensureAudioElement = useCallback((): HTMLAudioElement | null => {
		if (audioRef.current) return audioRef.current;
		if (typeof Audio === "undefined") return null;
		const audio = new Audio();
		audio.preload = "auto";

		const applyPendingSeek = () => {
			const pending = pendingSeekRef.current;
			if (pending !== null && (typeof audio.readyState !== "number" || audio.readyState >= 1)) {
				safeSetCurrentTime(audio, pending);
				pendingSeekRef.current = null;
				audio.muted = false;
			}
		};

		const handlers: Record<string, () => void> = {
			loadedmetadata: applyPendingSeek,
			canplay: applyPendingSeek,
			play: () => {
				if (!boundsRef.current || boundsRef.current.seq !== playSeqRef.current) return;
				setIsPlaying(true);
				setIsLoading(false);
			},
			pause: () => {
				if (boundsRef.current && boundsRef.current.seq === playSeqRef.current) {
					setIsPlaying(false);
				}
			},
			waiting: () => {
				if (boundsRef.current && boundsRef.current.seq === playSeqRef.current) {
					setIsLoading(true);
				}
			},
			timeupdate: () => {
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
					setActiveTarget(null);
					setIsPlaying(false);
					setIsLoading(false);
				}
			},
			ended: () => {
				if (boundsRef.current && boundsRef.current.seq === playSeqRef.current) {
					setActiveTarget(null);
					setIsPlaying(false);
					setIsLoading(false);
				}
			},
			error: () => {
				if (!audio.getAttribute("src")) return;
				const bounds = boundsRef.current;
				if (!bounds || bounds.seq !== playSeqRef.current) return;
				audio.muted = false;
				pendingSeekRef.current = null;
				boundsRef.current = null;
				playFallbackSpeech(bounds.fallbackKoText, bounds.seq);
			},
		};

		for (const [evt, fn] of Object.entries(handlers)) audio.addEventListener(evt, fn);
		cleanupAudioRef.current = () => {
			for (const [evt, fn] of Object.entries(handlers)) audio.removeEventListener(evt, fn);
		};
		audioRef.current = audio;
		return audio;
	}, [playFallbackSpeech, setActiveTarget]);

	useEffect(() => {
		return () => {
			stop();
			cleanupAudioRef.current?.();
			cleanupAudioRef.current = null;
			const audio = audioRef.current;
			if (audio) {
				audio.removeAttribute("src");
				audio.load();
				audioRef.current = null;
			}
		};
	}, [stop]);

	const togglePlay = useCallback(
		(target: VerseAudioTarget) => {
			const targetKey = getVerseAudioTargetKey(target);
			if (
				(isPlayingRef.current || isLoadingRef.current) &&
				activeTargetKeyRef.current === targetKey
			) {
				stop();
				return;
			}

			stop();
			const seq = ++playSeqRef.current;
			setActiveTarget(targetKey);
			setIsLoading(true);

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
						safeSetCurrentTime(audio, slice.startSec);
					}

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
		[stop, setActiveTarget, ensureAudioElement, playFallbackSpeech],
	);

	return {
		isPlaying,
		isLoading,
		activeTargetKey,
		togglePlay,
		stop,
	};
}
