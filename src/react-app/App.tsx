import { BookOpen, ChevronLeft, ChevronRight, Headphones } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BIBLE_BOOKS, getAdjacentChapter, getBookByNumber, getBookByUsfm } from "../shared/books";
import { CANONICAL_BIBLES } from "../shared/translations";
import type { AudioTrackOption, LexiconMap, TranslationMeta, VerseEntry } from "../shared/types";
import { FloatingBottomBar } from "./components/FloatingBottomBar";
import { FootnotesGuide } from "./components/FootnotesGuide";
import { PassagePicker } from "./components/PassagePicker";
import { type KoreanFontStyle, type ReaderTheme, TopBar } from "./components/TopBar";
import { type StackOrder, type StudyMaskMode, VerseBlock } from "./components/VerseBlock";
import { useHumanAudio } from "./hooks/useHumanAudio";
import {
	alignChapterVerses,
	loadLexicon,
	loadReaderConfig,
	loadSyncedChapterAudio,
	loadTranslationChapter,
} from "./lib/bible-loader";

const STORAGE_KEY = "logos.reader.preferences.v1";

interface StoredPrefs {
	bookNumber: number;
	chapter: number;
	stackOrder: StackOrder;
	theme: ReaderTheme;
	fontScale: number;
	koFontStyle: KoreanFontStyle;
	studyMask: StudyMaskMode;
}

const DEFAULT_PREFS: StoredPrefs = {
	bookNumber: 1,
	chapter: 1,
	stackOrder: "en-first",
	theme: "paper",
	fontScale: 1,
	koFontStyle: "serif",
	studyMask: "none",
};

function readInitialLocation(): { bookNumber: number; chapter: number } | null {
	if (typeof window === "undefined") return null;
	const hash = window.location.hash.replace(/^#\/?/, "");
	const match = hash.match(/^([A-Za-z0-9]+)\/(\d+)$/);
	if (!match) return null;
	const book = getBookByUsfm(match[1]);
	const chapter = Number.parseInt(match[2], 10);
	if (!book || Number.isNaN(chapter)) return null;
	return {
		bookNumber: book.number,
		chapter: Math.max(1, Math.min(book.chapters, chapter)),
	};
}

function readStoredPrefs(): StoredPrefs {
	if (typeof localStorage === "undefined") return DEFAULT_PREFS;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_PREFS;
		return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<StoredPrefs>) };
	} catch {
		return DEFAULT_PREFS;
	}
}

function useIsDesktopLayout(): boolean {
	const [isDesktop, setIsDesktop] = useState(() =>
		typeof window !== "undefined" && typeof window.matchMedia === "function"
			? window.matchMedia("(min-width: 1080px)").matches
			: true,
	);

	useEffect(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
		const mql = window.matchMedia("(min-width: 1080px)");
		const update = () => setIsDesktop(mql.matches);
		update();
		mql.addEventListener("change", update);
		return () => mql.removeEventListener("change", update);
	}, []);

	return isDesktop;
}

