import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BIBLE_BOOKS, getAdjacentChapter, getBookByNumber, getBookByUsfm } from "../shared/books";
import { CANONICAL_BIBLES } from "../shared/translations";
import type {
	AlignedVerse,
	AudioTrackOption,
	FavoriteItem,
	HighlightItem,
	LexiconMap,
	TranslationMeta,
	VerseEntry,
} from "../shared/types";
import { AudioControlRail } from "./components/AudioControlRail";
import { FloatingBottomBar } from "./components/FloatingBottomBar";
import { FootnotesGuide } from "./components/FootnotesGuide";
import { HomePage } from "./components/HomePage";
import {
	Bookmark,
	BookOpen,
	ChevronLeft,
	ChevronRight,
	Headphones,
	Highlighter,
} from "./components/Icons";
import { PassagePicker } from "./components/PassagePicker";
import { type KoreanFontStyle, type ReaderTheme, TopBar } from "./components/TopBar";
import { type StackOrder, type StudyMaskMode, VerseBlock } from "./components/VerseBlock";
import { useHumanAudio } from "./hooks/useHumanAudio";
import { useVisibleVerse } from "./hooks/useVisibleVerse";
import {
	alignChapterVerses,
	loadLexicon,
	loadReaderConfig,
	loadSyncedChapterAudio,
	loadTranslationChapter,
} from "./lib/bible-loader";
import {
	makeFavoriteId,
	readStoredFavorites,
	toggleFavoriteItem,
	writeStoredFavorites,
} from "./lib/favorites";
import {
	areSpansHighlighted,
	extractVerseSelectionSpans,
	getVerseTextForLang,
	readStoredHighlights,
	toggleHighlightSpans,
	writeStoredHighlights,
} from "./lib/highlights";

const STORAGE_KEY = "logos.reader.preferences.v1";

interface StoredPrefs {
	bookNumber: number;
	chapter: number;
	verse: number;
	stackOrder: StackOrder;
	theme: ReaderTheme;
	fontScale: number;
	koFontStyle: KoreanFontStyle;
	studyMask: StudyMaskMode;
	autoSync: boolean;
}

const DEFAULT_PREFS: StoredPrefs = {
	bookNumber: 1,
	chapter: 1,
	verse: 1,
	stackOrder: "en-first",
	theme: "paper",
	fontScale: 1,
	koFontStyle: "serif",
	studyMask: "none",
	autoSync: true,
};

type AppRoute =
	{ view: "home" } | { view: "reader"; bookNumber: number; chapter: number; verse?: number };

function parseLocationHash(): AppRoute {
	if (typeof window === "undefined") return { view: "home" };
	const hash = window.location.hash.replace(/^#\/?/, "").trim();
	if (!hash || hash === "top") return { view: "home" };
	const match = hash.match(/^([A-Za-z0-9]+)\/(\d+)(?:\/(\d+))?$/);
	if (!match) return { view: "home" };
	const book = getBookByUsfm(match[1]);
	const chapter = Number.parseInt(match[2], 10);
	const verse = match[3] ? Number.parseInt(match[3], 10) : undefined;
	if (!book || Number.isNaN(chapter)) return { view: "home" };
	return {
		view: "reader",
		bookNumber: book.number,
		chapter: Math.max(1, Math.min(book.chapters, chapter)),
		verse: verse && !Number.isNaN(verse) ? verse : undefined,
	};
}

function isOneOf<T extends string>(val: unknown, allowed: readonly T[]): val is T {
	return typeof val === "string" && (allowed as readonly string[]).includes(val);
}

function readStoredPrefs(): StoredPrefs {
	if (typeof localStorage === "undefined") return DEFAULT_PREFS;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_PREFS;
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const book =
			typeof parsed.bookNumber === "number" ? getBookByNumber(parsed.bookNumber) : undefined;
		const chapter =
			book && typeof parsed.chapter === "number" && Number.isInteger(parsed.chapter)
				? Math.max(1, Math.min(book.chapters, parsed.chapter))
				: DEFAULT_PREFS.chapter;
		const verse =
			typeof parsed.verse === "number" && Number.isInteger(parsed.verse) && parsed.verse >= 1
				? parsed.verse
				: DEFAULT_PREFS.verse;
		return {
			bookNumber: book ? book.number : DEFAULT_PREFS.bookNumber,
			chapter,
			verse,
			stackOrder: isOneOf(parsed.stackOrder, ["en-first", "ko-first"])
				? parsed.stackOrder
				: DEFAULT_PREFS.stackOrder,
			theme: isOneOf(parsed.theme, ["paper", "sepia", "dark"]) ? parsed.theme : DEFAULT_PREFS.theme,
			fontScale:
				typeof parsed.fontScale === "number" &&
				Number.isFinite(parsed.fontScale) &&
				parsed.fontScale >= 0.75 &&
				parsed.fontScale <= 1.5
					? parsed.fontScale
					: DEFAULT_PREFS.fontScale,
			koFontStyle: isOneOf(parsed.koFontStyle, ["serif", "sans"])
				? parsed.koFontStyle
				: DEFAULT_PREFS.koFontStyle,
			studyMask: isOneOf(parsed.studyMask, ["none", "mask-en", "mask-ko"])
				? parsed.studyMask
				: DEFAULT_PREFS.studyMask,
			autoSync: typeof parsed.autoSync === "boolean" ? parsed.autoSync : DEFAULT_PREFS.autoSync,
		};
	} catch {
		return DEFAULT_PREFS;
	}
}

