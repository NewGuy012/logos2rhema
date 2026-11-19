import { type CSSProperties, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { AudioTrackOption } from "../../shared/types";
import { PLAYBACK_SPEEDS } from "../hooks/useHumanAudio";
import { type AnchorPos, computeAnchorPos, useDismissListeners } from "../hooks/usePopover";
import { ChevronDown } from "./Icons";

export function formatTime(totalSeconds: number): string {
	if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0:00";
	const mins = Math.floor(totalSeconds / 60);
	const secs = Math.floor(totalSeconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AudioLanguageToggle({
	preferredLang,
	activeKoCode,
	activeEnCode,
	onSelectLanguage,
}: {
	preferredLang: string;
	activeKoCode: string;
	activeEnCode: string;
	onSelectLanguage: (lang: string) => void;
}) {
	return (
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
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<AnchorPos | null>(null);

	const updatePosition = useCallback(() => {
		if (!triggerRef.current) return;
		setPos(
			computeAnchorPos(triggerRef.current.getBoundingClientRect(), {
				minSpace: 56,
				halfWidth: 148,
				gap: 6,
			}),
		);
	}, []);

	const close = useCallback(() => setOpen(false), []);
	useDismissListeners(open, {
		refs: [triggerRef, menuRef],
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
						style={{
							left: `${pos.left}px`,
							top: `${pos.top}px`,
							transform: pos.placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
						}}
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
	activeKoCode,
	activeEnCode,
	onSelectLanguage,
}: {
	preferredLang: string;
	tracks: AudioTrackOption[];
	activeKoCode: string;
	activeEnCode: string;
	onSelectLanguage: (lang: string) => void;
}) {
	const fallbackLang = preferredLang === "en" ? "ko" : "en";
	if (!tracks.some((t) => t.language === fallbackLang)) return null;
	const fallbackCode = fallbackLang === "ko" ? activeKoCode : activeEnCode;
	return (
		<button
			type="button"
			className="quick-inline-chip active"
			onClick={() => onSelectLanguage(fallbackLang)}
		>
			Use {fallbackCode} Audio
		</button>
	);
}
