import type { ReactNode } from "react";

import { hasVerseTimings, SUPERTONIC_MOBILE_BADGE } from "../../shared/audio-timings";
import { CANONICAL_BIBLES } from "../../shared/translations";
import type { RightRailTab } from "../../shared/types";
import {
	AudioFallbackAction,
	AudioLanguageToggle,
	AudioScrubber,
	AudioSpeedSelect,
	formatDuration,
	formatTime,
	formatTrackTooltip,
	type SharedAudioControlProps,
} from "./AudioShared";
import {
	BookOpen,
	BookText,
	ChevronLeft,
	ChevronRight,
	Headphones,
	Loader2,
	Pause,
	RefreshCw,
	RotateCcw,
	RotateCw,
} from "./Icons";

interface FloatingBottomBarProps extends SharedAudioControlProps {
	hasPrev: boolean;
	hasNext: boolean;
	onPrevChapter: () => void;
	onNextChapter: () => void;
	onOpenPicker: () => void;
	activeVerse?: number | null;
	autoSync?: boolean;
	isFollowingAudio?: boolean;
	rightRailTab?: RightRailTab;
	dictionaryOpen: boolean;
	dictionarySheet?: ReactNode;
	onToggleDictionary: () => void;
	onToggleAutoSync?: () => void;
	onFollowActiveVerse?: () => void;
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
	activeVerse = null,
	autoSync = true,
	isFollowingAudio = true,
	rightRailTab = "dictionary",
	dictionaryOpen,
	dictionarySheet,
	onToggleDictionary,
	onTogglePlay,
	onSeek,
	onSkipBy,
	onSelectLanguage,
	onChangeSpeed,
	onToggleAutoSync,
	onFollowActiveVerse,
}: FloatingBottomBarProps) {
	const activeLangCode = CANONICAL_BIBLES[preferredLang].code;
	const showScrubber = Boolean(activeTrack && (isPlaying || currentTime > 0));
	const showUnavailable = Boolean(!activeTrack);
	const hasTimestamps = hasVerseTimings(activeTrack?.verseTimings);
	const syncActive = hasTimestamps && autoSync;
	const showFollowChip = Boolean(
		syncActive && isPlaying && !isFollowingAudio && activeVerse && onFollowActiveVerse,
	);

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
									onSelectLanguage={onSelectLanguage}
								/>
							</div>
						) : (
							<>
								<span className="quick-time">{formatTime(currentTime)}</span>
								<AudioScrubber currentTime={currentTime} duration={duration} onSeek={onSeek} />
								<span className="quick-time">{formatDuration(duration)}</span>
								{activeTrack?.isAiGenerated && (
									<span className="quick-strip-ai-badge" lang="ko" title={activeTrack.label}>
										{SUPERTONIC_MOBILE_BADGE}
									</span>
								)}
								{showFollowChip && activeVerse && onFollowActiveVerse ? (
									<button
										type="button"
										className="quick-inline-chip active"
										onClick={onFollowActiveVerse}
										title={`Scroll back to verse ${activeVerse}`}
									>
										<RefreshCw size={10} />
										<span>Follow v.{activeVerse}</span>
									</button>
								) : (
									hasTimestamps &&
									onToggleAutoSync && (
										<button
											type="button"
											role="switch"
											aria-checked={syncActive}
											className={`quick-inline-chip ${syncActive ? "active" : ""}`.trim()}
											onClick={onToggleAutoSync}
											title={
												syncActive ? "Auto-scroll verse sync on" : "Auto-scroll verse sync off"
											}
										>
											<RefreshCw size={10} />
											<span>{syncActive ? "Sync" : "Sync Off"}</span>
										</button>
									)
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
						title={formatTrackTooltip(activeTrack, activeLangCode)}
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

					<AudioLanguageToggle preferredLang={preferredLang} onSelectLanguage={onSelectLanguage} />

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
