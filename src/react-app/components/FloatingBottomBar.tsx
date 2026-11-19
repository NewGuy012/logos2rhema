import type { ReactNode } from "react";

import type { AudioTrackOption, RightRailTab } from "../../shared/types";
import {
	AudioFallbackAction,
	AudioLanguageToggle,
	AudioScrubber,
	AudioSpeedSelect,
	formatTime,
} from "./AudioShared";
import {
	BookOpen,
	BookText,
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
	preferredLang: string;
	activeTrack: AudioTrackOption | null;
	isPlaying: boolean;
	isLoading: boolean;
	currentTime: number;
	duration: number;
	playbackRate: number;
	errorMessage: string | null;
	activeEnCode: string;
	activeKoCode: string;
	rightRailTab?: RightRailTab;
	dictionaryOpen: boolean;
	dictionarySheet?: ReactNode;
	onToggleDictionary: () => void;
	onTogglePlay: () => void;
	onSeek: (sec: number) => void;
	onSkipBy: (delta: number) => void;
	onSelectTrack: (track: AudioTrackOption) => void;
	onSelectLanguage: (lang: string) => void;
	onChangeSpeed: (rate: number) => void;
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
	rightRailTab = "dictionary",
	dictionaryOpen,
	dictionarySheet,
	onToggleDictionary,
	onTogglePlay,
	onSeek,
	onSkipBy,
	onSelectTrack,
	onSelectLanguage,
	onChangeSpeed,
}: FloatingBottomBarProps) {
	const langTracks = tracks.filter((t) => t.language === preferredLang);
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
								<AudioFallbackAction
									preferredLang={preferredLang}
									tracks={tracks}
									activeKoCode={activeKoCode}
									onSelectLanguage={onSelectLanguage}
								/>
							</div>
						) : (
							<>
								<span className="quick-time">{formatTime(currentTime)}</span>
								<AudioScrubber currentTime={currentTime} duration={duration} onSeek={onSeek} />
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

					<AudioLanguageToggle
						preferredLang={preferredLang}
						activeKoCode={activeKoCode}
						activeEnCode={activeEnCode}
						onSelectLanguage={onSelectLanguage}
					/>

					{activeTrack && (
						<AudioSpeedSelect playbackRate={playbackRate} onChangeSpeed={onChangeSpeed} />
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
						aria-label={
							rightRailTab === "commentary" ? "Toggle commentary" : "Toggle Korean dictionary"
						}
						title={
							rightRailTab === "commentary"
								? "Toggle commentary & study notes"
								: "Toggle Korean dictionary & grammar guide"
						}
					>
						{rightRailTab === "commentary" ? <BookText size={14} /> : <BookOpen size={14} />}
						<span>{rightRailTab === "commentary" ? "Notes" : "어휘"}</span>
					</button>
				</div>
			</nav>
		</div>
	);
}
