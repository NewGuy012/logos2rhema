import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { hasVerseTimings } from "../../shared/audio-timings";
import type { AudioTrackOption, TranslationLanguage } from "../../shared/types";
import { isSafeAudioSrc } from "../../shared/url";
import { loadSyncedChapterAudio } from "../lib/bible-loader";

export const MIN_PLAYBACK_SPEED = 0.1;
export const MAX_PLAYBACK_SPEED = 2.0;
export const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 1.75, 2] as const;

const EMPTY_TRACKS: AudioTrackOption[] = [];
const EMPTY_LANGS: ReadonlySet<TranslationLanguage> = new Set();

interface ChapterTracksState {
	chapterKey: string;
	tracks: AudioTrackOption[];
	fetchedLangs: ReadonlySet<TranslationLanguage>;
}

function mergeChapterTracks(
	existing: AudioTrackOption[],
	incoming: AudioTrackOption[],
	requestedLang?: TranslationLanguage,
): AudioTrackOption[] {
	if (!requestedLang) return incoming;
	const replacedLangs = new Set<TranslationLanguage>([
		requestedLang,
		...incoming.map((t) => t.language),
	]);
	return [...existing.filter((t) => !replacedLangs.has(t.language)), ...incoming];
}

export function useChapterAudioTracks(
	usfm: string,
	chapter: number,
	enabled = true,
	preferredLang: TranslationLanguage = "ko",
) {
	const [state, setState] = useState<ChapterTracksState>({
		chapterKey: "",
		tracks: EMPTY_TRACKS,
		fetchedLangs: EMPTY_LANGS,
	});

	const chapterKey = `${usfm}:${chapter}`;
	const isCurrentChapter = state.chapterKey === chapterKey;
	const tracks = isCurrentChapter ? state.tracks : EMPTY_TRACKS;
	const fetchedLangs = isCurrentChapter ? state.fetchedLangs : EMPTY_LANGS;
	const isValidChapter = Boolean(usfm) && Number.isInteger(chapter) && chapter >= 1;
	const needsFetch = enabled && isValidChapter && !fetchedLangs.has(preferredLang);
	const requestedLang: TranslationLanguage | undefined =
		preferredLang === "ko" ? "ko" : fetchedLangs.has("ko") ? "en" : undefined;

	useEffect(() => {
		if (!needsFetch) return;
		const controller = new AbortController();
		loadSyncedChapterAudio({
			usfm,
			chapter,
			language: requestedLang,
			signal: controller.signal,
		}).then((res) => {
			if (controller.signal.aborted) return;
			setState((prev) => {
				const prevTracks = prev.chapterKey === chapterKey ? prev.tracks : EMPTY_TRACKS;
				const prevLangs = prev.chapterKey === chapterKey ? prev.fetchedLangs : EMPTY_LANGS;
				const nextLangs = new Set(prevLangs);
				if (requestedLang) {
					nextLangs.add(requestedLang);
				} else {
					nextLangs.add("ko");
					nextLangs.add("en");
				}
				return {
					chapterKey,
					tracks: mergeChapterTracks(prevTracks, res.tracks, requestedLang),
					fetchedLangs: nextLangs,
				};
			});
		});
		return () => controller.abort();
	}, [needsFetch, usfm, chapter, chapterKey, requestedLang]);

	return { tracks, loadingTracks: needsFetch };
}

function roundPlaybackRate(rate: number): number {
	return Math.round(rate * 100) / 100;
}

export function normalizePlaybackRate(rate: number): number | null {
	if (!Number.isFinite(rate)) return null;
	const clamped = Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, rate));
	return roundPlaybackRate(clamped);
}

export function parseCustomPlaybackRate(raw: string): number | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || parsed < MIN_PLAYBACK_SPEED || parsed > MAX_PLAYBACK_SPEED) {
		return null;
	}
	return roundPlaybackRate(parsed);
}

export function resolveVerseAtTime(
	timings: Record<number, number> | undefined,
	seconds: number,
): number | null {
	if (!hasVerseTimings(timings)) return null;
	let current: number | null = null;
	let bestTime = -1;
	for (const [vStr, startSec] of Object.entries(timings!)) {
		const vNum = Number.parseInt(vStr, 10);
		if (!Number.isNaN(vNum) && startSec <= seconds + 0.25 && startSec >= bestTime) {
			bestTime = startSec;
			current = vNum;
		}
	}
	return current;
}

