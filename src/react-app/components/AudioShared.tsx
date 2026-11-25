import { type CSSProperties, type FormEvent, useCallback, useId, useState } from "react";
import { createPortal } from "react-dom";

import { SUPERTONIC_COMPACT_BADGE, SUPERTONIC_TRACK_LABEL } from "../../shared/audio-timings";
import { CANONICAL_BIBLES } from "../../shared/translations";
import type { AudioTrackOption, TranslationLanguage } from "../../shared/types";
import {
	MAX_PLAYBACK_SPEED,
	MIN_PLAYBACK_SPEED,
	parseCustomPlaybackRate,
	PLAYBACK_SPEEDS,
} from "../hooks/useHumanAudio";
import { anchorPosStyle, useAnchoredPopover } from "../hooks/usePopover";
import { ChevronDown, Loader2, Pause, Play, RotateCcw, RotateCw, Volume2 } from "./Icons";

export interface SharedAudioControlProps {
	bookEn: string;
	bookKo: string;
	chapter: number;
	tracks: AudioTrackOption[];
	preferredLang: TranslationLanguage;
	activeTrack: AudioTrackOption | null;
	isPlaying: boolean;
	isLoading: boolean;
	isLoadingTracks?: boolean;
	currentTime: number;
	duration: number;
	playbackRate: number;
	errorMessage: string | null;
	onTogglePlay: () => void;
	onSeek: (sec: number) => void;
	onSkipBy: (delta: number) => void;
	onSelectLanguage: (lang: TranslationLanguage) => void;
	onChangeSpeed: (rate: number) => void;
}

