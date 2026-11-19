import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { hasVerseTimings } from "../../shared/audio-timings";
import type { AudioTrackOption, TranslationLanguage } from "../../shared/types";

export const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 1.75, 2] as const;

function isSafeAudioSrc(url: string): boolean {
	if (url.startsWith("/api/audio/")) return true;
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
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
	audio.playbackRate = rate;
	if ("preservesPitch" in audio) {
		audio.preservesPitch = true;
	}
}

interface UseHumanAudioOptions {
	tracks: AudioTrackOption[];
	visibleVerse?: number;
	autoSync?: boolean;
	onChapterEnded?: () => void;
}

export function useHumanAudio({
	tracks,
	visibleVerse = 1,
	autoSync = true,
	onChapterEnded,
}: UseHumanAudioOptions) {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const shouldAutoPlayOnTrackSwapRef = useRef(false);
	const pendingSyncVerseRef = useRef<number | null>(null);
	const onEndedRef = useRef(onChapterEnded);
	onEndedRef.current = onChapterEnded;

	const visibleVerseRef = useRef(visibleVerse);
	visibleVerseRef.current = visibleVerse;
	const autoSyncRef = useRef(autoSync);
	autoSyncRef.current = autoSync;

	const [preferredLang, setPreferredLang] = useState<TranslationLanguage>("ko");
	const [selectedTrackId, setSelectedTrackId] = useState("");
	const [isPlaying, setIsPlaying] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [playbackRate, setPlaybackRate] = useState(1.0);
	const [isFollowingAudio, setIsFollowingAudio] = useState(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const playbackRateRef = useRef(playbackRate);
	playbackRateRef.current = playbackRate;

	const activeTrack = useMemo(() => {
		const langTracks = tracks.filter((t) => t.language === preferredLang);
		if (langTracks.length === 0) return null;
		return langTracks.find((t) => t.id === selectedTrackId) ?? langTracks[0];
	}, [tracks, preferredLang, selectedTrackId]);

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
					audio.currentTime = targetSec;
					setCurrentTime(targetSec);
				}
				pendingSyncVerseRef.current = null;
			}
		};
		const handlers: Record<string, () => void> = {
			loadedmetadata: () => {
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
				onEndedRef.current?.();
			},
			error: () => {
				pendingSyncVerseRef.current = null;
				setIsPlaying(false);
				setIsLoading(false);
				setErrorMessage("Audio stream could not be loaded for this chapter.");
			},
		};

		for (const [evt, fn] of Object.entries(handlers)) audio.addEventListener(evt, fn);
		return () => {
			audio.pause();
			audio.removeAttribute("src");
			audio.load();
			for (const [evt, fn] of Object.entries(handlers)) audio.removeEventListener(evt, fn);
		};
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
			audio.pause();
			audio.removeAttribute("src");
			audio.load();
			setIsPlaying(false);
			pendingSyncVerseRef.current = null;
			if (track?.url) {
				setErrorMessage("Audio stream URL was rejected.");
			}
			return;
		}

		const resumePlayback = shouldAutoPlayOnTrackSwapRef.current;
		shouldAutoPlayOnTrackSwapRef.current = false;

		if (audio.src !== track.url) {
			audio.src = track.url;
			audio.load();
		}
		applyPlaybackRate(audio, playbackRateRef.current);

		if (resumePlayback) {
			setIsLoading(true);
			audio.play().catch(() => {
				setIsLoading(false);
				setIsPlaying(false);
			});
		}
	}, [activeTrackKey]);

	useEffect(() => {
		if (audioRef.current) applyPlaybackRate(audioRef.current, playbackRate);
	}, [playbackRate]);

	const seekTo = useCallback((seconds: number) => {
		const audio = audioRef.current;
		if (!audio || !Number.isFinite(seconds)) return;
		pendingSyncVerseRef.current = null;
		const validDuration =
			Number.isFinite(audio.duration) && audio.duration > 0
				? audio.duration
				: Number.POSITIVE_INFINITY;
		const clamped = Math.max(0, Math.min(seconds, validDuration));
		audio.currentTime = clamped;
		setCurrentTime(clamped);
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
			audio.pause();
			return;
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

		setErrorMessage(null);
		setIsLoading(true);
		audio.play().catch(() => {
			setIsLoading(false);
			setIsPlaying(false);
			setErrorMessage("Playback blocked or unavailable for this chapter.");
		});
	}, [seekOrQueueVerse]);

	const pause = useCallback(() => {
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

	const switchTrackOrLanguage = useCallback(
		(lang: TranslationLanguage, trackId: string) => {
			shouldAutoPlayOnTrackSwapRef.current = isPlaying;
			pendingSyncVerseRef.current = autoSyncRef.current
				? (activeVerse ?? visibleVerseRef.current)
				: null;
			setPreferredLang(lang);
			setSelectedTrackId(trackId);
		},
		[isPlaying, activeVerse],
	);

	const selectTrack = useCallback(
		(track: AudioTrackOption) => switchTrackOrLanguage(track.language, track.id),
		[switchTrackOrLanguage],
	);

	const selectLanguage = useCallback(
		(lang: TranslationLanguage) => switchTrackOrLanguage(lang, ""),
		[switchTrackOrLanguage],
	);

	const prepareAutoAdvancePlay = useCallback(() => {
		shouldAutoPlayOnTrackSwapRef.current = true;
		pendingSyncVerseRef.current = null;
	}, []);

	const jumpToVerse = useCallback(
		(verseNumber: number) => {
			const track = activeTrackRef.current;
			const startSec = resolveTimeForVerse(track?.verseTimings, verseNumber);
			if (startSec === null) return false;
			setIsFollowingAudio(true);
			seekOrQueueVerse(verseNumber, startSec);
			if (audioRef.current?.paused) {
				audioRef.current.play().catch(() => {});
			}
			return true;
		},
		[seekOrQueueVerse],
	);

	const selectPlaybackRate = useCallback((rate: number) => {
		if ((PLAYBACK_SPEEDS as readonly number[]).includes(rate)) {
			setPlaybackRate(rate);
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
			selectTrack,
			selectLanguage,
			prepareAutoAdvancePlay,
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
			selectTrack,
			selectLanguage,
			prepareAutoAdvancePlay,
			jumpToVerse,
			selectPlaybackRate,
		],
	);
}