export function resolveTimeForVerse(
	timings: Record<number, number> | undefined,
	verseNumber: number,
): number | null {
	if (!hasVerseTimings(timings)) return null;
	const map = timings!;
	if (typeof map[verseNumber] === "number") return map[verseNumber];
	// Walk backward to nearest preceding timed verse if a verse was merged in metadata.
	let bestVerse = -1;
	let bestTime: number | null = null;
	for (const [vStr, startSec] of Object.entries(map)) {
		const vNum = Number.parseInt(vStr, 10);
		if (!Number.isNaN(vNum) && vNum <= verseNumber && vNum > bestVerse) {
			bestVerse = vNum;
			bestTime = startSec;
		}
	}
	return bestTime;
}

function applyPlaybackRate(audio: HTMLAudioElement, rate: number): void {
	audio.defaultPlaybackRate = rate;
	audio.playbackRate = rate;
	if ("preservesPitch" in audio) {
		audio.preservesPitch = true;
	}
}

function safeSetCurrentTime(audio: HTMLAudioElement, seconds: number): number {
	const max =
		Number.isFinite(audio.duration) && audio.duration > 0
			? audio.duration
			: Number.POSITIVE_INFINITY;
	const clamped = Math.max(0, Math.min(seconds, max));
	try {
		audio.currentTime = clamped;
	} catch {}
	return clamped;
}

function clearAudioSource(audio: HTMLAudioElement): void {
	audio.pause();
	audio.removeAttribute("src");
	audio.load();
}

interface UseHumanAudioOptions {
	tracks: AudioTrackOption[];
	isLoadingTracks?: boolean;
	preferredLang?: TranslationLanguage;
	onPreferredLangChange?: (lang: TranslationLanguage) => void;
	visibleVerse?: number;
	autoSync?: boolean;
	onChapterEnded?: () => boolean;
}

