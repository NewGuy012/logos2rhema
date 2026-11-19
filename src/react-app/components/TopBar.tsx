import { useCallback, useMemo, useRef, useState } from "react";

import { BIBLE_BOOKS, getBookByNumber } from "../../shared/books";
import type { BookMeta, FavoriteItem, HighlightItem, TranslationMeta } from "../../shared/types";
import { useDismissListeners } from "../hooks/usePopover";
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
	onChangeStackOrder: (order: StackOrder) => void;
	onOpenSearch: () => void;
	onChangeTheme: (theme: ReaderTheme) => void;
	onChangeFontScale: (scale: number) => void;
	onChangeKoFontStyle: (style: KoreanFontStyle) => void;
	onChangeStudyMask: (mode: StudyMaskMode) => void;
}

type OpenPopover = "favorites" | "genres" | "display" | null;

function SegmentedSetting<T extends string | number>({
	title,
	value,
	options,
	onChange,
	groupAriaLabel,
	usePressed = false,
}: {
	title: string;
	value: T;
	options: ReadonlyArray<{ label: string; val: T }>;
	onChange: (val: T) => void;
	groupAriaLabel?: string;
	usePressed?: boolean;
}) {
	return (
		<div className="settings-group">
			<p className="popover-title">{title}</p>
			<div
				className="segmented-row"
				role={groupAriaLabel ? "group" : undefined}
				aria-label={groupAriaLabel}
			>
				{options.map((opt) => {
					const active = value === opt.val;
					return (
						<button
							key={String(opt.val)}
							type="button"
							className={`segmented-btn ${active ? "active" : ""}`}
							aria-pressed={usePressed ? active : undefined}
							onClick={() => {
								if (!active) onChange(opt.val);
							}}
						>
							{opt.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

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
	onChangeStackOrder,
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

	const closePopovers = useCallback(() => {
		setOpenPopover(null);
		setSelectedGenreBook(null);
	}, []);

	const togglePopover = (target: Exclude<OpenPopover, null>) => {
		setSelectedGenreBook(null);
		setOpenPopover((prev) => (prev === target ? null : target));
	};

	useDismissListeners(Boolean(openPopover), {
		refs: [navRef],
		onDismiss: closePopovers,
	});

	const savedCount = favorites.length + highlights.length;

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
								<Bookmark size={15} filled={savedCount > 0} />
								<span>Favorites</span>
								{savedCount > 0 && <span className="top-nav-count">{savedCount}</span>}
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
								<SegmentedSetting
									title="Theme"
									value={theme}
									onChange={onChangeTheme}
									options={[
										{ label: "Paper", val: "paper" },
										{ label: "Sepia", val: "sepia" },
										{ label: "Dark", val: "dark" },
									]}
								/>
								<SegmentedSetting
									title="Text Size"
									value={fontScale}
									onChange={onChangeFontScale}
									options={[
										{ label: "S", val: 0.9 },
										{ label: "M", val: 1 },
										{ label: "L", val: 1.12 },
										{ label: "XL", val: 1.24 },
									]}
								/>
								<SegmentedSetting
									title="Korean Font"
									value={koFontStyle}
									onChange={onChangeKoFontStyle}
									options={[
										{ label: "Serif (명조)", val: "serif" },
										{ label: "Sans (고딕)", val: "sans" },
									]}
								/>
								<SegmentedSetting
									title="Stack Order"
									value={stackOrder}
									onChange={onChangeStackOrder}
									groupAriaLabel="Flip language stack order"
									usePressed={true}
									options={[
										{ label: "EN / 한", val: "en-first" },
										{ label: "한 / EN", val: "ko-first" },
									]}
								/>
								<SegmentedSetting
									title="Study Mode (Hover to Reveal)"
									value={studyMask}
									onChange={onChangeStudyMask}
									options={[
										{ label: "Both", val: "none" },
										{ label: "Blur EN", val: "mask-en" },
										{ label: "Blur KO", val: "mask-ko" },
									]}
								/>
							</div>
						)}
					</div>
				</div>
			</div>
		</header>
	);
}
