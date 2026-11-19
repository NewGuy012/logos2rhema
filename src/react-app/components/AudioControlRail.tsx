import { useState } from "react";

import { hasVerseTimings } from "../../shared/audio-timings";
import { CANONICAL_BIBLES } from "../../shared/translations";
import type { AudioTrackOption, TranslationLanguage } from "../../shared/types";
import { type PanelPosition, useDraggablePanel } from "../hooks/useDraggablePanel";
import {
	AudioFallbackAction,
	AudioLanguageToggle,
	AudioScrubber,
	AudioSpeedSelect,
	formatTime,
} from "./AudioShared";
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Crosshair,
	Loader2,
	Pause,
	Play,
	RefreshCw,
	RotateCcw,
	RotateCw,
	Settings,
} from "./Icons";
import { PanelSnapBackButton } from "./RailShared";

interface AudioControlRailProps {
	bookEn: string;
	bookKo: string;
	chapter: number;
	tracks: AudioTrackOption[];
	preferredLang: TranslationLanguage;
	activeTrack: AudioTrackOption | null;
	isPlaying: boolean;
	isLoading: boolean;
	currentTime: number;
	duration: number;
	playbackRate: number;
	errorMessage: string | null;
	visibleVerse: number;
	activeVerse: number | null;
	autoSync: boolean;
	isFollowingAudio: boolean;
	floatingPosition?: PanelPosition | null;
	onFloatingPositionChange?: (pos: PanelPosition | null) => void;
	isActiveFloating?: boolean;
	onActivateFloating?: () => void;
	onTogglePlay: () => void;
	onSeek: (sec: number) => void;
	onSkipBy: (delta: number) => void;
	onSelectLanguage: (lang: TranslationLanguage) => void;
	onChangeSpeed: (rate: number) => void;
	onToggleAutoSync: () => void;
	onSyncToVisibleVerse: () => void;
	onFollowActiveVerse: () => void;
	onMinimize?: () => void;
}

