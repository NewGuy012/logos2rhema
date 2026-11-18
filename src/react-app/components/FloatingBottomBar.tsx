import {
	ChevronLeft,
	ChevronRight,
	Headphones,
	Loader2,
	Pause,
	Play,
	RotateCcw,
	RotateCw,
	X,
} from "lucide-react";

import type { AudioTrackOption, TranslationLanguage } from "../../shared/types";

interface FloatingBottomBarProps {
	bookEn: string;
	bookKo: string;
	chapter: number;
	hasPrev: boolean;
	hasNext: boolean;
	onPrevChapter: () => void;
	onNextChapter: () => void;
	onOpenPicker: () => void;
	audioDrawerOpen: boolean;
	onToggleAudioDrawer: () => void;
	tracks: AudioTrackOption[];
	preferredLang: TranslationLanguage;
	activeTrack: AudioTrackOption | null;
	isPlaying: boolean;
	isLoading: boolean;
	currentTime: number;
	duration: number;
	playbackRate: number;
	autoAdvance: boolean;
	errorMessage: string | null;
	activeEnCode: string;
	activeKoCode: string;
	onTogglePlay: () => void;
	onSeek: (sec: number) => void;
	onSkipBy: (delta: number) => void;
	onSelectTrack: (track: AudioTrackOption) => void;
	onSelectLanguage: (lang: TranslationLanguage) => void;
	onCycleSpeed: () => void;
	onToggleAutoAdvance: () => void;
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
	audioDrawerOpen,
	onToggleAudioDrawer,
	tracks,
	preferredLang,
	activeTrack,
	isPlaying,
	isLoading,
	currentTime,
	duration,
	playbackRate,
	autoAdvance,
	errorMessage,
	activeEnCode,
	activeKoCode,
	onTogglePlay,
	onSeek,
	onSkipBy,
	onSelectTrack,
	onSelectLanguage,
	onCycleSpeed,
	onToggleAutoAdvance,
}: FloatingBottomBarProps) {
	const koTracks = tracks.filter((t) => t.language === "ko");
	const enTracks = tracks.filter((t) => t.language === "en");

	return (
		<div className="floating-dock">
			{audioDrawerOpen && (
				<section className="audio-drawer" aria-label="Bible Audio Reader">
					<div className="audio-drawer-top">
						<div className="audio-track-pills">
							<button
								type="button"
								className={`audio-track-chip ${preferredLang === "ko" ? "active" : ""}`}
								onClick={() => onSelectLanguage("ko")}
							>
								한국어 ({activeKoCode})
							</button>
							<button
								type="button"
								className={`audio-track-chip ${preferredLang === "en" ? "active" : ""}`}
								onClick={() => onSelectLanguage("en")}
							>
								English ({activeEnCode})
							</button>

							{preferredLang === "en" &&
								enTracks.length > 1 &&
								enTracks.map((track) => (
									<button
										key={track.id}
										type="button"
										className={`audio-track-chip ${activeTrack?.id === track.id ? "active" : ""}`}
										onClick={() => onSelectTrack(track)}
									>
										{track.label.split(" ")[0]}
									</button>
								))}
						</div>

						<button
							type="button"
							className="pill-nav-btn"
							onClick={onToggleAudioDrawer}
							aria-label="Hide audio player"
						>
							<X size={15} />
						</button>
					</div>

					{activeTrack ? (
						<>
							<div className="audio-scrubber-row">
								<span>{formatTime(currentTime)}</span>
								<input
									type="range"
									className="audio-range"
									min={0}
									max={duration > 0 ? duration : 100}
									step={0.5}
									value={duration > 0 ? currentTime : 0}
									onChange={(e) => onSeek(Number.parseFloat(e.target.value))}
									aria-label="Audio playback progress"
								/>
								<span>{formatTime(duration)}</span>
							</div>

							<div className="audio-controls-row">
								<div className="audio-transport">
									<button
										type="button"
										className="icon-btn"
										onClick={() => onSkipBy(-10)}
										title="Rewind 10 seconds"
										aria-label="Rewind 10 seconds"
									>
										<RotateCcw size={14} />
										<span>10s</span>
									</button>

									<button
										type="button"
										className="play-circle-btn"
										onClick={onTogglePlay}
										aria-label={isPlaying ? "Pause audio" : "Play audio"}
									>
										{isLoading ? (
											<Loader2 size={16} className="spin" />
										) : isPlaying ? (
											<Pause size={16} />
										) : (
											<Play size={16} style={{ marginLeft: 1 }} />
										)}
									</button>

									<button
										type="button"
										className="icon-btn"
										onClick={() => onSkipBy(10)}
										title="Forward 10 seconds"
										aria-label="Forward 10 seconds"
									>
										<span>10s</span>
										<RotateCw size={14} />
									</button>
								</div>

								<div className="audio-transport">
									<button
										type="button"
										className="speed-pill"
										onClick={onCycleSpeed}
										title="Change reading speed"
									>
										{playbackRate}x
									</button>
									<button
										type="button"
										className={`audio-track-chip ${autoAdvance ? "active" : ""}`}
										onClick={onToggleAutoAdvance}
										title="Auto-advance to next chapter when finished"
									>
										Auto-next
									</button>
								</div>
							</div>

							<p className="audio-note">
								{errorMessage
									? errorMessage
									: `${activeTrack.label}${activeTrack.note ? ` · ${activeTrack.note}` : ""}`}
							</p>
						</>
					) : (
						<div>
							<p className="audio-note" style={{ marginTop: 0 }}>
								No human audio recording is linked to{" "}
								<strong>{preferredLang === "ko" ? activeKoCode : activeEnCode}</strong> for this
								chapter.
							</p>
							{preferredLang === "en" && koTracks.length > 0 && (
								<button
									type="button"
									className="audio-track-chip active"
									style={{ marginTop: "0.45rem" }}
									onClick={() => onSelectLanguage("ko")}
								>
									Switch to Korean Audio ({activeKoCode})
								</button>
							)}
						</div>
					)}
				</section>
			)}

			<nav className="bottom-pill" aria-label="Chapter and Audio Navigation">
				<button
					type="button"
					className="pill-nav-btn"
					disabled={!hasPrev}
					onClick={onPrevChapter}
					aria-label="Previous chapter"
				>
					<ChevronLeft size={18} />
				</button>

				<button type="button" className="pill-chapter-btn" onClick={onOpenPicker}>
					{bookEn} {chapter} · {bookKo} {chapter}장
				</button>

				<button
					type="button"
					className={`pill-audio-btn ${isPlaying || audioDrawerOpen ? "playing" : ""}`}
					onClick={() => {
						if (!audioDrawerOpen) {
							onToggleAudioDrawer();
							if (!isPlaying && activeTrack) {
								onTogglePlay();
							}
						} else {
							onTogglePlay();
						}
					}}
					aria-label="Listen to Bible audio"
				>
					<Headphones size={14} />
					<span>{isPlaying ? "Pause" : "Listen"}</span>
				</button>

				<button
					type="button"
					className="pill-nav-btn"
					disabled={!hasNext}
					onClick={onNextChapter}
					aria-label="Next chapter"
				>
					<ChevronRight size={18} />
				</button>
			</nav>
		</div>
	);
}
