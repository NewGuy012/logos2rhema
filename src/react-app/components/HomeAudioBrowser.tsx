import { useCallback, useEffect, useState } from "react";

import { hasVerseTimings, SUPERTONIC_COMPACT_BADGE } from "../../shared/audio-timings";
import { getAdjacentChapter } from "../../shared/books";
import { CANONICAL_BIBLES } from "../../shared/translations";
import type { AudioTrackOption } from "../../shared/types";
import { useHumanAudio } from "../hooks/useHumanAudio";
import { loadSyncedChapterAudio } from "../lib/bible-loader";
import {
	AudioFallbackAction,
	AudioLanguageToggle,
	AudioScrubber,
	AudioSpeedSelect,
	AudioTransportControls,
	formatTime,
} from "./AudioShared";
import { HomePassageBar, usePassageSelection } from "./HomeStudyShared";
import { Headphones } from "./Icons";

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
	const {
		book: currentBook,
		chapter,
		selectPassage,
	} = usePassageSelection(initialBookNumber, initialChapter);
	const [tracks, setTracks] = useState<AudioTrackOption[]>([]);
	const [loadingTracks, setLoadingTracks] = useState(true);

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
		const next = getAdjacentChapter(currentBook.number, chapter, 1);
		if (!next) return false;
		selectPassage(next.bookNumber, next.chapter);
		return true;
	}, [currentBook.number, chapter, selectPassage]);

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
			<div className="home-study-card home-study-toolbar">
				<HomePassageBar
					bookNumber={currentBook.number}
					chapter={chapter}
					onChangePassage={selectPassage}
					onOpenInReader={() =>
						onOpenPassage(currentBook.number, chapter, audio.activeVerse ?? undefined)
					}
				/>
			</div>

			<section className="home-study-card home-audio-card" aria-label="Chapter audio player">
				<div className="home-audio-title-group">
					<div className="home-audio-eyebrow">
						<Headphones size={13} />
						<span>Chapter Audio</span>
						{audio.activeTrack?.isAiGenerated && (
							<span className="home-study-badge" lang="ko">
								{SUPERTONIC_COMPACT_BADGE}
							</span>
						)}
						{hasTimings && <span className="home-study-badge">Verse-synced</span>}
					</div>
					<h3 className="home-study-passage-title">
						{currentBook.en} {chapter}{" "}
						<span className="home-continue-ko" lang="ko">
							· {currentBook.ko} {chapter}장
						</span>
					</h3>
					{audio.activeTrack && <p className="home-audio-track-label">{audio.activeTrack.label}</p>}
				</div>

				<div className="home-audio-controls">
					<div className="home-audio-row">
						<AudioLanguageToggle
							preferredLang={audio.preferredLang}
							onSelectLanguage={audio.selectLanguage}
						/>

						<AudioTransportControls
							className="home-audio-transport"
							activeTrack={audio.activeTrack}
							activeLangCode={activeLangCode}
							isPlaying={audio.isPlaying}
							isLoading={audio.isLoading || loadingTracks}
							errorMessage={audio.errorMessage}
							onSkipBy={audio.skipBy}
							onTogglePlay={audio.togglePlay}
						/>

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
		</div>
	);
}
