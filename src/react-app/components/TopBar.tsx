import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getBookOrDefault } from "../../shared/books";
import { CANONICAL_BIBLES } from "../../shared/translations";
import { useDismissListeners } from "../hooks/usePopover";
import { FavoritesList, type SavedItemsProps } from "./FavoritesList";
import {
	Bible,
	Bookmark,
	BookOpen,
	ChevronDown,
	Home,
	Layers,
	Moon,
	Search,
	Settings,
	Sun,
} from "./Icons";
import { SegmentedControl, type SegmentedOption } from "./RailShared";
import type { StackOrder, StudyMaskMode } from "./VerseBlock";

export type ReaderTheme = "paper" | "sepia" | "dark";
export type LightTheme = "paper" | "sepia";
type FontStyle = "serif" | "sans";

export interface TopBarDisplayPrefs {
	stackOrder: StackOrder;
	theme: ReaderTheme;
	lightTheme?: LightTheme;
	fontScale: number;
	enFontStyle: FontStyle;
	koFontStyle: FontStyle;
	studyMask: StudyMaskMode;
}

interface TopBarProps extends SavedItemsProps {
	activeView?: "home" | "reader" | "memorize";
	lastBookNumber?: number;
	lastChapter?: number;
	lastVerse?: number;
	memorizeCount?: number;
	prefs: TopBarDisplayPrefs;
	onGoHome: () => void;
	onContinueReading?: () => void;
	onOpenMemorize?: () => void;
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
	activeView,
	lastBookNumber = 1,
	lastChapter = 1,
	lastVerse = 1,
	memorizeCount = 0,
	favorites = [],
	highlights = [],
	prefs,
	onGoHome,
	onContinueReading,
	onOpenMemorize,
	onOpenPassage,
	onRemoveFavorite,
	onRemoveHighlight,
	onClearFavorites,
	onClearHighlights,
	onChangePref,
	onOpenSearch,
}: TopBarProps) {
	const resolvedView = activeView ?? "reader";
	const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
	const navRef = useRef<HTMLElement | null>(null);
	const lastLightThemeRef = useRef<LightTheme>(
		prefs.theme === "sepia" ? "sepia" : (prefs.lightTheme ?? "paper"),
	);
	if (prefs.theme === "paper" || prefs.theme === "sepia") {
		lastLightThemeRef.current = prefs.theme;
	}
	const isDark = prefs.theme === "dark";

	const lastBook = useMemo(() => getBookOrDefault(lastBookNumber), [lastBookNumber]);

	const closePopovers = useCallback(() => {
		setOpenPopover(null);
	}, []);

	const handleToggleTheme = () => {
		closePopovers();
		if (isDark) {
			onChangePref({ theme: prefs.lightTheme ?? lastLightThemeRef.current });
		} else {
			onChangePref({ theme: "dark" });
		}
	};

	const togglePopover = (target: Exclude<OpenPopover, null>) => {
		setOpenPopover((prev) => (prev === target ? null : target));
	};

	useEffect(() => {
		if (resolvedView === "home") {
			setOpenPopover((prev) => (prev === "display" ? null : prev));
		}
	}, [resolvedView]);

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
							className={`icon-btn ${resolvedView === "home" ? "active" : ""}`.trim()}
							onClick={() => {
								closePopovers();
								onGoHome();
							}}
							aria-current={resolvedView === "home" ? "page" : undefined}
							title="Go to Home page"
						>
							<Home size={15} />
							<span>Home</span>
						</button>

						<button
							type="button"
							className={`icon-btn ${resolvedView === "reader" ? "active" : ""}`.trim()}
							onClick={() => {
								closePopovers();
								onContinueReading?.();
							}}
							aria-current={resolvedView === "reader" ? "page" : undefined}
							title={`Read ${lastBook.en} ${lastChapter}:${lastVerse}`}
						>
							<BookOpen size={15} />
							<span>Read</span>
						</button>

						<button
							type="button"
							className={`icon-btn ${resolvedView === "memorize" ? "active" : ""}`.trim()}
							onClick={() => {
								closePopovers();
								onOpenMemorize?.();
							}}
							aria-current={resolvedView === "memorize" ? "page" : undefined}
							title="Open Memorize verses"
						>
							<Layers size={15} />
							<span>Memorize</span>
							{memorizeCount > 0 && <span className="top-nav-count">{memorizeCount}</span>}
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

					<button
						type="button"
						className="icon-btn theme-toggle-btn"
						onClick={handleToggleTheme}
						aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
						title={isDark ? "Switch to light mode" : "Switch to dark mode"}
					>
						{isDark ? <Sun size={16} /> : <Moon size={16} />}
					</button>

					{resolvedView !== "home" && (
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
									{resolvedView === "reader" && (
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
									)}
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		</header>
	);
}
