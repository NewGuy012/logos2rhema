import { type CSSProperties, useCallback, useState } from "react";
import { createPortal } from "react-dom";

import { CANONICAL_BIBLES } from "../../shared/translations";
import type { AudioTrackOption, TranslationLanguage } from "../../shared/types";
import { PLAYBACK_SPEEDS } from "../hooks/useHumanAudio";
import { anchorPosStyle, useAnchoredPopover } from "../hooks/usePopover";
import { ChevronDown } from "./Icons";

export interface SharedAudioControlProps {
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
				onClick={() => onSelectLanguage("ko")}
				title={`Korean audio (${CANONICAL_BIBLES.ko.code})`}
			>
				한
			</button>
			<button
				type="button"
				className={`quick-lang-btn ${preferredLang === "en" ? "active" : ""}`}
				onClick={() => onSelectLanguage("en")}
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
	const close = useCallback(() => setOpen(false), []);
	const { triggerRef, menuRef, pos, updatePosition } = useAnchoredPopover(open, {
		minSpace: 56,
		halfWidth: 148,
		gap: 6,
		onDismiss: close,
		onScroll: true,
		onResize: true,
	});

	return (
		<div className="speed-select-wrap">
			<button
				ref={triggerRef}
				type="button"
				className={`speed-pill speed-select ${open ? "active" : ""}`.trim()}
				onClick={() => {
					if (!open) updatePosition();
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
					</div>,
					document.body,
				)}
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