export default function App() {
	const initialPrefs = useMemo(() => readStoredPrefs(), []);
	const initialHash = useMemo(() => readInitialLocation(), []);
	const isDesktop = useIsDesktopLayout();

	const [bookNumber, setBookNumber] = useState(initialHash?.bookNumber ?? initialPrefs.bookNumber);
	const [chapter, setChapter] = useState(initialHash?.chapter ?? initialPrefs.chapter);
	const [selectedEn, setSelectedEn] = useState<TranslationMeta>(CANONICAL_BIBLES.en);
	const [selectedKo, setSelectedKo] = useState<TranslationMeta>(CANONICAL_BIBLES.ko);
	const [stackOrder, setStackOrder] = useState<StackOrder>(initialPrefs.stackOrder);
	const [theme, setTheme] = useState<ReaderTheme>(initialPrefs.theme);
	const [fontScale, setFontScale] = useState<number>(initialPrefs.fontScale);
	const [koFontStyle, setKoFontStyle] = useState<KoreanFontStyle>(initialPrefs.koFontStyle);
	const [studyMask, setStudyMask] = useState<StudyMaskMode>(initialPrefs.studyMask);

	const [lexicon, setLexicon] = useState<LexiconMap>({});
	const [rawEnVerses, setRawEnVerses] = useState<VerseEntry[]>([]);
	const [rawKoVerses, setRawKoVerses] = useState<VerseEntry[]>([]);
	const [loadingChapter, setLoadingChapter] = useState(true);
	const [chapterError, setChapterError] = useState<string | null>(null);

	const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [sheetOpen, setSheetOpen] = useState(false);

	const [pickerOpen, setPickerOpen] = useState(false);
	const [selectedVerse, setSelectedVerse] = useState<number | null>(null);
	const [highlightedFootnoteId, setHighlightedFootnoteId] = useState<string | null>(null);
	const [pendingScrollVerse, setPendingScrollVerse] = useState<number | null>(null);

	const currentBook = useMemo(() => getBookByNumber(bookNumber) ?? BIBLE_BOOKS[0], [bookNumber]);

	const prevChapterTarget = useMemo(
		() => getAdjacentChapter(bookNumber, chapter, -1),
		[bookNumber, chapter],
	);
	const nextChapterTarget = useMemo(
		() => getAdjacentChapter(bookNumber, chapter, 1),
		[bookNumber, chapter],
	);

	const { aligned: alignedVerses, analysis } = useMemo(
		() => alignChapterVerses(rawEnVerses, rawKoVerses, lexicon),
		[rawEnVerses, rawKoVerses, lexicon],
	);

	// Persist preferences
	useEffect(() => {
		try {
			const prefs: StoredPrefs = {
				bookNumber,
				chapter,
				stackOrder,
				theme,
				fontScale,
				koFontStyle,
				studyMask,
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
		} catch {
			// Ignore storage quota errors
		}
	}, [bookNumber, chapter, stackOrder, theme, fontScale, koFontStyle, studyMask]);

	// Sync theme attribute to <html>
	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
	}, [theme]);

	// Sync URL hash cleanly
	useEffect(() => {
		const targetHash = `#/${currentBook.usfm}/${chapter}`;
		if (window.location.hash !== targetHash) {
			window.history.replaceState(null, "", targetHash);
		}
	}, [currentBook.usfm, chapter]);

	// Load canonical reader configuration + compact Korean lexicon once
	useEffect(() => {
		let cancelled = false;
		loadReaderConfig().then((cfg) => {
			if (cancelled) return;
			setSelectedEn(cfg.english);
			setSelectedKo(cfg.korean);
		});
		loadLexicon().then((lex) => {
			if (!cancelled) setLexicon(lex);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	// Load chapter verses when book, chapter, or selected translations change
	useEffect(() => {
		let cancelled = false;
		setLoadingChapter(true);
		setChapterError(null);

		Promise.all([
			loadTranslationChapter(selectedEn, bookNumber, chapter),
			loadTranslationChapter(selectedKo, bookNumber, chapter),
		])
			.then(([enVerses, koVerses]) => {
				if (cancelled) return;
				setRawEnVerses(enVerses);
				setRawKoVerses(koVerses);
				setLoadingChapter(false);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setChapterError(err instanceof Error ? err.message : "Could not load chapter.");
				setLoadingChapter(false);
			});

		return () => {
			cancelled = true;
		};
	}, [selectedEn, selectedKo, bookNumber, chapter]);

	// Sync human-narrated audio tracks whenever book or chapter changes
	useEffect(() => {
		let cancelled = false;
		loadSyncedChapterAudio({
			usfm: currentBook.usfm,
			chapter,
		}).then((res) => {
			if (!cancelled) setAudioTracks(res.tracks);
		});
		return () => {
			cancelled = true;
		};
	}, [currentBook.usfm, chapter]);

	const navigateTo = useCallback((targetBook: number, targetChapter: number, verse?: number) => {
		setBookNumber(targetBook);
		setChapter(targetChapter);
		setSelectedVerse(verse ?? null);
		setPendingScrollVerse(verse ?? null);
		if (!verse) {
			window.scrollTo({ top: 0, behavior: "smooth" });
		}
	}, []);

	// Scroll to requested verse once chapter finishes rendering
	useEffect(() => {
		if (!pendingScrollVerse || loadingChapter) return;
		const el = document.getElementById(`verse-${pendingScrollVerse}`);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "center" });
			setPendingScrollVerse(null);
		}
	}, [pendingScrollVerse, loadingChapter]);

	const prepareNextPlayRef = useRef<() => void>(() => {});

	const handleChapterEnded = useCallback(() => {
		if (!nextChapterTarget) return;
		prepareNextPlayRef.current();
		navigateTo(nextChapterTarget.bookNumber, nextChapterTarget.chapter);
	}, [nextChapterTarget, navigateTo]);

	const audio = useHumanAudio({
		tracks: audioTracks,
		onChapterEnded: handleChapterEnded,
	});
	prepareNextPlayRef.current = audio.prepareAutoAdvancePlay;

	// Scroll active audio verse into view smoothly when verse timings are available
	useEffect(() => {
		if (!audio.activeVerse) return;
		const el = document.getElementById(`verse-${audio.activeVerse}`);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	}, [audio.activeVerse]);

	// Keyboard shortcuts: Cmd/Ctrl+K to jump, ArrowLeft/ArrowRight skip 10s while playing or turn chapters otherwise
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement | null)?.tagName;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setPickerOpen((prev) => !prev);
				return;
			}
			if (pickerOpen || tag === "INPUT" || tag === "TEXTAREA") return;
			if (e.key === "ArrowLeft") {
				if (audio.isPlaying) {
					e.preventDefault();
					audio.skipBy(-10);
				} else if (prevChapterTarget) {
					navigateTo(prevChapterTarget.bookNumber, prevChapterTarget.chapter);
				}
			} else if (e.key === "ArrowRight") {
				if (audio.isPlaying) {
					e.preventDefault();
					audio.skipBy(10);
				} else if (nextChapterTarget) {
					navigateTo(nextChapterTarget.bookNumber, nextChapterTarget.chapter);
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [pickerOpen, prevChapterTarget, nextChapterTarget, navigateTo, audio]);

	const handleSelectVerse = useCallback(
		(verseNum: number) => {
			setSelectedVerse((prev) => (prev === verseNum ? null : verseNum));
			if (audio.isPlaying) {
				audio.jumpToVerse(verseNum);
			}
		},
		[audio],
	);

	const handleToggleDictionary = useCallback(() => {
		if (isDesktop) {
			setSidebarOpen((prev) => !prev);
		} else {
			setSheetOpen((prev) => !prev);
		}
	}, [isDesktop]);

	const handleSelectFootnote = useCallback(
		(footnoteId: string) => {
			setHighlightedFootnoteId(footnoteId);
			if (isDesktop) {
				setSidebarOpen(true);
			} else {
				setSheetOpen(true);
			}
			window.setTimeout(() => {
				setHighlightedFootnoteId((cur) => (cur === footnoteId ? null : cur));
			}, 2600);
		},
		[isDesktop],
	);

	const handleJumpFromFootnote = useCallback((verseNum: number) => {
		setSelectedVerse(verseNum);
		const el = document.getElementById(`verse-${verseNum}`);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	}, []);

	const readerStyle = useMemo(
		() =>
			({
				"--reader-scale": fontScale,
				"--reader-ko-font":
					koFontStyle === "serif" ? "var(--font-ko-serif)" : "var(--font-ko-sans)",
			}) as CSSProperties,
		[fontScale, koFontStyle],
	);

	const activeAudioForCurrentLang = audioTracks.filter((t) => t.language === audio.preferredLang);
	const dictionaryOpen = isDesktop ? sidebarOpen : sheetOpen;
	const showDictionary = !loadingChapter && !chapterError;

	return (
		<div id="top" className="app-shell" style={readerStyle}>
			<TopBar
				selectedEn={selectedEn}
				selectedKo={selectedKo}
				stackOrder={stackOrder}
				theme={theme}
				fontScale={fontScale}
				koFontStyle={koFontStyle}
				studyMask={studyMask}
				onFlipStackOrder={() =>
					setStackOrder((prev) => (prev === "en-first" ? "ko-first" : "en-first"))
				}
				onOpenSearch={() => setPickerOpen(true)}
				onChangeTheme={setTheme}
				onChangeFontScale={setFontScale}
				onChangeKoFontStyle={setKoFontStyle}
				onChangeStudyMask={setStudyMask}
			/>

			<div className={`reader-workspace ${isDesktop && sidebarOpen ? "with-sidebar" : ""}`}>
				<main className="reader-main">
					<header className="chapter-header">
						<div className="chapter-kicker">
							<span>
								{currentBook.testament === "OT" ? "Old Testament · 구약" : "New Testament · 신약"}
							</span>
							<span>
								{selectedEn.code} · {selectedKo.code}
							</span>
						</div>

						<div className="chapter-title-row">
							<h1 className="chapter-title-en">
								{currentBook.en} {chapter}
							</h1>
							<p className="chapter-title-ko" lang="ko">
								{currentBook.ko} {chapter}장
							</p>
						</div>

						<div className="chapter-subbar">
							<button
								type="button"
								className="footnote-jump-link"
								disabled={!audio.activeTrack && !audio.isPlaying}
								onClick={audio.togglePlay}
							>
								<Headphones size={13} />
								<span>
									{audio.isPlaying
										? `Pause (${audio.preferredLang === "ko" ? selectedKo.code : selectedEn.code})`
										: activeAudioForCurrentLang.length > 0
											? `Listen (${audio.preferredLang === "ko" ? selectedKo.code : selectedEn.code})`
											: `No Audio (${audio.preferredLang === "ko" ? selectedKo.code : selectedEn.code})`}
								</span>
							</button>

							<button type="button" className="footnote-jump-link" onClick={handleToggleDictionary}>
								<BookOpen size={13} />
								<span>Korean Dictionary ({analysis.footnotes.length})</span>
							</button>
						</div>
					</header>

					{loadingChapter ? (
						<p className="footnotes-subtitle">Loading chapter...</p>
					) : chapterError ? (
						<div className="grammar-card">
							<div className="grammar-pattern">Unable to load passage</div>
							<p className="grammar-desc">{chapterError}</p>
						</div>
					) : (
						<section className="verses-list" aria-label="Bilingual Scripture">
							{alignedVerses.map((verse) => (
								<VerseBlock
									key={verse.verse}
									verse={verse}
									stackOrder={stackOrder}
									studyMask={studyMask}
									isSelected={selectedVerse === verse.verse}
									isAudioActive={audio.activeVerse === verse.verse}
									enCode={selectedEn.code}
									koCode={selectedKo.code}
									hasVerseTimestamps={Boolean(audio.activeTrack?.verseTimings)}
									onSelectVerse={handleSelectVerse}
									onSelectFootnote={handleSelectFootnote}
								/>
							))}
						</section>
					)}

					<div className="chapter-nav-footer">
						<button
							type="button"
							className="nav-chapter-btn"
							disabled={!prevChapterTarget}
							onClick={() =>
								prevChapterTarget &&
								navigateTo(prevChapterTarget.bookNumber, prevChapterTarget.chapter)
							}
						>
							<ChevronLeft size={16} />
							<span>Previous Chapter</span>
						</button>

						<button
							type="button"
							className="nav-chapter-btn"
							disabled={!nextChapterTarget}
							onClick={() =>
								nextChapterTarget &&
								navigateTo(nextChapterTarget.bookNumber, nextChapterTarget.chapter)
							}
						>
							<span>Next Chapter</span>
							<ChevronRight size={16} />
						</button>
					</div>

					<footer className="copyright-footer">
						Korean text: 성경전서 개역한글판 (1961, Public Domain) · English text:{" "}
						{selectedEn.nativeName} · Hover any Korean word for instant translation.
					</footer>
				</main>

				{showDictionary && isDesktop && sidebarOpen && (
					<div className="dict-sidebar-wrap">
						<FootnotesGuide
							bookEn={currentBook.en}
							bookKo={currentBook.ko}
							chapter={chapter}
							footnotes={analysis.footnotes}
							grammarNotes={analysis.grammarNotes}
							highlightedFootnoteId={highlightedFootnoteId}
							variant="sidebar"
							onClose={() => setSidebarOpen(false)}
							onJumpToVerse={handleJumpFromFootnote}
						/>
					</div>
				)}
			</div>

			<FloatingBottomBar
				bookEn={currentBook.en}
				bookKo={currentBook.ko}
				chapter={chapter}
				hasPrev={Boolean(prevChapterTarget)}
				hasNext={Boolean(nextChapterTarget)}
				onPrevChapter={() =>
					prevChapterTarget && navigateTo(prevChapterTarget.bookNumber, prevChapterTarget.chapter)
				}
				onNextChapter={() =>
					nextChapterTarget && navigateTo(nextChapterTarget.bookNumber, nextChapterTarget.chapter)
				}
				onOpenPicker={() => setPickerOpen(true)}
				tracks={audioTracks}
				preferredLang={audio.preferredLang}
				activeTrack={audio.activeTrack}
				isPlaying={audio.isPlaying}
				isLoading={audio.isLoading}
				currentTime={audio.currentTime}
				duration={audio.duration}
				playbackRate={audio.playbackRate}
				errorMessage={audio.errorMessage}
				activeEnCode={selectedEn.code}
				activeKoCode={selectedKo.code}
				dictionaryOpen={dictionaryOpen}
				dictionarySheet={
					showDictionary && !isDesktop && sheetOpen ? (
						<div className="dict-sheet-wrap">
							<FootnotesGuide
								bookEn={currentBook.en}
								bookKo={currentBook.ko}
								chapter={chapter}
								footnotes={analysis.footnotes}
								grammarNotes={analysis.grammarNotes}
								highlightedFootnoteId={highlightedFootnoteId}
								variant="sheet"
								onClose={() => setSheetOpen(false)}
								onJumpToVerse={handleJumpFromFootnote}
							/>
						</div>
					) : undefined
				}
				onToggleDictionary={handleToggleDictionary}
				onTogglePlay={audio.togglePlay}
				onSeek={audio.seekTo}
				onSkipBy={audio.skipBy}
				onSelectTrack={audio.selectTrack}
				onSelectLanguage={audio.selectLanguage}
				onCycleSpeed={audio.cyclePlaybackRate}
			/>

			<PassagePicker
				isOpen={pickerOpen}
				currentBookNumber={bookNumber}
				currentChapter={chapter}
				onClose={() => setPickerOpen(false)}
				onNavigate={navigateTo}
			/>
		</div>
	);
}
