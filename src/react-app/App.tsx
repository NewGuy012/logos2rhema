import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { hasVerseTimings } from "../shared/audio-timings";
import { BIBLE_BOOKS, getAdjacentChapter, getBookByNumber, getBookByUsfm } from "../shared/books";
import { DEFAULT_COMMENTARY_ID, isCommentaryId } from "../shared/commentaries";
import { CANONICAL_BIBLES } from "../shared/translations";
import type {
	AlignedVerse,
	AudioTrackOption,
	ChapterCommentaryResponse,
	CommentaryId,
	FavoriteItem,
	HighlightItem,
	LexiconMap,
	RightRailTab,
	VerseEntry,
} from "../shared/types";
import { AudioControlRail } from "./components/AudioControlRail";
import { FloatingBottomBar } from "./components/FloatingBottomBar";
import { HomePage } from "./components/HomePage";
import {
	Bookmark,
	BookOpen,
	BookText,
	ChevronLeft,
	ChevronRight,
	Headphones,
	Highlighter,
} from "./components/Icons";
import { PassagePicker } from "./components/PassagePicker";
import { StudyRightRail } from "./components/StudyRightRail";
import { type KoreanFontStyle, type ReaderTheme, TopBar } from "./components/TopBar";
import { type StackOrder, type StudyMaskMode, VerseBlock } from "./components/VerseBlock";
import { useHumanAudio } from "./hooks/useHumanAudio";
import { computeAnchorPos } from "./hooks/usePopover";
import { useVisibleVerse } from "./hooks/useVisibleVerse";
import {
	alignChapterVerses,
	loadChapterCommentary,
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
import { readJsonStorage, writeJsonStorage } from "./lib/storage";

const STORAGE_KEY = "logos.reader.preferences.v1";

interface DisplayPrefs {
	stackOrder: StackOrder;
	theme: ReaderTheme;
	fontScale: number;
	koFontStyle: KoreanFontStyle;
	studyMask: StudyMaskMode;
	autoSync: boolean;
	rightRailTab: RightRailTab;
	commentarySource: CommentaryId;
}

interface StoredPrefs extends DisplayPrefs {
	bookNumber: number;
	chapter: number;
	verse: number;
}

const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
	stackOrder: "en-first",
	theme: "paper",
	fontScale: 1,
	koFontStyle: "serif",
	studyMask: "none",
	autoSync: true,
	rightRailTab: "dictionary",
	commentarySource: DEFAULT_COMMENTARY_ID,
};

const DEFAULT_PREFS: StoredPrefs = {
	bookNumber: 1,
	chapter: 1,
	verse: 1,
	...DEFAULT_DISPLAY_PREFS,
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
	const raw = readJsonStorage(STORAGE_KEY);
	if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
	const parsed = raw as Record<string, unknown>;
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
		rightRailTab: isOneOf(parsed.rightRailTab, ["dictionary", "commentary"])
			? parsed.rightRailTab
			: DEFAULT_PREFS.rightRailTab,
		commentarySource: isCommentaryId(parsed.commentarySource)
			? parsed.commentarySource
			: DEFAULT_PREFS.commentarySource,
	};
}

const SCROLL_FOLLOW_IGNORED_SELECTOR =
	".dict-sidebar-wrap, .audio-rail-wrap, .dict-sheet-wrap, .top-popover, .picker-modal, .verse-ref-menu, .speed-menu";

function getReaderVerticalBounds(): { topInset: number; bottomLimit: number } {
	const viewportHeight = window.innerHeight || 0;
	const topBarBottom = document.querySelector(".top-bar")?.getBoundingClientRect().bottom ?? 56;
	const topInset = Math.max(56, topBarBottom) + 14;
	const dockTop = document.querySelector(".floating-dock")?.getBoundingClientRect().top;
	const bottomLimit =
		dockTop && dockTop > topInset + 80
			? Math.min(viewportHeight - 20, dockTop - 14)
			: viewportHeight - 28;
	return { topInset, bottomLimit };
}