export function formatTime(totalSeconds: number): string {
	if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0:00";
	const mins = Math.floor(totalSeconds / 60);
	const secs = Math.floor(totalSeconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatDuration(duration: number): string {
	return duration > 0 ? formatTime(duration) : "--:--";
}

export function formatTrackTooltip(track: AudioTrackOption | null, langCode: string): string {
	if (!track) return `No audio available for ${langCode}`;
	return track.label.includes(langCode) ? track.label : `${track.label} (${langCode})`;
}

export function AudioLanguageToggle({
	preferredLang,
	onSelectLanguage,
}: {
	preferredLang: TranslationLanguage;
	onSelectLanguage: (lang: TranslationLanguage) => void;
}) {
	return (
		<div className="quick-lang-toggle" role="group" aria-label="Audio language">
			<button
				type="button"
				className={`quick-lang-btn ${preferredLang === "ko" ? "active" : ""}`}
				onClick={() => {
					if (preferredLang !== "ko") onSelectLanguage("ko");
				}}
				title={`Korean AI audio (${CANONICAL_BIBLES.ko.code} · ${SUPERTONIC_COMPACT_BADGE})`}
			>
				한
			</button>
			<button
				type="button"
				className={`quick-lang-btn ${preferredLang === "en" ? "active" : ""}`}
				onClick={() => {
					if (preferredLang !== "en") onSelectLanguage("en");
				}}
				title={`English audio (${CANONICAL_BIBLES.en.code})`}
			>
				EN
			</button>
		</div>
	);
}

export function AudioScrubber({
	currentTime,
	duration,
	onSeek,
}: {
	currentTime: number;
	duration: number;
	onSeek: (sec: number) => void;
}) {
	const safeMax = duration > 0 ? duration : 100;
	const safeValue = duration > 0 ? Math.min(currentTime, duration) : 0;
	const progressPct = duration > 0 ? Math.min(100, Math.max(0, (safeValue / duration) * 100)) : 0;

	return (
		<input
			type="range"
			className="audio-range"
			style={{ "--range-progress": `${progressPct}%` } as CSSProperties}
			min={0}
			max={safeMax}
			step={0.5}
			value={safeValue}
			onChange={(e) => onSeek(Number.parseFloat(e.target.value))}
			aria-label="Audio playback progress"
		/>
	);
}

export function AudioSpeedSelect({
	playbackRate,
	onChangeSpeed,
}: {
	playbackRate: number;
	onChangeSpeed: (rate: number) => void;
}) {
	const [open, setOpen] = useState(false);
	const [customValue, setCustomValue] = useState(() => String(playbackRate));
	const [customError, setCustomError] = useState<string | null>(null);
	const inputId = useId();
	const errorId = useId();
	const close = useCallback(() => setOpen(false), []);
	const { triggerRef, menuRef, pos, updatePosition } = useAnchoredPopover(open, {
		minSpace: 108,
		halfWidth: 152,
		gap: 6,
		onDismiss: close,
		onScroll: true,
	});

	const handleCustomSubmit = (e: FormEvent) => {
		e.preventDefault();
		const parsed = parseCustomPlaybackRate(customValue);
		if (parsed === null) {
			setCustomError(`Enter ${MIN_PLAYBACK_SPEED}–${MAX_PLAYBACK_SPEED.toFixed(1)}`);
			return;
		}
		onChangeSpeed(parsed);
		setCustomError(null);
		setOpen(false);
	};

	return (
		<div className="speed-select-wrap">
			<button
				ref={triggerRef}
				type="button"
				className={`speed-pill speed-select ${open ? "active" : ""}`.trim()}
				onClick={() => {
					if (!open) {
						setCustomValue(String(playbackRate));
						setCustomError(null);
						updatePosition();
					}
					setOpen((prev) => !prev);
				}}
				aria-label="Playback speed"
				aria-haspopup="menu"
				aria-expanded={open}
				title="Change playback speed"
			>
				<span>{playbackRate}x</span>
				<ChevronDown size={10} className="speed-select-caret" />
			</button>

			{open &&
				pos &&
				typeof document !== "undefined" &&
				createPortal(
					<div
						ref={menuRef}
						role="menu"
						aria-label="Playback speed options"
						className="speed-menu"
						style={anchorPosStyle(pos)}
					>
						<div className="speed-menu-presets">
							{PLAYBACK_SPEEDS.map((speed) => {
								const active = speed === playbackRate;
								return (
									<button
										key={speed}
										type="button"
										role="menuitemradio"
										aria-checked={active}
										className={`speed-menu-option ${active ? "active" : ""}`.trim()}
										onClick={() => {
											onChangeSpeed(speed);
											setOpen(false);
										}}
									>
										{speed}x
									</button>
								);
							})}
						</div>

						<form className="speed-menu-custom" noValidate onSubmit={handleCustomSubmit}>
							<label htmlFor={inputId} className="speed-custom-label">
								Custom
							</label>
							<div className="speed-custom-controls">
								<span className={`speed-custom-field ${customError ? "invalid" : ""}`.trim()}>
									<input
										id={inputId}
										type="number"
										inputMode="decimal"
										min={MIN_PLAYBACK_SPEED}
										max={MAX_PLAYBACK_SPEED}
										step={0.05}
										className="speed-custom-input"
										aria-label="Custom playback speed (0.1 to 2.0)"
										aria-invalid={customError ? true : undefined}
										aria-describedby={customError ? errorId : undefined}
										value={customValue}
										onChange={(e) => {
											setCustomValue(e.target.value);
											if (customError) setCustomError(null);
										}}
									/>
									<span className="speed-custom-suffix" aria-hidden="true">
										x
									</span>
								</span>
								<button type="submit" className="speed-custom-apply">
									Apply
								</button>
							</div>
						</form>

						{customError && (
							<p id={errorId} className="speed-custom-error" role="alert">
								{customError}
							</p>
						)}
					</div>,
					document.body,
				)}
		</div>
	);
}

export function AudioTransportControls({
	activeTrack,
	activeLangCode,
	isPlaying,
	isLoading,
	errorMessage,
	className,
	skipBackClassName = "rail-skip-btn",
	skipForwardClassName = "rail-skip-btn",
	onSkipBy,
	onTogglePlay,
}: {
	activeTrack: AudioTrackOption | null;
	activeLangCode: string;
	isPlaying: boolean;
	isLoading: boolean;
	errorMessage: string | null;
	className: string;
	skipBackClassName?: string;
	skipForwardClassName?: string;
	onSkipBy: (delta: number) => void;
	onTogglePlay: () => void;
}) {
	return (
		<div className={className}>
			<button
				type="button"
				className={skipBackClassName}
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
				title={formatTrackTooltip(activeTrack, activeLangCode)}
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
				className={skipForwardClassName}
				disabled={!activeTrack || Boolean(errorMessage)}
				onClick={() => onSkipBy(10)}
				aria-label="Forward 10 seconds"
				title="Forward 10 seconds"
			>
				<span>10s</span>
				<RotateCw size={12} />
			</button>
		</div>
	);
}

export function AudioFallbackAction({
	preferredLang,
	tracks,
	onSelectLanguage,
}: {
	preferredLang: TranslationLanguage;
	tracks: AudioTrackOption[];
	onSelectLanguage: (lang: TranslationLanguage) => void;
}) {
	const fallbackLang: TranslationLanguage = preferredLang === "en" ? "ko" : "en";
	if (!tracks.some((t) => t.language === fallbackLang)) return null;
	return (
		<button
			type="button"
			className="quick-inline-chip active"
			onClick={() => onSelectLanguage(fallbackLang)}
		>
			Use {CANONICAL_BIBLES[fallbackLang].code} Audio
		</button>
	);
}

export function VerseAudioButton({
	isPlaying,
	isLoading,
	isSupertonic,
	disabled = false,
	onToggle,
}: {
	isPlaying: boolean;
	isLoading: boolean;
	isSupertonic: boolean;
	disabled?: boolean;
	onToggle: () => void;
}) {
	const label = isPlaying
		? "Pause Korean verse audio"
		: "Listen to Korean verse (Supertonic 3 · AI 낭독)";
	return (
		<button
			type="button"
			className={`votd-action-btn ${isPlaying || isLoading ? "active" : ""}`.trim()}
			disabled={disabled}
			onClick={onToggle}
			aria-pressed={isPlaying}
			aria-label={label}
			title={isSupertonic ? SUPERTONIC_TRACK_LABEL : `${SUPERTONIC_TRACK_LABEL}`}
		>
			{isLoading ? (
				<Loader2 size={13} className="spin" />
			) : isPlaying ? (
				<Pause size={13} />
			) : (
				<Volume2 size={13} />
			)}
			<span lang="ko">{isPlaying ? "Pause" : SUPERTONIC_COMPACT_BADGE}</span>
		</button>
	);
}
