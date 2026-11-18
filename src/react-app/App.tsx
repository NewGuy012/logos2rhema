import { ChevronLeft, ChevronRight, Headphones } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BIBLE_BOOKS, getAdjacentChapter, getBookByNumber, getBookByUsfm } from "../shared/books";
import { BUILTIN_ENGLISH_TRANSLATIONS, BUILTIN_KOREAN_TRANSLATIONS } from "../shared/translations";
import type { AudioTrackOption, LexiconMap, TranslationMeta, VerseEntry } from "../shared/types";
import { FloatingBottomBar } from "./components/FloatingBottomBar";
import { FootnotesGuide } from "./components/FootnotesGuide";
import { PassagePicker } from "./components/PassagePicker";
import { type KoreanFontStyle, type ReaderTheme, TopBar } from "./components/TopBar";
import { type StackOrder, type StudyMaskMode, VerseBlock } from "./components/VerseBlock";
import { useHumanAudio } from "./hooks/useHumanAudio";
import {
	alignChapterVerses,
	loadAvailableTranslations,
	loadLexicon,
	loadSyncedChapterAudio,
	loadTranslationChapter,
} from "./lib/bible-loader";

const STORAGE_KEY = "logos.reader.preferences.v1";

interface StoredPrefs {
	bookNumber: number;
	chapter: number;
	enId: string;
	koId: string;
	stackOrder: StackOrder;
	theme: ReaderTheme;
	fontScale: number;
	koFontStyle: KoreanFontStyle;
	studyMask: StudyMaskMode;
}

