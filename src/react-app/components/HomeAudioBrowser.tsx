import { useCallback, useEffect, useMemo, useState } from "react";

import { hasVerseTimings } from "../../shared/audio-timings";
import { BIBLE_BOOKS, getAdjacentChapter, getBookByNumber } from "../../shared/books";
import { CANONICAL_BIBLES } from "../../shared/translations";
import type { AudioTrackOption } from "../../shared/types";
import { useHumanAudio } from "../hooks/useHumanAudio";
import { loadSyncedChapterAudio } from "../lib/bible-loader";
import {
	AudioFallbackAction,
	AudioLanguageToggle,
	AudioScrubber,
	AudioSpeedSelect,
	formatTime,
} from "./AudioShared";
import {
	ArrowRight,
	BookOpen,
	ChevronLeft,
	ChevronRight,
	Headphones,
	Loader2,
	Pause,
	Play,
	RotateCcw,
	RotateCw,
} from "./Icons";

interface HomeAudioBrowserProps {
	initialBookNumber: number;
	initialChapter: number;
	onOpenPassage: (bookNumber: number, chapter: number, verse?: number) => void;
}

export function HomeAudioBrowser({
	initialBookNumber,
	initialChapter,
	onOpenPassage,
}: HomeAudioBrowserProps) {
	const initialBook = getBookByNumber(initialBookNumber) ?? BIBLE_BOOKS[0];
	const [bookNumber, setBookNumber] = useState(initialBook.number);
	const [chapter, setChapter] = useState(initialChapter);
	const [tracks, setTracks] = useState<AudioTrackOption[]>([]);
	const [loadingTracks, setLoadingTracks] = useState(true);

	const currentBook = useMemo(() => getBookByNumber(bookNumber) ?? BIBLE_BOOKS[0], [bookNumber]);
	const prevTarget = useMemo(
		() => getAdjacentChapter(bookNumber, chapter, -1),
		[bookNumber, chapter],
	);
	const nextTarget = useMemo(
		() => getAdjacentChapter(bookNumber, chapter, 1),
		[bookNumber, chapter],
	);

	const selectPassage = useCallback((nextBookNumber: number, nextChapter: number) => {
		const target = getBookByNumber(nextBookNumber) ?? BIBLE_BOOKS[0];
		setBookNumber(target.number);
		setChapter(Math.max(1, Math.min(target.chapters, nextChapter)));
	}, []);

	useEffect(() => {
		let cancelled = false;
		setLoadingTracks(true);
		setTracks([]);
		loadSyncedChapterAudio({ usfm: currentBook.usfm, chapter })
			.then((res) => {
				if (cancelled) return;
				setTracks(res.tracks);
				setLoadingTracks(false);
			})
			.catch(() => {
				if (cancelled) return;
				setTracks([]);
				setLoadingTracks(false);
			});
		return () => {
			cancelled = true;
		};
	}, [currentBook.usfm, chapter]);

	const handleChapterEnded = useCallback(() => {
		const next = getAdjacentChapter(bookNumber, chapter, 1);
		if (!next) return false;
		selectPassage(next.bookNumber, next.chapter);
		return true;
	}, [bookNumber, chapter, selectPassage]);

	const audio = useHumanAudio({
		tracks,
		visibleVerse: 1,
		autoSync: false,
		onChapterEnded: handleChapterEnded,
	});

	const activeLangCode = CANONICAL_BIBLES[audio.preferredLang].code;
	const hasTimings = hasVerseTimings(audio.activeTrack?.verseTimings);

	return (
		<div className="home-study-browser">
			<section className="home-study-card home-audio-card" aria-label="Chapter audio player">
				<div className="home-audio-card-head">
					<div className="home-audio-title-group">
						<div className="home-audio-eyebrow">
							<Headphones size={13} />
							<span>Chapter Audio</span>
							{hasTimings && <span className="home-study-badge">Verse-synced</span>}
						</div>
						<h3 className="home-study-passage-title">
							{currentBook.en} {chapter}{" "}
							<span className="home-continue-ko" lang="ko">
								· {currentBook.ko} {chapter}장
							</span>
						</h3>
						{audio.activeTrack && (
							<p className="home-audio-track-label">{audio.activeTrack.label}</p>
						)}
					</div>

					<div className="home-audio-head-actions">
						<div className="home-passage-steppers">
							<button
								type="button"
								className="pill-nav-btn home-step-btn"
								disabled={!prevTarget}
								onClick={() =>
									prevTarget && selectPassage(prevTarget.bookNumber, prevTarget.chapter)
								}
								aria-label="Previous chapter"
								title="Previous chapter"
							>
								<ChevronLeft size={15} />
							</button>
							<button
								type="button"
								className="pill-nav-btn home-step-btn"
								disabled={!nextTarget}
								onClick={() =>
									nextTarget && selectPassage(nextTarget.bookNumber, nextTarget.chapter)
								}
								aria-label="Next chapter"
								title="Next chapter"
							>
								<ChevronRight size={15} />
							</button>
						</div>

						<button
							type="button"
							className="home-open-reader-btn"
							onClick={() =>
								onOpenPassage(currentBook.number, chapter, audio.activeVerse ?? undefined)
							}
						>
							<BookOpen size={14} />
							<span>Open in Reader</span>
							<ArrowRight size={14} />
						</button>
					</div>
				</div>

				<div className="home-audio-controls">
					<div className="home-audio-row">
						<AudioLanguageToggle
							preferredLang={audio.preferredLang}
							onSelectLanguage={audio.selectLanguage}
						/>

						<div className="home-audio-transport">
							<button
								type="button"
								className="rail-skip-btn"
								disabled={!audio.activeTrack || Boolean(audio.errorMessage)}
								onClick={() => audio.skipBy(-10)}
								aria-label="Rewind 10 seconds"
								title="Rewind 10 seconds"
							>
								<RotateCcw size={12} />
								<span>10s</span>
							</button>

							<button
								type="button"
								className={`rail-play-btn ${audio.isPlaying ? "playing" : ""}`}
								disabled={!audio.activeTrack && !audio.isPlaying}
								onClick={audio.togglePlay}
								aria-label={audio.isPlaying ? "Pause audio" : "Play audio"}
								title={
									audio.activeTrack
										? `${audio.activeTrack.label} (${activeLangCode})`
										: `No audio available for ${activeLangCode}`
								}
							>
								{audio.isLoading || loadingTracks ? (
									<Loader2 size={14} className="spin" />
								) : audio.isPlaying ? (
									<Pause size={14} />
								) : (
									<Play size={14} />
								)}
								<span>{audio.isPlaying ? "Pause" : "Play"}</span>
							</button>

							<button
								type="button"
								className="rail-skip-btn"
								disabled={!audio.activeTrack || Boolean(audio.errorMessage)}
								onClick={() => audio.skipBy(10)}
								aria-label="Forward 10 seconds"
								title="Forward 10 seconds"
							>
								<span>10s</span>
								<RotateCw size={12} />
							</button>
						</div>

						<div className="home-audio-meta">
							<span className="quick-time">{formatTime(audio.currentTime)}</span>
							<AudioSpeedSelect
								playbackRate={audio.playbackRate}
								onChangeSpeed={audio.setPlaybackRate}
							/>
							<span className="quick-time">
								{audio.duration > 0 ? formatTime(audio.duration) : "--:--"}
							</span>
						</div>
					</div>

					{audio.activeTrack && !audio.errorMessage && (
						<div className="home-audio-scrubber">
							<AudioScrubber
								currentTime={audio.currentTime}
								duration={audio.duration}
								onSeek={audio.seekTo}
							/>
						</div>
					)}

					{loadingTracks ? (
						<p className="rail-note">Checking available audio tracks...</p>
					) : audio.errorMessage ? (
						<p className="rail-note">{audio.errorMessage}</p>
					) : !audio.activeTrack ? (
						<div className="home-audio-unavailable">
							<p className="rail-note">No {activeLangCode} audio available for this chapter.</p>
							<AudioFallbackAction
								preferredLang={audio.preferredLang}
								tracks={tracks}
								onSelectLanguage={audio.selectLanguage}
							/>
						</div>
					) : (
						audio.isPlaying &&
						audio.activeVerse && (
							<div className="home-audio-live">
								<button
									type="button"
									className="verse-ref-chip"
									onClick={() =>
										onOpenPassage(currentBook.number, chapter, audio.activeVerse ?? undefined)
									}
								>
									Playing v.{audio.activeVerse} · Open verse
								</button>
							</div>
						)
					)}
				</div>
			</section>

			<div className="home-audio-chapters">
				<div className="home-subhead">
					<h3 className="home-favorites-group-title">
						{currentBook.en} Chapters ({currentBook.chapters})
					</h3>
				</div>
				<div className="chapters-grid home-audio-chapters-grid">
					{Array.from({ length: currentBook.chapters }, (_, i) => i + 1).map((ch) => (
						<button
							key={ch}
							type="button"
							className={`chapter-cell ${ch === chapter ? "current" : ""}`.trim()}
							onClick={() => setChapter(ch)}
						>
							{ch}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