function scrollToVerse(verseNum: number, mode: "jump" | "follow" = "jump"): void {
	const el = document.getElementById(`verse-${verseNum}`);
	if (!el) return;

	if (
		mode === "follow" &&
		typeof window !== "undefined" &&
		typeof window.scrollTo === "function" &&
		typeof el.getBoundingClientRect === "function"
	) {
		const rect = el.getBoundingClientRect();
		const viewportHeight = window.innerHeight || 0;
		if (rect.height > 0 && viewportHeight > 0) {
			const { topInset, bottomLimit } = getReaderVerticalBounds();
			const usableHeight = Math.max(120, bottomLimit - topInset);
			const bandBottom = topInset + usableHeight * 0.72;
			const fitsComfortably =
				rect.top >= topInset &&
				rect.top <= bandBottom &&
				(rect.bottom <= bottomLimit || rect.top <= topInset + 72);
			if (fitsComfortably) return;

			const desiredTop = topInset + Math.min(44, usableHeight * 0.14);
			const targetScrollY = Math.max(0, window.scrollY + rect.top - desiredTop);
			window.scrollTo({ top: targetScrollY, behavior: "smooth" });
			return;
		}
	}

	if (typeof el.scrollIntoView === "function") {
		el.scrollIntoView({ behavior: "smooth", block: mode === "follow" ? "nearest" : "start" });
	}
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
	const [lastVerse, setLastVerse] = useState(() =>
		initialRoute.view === "reader" ? (initialRoute.verse ?? 1) : initialPrefs.verse,
	);
	const [prefs, setPrefs] = useState<DisplayPrefs>({
		stackOrder: initialPrefs.stackOrder,
		theme: initialPrefs.theme,
		fontScale: initialPrefs.fontScale,
		koFontStyle: initialPrefs.koFontStyle,
		studyMask: initialPrefs.studyMask,
		autoSync: initialPrefs.autoSync,
		rightRailTab: initialPrefs.rightRailTab,
		commentarySource: initialPrefs.commentarySource,
	});

	const updatePref = useCallback(<K extends keyof DisplayPrefs>(key: K, value: DisplayPrefs[K]) => {
		setPrefs((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
	}, []);

	const [krvSyncedAudioEnabled, setKrvSyncedAudioEnabled] = useState(false);

	const [lexicon, setLexicon] = useState<LexiconMap>({});
	const [rawEnVerses, setRawEnVerses] = useState<VerseEntry[]>([]);
	const [rawKoVerses, setRawKoVerses] = useState<VerseEntry[]>([]);
	const [loadingChapter, setLoadingChapter] = useState(false);
	const [chapterError, setChapterError] = useState<string | null>(null);

	const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
	const [audioRailOpen, setAudioRailOpen] = useState(true);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [sheetOpen, setSheetOpen] = useState(false);

	const [commentaryData, setCommentaryData] = useState<ChapterCommentaryResponse | null>(null);
	const [commentaryLoading, setCommentaryLoading] = useState(false);
	const [commentaryError, setCommentaryError] = useState<string | null>(null);
	const [commentaryRetrySeq, setCommentaryRetrySeq] = useState(0);
	const commentaryLoadedKeyRef = useRef<string | null>(null);

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
		writeJsonStorage(STORAGE_KEY, {
			bookNumber,
			chapter,
			verse: lastVerse,
			...prefs,
		} satisfies StoredPrefs);
	}, [bookNumber, chapter, lastVerse, prefs]);

	useEffect(() => {
		writeStoredFavorites(favorites);
	}, [favorites]);

	useEffect(() => {
		writeStoredHighlights(highlights);
	}, [highlights]);

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
	const handleClearFavorites = useCallback(() => setFavorites([]), []);
	const handleRemoveHighlight = useCallback((id: string) => {
		setHighlights((prev) => prev.filter((item) => item.id !== id));
	}, []);
	const handleClearHighlights = useCallback(() => setHighlights([]), []);

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
		const pos = computeAnchorPos(selection.getRangeAt(0).getBoundingClientRect(), {
			minSpace: 110,
			halfWidth: 95,
			gap: 8,
			prefer: "above",
		});
		setSelectionToolbar({
			...pos,
			alreadyHighlighted: areSpansHighlighted(highlights, bookNumber, chapter, spans),
		});
	}, [view, loadingChapter, highlights, bookNumber, chapter]);

	useEffect(() => {
		if (view !== "reader") {
			setSelectionToolbar(null);
			return;
		}
		const handlePointerStart = (e: MouseEvent) => {
			if (!(e.target as HTMLElement | null)?.closest(".selection-highlight-bar")) {
				setSelectionToolbar(null);
			}
		};
		const handleSelectionChange = () => {
			const selection = typeof window !== "undefined" ? window.getSelection() : null;
			if (!selection || selection.isCollapsed) setSelectionToolbar(null);
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
		document.documentElement.setAttribute("data-theme", prefs.theme);
	}, [prefs.theme]);

	const openReaderRoute = useCallback(
		(targetBook: number, targetChapter: number, verse?: number) => {
			setView("reader");
			setBookNumber(targetBook);
			setChapter(targetChapter);
			setLastVerse(verse ?? 1);
			setSelectedVerse(verse ?? null);
			setHighlightedFootnoteId(null);
			setSelectionToolbar(null);
			setPendingScrollVerse(verse ?? null);
			if (!verse) {
				window.scrollTo({ top: 0, behavior: "smooth" });
			}
		},
		[],
	);

	useEffect(() => {
		const syncFromLocation = () => {
			const route = parseLocationHash();
			if (route.view === "home") {
				setView("home");
				setSelectionToolbar(null);
				return;
			}
			openReaderRoute(route.bookNumber, route.chapter, route.verse);
		};
		window.addEventListener("hashchange", syncFromLocation);
		window.addEventListener("popstate", syncFromLocation);
		return () => {
			window.removeEventListener("hashchange", syncFromLocation);
			window.removeEventListener("popstate", syncFromLocation);
		};
	}, [openReaderRoute]);

	useEffect(() => {
		let cancelled = false;
		loadReaderConfig().then((cfg) => {
			if (cancelled) return;
			setKrvSyncedAudioEnabled(cfg.krvSyncedAudioEnabled);
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
		setRawEnVerses([]);
		setRawKoVerses([]);
		setLoadingChapter(true);
		setChapterError(null);

		Promise.all([
			loadTranslationChapter(CANONICAL_BIBLES.en.id, bookNumber, chapter),
			loadTranslationChapter(CANONICAL_BIBLES.ko.id, bookNumber, chapter),
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
	}, [view, bookNumber, chapter]);

	useEffect(() => {
		if (view !== "reader") return;
		let cancelled = false;
		setAudioTracks([]);
		loadSyncedChapterAudio({ usfm: currentBook.usfm, chapter }).then((res) => {
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
			openReaderRoute(book.number, clampedChapter, verse);
		},
		[openReaderRoute],
	);

	useEffect(() => {
		if (!pendingScrollVerse || loadingChapter) return;
		scrollToVerse(pendingScrollVerse);
		setPendingScrollVerse(null);
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
		autoSync: prefs.autoSync,
		onChapterEnded: handleChapterEnded,
	});
	const {
		isPlaying,
		activeVerse,
		isFollowingAudio,
		pause,
		skipBy,
		jumpToVerse,
		setIsFollowingAudio,
	} = audio;
	prepareNextPlayRef.current = audio.prepareAutoAdvancePlay;

	const goHome = useCallback(() => {
		pause();
		setView("home");
		if (window.location.hash !== "#/" && window.location.hash !== "") {
			window.history.pushState(null, "", "#/");
		}
		window.scrollTo({ top: 0, behavior: "smooth" });
	}, [pause]);

	const handleContinueReading = useCallback(() => {
		navigateTo(bookNumber, chapter, lastVerse > 1 ? lastVerse : undefined);
	}, [bookNumber, chapter, lastVerse, navigateTo]);

	const hasAudioTimings = hasVerseTimings(audio.activeTrack?.verseTimings);

	// Pause auto-scroll follow when user manually scrolls the reader via wheel/touch while audio plays.
	useEffect(() => {
		if (!isPlaying || !prefs.autoSync || !hasAudioTimings) return;
		let touchStartY: number | null = null;
		let touchIgnored = false;
		const isIgnoredTarget = (target: EventTarget | null) =>
			Boolean((target as HTMLElement | null)?.closest?.(SCROLL_FOLLOW_IGNORED_SELECTOR));

		const handleWheel = (e: WheelEvent) => {
			if (Math.abs(e.deltaY) < 4 || isIgnoredTarget(e.target)) return;
			setIsFollowingAudio(false);
		};
		const handleTouchStart = (e: TouchEvent) => {
			touchIgnored = isIgnoredTarget(e.target);
			touchStartY = touchIgnored ? null : (e.touches?.[0]?.clientY ?? null);
		};
		const handleTouchMove = (e: TouchEvent) => {
			if (touchIgnored || isIgnoredTarget(e.target)) return;
			const currentY = e.touches?.[0]?.clientY;
			if (touchStartY !== null && currentY !== undefined && Math.abs(currentY - touchStartY) < 8) {
				return;
			}
			setIsFollowingAudio(false);
		};
		const handleTouchEnd = () => {
			touchStartY = null;
			touchIgnored = false;
		};

		window.addEventListener("wheel", handleWheel, { passive: true });
		window.addEventListener("touchstart", handleTouchStart, { passive: true });
		window.addEventListener("touchmove", handleTouchMove, { passive: true });
		window.addEventListener("touchend", handleTouchEnd, { passive: true });
		return () => {
			window.removeEventListener("wheel", handleWheel);
			window.removeEventListener("touchstart", handleTouchStart);
			window.removeEventListener("touchmove", handleTouchMove);
			window.removeEventListener("touchend", handleTouchEnd);
		};
	}, [isPlaying, prefs.autoSync, hasAudioTimings, setIsFollowingAudio]);

	useEffect(() => {
		if (activeVerse) setLastVerse(activeVerse);
	}, [activeVerse]);

	useEffect(() => {
		if (
			view !== "reader" ||
			loadingChapter ||
			!activeVerse ||
			!prefs.autoSync ||
			!isFollowingAudio
		) {
			return;
		}
		scrollToVerse(activeVerse, "follow");
	}, [view, loadingChapter, activeVerse, prefs.autoSync, isFollowingAudio]);

	const handleFollowActiveVerse = useCallback(() => {
		setIsFollowingAudio(true);
		if (activeVerse) scrollToVerse(activeVerse, "jump");
	}, [activeVerse, setIsFollowingAudio]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement | null)?.tagName;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setPickerOpen((prev) => !prev);
				return;
			}
			if (pickerOpen || view !== "reader" || tag === "INPUT" || tag === "TEXTAREA") return;
			if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "h") {
				if (applySelectionHighlight()) e.preventDefault();
				return;
			}
			if (e.key === "ArrowLeft") {
				if (isPlaying) {
					e.preventDefault();
					skipBy(-10);
				} else if (prevChapterTarget) {
					navigateTo(prevChapterTarget.bookNumber, prevChapterTarget.chapter);
				}
			} else if (e.key === "ArrowRight") {
				if (isPlaying) {
					e.preventDefault();
					skipBy(10);
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
		isPlaying,
		skipBy,
		applySelectionHighlight,
	]);

	const handleSelectVerse = useCallback(
		(verseNum: number) => {
			setSelectedVerse((prev) => (prev === verseNum ? null : verseNum));
			setLastVerse(verseNum);
			if (isPlaying) jumpToVerse(verseNum);
		},
		[isPlaying, jumpToVerse],
	);

	const handleToggleAudioRail = useCallback(() => setAudioRailOpen((prev) => !prev), []);
	const handleToggleDictionary = useCallback(() => {
		if (isDesktop) setSidebarOpen((prev) => !prev);
		else setSheetOpen((prev) => !prev);
	}, [isDesktop]);

	useEffect(() => {
		return () => {
			if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
		};
	}, []);

	const handleSelectFootnote = useCallback(
		(footnoteId: string) => {
			setHighlightedFootnoteId(footnoteId);
			setHighlightSeq((seq) => seq + 1);
			updatePref("rightRailTab", "dictionary");
			if (isDesktop) setSidebarOpen(true);
			else setSheetOpen(true);
			if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
			highlightTimerRef.current = window.setTimeout(() => {
				highlightTimerRef.current = null;
				setHighlightedFootnoteId((cur) => (cur === footnoteId ? null : cur));
			}, 3200);
		},
		[isDesktop, updatePref],
	);

	const handleJumpFromFootnote = useCallback((verseNum: number) => {
		setSelectedVerse(verseNum);
		setLastVerse(verseNum);
		scrollToVerse(verseNum);
	}, []);

	const readerStyle = useMemo(
		() =>
			({
				"--reader-scale": prefs.fontScale,
				"--reader-ko-font":
					prefs.koFontStyle === "serif" ? "var(--font-ko-serif)" : "var(--font-ko-sans)",
			}) as CSSProperties,
		[prefs.fontScale, prefs.koFontStyle],
	);

	const dictionaryOpen = isDesktop ? sidebarOpen : sheetOpen;
	const showDictionary = !loadingChapter && !chapterError;

	useEffect(() => {
		const targetKey = `${prefs.commentarySource}:${currentBook.usfm}:${chapter}`;
		const matchesCurrent = commentaryLoadedKeyRef.current === targetKey;

		if (!matchesCurrent) {
			commentaryLoadedKeyRef.current = null;
			setCommentaryData(null);
		}
		setCommentaryError(null);

		if (view !== "reader" || !dictionaryOpen || prefs.rightRailTab !== "commentary") {
			setCommentaryLoading(false);
			return;
		}

		let cancelled = false;
		setCommentaryLoading(!matchesCurrent);
		loadChapterCommentary({
			commentaryId: prefs.commentarySource,
			usfm: currentBook.usfm,
			chapter,
		})
			.then((res) => {
				if (cancelled) return;
				commentaryLoadedKeyRef.current = targetKey;
				setCommentaryData(res);
				setCommentaryLoading(false);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				commentaryLoadedKeyRef.current = null;
				setCommentaryError(err instanceof Error ? err.message : "Unable to load commentary.");
				setCommentaryLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [
		view,
		dictionaryOpen,
		prefs.rightRailTab,
		prefs.commentarySource,
		currentBook.usfm,
		chapter,
		commentaryRetrySeq,
	]);

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
		isPlaying,
		isLoading: audio.isLoading,
		currentTime: audio.currentTime,
		duration: audio.duration,
		playbackRate: audio.playbackRate,
		errorMessage: audio.errorMessage,
		onTogglePlay: audio.togglePlay,
		onSeek: audio.seekTo,
		onSkipBy: skipBy,
		onSelectTrack: audio.selectTrack,
		onSelectLanguage: audio.selectLanguage,
		onChangeSpeed: audio.setPlaybackRate,
	};

	const maxVerseInChapter = alignedVerses[alignedVerses.length - 1]?.verse;

	const renderRightRail = (variant: "sidebar" | "sheet", onMinimize: () => void) => (
		<StudyRightRail
			activeTab={prefs.rightRailTab}
			onChangeTab={(tab) => updatePref("rightRailTab", tab)}
			variant={variant}
			onMinimize={onMinimize}
			bookEn={currentBook.en}
			bookKo={currentBook.ko}
			chapter={chapter}
			footnotes={analysis.footnotes}
			grammarNotes={analysis.grammarNotes}
			highlightedFootnoteId={highlightedFootnoteId}
			highlightSeq={highlightSeq}
			commentarySource={prefs.commentarySource}
			commentaryData={commentaryData}
			commentaryLoading={commentaryLoading}
			commentaryError={commentaryError}
			maxVerseInChapter={maxVerseInChapter}
			selectedVerse={selectedVerse}
			onChangeCommentarySource={(source) => updatePref("commentarySource", source)}
			onRetryCommentary={() => setCommentaryRetrySeq((seq) => seq + 1)}
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
				stackOrder={prefs.stackOrder}
				theme={prefs.theme}
				fontScale={prefs.fontScale}
				koFontStyle={prefs.koFontStyle}
				studyMask={prefs.studyMask}
				onGoHome={goHome}
				onContinueReading={handleContinueReading}
				onOpenPassage={navigateTo}
				onRemoveFavorite={handleRemoveFavorite}
				onRemoveHighlight={handleRemoveHighlight}
				onClearFavorites={handleClearFavorites}
				onClearHighlights={handleClearHighlights}
				onChangeStackOrder={(v) => updatePref("stackOrder", v)}
				onOpenSearch={() => setPickerOpen(true)}
				onChangeTheme={(v) => updatePref("theme", v)}
				onChangeFontScale={(v) => updatePref("fontScale", v)}
				onChangeKoFontStyle={(v) => updatePref("koFontStyle", v)}
				onChangeStudyMask={(v) => updatePref("studyMask", v)}
			/>

			{view === "home" ? (
				<HomePage
					lastBookNumber={bookNumber}
					lastChapter={chapter}
					lastVerse={lastVerse}
					krvSyncedAudioEnabled={krvSyncedAudioEnabled}
					favorites={favorites}
					highlights={highlights}
					onOpenPassage={navigateTo}
					onRemoveFavorite={handleRemoveFavorite}
					onRemoveHighlight={handleRemoveHighlight}
					onClearFavorites={handleClearFavorites}
					onClearHighlights={handleClearHighlights}
				/>
			) : (
				<>
					<div className={`reader-workspace ${isDesktop ? "desktop-layout" : ""}`.trim()}>
						{isDesktop && (
							<div className={`audio-rail-wrap ${audioRailOpen ? "expanded" : "minimized"}`}>
								{audioRailOpen ? (
									<AudioControlRail
										{...sharedAudioControls}
										visibleVerse={visibleVerse}
										activeVerse={activeVerse}
										autoSync={prefs.autoSync}
										isFollowingAudio={isFollowingAudio}
										onToggleAutoSync={() => updatePref("autoSync", !prefs.autoSync)}
										onSyncToVisibleVerse={() => jumpToVerse(visibleVerse)}
										onFollowActiveVerse={handleFollowActiveVerse}
										onMinimize={handleToggleAudioRail}
									/>
								) : (
									<button
										type="button"
										className={`rail-minimized-pill audio-minimized-pill ${isPlaying ? "playing" : ""}`.trim()}
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
										{CANONICAL_BIBLES.en.code}
									</span>
									<span lang="ko">
										{currentBook.testament === "OT" ? "구약" : "신약"} · {CANONICAL_BIBLES.ko.code}
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
											onClick={() => {
												updatePref("rightRailTab", "dictionary");
												setSheetOpen(true);
											}}
										>
											<BookOpen size={13} />
											<span>Korean Dictionary ({analysis.footnotes.length})</span>
										</button>
										<button
											type="button"
											className="footnote-jump-link"
											onClick={() => {
												updatePref("rightRailTab", "commentary");
												setSheetOpen(true);
											}}
										>
											<BookText size={13} />
											<span>Commentary</span>
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
												stackOrder={prefs.stackOrder}
												studyMask={prefs.studyMask}
												isSelected={selectedVerse === verse.verse}
												isAudioActive={activeVerse === verse.verse}
												isFavorited={favoriteIds.has(
													makeFavoriteId(bookNumber, chapter, verse.verse),
												)}
												enHighlights={verseHighlights?.en}
												koHighlights={verseHighlights?.ko}
												hasVerseTimestamps={hasAudioTimings}
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
								{CANONICAL_BIBLES.en.nativeName} · Hover any Korean word for instant translation.
							</footer>
						</main>

						{showDictionary && isDesktop && (
							<div className={`dict-sidebar-wrap ${sidebarOpen ? "expanded" : "minimized"}`}>
								{sidebarOpen ? (
									renderRightRail("sidebar", handleToggleDictionary)
								) : (
									<button
										type="button"
										className="rail-minimized-pill dict-minimized-pill"
										onClick={handleToggleDictionary}
										aria-expanded={false}
										aria-label={
											prefs.rightRailTab === "commentary"
												? "Expand commentary"
												: "Expand dictionary"
										}
										title={
											prefs.rightRailTab === "commentary"
												? "Show commentary"
												: "Show Korean dictionary"
										}
									>
										<ChevronLeft size={13} />
										{prefs.rightRailTab === "commentary" ? (
											<BookText size={14} />
										) : (
											<BookOpen size={14} />
										)}
									</button>
								)}
							</div>
						)}
					</div>

					{!isDesktop && (
						<FloatingBottomBar
							{...sharedAudioControls}
							activeVerse={activeVerse}
							autoSync={prefs.autoSync}
							isFollowingAudio={isFollowingAudio}
							onToggleAutoSync={() => updatePref("autoSync", !prefs.autoSync)}
							onFollowActiveVerse={handleFollowActiveVerse}
							hasPrev={Boolean(prevChapterTarget)}
							hasNext={Boolean(nextChapterTarget)}
							onPrevChapter={openPrevChapter}
							onNextChapter={openNextChapter}
							onOpenPicker={() => setPickerOpen(true)}
							rightRailTab={prefs.rightRailTab}
							dictionaryOpen={dictionaryOpen}
							dictionarySheet={
								showDictionary && sheetOpen ? (
									<div className="dict-sheet-wrap">
										{renderRightRail("sheet", () => setSheetOpen(false))}
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
