import { useEffect, useMemo, useRef, useState } from "react";

import { BIBLE_BOOKS, getBookByNumber } from "../../shared/books";
import type { BookMeta, FavoriteItem, HighlightItem, TranslationMeta } from "../../shared/types";
import { GenresBrowser } from "./BookChapterBrowser";
import { FavoritesList } from "./FavoritesList";
import {
	Bible,
	Bookmark,
	BookOpen,
	ChevronDown,
	Home,
	LayoutGrid,
	Search,
	Settings,
} from "./Icons";
import type { StackOrder, StudyMaskMode } from "./VerseBlock";

export type ReaderTheme = "paper" | "sepia" | "dark";
export type KoreanFontStyle = "serif" | "sans";

interface TopBarProps {
	isHome?: boolean;
	lastBookNumber?: number;
	lastChapter?: number;
	lastVerse?: number;
	favorites?: FavoriteItem[];
	highlights?: HighlightItem[];
	selectedEn: TranslationMeta;
	selectedKo: TranslationMeta;
	stackOrder: StackOrder;
	theme: ReaderTheme;
	fontScale: number;
	koFontStyle: KoreanFontStyle;
	studyMask: StudyMaskMode;
	onGoHome: () => void;
	onContinueReading?: () => void;
	onOpenPassage?: (bookNumber: number, chapter: number, verse?: number) => void;
	onRemoveFavorite?: (id: string) => void;
	onRemoveHighlight?: (id: string) => void;
	onClearFavorites?: () => void;
	onClearHighlights?: () => void;
	onFlipStackOrder: () => void;
	onOpenSearch: () => void;
	onChangeTheme: (theme: ReaderTheme) => void;
	onChangeFontScale: (scale: number) => void;
	onChangeKoFontStyle: (style: KoreanFontStyle) => void;
	onChangeStudyMask: (mode: StudyMaskMode) => void;
}

type OpenPopover = "favorites" | "genres" | "display" | null;

