import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getBookOrDefault } from "../../shared/books";
import { CANONICAL_BIBLES } from "../../shared/translations";
import { useDismissListeners } from "../hooks/usePopover";
import { FavoritesList, type SavedItemsProps } from "./FavoritesList";
import { Bible, Bookmark, BookOpen, ChevronDown, Home, Search, Settings } from "./Icons";
import { SegmentedControl, type SegmentedOption } from "./RailShared";
import type { StackOrder, StudyMaskMode } from "./VerseBlock";

type ReaderTheme = "paper" | "sepia" | "dark";
type FontStyle = "serif" | "sans";

export interface TopBarDisplayPrefs {
	stackOrder: StackOrder;
	theme: ReaderTheme;
	fontScale: number;
	enFontStyle: FontStyle;
	koFontStyle: FontStyle;
	studyMask: StudyMaskMode;
}

interface TopBarProps extends SavedItemsProps {
	isHome?: boolean;
	lastBookNumber?: number;
	lastChapter?: number;
	lastVerse?: number;
	prefs: TopBarDisplayPrefs;
	onGoHome: () => void;
	onContinueReading?: () => void;
	onOpenPassage?: (bookNumber: number, chapter: number, verse?: number) => void;
	onChangePref: (patch: Partial<TopBarDisplayPrefs>) => void;
	onOpenSearch: () => void;
}

type OpenPopover = "favorites" | "display" | null;

function SegmentedSetting<T extends string | number>({
	title,
	value,
	options,
	onChange,
	groupAriaLabel,
}: {
	title: string;
	value: T;
	options: ReadonlyArray<SegmentedOption<T>>;
	onChange: (val: T) => void;
	groupAriaLabel?: string;
}) {
	return (
		<div className="settings-group">
			<p className="popover-title">{title}</p>
			<SegmentedControl
				value={value}
				options={options}
				onChange={onChange}
				ariaLabel={groupAriaLabel}
			/>
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
	prefs,
	onGoHome,
	onContinueReading,
	onOpenPassage,
	onRemoveFavorite,
	onRemoveHighlight,
	onClearFavorites,
	onClearHighlights,
	onChangePref,
	onOpenSearch,
}: TopBarProps) {
	const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
	const navRef = useRef<HTMLElement | null>(null);

	const lastBook = useMemo(() => getBookOrDefault(lastBookNumber), [lastBookNumber]);

	const closePopovers = useCallback(() => {
		setOpenPopover(null);
	}, []);

	const togglePopover = (target: Exclude<OpenPopover, null>) => {
		setOpenPopover((prev) => (prev === target ? null : target));
	};

	useEffect(() => {
		if (isHome) {
			setOpenPopover((prev) => (prev === "display" ? null : prev));
		}
	}, [isHome]);

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
							title={`Read ${lastBook.en} ${lastChapter}:${lastVerse}`}
						>
							<BookOpen size={15} />
							<span>Read</span>
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
						title={`${CANONICAL_BIBLES.en.nativeName} · ${CANONICAL_BIBLES.ko.nativeName}`}
					>
						{CANONICAL_BIBLES.en.code} / {CANONICAL_BIBLES.ko.code}
					</span>

					{!isHome && (
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
								<div className="popover-card settings-popover">
									<SegmentedSetting
										title="Theme"
										value={prefs.theme}
										onChange={(theme) => onChangePref({ theme })}
										options={[
											{ label: "Paper", value: "paper" },
											{ label: "Sepia", value: "sepia" },
											{ label: "Dark", value: "dark" },
										]}
									/>
									<SegmentedSetting
										title="Text Size"
										value={prefs.fontScale}
										onChange={(fontScale) => onChangePref({ fontScale })}
										options={[
											{ label: "S", value: 0.9 },
											{ label: "M", value: 1 },
											{ label: "L", value: 1.12 },
											{ label: "XL", value: 1.24 },
										]}
									/>
									<SegmentedSetting
										title="English Font"
										value={prefs.enFontStyle}
										onChange={(enFontStyle) => onChangePref({ enFontStyle })}
										options={[
											{ label: "Serif", value: "serif" },
											{ label: "Sans", value: "sans" },
										]}
									/>
									<SegmentedSetting
										title="Korean Font"
										value={prefs.koFontStyle}
										onChange={(koFontStyle) => onChangePref({ koFontStyle })}
										options={[
											{ label: "Serif (명조)", value: "serif" },
											{ label: "Sans (고딕)", value: "sans" },
										]}
									/>
									<SegmentedSetting
										title="Stack Order"
										value={prefs.stackOrder}
										onChange={(stackOrder) => onChangePref({ stackOrder })}
										groupAriaLabel="Flip language stack order"
										options={[
											{ label: "EN / 한", value: "en-first" },
											{ label: "한 / EN", value: "ko-first" },
										]}
									/>
									<SegmentedSetting
										title="Study Mode (Hover to Reveal)"
										value={prefs.studyMask}
										onChange={(studyMask) => onChangePref({ studyMask })}
										options={[
											{ label: "Both", value: "none" },
											{ label: "Blur EN", value: "mask-en" },
											{ label: "Blur KO", value: "mask-ko" },
										]}
									/>
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		</header>
	);
}
