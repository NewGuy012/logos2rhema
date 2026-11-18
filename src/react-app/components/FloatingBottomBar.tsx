import type { ReactNode } from "react";

import type { AudioTrackOption, TranslationLanguage } from "../../shared/types";
import {
	BookOpen,
	ChevronLeft,
	ChevronRight,
	Headphones,
	Loader2,
	Pause,
	RotateCcw,
	RotateCw,
} from "./Icons";

interface FloatingBottomBarProps {
	bookEn: string;
	bookKo: string;
	chapter: number;
	hasPrev: boolean;
	hasNext: boolean;
	onPrevChapter: () => void;
	onNextChapter: () => void;
	onOpenPicker: () => void;
	tracks: AudioTrackOption[];
	preferredLang: TranslationLanguage;
	activeTrack: AudioTrackOption | null;
	isPlaying: boolean;
	isLoading: boolean;
	currentTime: number;
	duration: number;
	playbackRate: number;
	errorMessage: string | null;
	activeEnCode: string;
	activeKoCode: string;
	dictionaryOpen: boolean;
	dictionarySheet?: ReactNode;
	onToggleDictionary: () => void;
	onTogglePlay: () => void;
	onSeek: (sec: number) => void;
	onSkipBy: (delta: number) => void;
	onSelectTrack: (track: AudioTrackOption) => void;
	onSelectLanguage: (lang: TranslationLanguage) => void;
	onCycleSpeed: () => void;
}

