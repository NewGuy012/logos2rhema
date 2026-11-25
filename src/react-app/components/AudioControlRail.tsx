import { useState } from "react";

import { hasVerseTimings } from "../../shared/audio-timings";
import { CANONICAL_BIBLES } from "../../shared/translations";
import { DEFAULT_MAX_AUDIO_RAIL_WIDTH, DEFAULT_MIN_AUDIO_HEIGHT } from "../hooks/useResizablePanel";
import {
	AudioFallbackAction,
	AudioLanguageToggle,
	AudioScrubber,
	AudioSpeedSelect,
	AudioTransportControls,
	formatDuration,
	formatTime,
	type SharedAudioControlProps,
} from "./AudioShared";
import { ChevronDown, ChevronLeft, ChevronRight, Crosshair, RefreshCw, Settings } from "./Icons";
import {
	type DraggableRailProps,
	DraggableRailShell,
	PanelHeaderText,
	PanelResetButton,
} from "./RailShared";

interface AudioControlRailProps extends SharedAudioControlProps, DraggableRailProps {
	visibleVerse: number;
	activeVerse: number | null;
	autoSync: boolean;
	isFollowingAudio: boolean;
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
	isLoadingTracks = false,
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
	railSize,
	onRailSizeChange,
	maxRailWidth,
	maxRailHeight,
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
	const activeLangCode = CANONICAL_BIBLES[preferredLang].code;
	const hasTimestamps = hasVerseTimings(activeTrack?.verseTimings);
	const syncActive = hasTimestamps && autoSync;
	const syncStatusText = !hasTimestamps
		? "No verse sync"
		: syncActive
			? "Verse sync on"
			: "Verse sync off";
	const showFollowButton = Boolean(syncActive && isPlaying && !isFollowingAudio && activeVerse);
	const isPlayingVisibleVerse = Boolean(isPlaying && activeVerse === visibleVerse);
	const currentVerse = isPlaying && activeVerse ? activeVerse : visibleVerse;

	return (
		<DraggableRailShell
			className="audio-rail"
			ariaLabel="Audio Playback and Verse Sync"
			dockSide="left"
			resizeLabel="Resize audio panel"
			floatingPosition={floatingPosition}
			onFloatingPositionChange={onFloatingPositionChange}
			isActiveFloating={isActiveFloating}
			onActivateFloating={onActivateFloating}
			railSize={railSize}
			onRailSizeChange={onRailSizeChange}
			maxRailWidth={maxRailWidth ?? DEFAULT_MAX_AUDIO_RAIL_WIDTH}
			minRailHeight={DEFAULT_MIN_AUDIO_HEIGHT}
			maxRailHeight={maxRailHeight}
		>
			{({ isModified, resetPanel }) => (
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
						<PanelHeaderText title="Audio" bookEn={bookEn} bookKo={bookKo} chapter={chapter} />
						{isModified ? (
							<PanelResetButton
								onClick={resetPanel}
								ariaLabel="Reset audio to original position and size"
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

						<AudioTransportControls
							className="rail-transport-row"
							skipBackClassName="rail-skip-btn rail-skip-back"
							skipForwardClassName="rail-skip-btn rail-skip-forward"
							activeTrack={activeTrack}
							activeLangCode={activeLangCode}
							isPlaying={isPlaying}
							isLoading={isLoading || isLoadingTracks}
							errorMessage={errorMessage}
							onSkipBy={onSkipBy}
							onTogglePlay={onTogglePlay}
						/>

						{errorMessage ? (
							<p className="rail-note">{errorMessage}</p>
						) : !activeTrack ? (
							isLoadingTracks ? (
								<p className="rail-note">Checking available audio tracks...</p>
							) : (
								<div className="rail-unavailable">
									<p className="rail-note">No {activeLangCode} audio for this chapter.</p>
									<AudioFallbackAction
										preferredLang={preferredLang}
										tracks={tracks}
										onSelectLanguage={onSelectLanguage}
									/>
								</div>
							)
						) : (
							<>
								<div className="rail-time-row">
									<span className="quick-time">{formatTime(currentTime)}</span>
									<AudioSpeedSelect playbackRate={playbackRate} onChangeSpeed={onChangeSpeed} />
									<span className="quick-time rail-duration">{formatDuration(duration)}</span>
								</div>

								<p className="rail-track-caption">
									<span
										className="rail-track-name"
										lang={activeTrack.language === "ko" ? "ko" : undefined}
									>
										{activeTrack.attribution ?? activeTrack.label}
									</span>
									{" · "}
									<span className="rail-track-sync">{syncStatusText}</span>
								</p>

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

					<div className={`rail-settings ${settingsOpen ? "rail-settings-open" : ""}`.trim()}>
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
									<dl className="rail-sync-status">
										<div className="rail-kv-row">
											<dt className="rail-section-label">Play from</dt>
											<dd className="rail-sync-control">
												<button
													type="button"
													aria-pressed={isPlayingVisibleVerse}
													aria-label={`Play from v.${visibleVerse}`}
													title={`Play from v.${visibleVerse}`}
													className={`rail-sync-toggle ${isPlayingVisibleVerse ? "active" : ""}`.trim()}
													onClick={onSyncToVisibleVerse}
												>
													<Crosshair size={10} />
													<span>v.{visibleVerse}</span>
												</button>
											</dd>
										</div>
										<div className="rail-kv-row">
											<dt className="rail-section-label">Current</dt>
											<dd className="rail-sync-value">v.{currentVerse}</dd>
										</div>
									</dl>
								) : (
									activeTrack && (
										<p className="rail-sync-hint">Verse sync unavailable for this audio</p>
									)
								)}
							</div>
						)}
					</div>
				</div>
			)}
		</DraggableRailShell>
	);
}