export function useHumanAudio({
	tracks,
	isLoadingTracks = false,
	preferredLang: controlledLang,
	onPreferredLangChange,
	visibleVerse = 1,
	autoSync = true,
	onChapterEnded,
}: UseHumanAudioOptions) {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const shouldAutoPlayOnTrackSwapRef = useRef(false);
	const pendingSyncVerseRef = useRef<number | null>(null);
	const playSeqRef = useRef(0);
	const onEndedRef = useRef(onChapterEnded);
	onEndedRef.current = onChapterEnded;

	const visibleVerseRef = useRef(visibleVerse);
	visibleVerseRef.current = visibleVerse;
	const autoSyncRef = useRef(autoSync);
	autoSyncRef.current = autoSync;
	const isLoadingTracksRef = useRef(isLoadingTracks);
	isLoadingTracksRef.current = isLoadingTracks;

	const [uncontrolledLang, setUncontrolledLang] = useState<TranslationLanguage>("ko");
	const preferredLang = controlledLang ?? uncontrolledLang;
	const preferredLangRef = useRef(preferredLang);
	preferredLangRef.current = preferredLang;

	const [isPlaying, setIsPlaying] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [playbackRate, setPlaybackRate] = useState(1.0);
	const [isFollowingAudio, setIsFollowingAudio] = useState(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const playbackRateRef = useRef(playbackRate);
	playbackRateRef.current = playbackRate;

	const activeTrack = useMemo(
		() => tracks.find((t) => t.language === preferredLang) ?? null,
		[tracks, preferredLang],
	);

	const activeTrackRef = useRef(activeTrack);
	activeTrackRef.current = activeTrack;

	const activeVerse = useMemo(
		() => (isPlaying ? resolveVerseAtTime(activeTrack?.verseTimings, currentTime) : null),
		[activeTrack, currentTime, isPlaying],
	);

	useEffect(() => {
		if (typeof Audio === "undefined") return;
		const audio = new Audio();
		audio.preload = "metadata";
		audioRef.current = audio;

		const syncDuration = () => {
			if (Number.isFinite(audio.duration) && audio.duration > 0) {
				setDuration(audio.duration);
			}
		};
		const applyPendingVerseSeek = () => {
			const pendingVerse = pendingSyncVerseRef.current;
			const track = activeTrackRef.current;
			if (pendingVerse !== null && hasVerseTimings(track?.verseTimings)) {
				const targetSec = resolveTimeForVerse(track?.verseTimings, pendingVerse);
				if (targetSec !== null) {
					setCurrentTime(safeSetCurrentTime(audio, targetSec));
				}
				pendingSyncVerseRef.current = null;
			}
		};
		const handlers: Record<string, () => void> = {
			loadedmetadata: () => {
				applyPlaybackRate(audio, playbackRateRef.current);
				syncDuration();
				applyPendingVerseSeek();
			},
			timeupdate: () => {
				if (pendingSyncVerseRef.current === null) {
					setCurrentTime(audio.currentTime || 0);
				}
				syncDuration();
			},
			durationchange: () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0),
			play: () => {
				applyPlaybackRate(audio, playbackRateRef.current);
				setIsPlaying(true);
				setIsLoading(false);
				setErrorMessage(null);
				syncDuration();
			},
			pause: () => setIsPlaying(false),
			waiting: () => setIsLoading(true),
			canplay: () => {
				setIsLoading(false);
				syncDuration();
				applyPendingVerseSeek();
			},
			ended: () => {
				setIsPlaying(false);
				if (onEndedRef.current?.()) {
					shouldAutoPlayOnTrackSwapRef.current = true;
					pendingSyncVerseRef.current = null;
				}
			},
			error: () => {
				if (!audio.getAttribute("src")) return;
				pendingSyncVerseRef.current = null;
				setIsPlaying(false);
				setIsLoading(false);
				setErrorMessage("Audio stream could not be loaded for this chapter.");
			},
		};

		for (const [evt, fn] of Object.entries(handlers)) audio.addEventListener(evt, fn);
		return () => {
			for (const [evt, fn] of Object.entries(handlers)) audio.removeEventListener(evt, fn);
			clearAudioSource(audio);
		};
	}, []);

	const playAudio = useCallback((audio: HTMLAudioElement, blockedMessage?: string) => {
		const seq = ++playSeqRef.current;
		setErrorMessage(null);
		setIsLoading(true);
		audio.play().catch((err: unknown) => {
			if (seq !== playSeqRef.current) return;
			setIsLoading(false);
			setIsPlaying(false);
			if (err instanceof Error && err.name === "AbortError") return;
			if (blockedMessage) setErrorMessage(blockedMessage);
		});
	}, []);

	const activeTrackKey = activeTrack ? `${activeTrack.id}|${activeTrack.url}` : "";

	// Sync audio src when activeTrack changes without resetting position on speed changes.
	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		setCurrentTime(0);
		setDuration(0);
		setErrorMessage(null);
		setIsFollowingAudio(true);

		const track = activeTrackRef.current;
		if (!track?.url || !isSafeAudioSrc(track.url)) {
			if (!isLoadingTracksRef.current) {
				shouldAutoPlayOnTrackSwapRef.current = false;
				pendingSyncVerseRef.current = null;
			}
			clearAudioSource(audio);
			setIsPlaying(false);
			if (track?.url) {
				setErrorMessage("Audio stream URL was rejected.");
			}
			return;
		}

		const resumePlayback = shouldAutoPlayOnTrackSwapRef.current;
		shouldAutoPlayOnTrackSwapRef.current = false;

		if (audio.getAttribute("src") !== track.url) {
			audio.src = track.url;
			audio.load();
		}
		applyPlaybackRate(audio, playbackRateRef.current);

		if (resumePlayback) {
			playAudio(audio);
		}
	}, [activeTrackKey, playAudio]);

	useEffect(() => {
		if (!isLoadingTracks && !activeTrackRef.current) {
			shouldAutoPlayOnTrackSwapRef.current = false;
			pendingSyncVerseRef.current = null;
		}
	}, [isLoadingTracks]);

	useEffect(() => {
		if (audioRef.current) applyPlaybackRate(audioRef.current, playbackRate);
	}, [playbackRate]);

	const seekTo = useCallback((seconds: number) => {
		const audio = audioRef.current;
		if (!audio || !Number.isFinite(seconds)) return;
		pendingSyncVerseRef.current = null;
		setCurrentTime(safeSetCurrentTime(audio, seconds));
	}, []);

	const seekOrQueueVerse = useCallback(
		(verseNumber: number, targetSec: number) => {
			const audio = audioRef.current;
			if (!audio) return;
			// Queue seek for loadedmetadata/canplay when the audio element hasn't loaded metadata yet.
			if (typeof audio.readyState === "number" && audio.readyState < 1) {
				pendingSyncVerseRef.current = verseNumber;
				setCurrentTime(targetSec);
			} else {
				seekTo(targetSec);
			}
		},
		[seekTo],
	);

	const togglePlay = useCallback(() => {
		const audio = audioRef.current;
		const track = activeTrackRef.current;
		if (!audio || !track || !isSafeAudioSrc(track.url)) return;
		if (!audio.paused) {
			playSeqRef.current++;
			audio.pause();
			return;
		}

		if (audio.error) {
			audio.load();
		}
		setIsFollowingAudio(true);

		if (autoSyncRef.current && hasVerseTimings(track.verseTimings)) {
			const targetVerse = visibleVerseRef.current;
			const targetSec = resolveTimeForVerse(track.verseTimings, targetVerse);
			const verseAtAudio = resolveVerseAtTime(track.verseTimings, audio.currentTime || 0);
			const shouldSnap =
				targetSec !== null &&
				(((audio.currentTime || 0) < 0.5 && targetVerse > 1) ||
					(verseAtAudio !== null && verseAtAudio !== targetVerse));
			if (shouldSnap) seekOrQueueVerse(targetVerse, targetSec);
		}

		playAudio(audio, "Playback blocked or unavailable for this chapter.");
	}, [seekOrQueueVerse, playAudio]);

	const pause = useCallback(() => {
		shouldAutoPlayOnTrackSwapRef.current = false;
		playSeqRef.current++;
		const audio = audioRef.current;
		if (audio && !audio.paused) audio.pause();
	}, []);

	const skipBy = useCallback(
		(deltaSeconds: number) => {
			const audio = audioRef.current;
			if (audio) seekTo((audio.currentTime || 0) + deltaSeconds);
		},
		[seekTo],
	);

	const selectLanguage = useCallback(
		(lang: TranslationLanguage) => {
			if (lang === preferredLangRef.current) return;
			shouldAutoPlayOnTrackSwapRef.current = isPlaying;
			pendingSyncVerseRef.current = autoSyncRef.current
				? (activeVerse ?? visibleVerseRef.current)
				: null;
			if (onPreferredLangChange) {
				onPreferredLangChange(lang);
			} else {
				setUncontrolledLang(lang);
			}
		},
		[isPlaying, activeVerse, onPreferredLangChange],
	);

	const jumpToVerse = useCallback(
		(verseNumber: number) => {
			const audio = audioRef.current;
			const track = activeTrackRef.current;
			if (!audio || !track || !isSafeAudioSrc(track.url)) return false;
			const startSec = resolveTimeForVerse(track.verseTimings, verseNumber);
			if (startSec === null) return false;
			setIsFollowingAudio(true);
			seekOrQueueVerse(verseNumber, startSec);
			if (audio.paused) {
				playAudio(audio, "Playback blocked or unavailable for this chapter.");
			}
			return true;
		},
		[seekOrQueueVerse, playAudio],
	);

	const selectPlaybackRate = useCallback((rate: number) => {
		const next = normalizePlaybackRate(rate);
		if (next !== null) {
			setPlaybackRate(next);
		}
	}, []);

	return useMemo(
		() => ({
			preferredLang,
			activeTrack,
			activeVerse,
			isPlaying,
			isLoading,
			currentTime,
			duration,
			playbackRate,
			isFollowingAudio,
			errorMessage,
			setIsFollowingAudio,
			togglePlay,
			pause,
			seekTo,
			skipBy,
			selectLanguage,
			jumpToVerse,
			setPlaybackRate: selectPlaybackRate,
		}),
		[
			preferredLang,
			activeTrack,
			activeVerse,
			isPlaying,
			isLoading,
			currentTime,
			duration,
			playbackRate,
			isFollowingAudio,
			errorMessage,
			togglePlay,
			pause,
			seekTo,
			skipBy,
			selectLanguage,
			jumpToVerse,
			selectPlaybackRate,
		],
	);
}