function formatTime(totalSeconds: number): string {
	if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0:00";
	const mins = Math.floor(totalSeconds / 60);
	const secs = Math.floor(totalSeconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function FloatingBottomBar({
	bookEn,
	bookKo,
	chapter,
	hasPrev,
	hasNext,
	onPrevChapter,
	onNextChapter,
	onOpenPicker,
	tracks,
	preferredLang,
	activeTrack,
	isPlaying,
	isLoading,
	currentTime,
	duration,
	playbackRate,
	errorMessage,
	activeEnCode,
	activeKoCode,
	dictionaryOpen,
	dictionarySheet,
	onToggleDictionary,
	onTogglePlay,
	onSeek,
	onSkipBy,
	onSelectTrack,
	onSelectLanguage,
	onCycleSpeed,
}: FloatingBottomBarProps) {
	const langTracks = tracks.filter((t) => t.language === preferredLang);
	const koTracks = tracks.filter((t) => t.language === "ko");
	const activeLangCode = preferredLang === "ko" ? activeKoCode : activeEnCode;
	const showScrubber = Boolean(activeTrack && (isPlaying || currentTime > 0));
	const showUnavailable = Boolean(!activeTrack && preferredLang === "en");

	const handleCycleNarrator = () => {
		if (langTracks.length <= 1 || !activeTrack) return;
		const idx = langTracks.findIndex((t) => t.id === activeTrack.id);
		const next = langTracks[(idx + 1) % langTracks.length];
		onSelectTrack(next);
	};

	return (
		<div className="floating-dock">
			{dictionarySheet}

			<nav className="quick-bar" aria-label="Chapter, Audio, and Dictionary Quick Access">
				{(showScrubber || errorMessage || showUnavailable) && (
					<div className="quick-bar-strip">
						{errorMessage ? (
							<span className="quick-strip-note">{errorMessage}</span>
						) : showUnavailable ? (
							<div className="quick-strip-unavailable">
								<span>
									No audio recording linked to <strong>{activeLangCode}</strong> for this chapter.
								</span>
								{koTracks.length > 0 && (
									<button
										type="button"
										className="quick-inline-chip active"
										onClick={() => onSelectLanguage("ko")}
									>
										Use {activeKoCode}
									</button>
								)}
							</div>
						) : (
							<>
								<span className="quick-time">{formatTime(currentTime)}</span>
								<input
									type="range"
									className="audio-range"
									min={0}
									max={duration > 0 ? duration : 100}
									step={0.5}
									value={duration > 0 ? Math.min(currentTime, duration) : 0}
									onChange={(e) => onSeek(Number.parseFloat(e.target.value))}
									aria-label="Audio playback progress"
								/>
								<span className="quick-time">{duration > 0 ? formatTime(duration) : "--:--"}</span>
								{langTracks.length > 1 && activeTrack && (
									<button
										type="button"
										className="quick-inline-chip"
										onClick={handleCycleNarrator}
										title={`Switch narrator (${activeTrack.label})`}
									>
										{activeTrack.label.split(" ")[0]} ↻
									</button>
								)}
							</>
						)}
					</div>
				)}

				<div className="quick-bar-row">
					<button
						type="button"
						className={`pill-audio-btn ${isPlaying ? "playing" : ""}`}
						disabled={!activeTrack && !isPlaying}
						onClick={onTogglePlay}
						aria-label={isPlaying ? "Pause audio" : "Play audio"}
						title={activeTrack ? activeTrack.label : `No audio available for ${activeLangCode}`}
					>
						{isLoading ? (
							<Loader2 size={14} className="spin" />
						) : isPlaying ? (
							<Pause size={14} />
						) : (
							<Headphones size={14} />
						)}
						<span>{isPlaying ? "Pause" : "Listen"}</span>
					</button>

					<div className="quick-lang-toggle" role="group" aria-label="Audio language">
						<button
							type="button"
							className={`quick-lang-btn ${preferredLang === "ko" ? "active" : ""}`}
							onClick={() => onSelectLanguage("ko")}
							title={`Korean audio (${activeKoCode})`}
						>
							한
						</button>
						<button
							type="button"
							className={`quick-lang-btn ${preferredLang === "en" ? "active" : ""}`}
							onClick={() => onSelectLanguage("en")}
							title={`English audio (${activeEnCode})`}
						>
							EN
						</button>
					</div>

					{activeTrack && (
						<button
							type="button"
							className="speed-pill"
							onClick={onCycleSpeed}
							title="Change reading speed"
							aria-label={`Playback speed ${playbackRate}x`}
						>
							{playbackRate}x
						</button>
					)}

					<button
						type="button"
						className={`pill-nav-btn ${isPlaying ? "skip-mode" : ""}`}
						disabled={isPlaying ? false : !hasPrev}
						onClick={() => (isPlaying ? onSkipBy(-10) : onPrevChapter())}
						aria-label={isPlaying ? "Rewind 10 seconds" : "Previous chapter"}
						title={isPlaying ? "Rewind 10 seconds (Left Arrow)" : "Previous chapter (Left Arrow)"}
					>
						{isPlaying ? (
							<span className="skip-btn-inner">
								<RotateCcw size={14} />
								<span className="skip-tag">10</span>
							</span>
						) : (
							<ChevronLeft size={18} />
						)}
					</button>

					<button type="button" className="pill-chapter-btn" onClick={onOpenPicker}>
						{bookEn} {chapter} · {bookKo} {chapter}장
					</button>

					<button
						type="button"
						className={`pill-nav-btn ${isPlaying ? "skip-mode" : ""}`}
						disabled={isPlaying ? false : !hasNext}
						onClick={() => (isPlaying ? onSkipBy(10) : onNextChapter())}
						aria-label={isPlaying ? "Forward 10 seconds" : "Next chapter"}
						title={isPlaying ? "Forward 10 seconds (Right Arrow)" : "Next chapter (Right Arrow)"}
					>
						{isPlaying ? (
							<span className="skip-btn-inner">
								<span className="skip-tag">10</span>
								<RotateCw size={14} />
							</span>
						) : (
							<ChevronRight size={18} />
						)}
					</button>

					<button
						type="button"
						className={`quick-dict-btn ${dictionaryOpen ? "active" : ""}`}
						onClick={onToggleDictionary}
						aria-expanded={dictionaryOpen}
						aria-label="Toggle Korean dictionary"
						title="Toggle Korean dictionary & grammar guide"
					>
						<BookOpen size={14} />
						<span>어휘</span>
					</button>
				</div>
			</nav>
		</div>
	);
}