const DEFAULT_PREFS: StoredPrefs = {
	bookNumber: 1,
	chapter: 1,
	enId: "esv",
	koId: "krv",
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

export default function App() {
	const initialPrefs = useMemo(() => readStoredPrefs(), []);
	const initialHash = useMemo(() => readInitialLocation(), []);

	const [bookNumber, setBookNumber] = useState(initialHash?.bookNumber ?? initialPrefs.bookNumber);
	const [chapter, setChapter] = useState(initialHash?.chapter ?? initialPrefs.chapter);
	const [enTranslations, setEnTranslations] = useState<TranslationMeta[]>([
		...BUILTIN_ENGLISH_TRANSLATIONS,
	]);
	const [koTranslations, setKoTranslations] = useState<TranslationMeta[]>([
		...BUILTIN_KOREAN_TRANSLATIONS,
	]);
	const [enId, setEnId] = useState(initialPrefs.enId);
	const [koId, setKoId] = useState(initialPrefs.koId);
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
	const [audioDrawerOpen, setAudioDrawerOpen] = useState(false);
	const [autoAdvance, setAutoAdvance] = useState(true);

	const [pickerOpen, setPickerOpen] = useState(false);
	const [selectedVerse, setSelectedVerse] = useState<number | null>(null);
	const [highlightedFootnoteId, setHighlightedFootnoteId] = useState<string | null>(null);
	const [pendingScrollVerse, setPendingScrollVerse] = useState<number | null>(null);

	const currentBook = useMemo(() => getBookByNumber(bookNumber) ?? BIBLE_BOOKS[0], [bookNumber]);
	const selectedEn = useMemo(
		() => enTranslations.find((t) => t.id === enId) ?? enTranslations[0],
		[enTranslations, enId],
	);
	const selectedKo = useMemo(
		() => koTranslations.find((t) => t.id === koId) ?? koTranslations[0],
		[koTranslations, koId],
	);

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
				enId,
				koId,
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
	}, [bookNumber, chapter, enId, koId, stackOrder, theme, fontScale, koFontStyle, studyMask]);

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

	// Load dynamic translation catalog + compact Korean lexicon once
	useEffect(() => {
		let cancelled = false;
		loadAvailableTranslations().then((catalog) => {
			if (cancelled) return;
			setEnTranslations(catalog.english);
			setKoTranslations(catalog.korean);
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

	// Sync human-narrated audio tracks whenever book, chapter, or selected translations change
	useEffect(() => {
		let cancelled = false;
		loadSyncedChapterAudio({
			usfm: currentBook.usfm,
			chapter,
			koTranslation: selectedKo,
			enTranslation: selectedEn,
		}).then((res) => {
			if (!cancelled) setAudioTracks(res.tracks);
		});
		return () => {
			cancelled = true;
		};
	}, [currentBook.usfm, chapter, selectedKo, selectedEn]);

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
		if (!autoAdvance || !nextChapterTarget) return;
		prepareNextPlayRef.current();
		navigateTo(nextChapterTarget.bookNumber, nextChapterTarget.chapter);
	}, [autoAdvance, nextChapterTarget, navigateTo]);

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

	// Keyboard shortcuts: Cmd/Ctrl+K to jump, ArrowLeft/ArrowRight to turn chapters
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement | null)?.tagName;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setPickerOpen((prev) => !prev);
				return;
			}
			if (pickerOpen || tag === "INPUT" || tag === "TEXTAREA") return;
			if (e.key === "ArrowLeft" && prevChapterTarget) {
				navigateTo(prevChapterTarget.bookNumber, prevChapterTarget.chapter);
			} else if (e.key === "ArrowRight" && nextChapterTarget) {
				navigateTo(nextChapterTarget.bookNumber, nextChapterTarget.chapter);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [pickerOpen, prevChapterTarget, nextChapterTarget, navigateTo]);

	const handleSelectVerse = useCallback(
		(verseNum: number) => {
			setSelectedVerse((prev) => (prev === verseNum ? null : verseNum));
			if (audioDrawerOpen || audio.isPlaying) {
				audio.jumpToVerse(verseNum);
			}
		},
		[audio, audioDrawerOpen],
	);

	const handleSelectFootnote = useCallback((footnoteId: string) => {
		setHighlightedFootnoteId(footnoteId);
		const el = document.getElementById(footnoteId);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "center" });
		}
		window.setTimeout(() => {
			setHighlightedFootnoteId((cur) => (cur === footnoteId ? null : cur));
		}, 2400);
	}, []);

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

	return (
		<div id="top" className="app-shell" style={readerStyle}>
			<TopBar
				englishTranslations={enTranslations}
				koreanTranslations={koTranslations}
				selectedEn={selectedEn}
				selectedKo={selectedKo}
				stackOrder={stackOrder}
				theme={theme}
				fontScale={fontScale}
				koFontStyle={koFontStyle}
				studyMask={studyMask}
				onSelectEn={(t) => setEnId(t.id)}
				onSelectKo={(t) => setKoId(t.id)}
				onFlipStackOrder={() =>
					setStackOrder((prev) => (prev === "en-first" ? "ko-first" : "en-first"))
				}
				onOpenSearch={() => setPickerOpen(true)}
				onChangeTheme={setTheme}
				onChangeFontScale={setFontScale}
				onChangeKoFontStyle={setKoFontStyle}
				onChangeStudyMask={setStudyMask}
			/>

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
							onClick={() => {
								setAudioDrawerOpen(true);
								if (!audio.isPlaying && audio.activeTrack) {
									audio.togglePlay();
								}
							}}
						>
							<Headphones size={13} />
							<span>
								{activeAudioForCurrentLang.length > 0
									? `Listen (${audio.preferredLang === "ko" ? selectedKo.code : selectedEn.code})`
									: "Audio Settings"}
							</span>
						</button>

						<a href="#footnotes" className="footnote-jump-link">
							Korean Word Footnotes ({analysis.footnotes.length}) ↓
						</a>
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

				{!loadingChapter && !chapterError && (
					<FootnotesGuide
						bookEn={currentBook.en}
						bookKo={currentBook.ko}
						chapter={chapter}
						footnotes={analysis.footnotes}
						grammarNotes={analysis.grammarNotes}
						highlightedFootnoteId={highlightedFootnoteId}
						onJumpToVerse={handleJumpFromFootnote}
					/>
				)}

				<footer className="copyright-footer">
					Korean text: 성경전서 개역한글판 (1961, Public Domain) · English text:{" "}
					{selectedEn.nativeName} · Hover any Korean word for instant translation.
				</footer>
			</main>

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
				audioDrawerOpen={audioDrawerOpen}
				onToggleAudioDrawer={() => setAudioDrawerOpen((prev) => !prev)}
				tracks={audioTracks}
				preferredLang={audio.preferredLang}
				activeTrack={audio.activeTrack}
				isPlaying={audio.isPlaying}
				isLoading={audio.isLoading}
				currentTime={audio.currentTime}
				duration={audio.duration}
				playbackRate={audio.playbackRate}
				autoAdvance={autoAdvance}
				errorMessage={audio.errorMessage}
				activeEnCode={selectedEn.code}
				activeKoCode={selectedKo.code}
				onTogglePlay={audio.togglePlay}
				onSeek={audio.seekTo}
				onSkipBy={audio.skipBy}
				onSelectTrack={audio.selectTrack}
				onSelectLanguage={audio.selectLanguage}
				onCycleSpeed={audio.cyclePlaybackRate}
				onToggleAutoAdvance={() => setAutoAdvance((prev) => !prev)}
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
