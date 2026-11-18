import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AudioTrackOption } from "../../shared/types";

export const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 1.75, 2] as const;

export function resolveVerseAtTime(
	timings: Record<number, number> | undefined,
	seconds: number,
): number | null {
	if (!timings) return null;
	let current: number | null = null;
	let bestTime = -1;
	for (const [vStr, startSec] of Object.entries(timings)) {
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
	if (!timings) return null;
	if (typeof timings[verseNumber] === "number") {
		return timings[verseNumber];
	}
	// Walk backward to nearest preceding timed verse if a verse was merged in audio metadata
	let bestVerse = -1;
	let bestTime: number | null = null;
	for (const [vStr, startSec] of Object.entries(timings)) {
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

export interface UseHumanAudioOptions {
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

	const [preferredLang, setPreferredLang] = useState<string>("ko");
	const [selectedTrackId, setSelectedTrackId] = useState<string>("");
	const [isPlaying, setIsPlaying] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [playbackRate, setPlaybackRate] = useState<number>(1.0);
	const [isFollowingAudio, setIsFollowingAudio] = useState<boolean>(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const playbackRateRef = useRef(playbackRate);
	playbackRateRef.current = playbackRate;

	const activeTrack = useMemo(() => {
		const langTracks = tracks.filter((t) => t.language === preferredLang);
		if (langTracks.length === 0) return null;
		const exact = langTracks.find((t) => t.id === selectedTrackId);
		return exact ?? langTracks[0];
	}, [tracks, preferredLang, selectedTrackId]);

	const activeTrackRef = useRef(activeTrack);
	activeTrackRef.current = activeTrack;

	const activeVerse = useMemo(() => {
		if (!isPlaying) return null;
		return resolveVerseAtTime(activeTrack?.verseTimings, currentTime);
	}, [activeTrack, currentTime, isPlaying]);

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
			if (pendingVerse !== null && track?.verseTimings) {
				const targetSec = resolveTimeForVerse(track.verseTimings, pendingVerse);
				if (targetSec !== null) {
					audio.currentTime = targetSec;
					setCurrentTime(targetSec);
				}
				pendingSyncVerseRef.current = null;
			}
		};
		const handleLoadedMetadata = () => {
			syncDuration();
			applyPendingVerseSeek();
		};
		const handleTimeUpdate = () => {
			setCurrentTime(audio.currentTime || 0);
			syncDuration();
		};
		const handleDurationChange = () =>
			setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
		const handlePlay = () => {
			setIsPlaying(true);
			setIsLoading(false);
			setErrorMessage(null);
			syncDuration();
		};
		const handlePause = () => setIsPlaying(false);
		const handleWaiting = () => setIsLoading(true);
		const handleCanPlay = () => {
			setIsLoading(false);
			syncDuration();
			applyPendingVerseSeek();
		};
		const handleEnded = () => {
			setIsPlaying(false);
			onEndedRef.current?.();
		};
		const handleError = () => {
			setIsPlaying(false);
			setIsLoading(false);
			setErrorMessage("Audio stream could not be loaded for this chapter.");
		};

		audio.addEventListener("timeupdate", handleTimeUpdate);
		audio.addEventListener("loadedmetadata", handleLoadedMetadata);
		audio.addEventListener("durationchange", handleDurationChange);
		audio.addEventListener("play", handlePlay);
		audio.addEventListener("pause", handlePause);
		audio.addEventListener("waiting", handleWaiting);
		audio.addEventListener("canplay", handleCanPlay);
		audio.addEventListener("ended", handleEnded);
		audio.addEventListener("error", handleError);

		return () => {
			audio.pause();
			audio.removeAttribute("src");
			audio.removeEventListener("timeupdate", handleTimeUpdate);
			audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
			audio.removeEventListener("durationchange", handleDurationChange);
			audio.removeEventListener("play", handlePlay);
			audio.removeEventListener("pause", handlePause);
			audio.removeEventListener("waiting", handleWaiting);
			audio.removeEventListener("canplay", handleCanPlay);
			audio.removeEventListener("ended", handleEnded);
			audio.removeEventListener("error", handleError);
		};
	}, []);

	const activeTrackKey = activeTrack ? `${activeTrack.id}|${activeTrack.url}` : "";

	// Sync audio src when activeTrack changes (without resetting position on speed changes)
	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		setCurrentTime(0);
		setDuration(0);
		setErrorMessage(null);
		setIsFollowingAudio(true);

		const track = activeTrackRef.current;
		if (!track?.url) {
			audio.pause();
			audio.removeAttribute("src");
			setIsPlaying(false);
			pendingSyncVerseRef.current = null;
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
		const audio = audioRef.current;
		if (!audio) return;
		applyPlaybackRate(audio, playbackRate);
	}, [playbackRate]);

	const seekTo = useCallback((seconds: number) => {
		const audio = audioRef.current;
		if (!audio || !Number.isFinite(seconds)) return;
		const validDuration =
			Number.isFinite(audio.duration) && audio.duration > 0
				? audio.duration
				: Number.POSITIVE_INFINITY;
		const clamped = Math.max(0, Math.min(seconds, validDuration));
		audio.currentTime = clamped;
		setCurrentTime(clamped);
	}, []);

	const togglePlay = useCallback(() => {
		const audio = audioRef.current;
		if (!audio || !activeTrack) return;
		if (!audio.paused) {
			audio.pause();
			return;
		}

		setIsFollowingAudio(true);

		// Two-way auto-sync: start playback from the currently visible verse when timestamps exist
		if (autoSyncRef.current && activeTrack.verseTimings) {
			const targetVerse = visibleVerseRef.current;
			const targetSec = resolveTimeForVerse(activeTrack.verseTimings, targetVerse);
			const verseAtAudio = resolveVerseAtTime(activeTrack.verseTimings, audio.currentTime || 0);
			const shouldSnap =
				targetSec !== null &&
				(((audio.currentTime || 0) < 0.5 && targetVerse > 1) ||
					(verseAtAudio !== null && verseAtAudio !== targetVerse));
			if (shouldSnap) {
				seekTo(targetSec);
			}
		}

		setErrorMessage(null);
		setIsLoading(true);
		audio.play().catch(() => {
			setIsLoading(false);
			setIsPlaying(false);
			setErrorMessage("Playback blocked or unavailable for this chapter.");
		});
	}, [activeTrack, seekTo]);

	const pause = useCallback(() => {
		const audio = audioRef.current;
		if (!audio) return;
		if (!audio.paused) {
			audio.pause();
		}
	}, []);

	const skipBy = useCallback(
		(deltaSeconds: number) => {
			const audio = audioRef.current;
			if (!audio) return;
			seekTo((audio.currentTime || 0) + deltaSeconds);
		},
		[seekTo],
	);

	const switchTrackOrLanguage = useCallback(
		(lang: string, trackId: string) => {
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
		(lang: string) => switchTrackOrLanguage(lang, ""),
		[switchTrackOrLanguage],
	);

	const prepareAutoAdvancePlay = useCallback(() => {
		shouldAutoPlayOnTrackSwapRef.current = true;
		pendingSyncVerseRef.current = null;
	}, []);

	const jumpToVerse = useCallback(
		(verseNumber: number) => {
			const startSec = resolveTimeForVerse(activeTrack?.verseTimings, verseNumber);
			if (startSec === null) return false;
			setIsFollowingAudio(true);
			seekTo(startSec);
			if (!isPlaying) {
				audioRef.current?.play().catch(() => {});
			}
			return true;
		},
		[activeTrack, isPlaying, seekTo],
	);

	const selectPlaybackRate = useCallback((rate: number) => {
		if ((PLAYBACK_SPEEDS as readonly number[]).includes(rate)) {
			setPlaybackRate(rate);
		}
	}, []);

	return {
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
	};
}
