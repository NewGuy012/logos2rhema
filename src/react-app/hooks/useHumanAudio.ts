import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AudioTrackOption, TranslationLanguage } from "../../shared/types";

export const PLAYBACK_SPEEDS = [0.75, 0.9, 1.0, 1.25] as const;

export interface UseHumanAudioOptions {
	tracks: AudioTrackOption[];
	onChapterEnded?: () => void;
}

export function useHumanAudio({ tracks, onChapterEnded }: UseHumanAudioOptions) {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const shouldAutoPlayOnTrackSwapRef = useRef(false);
	const onEndedRef = useRef(onChapterEnded);
	onEndedRef.current = onChapterEnded;

	const [preferredLang, setPreferredLang] = useState<TranslationLanguage>("ko");
	const [selectedTrackId, setSelectedTrackId] = useState<string>("");
	const [isPlaying, setIsPlaying] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [playbackRate, setPlaybackRate] = useState<number>(1.0);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// Sync active track cleanly whenever available tracks or preferred language changes
	const activeTrack = useMemo(() => {
		const langTracks = tracks.filter((t) => t.language === preferredLang);
		if (langTracks.length === 0) return null;
		const exact = langTracks.find((t) => t.id === selectedTrackId);
		return exact ?? langTracks[0];
	}, [tracks, preferredLang, selectedTrackId]);

	const activeVerse = useMemo(() => {
		const timings = activeTrack?.verseTimings;
		if (!timings || !isPlaying) return null;
		let current: number | null = null;
		let bestTime = -1;
		for (const [vStr, startSec] of Object.entries(timings)) {
			const vNum = Number.parseInt(vStr, 10);
			if (!Number.isNaN(vNum) && startSec <= currentTime + 0.25 && startSec >= bestTime) {
				bestTime = startSec;
				current = vNum;
			}
		}
		return current;
	}, [activeTrack, currentTime, isPlaying]);

	// Initialize persistent HTMLAudioElement once in browser
	useEffect(() => {
		if (typeof Audio === "undefined") return;
		const audio = new Audio();
		audio.preload = "metadata";
		audioRef.current = audio;

		const handleTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
		const handleDurationChange = () =>
			setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
		const handlePlay = () => {
			setIsPlaying(true);
			setIsLoading(false);
			setErrorMessage(null);
		};
		const handlePause = () => setIsPlaying(false);
		const handleWaiting = () => setIsLoading(true);
		const handleCanPlay = () => setIsLoading(false);
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
			audio.removeEventListener("durationchange", handleDurationChange);
			audio.removeEventListener("play", handlePlay);
			audio.removeEventListener("pause", handlePause);
			audio.removeEventListener("waiting", handleWaiting);
			audio.removeEventListener("canplay", handleCanPlay);
			audio.removeEventListener("ended", handleEnded);
			audio.removeEventListener("error", handleError);
		};
	}, []);

	// Sync audio src when activeTrack changes
	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		setCurrentTime(0);
		setDuration(0);
		setErrorMessage(null);

		if (!activeTrack?.url) {
			audio.pause();
			audio.removeAttribute("src");
			setIsPlaying(false);
			return;
		}

		const resumePlayback = shouldAutoPlayOnTrackSwapRef.current;
		shouldAutoPlayOnTrackSwapRef.current = false;

		if (audio.src !== activeTrack.url) {
			audio.src = activeTrack.url;
			audio.load();
		}
		audio.playbackRate = playbackRate;
		if ("preservesPitch" in audio) {
			audio.preservesPitch = true;
		}

		if (resumePlayback) {
			setIsLoading(true);
			audio.play().catch(() => {
				setIsLoading(false);
				setIsPlaying(false);
			});
		}
	}, [activeTrack, playbackRate]);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;
		audio.playbackRate = playbackRate;
		if ("preservesPitch" in audio) {
			audio.preservesPitch = true;
		}
	}, [playbackRate]);

	const togglePlay = useCallback(() => {
		const audio = audioRef.current;
		if (!audio || !activeTrack) return;
		if (!audio.paused) {
			audio.pause();
			return;
		}
		setErrorMessage(null);
		setIsLoading(true);
		audio.play().catch(() => {
			setIsLoading(false);
			setIsPlaying(false);
			setErrorMessage("Playback blocked or unavailable for this chapter.");
		});
	}, [activeTrack]);

	const seekTo = useCallback((seconds: number) => {
		const audio = audioRef.current;
		if (!audio) return;
		const clamped = Math.max(0, Math.min(seconds, audio.duration || seconds));
		audio.currentTime = clamped;
		setCurrentTime(clamped);
	}, []);

	const skipBy = useCallback(
		(deltaSeconds: number) => {
			const audio = audioRef.current;
			if (!audio) return;
			seekTo((audio.currentTime || 0) + deltaSeconds);
		},
		[seekTo],
	);

	const selectTrack = useCallback(
		(track: AudioTrackOption) => {
			const wasPlaying = isPlaying;
			shouldAutoPlayOnTrackSwapRef.current = wasPlaying;
			setPreferredLang(track.language);
			setSelectedTrackId(track.id);
		},
		[isPlaying],
	);

	const selectLanguage = useCallback(
		(lang: TranslationLanguage) => {
			shouldAutoPlayOnTrackSwapRef.current = isPlaying;
			setPreferredLang(lang);
			setSelectedTrackId("");
		},
		[isPlaying],
	);

	const prepareAutoAdvancePlay = useCallback(() => {
		shouldAutoPlayOnTrackSwapRef.current = true;
	}, []);

	const jumpToVerse = useCallback(
		(verseNumber: number) => {
			const startSec = activeTrack?.verseTimings?.[verseNumber];
			if (typeof startSec !== "number") return false;
			seekTo(startSec);
			if (!isPlaying) {
				audioRef.current?.play().catch(() => {});
			}
			return true;
		},
		[activeTrack, isPlaying, seekTo],
	);

	const cyclePlaybackRate = useCallback(() => {
		setPlaybackRate((prev) => {
			const idx = PLAYBACK_SPEEDS.indexOf(prev as (typeof PLAYBACK_SPEEDS)[number]);
			return PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length];
		});
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
		errorMessage,
		togglePlay,
		seekTo,
		skipBy,
		selectTrack,
		selectLanguage,
		prepareAutoAdvancePlay,
		jumpToVerse,
		cyclePlaybackRate,
	};
}
