import type { AudioTrackOption, TranslationLanguage } from "../../shared/types";
import { AudioFallbackAction, AudioLanguageToggle, AudioScrubber, formatTime } from "./AudioShared";
import {
	ChevronLeft,
	ChevronRight,
	Crosshair,
	Headphones,
	Loader2,
	Pause,
	RefreshCw,
	RotateCcw,
	RotateCw,
} from "./Icons";

interface AudioControlRailProps {
	bookEn: string;
	bookKo: string;
	chapter: number;
	hasPrev: boolean;
	hasNext: boolean;
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
	visibleVerse: number;
	activeVerse: number | null;
	autoSync: boolean;
	isFollowingAudio: boolean;
	onPrevChapter: () => void;
	onNextChapter: () => void;
	onOpenPicker: () => void;
	onTogglePlay: () => void;
	onSeek: (sec: number) => void;
	onSkipBy: (delta: number) => void;
	onSelectTrack: (track: AudioTrackOption) => void;
	onSelectLanguage: (lang: TranslationLanguage) => void;
	onCycleSpeed: () => void;
	onToggleAutoSync: () => void;
	onSyncToVisibleVerse: () => void;
	onFollowActiveVerse: () => void;
}

export function AudioControlRail({
	bookEn,
	bookKo,
	chapter,
	hasPrev,
	hasNext,
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
	visibleVerse,
	activeVerse,
	autoSync,
	isFollowingAudio,
	onPrevChapter,
	onNextChapter,
	onOpenPicker,
	onTogglePlay,
	onSeek,
	onSkipBy,
	onSelectTrack,
	onSelectLanguage,
	onCycleSpeed,
	onToggleAutoSync,
	onSyncToVisibleVerse,
	onFollowActiveVerse,
}: AudioControlRailProps) {
	const langTracks = tracks.filter((t) => t.language === preferredLang);
	const activeLangCode = preferredLang === "ko" ? activeKoCode : activeEnCode;
	const hasTimestamps = Boolean(activeTrack?.verseTimings);

	return (
		<aside className="audio-rail" aria-label="Audio Playback and Verse Sync">
			<div className="rail-card">
				<div className="rail-passage-nav">
					<button
						type="button"
						className="pill-nav-btn"
						disabled={!hasPrev}
						onClick={onPrevChapter}
						aria-label="Previous chapter"
						title="Previous chapter"
					>
						<ChevronLeft size={16} />
					</button>

					<button type="button" className="rail-chapter-btn" onClick={onOpenPicker}>
						<span className="rail-chapter-en">
							{bookEn} {chapter}
						</span>
						<span className="rail-chapter-ko" lang="ko">
							{bookKo} {chapter}장
						</span>
					</button>

					<button
						type="button"
						className="pill-nav-btn"
						disabled={!hasNext}
						onClick={onNextChapter}
						aria-label="Next chapter"
						title="Next chapter"
					>
						<ChevronRight size={16} />
					</button>
				</div>

				<div className="rail-divider" />

				<div className="rail-section-head">
					<span className="rail-section-label">Audio</span>
					<AudioLanguageToggle
						preferredLang={preferredLang}
						activeKoCode={activeKoCode}
						activeEnCode={activeEnCode}
						onSelectLanguage={onSelectLanguage}
					/>
				</div>

				<div className="rail-play-row">
					<button
						type="button"
						className={`rail-play-btn ${isPlaying ? "playing" : ""}`}
						disabled={!activeTrack && !isPlaying}
						onClick={onTogglePlay}
						aria-label={isPlaying ? "Pause audio" : "Play audio"}
					>
						{isLoading ? (
							<Loader2 size={15} className="spin" />
						) : isPlaying ? (
							<Pause size={15} />
						) : (
							<Headphones size={15} />
						)}
						<span>{isPlaying ? "Pause" : `Listen (${activeLangCode})`}</span>
					</button>

					{activeTrack && (
						<button
							type="button"
							className="speed-pill"
							onClick={onCycleSpeed}
							title="Change playback speed"
							aria-label={`Playback speed ${playbackRate}x`}
						>
							{playbackRate}x
						</button>
					)}
				</div>

				{errorMessage ? (
					<p className="rail-note">{errorMessage}</p>
				) : !activeTrack ? (
					<div className="rail-unavailable">
						<p className="rail-note">
							No audio linked to <strong>{activeLangCode}</strong> for this chapter.
						</p>
						<AudioFallbackAction
							preferredLang={preferredLang}
							tracks={tracks}
							activeKoCode={activeKoCode}
							onSelectLanguage={onSelectLanguage}
						/>
					</div>
				) : (
					<>
						<div className="rail-scrubber">
							<AudioScrubber currentTime={currentTime} duration={duration} onSeek={onSeek} />
							<div className="rail-time-row">
								<span className="quick-time">{formatTime(currentTime)}</span>
								<span className="quick-time">{duration > 0 ? formatTime(duration) : "--:--"}</span>
							</div>
						</div>

						<div className="rail-skip-row">
							<button
								type="button"
								className="rail-mini-btn"
								onClick={() => onSkipBy(-10)}
								aria-label="Rewind 10 seconds"
							>
								<RotateCcw size={13} />
								<span>10s</span>
							</button>
							<button
								type="button"
								className="rail-mini-btn"
								onClick={() => onSkipBy(10)}
								aria-label="Forward 10 seconds"
							>
								<span>10s</span>
								<RotateCw size={13} />
							</button>
						</div>

						{langTracks.length > 1 && (
							<div className="rail-track-list" role="group" aria-label="Audio style">
								{langTracks.map((track) => {
									const styleLabel =
										track.audioStyle === "drama"
											? "Drama"
											: track.audioStyle === "standard"
												? "Standard"
												: track.label.split(" ")[0];
									return (
										<button
											key={track.id}
											type="button"
											className={`quick-inline-chip ${track.id === activeTrack.id ? "active" : ""}`}
											onClick={() => onSelectTrack(track)}
											title={track.label}
										>
											{styleLabel}
										</button>
									);
								})}
							</div>
						)}
					</>
				)}

				<div className="rail-divider" />

				<div className="rail-sync-box">
					<div className="rail-section-head">
						<span className="rail-section-label">Verse Sync</span>
						<button
							type="button"
							role="switch"
							aria-checked={autoSync}
							className={`rail-sync-toggle ${autoSync ? "active" : ""}`}
							onClick={onToggleAutoSync}
						>
							<RefreshCw size={11} />
							<span>{autoSync ? "Auto On" : "Auto Off"}</span>
						</button>
					</div>

					<div className="rail-sync-status">
						<span>Visible: v.{visibleVerse}</span>
						{isPlaying && activeVerse && <span>Audio: v.{activeVerse}</span>}
					</div>

					{hasTimestamps ? (
						<div className="rail-sync-actions">
							{(!isPlaying || (activeVerse !== null && activeVerse !== visibleVerse)) && (
								<button type="button" className="rail-sync-btn" onClick={onSyncToVisibleVerse}>
									<Crosshair size={13} />
									<span>Play from v.{visibleVerse}</span>
								</button>
							)}
							{isPlaying && !isFollowingAudio && activeVerse && (
								<button type="button" className="rail-sync-btn" onClick={onFollowActiveVerse}>
									<RefreshCw size={13} />
									<span>Follow Audio (v.{activeVerse})</span>
								</button>
							)}
						</div>
					) : (
						activeTrack && (
							<p className="rail-note">
								Chapter MP3 active. Verse-level sync activates with Bible Brain timestamps.
							</p>
						)
					)}
				</div>
			</div>
		</aside>
	);
}