function scrollToVerse(verseNum: number): boolean {
	const el = document.getElementById(`verse-${verseNum}`);
	if (!el) return false;
	if (typeof el.scrollIntoView === "function") {
		el.scrollIntoView({ behavior: "smooth", block: "center" });
	}
	return true;
}

function useIsDesktopLayout(): boolean {
	const [isDesktop, setIsDesktop] = useState(() =>
		typeof window !== "undefined" && typeof window.matchMedia === "function"
			? window.matchMedia("(min-width: 1024px)").matches
			: true,
	);

	useEffect(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
		const mql = window.matchMedia("(min-width: 1024px)");
		const update = () => setIsDesktop(mql.matches);
		update();
		mql.addEventListener("change", update);
		return () => mql.removeEventListener("change", update);
	}, []);

	return isDesktop;
}

export default function App() {
	const initialPrefs = useMemo(() => readStoredPrefs(), []);
	const initialRoute = useMemo(() => parseLocationHash(), []);
	const isDesktop = useIsDesktopLayout();

	const [view, setView] = useState<"home" | "reader">(initialRoute.view);
	const [bookNumber, setBookNumber] = useState(
		initialRoute.view === "reader" ? initialRoute.bookNumber : initialPrefs.bookNumber,
	);
	const [chapter, setChapter] = useState(
		initialRoute.view === "reader" ? initialRoute.chapter : initialPrefs.chapter,
	);
	const [lastVerse, setLastVerse] = useState<number>(() =>
		initialRoute.view === "reader" ? (initialRoute.verse ?? 1) : initialPrefs.verse,
	);
	const [selectedEn, setSelectedEn] = useState<TranslationMeta>(CANONICAL_BIBLES.en);
	const [selectedKo, setSelectedKo] = useState<TranslationMeta>(CANONICAL_BIBLES.ko);
	const [bibleBrainEnabled, setBibleBrainEnabled] = useState(false);
	const [stackOrder, setStackOrder] = useState<StackOrder>(initialPrefs.stackOrder);
	const [theme, setTheme] = useState<ReaderTheme>(initialPrefs.theme);
	const [fontScale, setFontScale] = useState<number>(initialPrefs.fontScale);
	const [koFontStyle, setKoFontStyle] = useState<KoreanFontStyle>(initialPrefs.koFontStyle);
	const [studyMask, setStudyMask] = useState<StudyMaskMode>(initialPrefs.studyMask);
	const [autoSync, setAutoSync] = useState<boolean>(initialPrefs.autoSync);

	const [lexicon, setLexicon] = useState<LexiconMap>({});
	const [rawEnVerses, setRawEnVerses] = useState<VerseEntry[]>([]);
	const [rawKoVerses, setRawKoVerses] = useState<VerseEntry[]>([]);
	const [loadingChapter, setLoadingChapter] = useState(false);
	const [chapterError, setChapterError] = useState<string | null>(null);

	const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
	const [audioRailOpen, setAudioRailOpen] = useState(true);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [sheetOpen, setSheetOpen] = useState(false);

	const [pickerOpen, setPickerOpen] = useState(false);
	const [selectedVerse, setSelectedVerse] = useState<number | null>(
		initialRoute.view === "reader" ? (initialRoute.verse ?? null) : null,
	);
	const [favorites, setFavorites] = useState<FavoriteItem[]>(() => readStoredFavorites());
	const [highlights, setHighlights] = useState<HighlightItem[]>(() => readStoredHighlights());
	const versesListRef = useRef<HTMLElement | null>(null);
	const [selectionToolbar, setSelectionToolbar] = useState<{
		left: number;
		top: number;
		placeBelow: boolean;
		alreadyHighlighted: boolean;
	} | null>(null);
	const [highlightedFootnoteId, setHighlightedFootnoteId] = useState<string | null>(null);
	const [highlightSeq, setHighlightSeq] = useState(0);
	const highlightTimerRef = useRef<number | null>(null);
	const [pendingScrollVerse, setPendingScrollVerse] = useState<number | null>(
		initialRoute.view === "reader" ? (initialRoute.verse ?? null) : null,
	);

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

	const verseNumbers = useMemo(() => alignedVerses.map((v) => v.verse), [alignedVerses]);
	const { visibleVerse } = useVisibleVerse({
		enabled: view === "reader" && !loadingChapter && verseNumbers.length > 0,
		verseNumbers,
		resetKey: `${currentBook.usfm}:${chapter}`,
	});

	const prevVisibleVerseRef = useRef(visibleVerse);
	useEffect(() => {
		if (view !== "reader" || loadingChapter || verseNumbers.length === 0) {
			prevVisibleVerseRef.current = visibleVerse;
			return;
		}
		if (visibleVerse !== prevVisibleVerseRef.current) {
			prevVisibleVerseRef.current = visibleVerse;
			if (pendingScrollVerse === null) {
				setLastVerse(visibleVerse);
			}
		}
	}, [view, loadingChapter, verseNumbers.length, visibleVerse, pendingScrollVerse]);

	useEffect(() => {
		try {
			const prefs: StoredPrefs = {
				bookNumber,
				chapter,
				verse: lastVerse,
				stackOrder,
				theme,
				fontScale,
				koFontStyle,
				studyMask,
				autoSync,
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
		} catch {
			// Ignore storage quota errors
		}
	}, [
		bookNumber,
		chapter,
		lastVerse,
		stackOrder,
		theme,
		fontScale,
		koFontStyle,
		studyMask,
		autoSync,
	]);

	useEffect(() => {
		writeStoredFavorites(favorites);
	}, [favorites]);

	const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.id)), [favorites]);
	const isChapterFavorited = favoriteIds.has(makeFavoriteId(bookNumber, chapter));

	const handleToggleChapterFavorite = useCallback(() => {
		setFavorites((prev) => toggleFavoriteItem(prev, { bookNumber, chapter }));
	}, [bookNumber, chapter]);

	const handleToggleVerseFavorite = useCallback(
		(verse: AlignedVerse) => {
			setFavorites((prev) =>
				toggleFavoriteItem(prev, {
					bookNumber,
					chapter,
					verse: verse.verse,
					enText: verse.enText,
					koText: verse.koText,
				}),
			);
		},
		[bookNumber, chapter],
	);

	const handleRemoveFavorite = useCallback((id: string) => {
		setFavorites((prev) => prev.filter((item) => item.id !== id));
	}, []);

	useEffect(() => {
		writeStoredHighlights(highlights);
	}, [highlights]);

	const handleRemoveHighlight = useCallback((id: string) => {
		setHighlights((prev) => prev.filter((item) => item.id !== id));
	}, []);

	const alignedVerseMap = useMemo(
		() => new Map(alignedVerses.map((v) => [v.verse, v])),
		[alignedVerses],
	);

	const chapterHighlightsByVerse = useMemo(() => {
		const map = new Map<number, { en: HighlightItem[]; ko: HighlightItem[] }>();
		for (const item of highlights) {
			if (item.bookNumber !== bookNumber || item.chapter !== chapter) continue;
			let bucket = map.get(item.verse);
			if (!bucket) {
				bucket = { en: [], ko: [] };
				map.set(item.verse, bucket);
			}
			bucket[item.lang].push(item);
		}
		for (const bucket of map.values()) {
			bucket.en.sort((a, b) => a.start - b.start);
			bucket.ko.sort((a, b) => a.start - b.start);
		}
		return map;
	}, [highlights, bookNumber, chapter]);

	const applySelectionHighlight = useCallback((): boolean => {
		if (view !== "reader" || loadingChapter || !versesListRef.current) return false;
		const selection = typeof window !== "undefined" ? window.getSelection() : null;
		const spans = extractVerseSelectionSpans(selection, versesListRef.current);
		if (spans.length === 0) return false;

		setHighlights((prev) => {
			const { next } = toggleHighlightSpans(prev, bookNumber, chapter, spans, (v, lang) => {
				const verse = alignedVerseMap.get(v);
				return verse ? getVerseTextForLang(verse, lang) : "";
			});
			return next;
		});
		selection?.removeAllRanges?.();
		setSelectionToolbar(null);
		return true;
	}, [view, loadingChapter, bookNumber, chapter, alignedVerseMap]);

	const syncSelectionToolbar = useCallback(() => {
		if (view !== "reader" || loadingChapter || !versesListRef.current) {
			setSelectionToolbar(null);
			return;
		}
		const selection = typeof window !== "undefined" ? window.getSelection() : null;
		const spans = extractVerseSelectionSpans(selection, versesListRef.current);
		if (spans.length === 0 || !selection || selection.rangeCount === 0) {
			setSelectionToolbar(null);
			return;
		}
		const rect = selection.getRangeAt(0).getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const left = Math.max(95, Math.min(window.innerWidth - 95, centerX));
		const placeBelow = rect.top < 110;
		const top = placeBelow ? rect.bottom + 8 : rect.top - 8;
		setSelectionToolbar({
			left,
			top,
			placeBelow,
			alreadyHighlighted: areSpansHighlighted(highlights, bookNumber, chapter, spans),
		});
	}, [view, loadingChapter, highlights, bookNumber, chapter]);

	useEffect(() => {
		if (view !== "reader") {
			setSelectionToolbar(null);
			return;
		}
		const handlePointerStart = (e: MouseEvent) => {
			const target = e.target as HTMLElement | null;
			if (target?.closest(".selection-highlight-bar")) return;
			setSelectionToolbar(null);
		};
		const handleSelectionChange = () => {
			const selection = typeof window !== "undefined" ? window.getSelection() : null;
			if (!selection || selection.isCollapsed) {
				setSelectionToolbar(null);
			}
		};
		const handleScroll = () => setSelectionToolbar(null);

		document.addEventListener("mousedown", handlePointerStart);
		document.addEventListener("mouseup", syncSelectionToolbar);
		document.addEventListener("touchend", syncSelectionToolbar);
		document.addEventListener("keyup", syncSelectionToolbar);
		document.addEventListener("selectionchange", handleSelectionChange);
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => {
			document.removeEventListener("mousedown", handlePointerStart);
			document.removeEventListener("mouseup", syncSelectionToolbar);
			document.removeEventListener("touchend", syncSelectionToolbar);
			document.removeEventListener("keyup", syncSelectionToolbar);
			document.removeEventListener("selectionchange", handleSelectionChange);
			window.removeEventListener("scroll", handleScroll);
		};
	}, [view, syncSelectionToolbar]);

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
	}, [theme]);

	useEffect(() => {
		const syncFromLocation = () => {
			const route = parseLocationHash();
			if (route.view === "home") {
				setView("home");
				return;
			}
			setView("reader");
			setBookNumber(route.bookNumber);
			setChapter(route.chapter);
			setLastVerse(route.verse ?? 1);
			setSelectedVerse(route.verse ?? null);
			setPendingScrollVerse(route.verse ?? null);
		};
		window.addEventListener("hashchange", syncFromLocation);
		window.addEventListener("popstate", syncFromLocation);
		return () => {
			window.removeEventListener("hashchange", syncFromLocation);
			window.removeEventListener("popstate", syncFromLocation);
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		loadReaderConfig().then((cfg) => {
			if (cancelled) return;
			setSelectedEn(cfg.english);
			setSelectedKo(cfg.korean);
			setBibleBrainEnabled(cfg.bibleBrainEnabled);
		});
		loadLexicon().then((lex) => {
			if (!cancelled) setLexicon(lex);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (view !== "reader") return;
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
	}, [view, selectedEn, selectedKo, bookNumber, chapter]);

	useEffect(() => {
		if (view !== "reader") return;
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
	}, [view, currentBook.usfm, chapter]);

	const navigateTo = useCallback(
		(targetBook: number, targetChapter: number, verse?: number) => {
			const book = getBookByNumber(targetBook) ?? BIBLE_BOOKS[0];
			const clampedChapter = Math.max(1, Math.min(book.chapters, targetChapter));
			const targetHash = verse
				? `#/${book.usfm}/${clampedChapter}/${verse}`
				: `#/${book.usfm}/${clampedChapter}`;
			if (window.location.hash !== targetHash) {
				window.history.pushState(null, "", targetHash);
			}
			if (book.number !== bookNumber || clampedChapter !== chapter) {
				setRawEnVerses([]);
				setRawKoVerses([]);
				setLoadingChapter(true);
				setChapterError(null);
			}
			setView("reader");
			setBookNumber(book.number);
			setChapter(clampedChapter);
			setLastVerse(verse ?? 1);
			setSelectedVerse(verse ?? null);
			setHighlightedFootnoteId(null);
			setPendingScrollVerse(verse ?? null);
			if (!verse) {
				window.scrollTo({ top: 0, behavior: "smooth" });
			}
		},
		[bookNumber, chapter],
	);

	useEffect(() => {
		if (!pendingScrollVerse || loadingChapter) return;
		if (scrollToVerse(pendingScrollVerse)) {
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
		visibleVerse,
		autoSync,
		onChapterEnded: handleChapterEnded,
	});
	prepareNextPlayRef.current = audio.prepareAutoAdvancePlay;

	const goHome = useCallback(() => {
		audio.pause();
		setView("home");
		if (window.location.hash !== "#/" && window.location.hash !== "") {
			window.history.pushState(null, "", "#/");
		}
		window.scrollTo({ top: 0, behavior: "smooth" });
	}, [audio]);

	const handleContinueReading = useCallback(() => {
		if (lastVerse > 1) {
			navigateTo(bookNumber, chapter, lastVerse);
		} else {
			navigateTo(bookNumber, chapter);
		}
	}, [bookNumber, chapter, lastVerse, navigateTo]);

	// Pause auto-scroll follow when user manually scrolls via wheel/touch while audio plays
	useEffect(() => {
		if (!audio.isPlaying || !autoSync) return;
		const pauseFollow = () => audio.setIsFollowingAudio(false);
		window.addEventListener("wheel", pauseFollow, { passive: true });
		window.addEventListener("touchmove", pauseFollow, { passive: true });
		return () => {
			window.removeEventListener("wheel", pauseFollow);
			window.removeEventListener("touchmove", pauseFollow);
		};
	}, [audio, autoSync]);

	useEffect(() => {
		if (audio.activeVerse) {
			setLastVerse(audio.activeVerse);
		}
	}, [audio.activeVerse]);

	useEffect(() => {
		if (!audio.activeVerse || !autoSync || !audio.isFollowingAudio) return;
		scrollToVerse(audio.activeVerse);
	}, [audio.activeVerse, autoSync, audio.isFollowingAudio]);

	const handleFollowActiveVerse = useCallback(() => {
		audio.setIsFollowingAudio(true);
		if (audio.activeVerse) {
			scrollToVerse(audio.activeVerse);
		}
	}, [audio]);

	// Keyboard shortcuts: Cmd/Ctrl+K to jump, Cmd/Ctrl+H to highlight selection, ArrowLeft/ArrowRight skip 10s while playing or turn chapters otherwise
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement | null)?.tagName;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setPickerOpen((prev) => !prev);
				return;
			}
			if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "h") {
				if (pickerOpen || view !== "reader" || tag === "INPUT" || tag === "TEXTAREA") return;
				if (applySelectionHighlight()) {
					e.preventDefault();
				}
				return;
			}
			if (pickerOpen || view !== "reader" || tag === "INPUT" || tag === "TEXTAREA") return;
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
	}, [
		pickerOpen,
		view,
		prevChapterTarget,
		nextChapterTarget,
		navigateTo,
		audio,
		applySelectionHighlight,
	]);

	const handleSelectVerse = useCallback(
		(verseNum: number) => {
			setSelectedVerse((prev) => (prev === verseNum ? null : verseNum));
			setLastVerse(verseNum);
			if (audio.isPlaying) {
				audio.jumpToVerse(verseNum);
			}
		},
		[audio],
	);

	const handleToggleAudioRail = useCallback(() => {
		setAudioRailOpen((prev) => !prev);
	}, []);

	const handleToggleDictionary = useCallback(() => {
		if (isDesktop) {
			setSidebarOpen((prev) => !prev);
		} else {
			setSheetOpen((prev) => !prev);
		}
	}, [isDesktop]);

	useEffect(() => {
		return () => {
			if (highlightTimerRef.current !== null) {
				window.clearTimeout(highlightTimerRef.current);
			}
		};
	}, []);

	const handleSelectFootnote = useCallback(
		(footnoteId: string) => {
			setHighlightedFootnoteId(footnoteId);
			setHighlightSeq((seq) => seq + 1);
			if (isDesktop) {
				setSidebarOpen(true);
			} else {
				setSheetOpen(true);
			}
			if (highlightTimerRef.current !== null) {
				window.clearTimeout(highlightTimerRef.current);
			}
			highlightTimerRef.current = window.setTimeout(() => {
				highlightTimerRef.current = null;
				setHighlightedFootnoteId((cur) => (cur === footnoteId ? null : cur));
			}, 3200);
		},
		[isDesktop],
	);

	const handleJumpFromFootnote = useCallback((verseNum: number) => {
		setSelectedVerse(verseNum);
		setLastVerse(verseNum);
		scrollToVerse(verseNum);
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

	const dictionaryOpen = isDesktop ? sidebarOpen : sheetOpen;
	const showDictionary = !loadingChapter && !chapterError;

	const openPrevChapter = () =>
		prevChapterTarget && navigateTo(prevChapterTarget.bookNumber, prevChapterTarget.chapter);
	const openNextChapter = () =>
		nextChapterTarget && navigateTo(nextChapterTarget.bookNumber, nextChapterTarget.chapter);

	const renderChapterNav = (placement: "header" | "footer") => (
		<nav
			className={placement === "header" ? "chapter-nav-header" : "chapter-nav-footer"}
			aria-label={placement === "header" ? "Top chapter navigation" : "Bottom chapter navigation"}
		>
			<button
				type="button"
				className={`nav-chapter-btn ${placement === "header" ? "nav-chapter-btn-compact" : ""}`.trim()}
				disabled={!prevChapterTarget}
				onClick={openPrevChapter}
			>
				<ChevronLeft size={placement === "header" ? 15 : 16} />
				<span>Previous Chapter</span>
			</button>

			<button
				type="button"
				className={`nav-chapter-btn ${placement === "header" ? "nav-chapter-btn-compact" : ""}`.trim()}
				disabled={!nextChapterTarget}
				onClick={openNextChapter}
			>
				<span>Next Chapter</span>
				<ChevronRight size={placement === "header" ? 15 : 16} />
			</button>
		</nav>
	);

	const sharedAudioControls = {
		bookEn: currentBook.en,
		bookKo: currentBook.ko,
		chapter,
		tracks: audioTracks,
		preferredLang: audio.preferredLang,
		activeTrack: audio.activeTrack,
		isPlaying: audio.isPlaying,
		isLoading: audio.isLoading,
		currentTime: audio.currentTime,
		duration: audio.duration,
		playbackRate: audio.playbackRate,
		errorMessage: audio.errorMessage,
		activeEnCode: selectedEn.code,
		activeKoCode: selectedKo.code,
		onTogglePlay: audio.togglePlay,
		onSeek: audio.seekTo,
		onSkipBy: audio.skipBy,
		onSelectTrack: audio.selectTrack,
		onSelectLanguage: audio.selectLanguage,
		onChangeSpeed: audio.setPlaybackRate,
	};

	const renderDictionary = (variant: "sidebar" | "sheet", onMinimize: () => void) => (
		<FootnotesGuide
			bookEn={currentBook.en}
			bookKo={currentBook.ko}
			chapter={chapter}
			footnotes={analysis.footnotes}
			grammarNotes={analysis.grammarNotes}
			highlightedFootnoteId={highlightedFootnoteId}
			highlightSeq={highlightSeq}
			variant={variant}
			onMinimize={onMinimize}
			onJumpToVerse={handleJumpFromFootnote}
		/>
	);

	return (
		<div id="top" className="app-shell" style={readerStyle}>
			<TopBar
				isHome={view === "home"}
				lastBookNumber={bookNumber}
				lastChapter={chapter}
				lastVerse={lastVerse}
				favorites={favorites}
				highlights={highlights}
				selectedEn={selectedEn}
				selectedKo={selectedKo}
				stackOrder={stackOrder}
				theme={theme}
				fontScale={fontScale}
				koFontStyle={koFontStyle}
				studyMask={studyMask}
				onGoHome={goHome}
				onContinueReading={handleContinueReading}
				onOpenPassage={navigateTo}
				onRemoveFavorite={handleRemoveFavorite}
				onRemoveHighlight={handleRemoveHighlight}
				onFlipStackOrder={() =>
					setStackOrder((prev) => (prev === "en-first" ? "ko-first" : "en-first"))
				}
				onOpenSearch={() => setPickerOpen(true)}
				onChangeTheme={setTheme}
				onChangeFontScale={setFontScale}
				onChangeKoFontStyle={setKoFontStyle}
				onChangeStudyMask={setStudyMask}
			/>

			{view === "home" ? (
				<HomePage
					lastBookNumber={bookNumber}
					lastChapter={chapter}
					lastVerse={lastVerse}
					selectedEn={selectedEn}
					selectedKo={selectedKo}
					bibleBrainEnabled={bibleBrainEnabled}
					favorites={favorites}
					highlights={highlights}
					onOpenPassage={navigateTo}
					onRemoveFavorite={handleRemoveFavorite}
					onRemoveHighlight={handleRemoveHighlight}
				/>
			) : (
				<>
					<div
						className={`reader-workspace ${isDesktop ? "desktop-layout" : ""} ${isDesktop && audioRailOpen ? "with-left-rail" : ""} ${isDesktop && !audioRailOpen ? "with-minimized-left-rail" : ""} ${isDesktop && sidebarOpen ? "with-right-rail" : ""} ${isDesktop && showDictionary && !sidebarOpen ? "with-minimized-rail" : ""}`}
					>
						{isDesktop && (
							<div className={`audio-rail-wrap ${audioRailOpen ? "expanded" : "minimized"}`}>
								{audioRailOpen ? (
									<AudioControlRail
										{...sharedAudioControls}
										visibleVerse={visibleVerse}
										activeVerse={audio.activeVerse}
										autoSync={autoSync}
										isFollowingAudio={audio.isFollowingAudio}
										onToggleAutoSync={() => setAutoSync((prev) => !prev)}
										onSyncToVisibleVerse={() => audio.jumpToVerse(visibleVerse)}
										onFollowActiveVerse={handleFollowActiveVerse}
										onMinimize={handleToggleAudioRail}
									/>
								) : (
									<button
										type="button"
										className={`rail-minimized-pill audio-minimized-pill ${audio.isPlaying ? "playing" : ""}`.trim()}
										onClick={handleToggleAudioRail}
										aria-expanded={false}
										aria-label="Expand audio"
										title="Show audio player"
									>
										<Headphones size={14} />
										<ChevronRight size={13} />
									</button>
								)}
							</div>
						)}

						<main className="reader-main">
							<header className="chapter-header">
								<div className="chapter-kicker">
									<span>
										{currentBook.testament === "OT" ? "Old Testament" : "New Testament"} ·{" "}
										{selectedEn.code}
									</span>
									<span lang="ko">
										{currentBook.testament === "OT" ? "구약" : "신약"} · {selectedKo.code}
									</span>
								</div>

								<div className="chapter-title-row">
									<div className="chapter-title-main">
										<h1 className="chapter-title-en">
											{currentBook.en} {chapter}
										</h1>
										<button
											type="button"
											className={`chapter-favorite-btn ${isChapterFavorited ? "active" : ""}`.trim()}
											onClick={handleToggleChapterFavorite}
											aria-pressed={isChapterFavorited}
											aria-label={
												isChapterFavorited
													? `Remove ${currentBook.en} ${chapter} from favorites`
													: `Bookmark ${currentBook.en} ${chapter}`
											}
											title={
												isChapterFavorited
													? "Remove chapter from favorites"
													: "Bookmark chapter to favorites"
											}
										>
											<Bookmark size={15} filled={isChapterFavorited} />
										</button>
									</div>
									<p className="chapter-title-ko" lang="ko">
										{currentBook.ko} {chapter}장
									</p>
								</div>

								{renderChapterNav("header")}

								{!isDesktop && (
									<div className="chapter-subbar">
										<button
											type="button"
											className="footnote-jump-link"
											onClick={handleToggleDictionary}
										>
											<BookOpen size={13} />
											<span>Korean Dictionary ({analysis.footnotes.length})</span>
										</button>
									</div>
								)}
							</header>

							{loadingChapter ? (
								<p className="footnotes-subtitle">Loading chapter...</p>
							) : chapterError ? (
								<div className="grammar-card">
									<div className="grammar-pattern">Unable to load passage</div>
									<p className="grammar-desc">{chapterError}</p>
								</div>
							) : (
								<section
									ref={versesListRef}
									className="verses-list"
									aria-label="Bilingual Scripture"
								>
									{alignedVerses.map((verse) => {
										const verseHighlights = chapterHighlightsByVerse.get(verse.verse);
										return (
											<VerseBlock
												key={verse.verse}
												verse={verse}
												stackOrder={stackOrder}
												studyMask={studyMask}
												isSelected={selectedVerse === verse.verse}
												isAudioActive={audio.activeVerse === verse.verse}
												isFavorited={favoriteIds.has(
													makeFavoriteId(bookNumber, chapter, verse.verse),
												)}
												enHighlights={verseHighlights?.en}
												koHighlights={verseHighlights?.ko}
												enCode={selectedEn.code}
												koCode={selectedKo.code}
												hasVerseTimestamps={Boolean(audio.activeTrack?.verseTimings)}
												onSelectVerse={handleSelectVerse}
												onToggleFavorite={handleToggleVerseFavorite}
												onSelectFootnote={handleSelectFootnote}
											/>
										);
									})}
								</section>
							)}

							{renderChapterNav("footer")}

							<footer className="copyright-footer">
								Korean text: 성경전서 개역한글판 (1961, Public Domain) · English text:{" "}
								{selectedEn.nativeName} · Hover any Korean word for instant translation.
							</footer>
						</main>

						{showDictionary && isDesktop && (
							<div className={`dict-sidebar-wrap ${sidebarOpen ? "expanded" : "minimized"}`}>
								{sidebarOpen ? (
									renderDictionary("sidebar", handleToggleDictionary)
								) : (
									<button
										type="button"
										className="rail-minimized-pill dict-minimized-pill"
										onClick={handleToggleDictionary}
										aria-expanded={false}
										aria-label="Expand dictionary"
										title="Show Korean dictionary"
									>
										<ChevronLeft size={13} />
										<BookOpen size={14} />
									</button>
								)}
							</div>
						)}
					</div>

					{!isDesktop && (
						<FloatingBottomBar
							{...sharedAudioControls}
							hasPrev={Boolean(prevChapterTarget)}
							hasNext={Boolean(nextChapterTarget)}
							onPrevChapter={openPrevChapter}
							onNextChapter={openNextChapter}
							onOpenPicker={() => setPickerOpen(true)}
							dictionaryOpen={dictionaryOpen}
							dictionarySheet={
								showDictionary && sheetOpen ? (
									<div className="dict-sheet-wrap">
										{renderDictionary("sheet", () => setSheetOpen(false))}
									</div>
								) : undefined
							}
							onToggleDictionary={handleToggleDictionary}
						/>
					)}
				</>
			)}

			{selectionToolbar && view === "reader" && (
				<div
					className="selection-highlight-bar"
					role="toolbar"
					aria-label="Text highlight actions"
					style={{
						left: `${selectionToolbar.left}px`,
						top: `${selectionToolbar.top}px`,
						transform: selectionToolbar.placeBelow
							? "translate(-50%, 0)"
							: "translate(-50%, -100%)",
					}}
				>
					<button
						type="button"
						className="selection-highlight-btn"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => applySelectionHighlight()}
					>
						<Highlighter size={13} />
						<span>{selectionToolbar.alreadyHighlighted ? "Remove Highlight" : "Highlight"}</span>
						<kbd className="selection-highlight-kbd">⌘H</kbd>
					</button>
				</div>
			)}

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
