import type { CSSProperties } from "react";

import type { AudioTrackOption } from "../../shared/types";

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

export function AudioFallbackAction({
	preferredLang,
	tracks,
	activeKoCode,
	onSelectLanguage,
}: {
	preferredLang: string;
	tracks: AudioTrackOption[];
	activeKoCode: string;
	onSelectLanguage: (lang: string) => void;
}) {
	if (preferredLang !== "en" || !tracks.some((t) => t.language === "ko")) return null;
	return (
		<button
			type="button"
			className="quick-inline-chip active"
			onClick={() => onSelectLanguage("ko")}
		>
			Use {activeKoCode} Audio
		</button>
	);
}