export function AudioControlRail({
	bookEn,
	bookKo,
	chapter,
	tracks,
	preferredLang,
	activeTrack,
	isPlaying,
	isLoading,
	currentTime,
	duration,
	playbackRate,
	errorMessage,
	visibleVerse,
	activeVerse,
	autoSync,
	isFollowingAudio,
	floatingPosition,
	onFloatingPositionChange,
	isActiveFloating = false,
	onActivateFloating,
	onTogglePlay,
	onSeek,
	onSkipBy,
	onSelectLanguage,
	onChangeSpeed,
	onToggleAutoSync,
	onSyncToVisibleVerse,
	onFollowActiveVerse,
	onMinimize,
}: AudioControlRailProps) {
	const [settingsOpen, setSettingsOpen] = useState(false);
	const {
		panelRef,
		isFloating,
		isDragging,
		onMouseDown,
		onMouseDownCapture,
		resetPosition,
		floatingStyle,
	} = useDraggablePanel<HTMLElement>({
		enabled: true,
		position: floatingPosition,
		onPositionChange: onFloatingPositionChange,
		onActivate: onActivateFloating,
		isActive: isActiveFloating,
	});
	const activeLangCode = CANONICAL_BIBLES[preferredLang].code;
	const hasTimestamps = hasVerseTimings(activeTrack?.verseTimings);
	const syncActive = hasTimestamps && autoSync;
	const showFollowButton = Boolean(syncActive && isPlaying && !isFollowingAudio && activeVerse);
	const showPlayFromButton = !isPlaying || (activeVerse !== null && activeVerse !== visibleVerse);

	return (
		<aside
			ref={panelRef}
			className={`audio-rail ${isFloating ? "floating" : ""} ${isDragging ? "is-dragging" : ""}`.trim()}
			style={floatingStyle}
			onMouseDown={onMouseDown}
			onMouseDownCapture={onMouseDownCapture}
			aria-label="Audio Playback and Verse Sync"
		>
			<div className="rail-card">
				<div className="rail-panel-header panel-drag-handle">
					{onMinimize ? (
						<button
							type="button"
							className="pill-nav-btn rail-minimize-btn"
							onClick={onMinimize}
							aria-expanded={true}
							aria-label="Minimize audio"
							title="Minimize audio"
						>
							<ChevronLeft size={15} />
						</button>
					) : (
						<span aria-hidden="true" />
					)}
					<div className="panel-header-text">
						<h2 className="panel-title">Audio</h2>
						<p className="panel-subtitle">
							{bookEn} {chapter} ·{" "}
							<span lang="ko">
								{bookKo} {chapter}장
							</span>
						</p>
					</div>
					{isFloating ? (
						<PanelSnapBackButton
							onClick={resetPosition}
							ariaLabel="Snap audio back to original position"
						/>
					) : (
						<span aria-hidden="true" />
					)}
				</div>

				<div className="rail-player">
					<div className="rail-lang-row">
						<AudioLanguageToggle
							preferredLang={preferredLang}
							onSelectLanguage={onSelectLanguage}
						/>
					</div>

					{activeTrack && !errorMessage && (
						<div className="rail-scrubber">
							<AudioScrubber currentTime={currentTime} duration={duration} onSeek={onSeek} />
						</div>
					)}

					<div className="rail-transport-row">
						<button
							type="button"
							className="rail-skip-btn rail-skip-back"
							disabled={!activeTrack || Boolean(errorMessage)}
							onClick={() => onSkipBy(-10)}
							aria-label="Rewind 10 seconds"
							title="Rewind 10 seconds"
						>
							<RotateCcw size={12} />
							<span>10s</span>
						</button>

						<button
							type="button"
							className={`rail-play-btn ${isPlaying ? "playing" : ""}`}
							disabled={!activeTrack && !isPlaying}
							onClick={onTogglePlay}
							aria-label={isPlaying ? "Pause audio" : "Play audio"}
							title={
								activeTrack
									? `${activeTrack.label} (${activeLangCode})`
									: `No audio available for ${activeLangCode}`
							}
						>
							{isLoading ? (
								<Loader2 size={14} className="spin" />
							) : isPlaying ? (
								<Pause size={14} />
							) : (
								<Play size={14} />
							)}
							<span>{isPlaying ? "Pause" : "Play"}</span>
						</button>

						<button
							type="button"
							className="rail-skip-btn rail-skip-forward"
							disabled={!activeTrack || Boolean(errorMessage)}
							onClick={() => onSkipBy(10)}
							aria-label="Forward 10 seconds"
							title="Forward 10 seconds"
						>
							<span>10s</span>
							<RotateCw size={12} />
						</button>
					</div>

					{errorMessage ? (
						<p className="rail-note">{errorMessage}</p>
					) : !activeTrack ? (
						<div className="rail-unavailable">
							<p className="rail-note">No {activeLangCode} audio for this chapter.</p>
							<AudioFallbackAction
								preferredLang={preferredLang}
								tracks={tracks}
								onSelectLanguage={onSelectLanguage}
							/>
						</div>
					) : (
						<>
							<div className="rail-time-row">
								<span className="quick-time">{formatTime(currentTime)}</span>
								<AudioSpeedSelect playbackRate={playbackRate} onChangeSpeed={onChangeSpeed} />
								<span className="quick-time rail-duration">
									{duration > 0 ? formatTime(duration) : "--:--"}
								</span>
							</div>

							{showFollowButton && activeVerse && (
								<button
									type="button"
									className="rail-sync-btn rail-follow-btn"
									onClick={onFollowActiveVerse}
								>
									<RefreshCw size={12} />
									<span>Follow Audio (v.{activeVerse})</span>
								</button>
							)}
						</>
					)}
				</div>

				<div className="rail-divider" />

				<div className="rail-settings">
					<button
						type="button"
						className="rail-settings-btn"
						aria-expanded={settingsOpen}
						onClick={() => setSettingsOpen((prev) => !prev)}
					>
						<span className="rail-settings-label">
							<Settings size={13} />
							<span>Settings</span>
						</span>
						{settingsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
					</button>

					{settingsOpen && (
						<div className="rail-sync-box">
							<div className="rail-section-head">
								<span className="rail-section-label">Verse Sync</span>
								<button
									type="button"
									role="switch"
									aria-checked={syncActive}
									disabled={!hasTimestamps}
									className={`rail-sync-toggle ${syncActive ? "active" : ""}`}
									onClick={onToggleAutoSync}
									title={
										hasTimestamps
											? "Toggle automatic verse sync"
											: "Verse sync unavailable for this audio"
									}
								>
									<RefreshCw size={10} />
									<span>{syncActive ? "On" : "Off"}</span>
								</button>
							</div>

							{hasTimestamps ? (
								<>
									<dl className="rail-sync-status">
										<div className="rail-kv-row">
											<dt className="rail-section-label">Reading</dt>
											<dd className="rail-sync-value">v.{visibleVerse}</dd>
										</div>
										{Boolean(isPlaying && activeVerse) && (
											<div className="rail-kv-row">
												<dt className="rail-section-label">Playing</dt>
												<dd className="rail-sync-value">v.{activeVerse}</dd>
											</div>
										)}
									</dl>

									{showPlayFromButton && (
										<div className="rail-sync-actions">
											<button
												type="button"
												className="rail-sync-btn"
												onClick={onSyncToVisibleVerse}
											>
												<Crosshair size={12} />
												<span>Play from v.{visibleVerse}</span>
											</button>
										</div>
									)}
								</>
							) : (
								activeTrack && (
									<p className="rail-sync-hint">Verse sync unavailable for this audio</p>
								)
							)}
						</div>
					)}
				</div>
			</div>
		</aside>
	);
}