export function TopBar({
	isHome = false,
	lastBookNumber = 1,
	lastChapter = 1,
	lastVerse = 1,
	favorites = [],
	highlights = [],
	selectedEn,
	selectedKo,
	stackOrder,
	theme,
	fontScale,
	koFontStyle,
	studyMask,
	onGoHome,
	onContinueReading,
	onOpenPassage,
	onRemoveFavorite,
	onRemoveHighlight,
	onClearFavorites,
	onClearHighlights,
	onFlipStackOrder,
	onOpenSearch,
	onChangeTheme,
	onChangeFontScale,
	onChangeKoFontStyle,
	onChangeStudyMask,
}: TopBarProps) {
	const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
	const [selectedGenreBook, setSelectedGenreBook] = useState<BookMeta | null>(null);
	const navRef = useRef<HTMLElement | null>(null);

	const lastBook = useMemo(
		() => getBookByNumber(lastBookNumber) ?? BIBLE_BOOKS[0],
		[lastBookNumber],
	);

	const closePopovers = () => {
		setOpenPopover(null);
		setSelectedGenreBook(null);
	};

	const togglePopover = (target: Exclude<OpenPopover, null>) => {
		setSelectedGenreBook(null);
		setOpenPopover((prev) => (prev === target ? null : target));
	};

	useEffect(() => {
		if (!openPopover) return;
		const handleOutside = (event: MouseEvent) => {
			if (navRef.current && !navRef.current.contains(event.target as Node)) {
				setOpenPopover(null);
				setSelectedGenreBook(null);
			}
		};
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpenPopover(null);
				setSelectedGenreBook(null);
			}
		};
		document.addEventListener("mousedown", handleOutside);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handleOutside);
			document.removeEventListener("keydown", handleKey);
		};
	}, [openPopover]);

	return (
		<header className="top-bar" ref={navRef}>
			<div className="top-bar-inner">
				<div className="brand-group">
					<a
						href="#/"
						className="brand-mark"
						aria-label="Logos2Rhema Home"
						title="Return to Logos2Rhema Home"
						onClick={(e) => {
							e.preventDefault();
							closePopovers();
							onGoHome();
						}}
					>
						<Bible size={17} className="brand-icon" />
						<span>Logos2Rhema</span>
					</a>

					<nav className="top-nav" aria-label="Quick navigation">
						<button
							type="button"
							className={`icon-btn ${isHome ? "active" : ""}`.trim()}
							onClick={() => {
								closePopovers();
								onGoHome();
							}}
							aria-current={isHome ? "page" : undefined}
							title="Go to Home page"
						>
							<Home size={15} />
							<span>Home</span>
						</button>

						<button
							type="button"
							className={`icon-btn ${!isHome ? "active" : ""}`.trim()}
							onClick={() => {
								closePopovers();
								onContinueReading?.();
							}}
							aria-current={!isHome ? "page" : undefined}
							title={`Continue ${lastBook.en} ${lastChapter}:${lastVerse}`}
						>
							<BookOpen size={15} />
							<span>Continue</span>
						</button>

						<div className="popover-anchor">
							<button
								type="button"
								className={`icon-btn ${openPopover === "favorites" ? "active" : ""}`}
								onClick={() => togglePopover("favorites")}
								aria-expanded={openPopover === "favorites"}
								aria-haspopup="true"
								title="Open favorites"
							>
								<Bookmark size={15} filled={favorites.length + highlights.length > 0} />
								<span>Favorites</span>
								{favorites.length + highlights.length > 0 && (
									<span className="top-nav-count">{favorites.length + highlights.length}</span>
								)}
								<ChevronDown size={13} className="top-nav-caret" />
							</button>

							{openPopover === "favorites" && (
								<div className="popover-card top-nav-popover top-favorites-popover">
									<p className="popover-title">Favorites</p>
									<div className="top-nav-popover-body">
										<FavoritesList
											favorites={favorites}
											highlights={highlights}
											compact={true}
											onSelectFavorite={(book, ch, verse) => {
												closePopovers();
												onOpenPassage?.(book, ch, verse);
											}}
											onRemoveFavorite={onRemoveFavorite}
											onRemoveHighlight={onRemoveHighlight}
											onClearFavorites={onClearFavorites}
											onClearHighlights={onClearHighlights}
										/>
									</div>
								</div>
							)}
						</div>

						<div className="popover-anchor">
							<button
								type="button"
								className={`icon-btn ${openPopover === "genres" ? "active" : ""}`}
								onClick={() => togglePopover("genres")}
								aria-expanded={openPopover === "genres"}
								aria-haspopup="true"
								title="Browse Bible genres"
							>
								<LayoutGrid size={15} />
								<span>Genres</span>
								<ChevronDown size={13} className="top-nav-caret" />
							</button>

							{openPopover === "genres" && (
								<div className="popover-card top-nav-popover top-genres-popover">
									<p className="popover-title">Genres</p>
									<div className="top-nav-popover-body">
										<GenresBrowser
											selectedBook={selectedGenreBook}
											currentBookNumber={lastBookNumber}
											currentChapter={lastChapter}
											compact={true}
											onSelectBook={setSelectedGenreBook}
											onSelectChapter={(book, ch) => {
												closePopovers();
												onOpenPassage?.(book, ch);
											}}
										/>
									</div>
								</div>
							)}
						</div>
					</nav>
				</div>

				<div className="top-controls">
					<button
						type="button"
						className="top-search-btn"
						onClick={() => {
							closePopovers();
							onOpenSearch();
						}}
						aria-label="Go to book or chapter"
						title="Go to book or chapter (Cmd/Ctrl+K)"
					>
						<span className="top-search-leading">
							<Search size={14} className="top-search-icon" />
							<span className="top-search-placeholder">Go to...</span>
						</span>
						<kbd className="top-search-kbd">⌘K</kbd>
					</button>

					<span
						className="translation-badge"
						aria-label="Canonical language editions"
						title={`${selectedEn.nativeName} · ${selectedKo.nativeName}`}
					>
						{selectedEn.code} / {selectedKo.code}
					</span>

					<div className="popover-anchor">
						<button
							type="button"
							className={`icon-btn appearance-btn ${openPopover === "display" ? "active" : ""}`}
							onClick={() => togglePopover("display")}
							aria-expanded={openPopover === "display"}
							aria-label="Reader appearance settings"
							title="Reader appearance settings"
						>
							<Settings size={16} />
						</button>

						{openPopover === "display" && (
							<div className="popover-card">
								<div className="settings-group">
									<p className="popover-title">Theme</p>
									<div className="segmented-row">
										{(["paper", "sepia", "dark"] as const).map((mode) => (
											<button
												key={mode}
												type="button"
												className={`segmented-btn ${theme === mode ? "active" : ""}`}
												onClick={() => onChangeTheme(mode)}
											>
												{mode === "paper" ? "Paper" : mode === "sepia" ? "Sepia" : "Dark"}
											</button>
										))}
									</div>
								</div>

								<div className="settings-group">
									<p className="popover-title">Text Size</p>
									<div className="segmented-row">
										{[
											{ label: "S", val: 0.9 },
											{ label: "M", val: 1 },
											{ label: "L", val: 1.12 },
											{ label: "XL", val: 1.24 },
										].map((opt) => (
											<button
												key={opt.label}
												type="button"
												className={`segmented-btn ${fontScale === opt.val ? "active" : ""}`}
												onClick={() => onChangeFontScale(opt.val)}
											>
												{opt.label}
											</button>
										))}
									</div>
								</div>

								<div className="settings-group">
									<p className="popover-title">Korean Font</p>
									<div className="segmented-row">
										<button
											type="button"
											className={`segmented-btn ${koFontStyle === "serif" ? "active" : ""}`}
											onClick={() => onChangeKoFontStyle("serif")}
										>
											Serif (명조)
										</button>
										<button
											type="button"
											className={`segmented-btn ${koFontStyle === "sans" ? "active" : ""}`}
											onClick={() => onChangeKoFontStyle("sans")}
										>
											Sans (고딕)
										</button>
									</div>
								</div>

								<div className="settings-group">
									<p className="popover-title">Stack Order</p>
									<div
										className="segmented-row"
										role="group"
										aria-label="Flip language stack order"
									>
										<button
											type="button"
											className={`segmented-btn ${stackOrder === "en-first" ? "active" : ""}`}
											onClick={() => {
												if (stackOrder !== "en-first") onFlipStackOrder();
											}}
											aria-pressed={stackOrder === "en-first"}
										>
											EN / 한
										</button>
										<button
											type="button"
											className={`segmented-btn ${stackOrder === "ko-first" ? "active" : ""}`}
											onClick={() => {
												if (stackOrder !== "ko-first") onFlipStackOrder();
											}}
											aria-pressed={stackOrder === "ko-first"}
										>
											한 / EN
										</button>
									</div>
								</div>

								<div className="settings-group">
									<p className="popover-title">Study Mode (Hover to Reveal)</p>
									<div className="segmented-row">
										<button
											type="button"
											className={`segmented-btn ${studyMask === "none" ? "active" : ""}`}
											onClick={() => onChangeStudyMask("none")}
										>
											Both
										</button>
										<button
											type="button"
											className={`segmented-btn ${studyMask === "mask-en" ? "active" : ""}`}
											onClick={() => onChangeStudyMask("mask-en")}
										>
											Blur EN
										</button>
										<button
											type="button"
											className={`segmented-btn ${studyMask === "mask-ko" ? "active" : ""}`}
											onClick={() => onChangeStudyMask("mask-ko")}
										>
											Blur KO
										</button>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</header>
	);
}
