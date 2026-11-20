import { Fragment, useId, useMemo, useState } from "react";

import { filterBooks, getBookOrDefault } from "../../shared/books";
import { DEFAULT_COMMENTARY_ID } from "../../shared/commentaries";
import { CANONICAL_BIBLES } from "../../shared/translations";
import type { BookMeta, CommentaryId, RightRailTab } from "../../shared/types";
import { useIsDesktopLayout } from "../hooks/useMediaQuery";
import { BookChapterGrid, GenresBrowser, submitPassageQuery } from "./BookChapterBrowser";
import { FavoritesList, type SavedItemsProps } from "./FavoritesList";
import { HomeAudioBrowser } from "./HomeAudioBrowser";
import { HomeCommentaryBrowser } from "./HomeCommentaryBrowser";
import { HomeDictionaryBrowser } from "./HomeDictionaryBrowser";
import {
	ArrowLeft,
	ArrowRight,
	BookOpen,
	ChevronDown,
	ChevronRight,
	Headphones,
	Search,
} from "./Icons";
import { LegalFooter } from "./LegalFooter";

interface HomePageProps extends SavedItemsProps {
	lastBookNumber: number;
	lastChapter: number;
	lastVerse?: number;
	commentarySource?: CommentaryId;
	onChangeCommentarySource?: (source: CommentaryId) => void;
	onOpenPassage: (
		bookNumber: number,
		chapter: number,
		verse?: number,
		options?: { rightRailTab?: RightRailTab },
	) => void;
}

type BrowseSection = "scripture" | "genres" | "audio" | "dictionary" | "commentary";

const BROWSE_SECTIONS: ReadonlyArray<{ id: BrowseSection; label: string }> = [
	{ id: "scripture", label: "Scripture" },
	{ id: "genres", label: "Genres" },
	{ id: "audio", label: "Audio" },
	{ id: "dictionary", label: "Dictionary" },
	{ id: "commentary", label: "Commentary" },
];

export function HomePage({
	lastBookNumber,
	lastChapter,
	lastVerse = 1,
	favorites = [],
	highlights = [],
	commentarySource,
	onChangeCommentarySource,
	onOpenPassage,
	onRemoveFavorite,
	onRemoveHighlight,
	onClearFavorites,
	onClearHighlights,
}: HomePageProps) {
	const [query, setQuery] = useState("");
	const [selectedBook, setSelectedBook] = useState<BookMeta | null>(null);
	const [browseSection, setBrowseSection] = useState<BrowseSection>("scripture");
	const [localCommentarySource, setLocalCommentarySource] =
		useState<CommentaryId>(DEFAULT_COMMENTARY_ID);
	const [favoritesOpen, setFavoritesOpen] = useState(false);
	const favoritesPanelId = useId();
	const isDesktop = useIsDesktopLayout();
	const testamentBookColumns = isDesktop ? 3 : 2;

	const activeCommentarySource = commentarySource ?? localCommentarySource;
	const handleChangeCommentarySource = onChangeCommentarySource ?? setLocalCommentarySource;

	const lastBook = useMemo(() => getBookOrDefault(lastBookNumber), [lastBookNumber]);

	const { otBooks, ntBooks, matchedBookNumbers, totalMatches } = useMemo(() => {
		const matches = filterBooks(query);
		return {
			otBooks: matches.filter((b) => b.testament === "OT"),
			ntBooks: matches.filter((b) => b.testament === "NT"),
			matchedBookNumbers: new Set(matches.map((b) => b.number)),
			totalMatches: matches.length,
		};
	}, [query]);

	const handleSearchSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		submitPassageQuery(
			query,
			totalMatches === 1 ? (otBooks[0] ?? ntBooks[0]) : undefined,
			onOpenPassage,
			setSelectedBook,
		);
	};

	const isBookDrilldown =
		selectedBook !== null && (browseSection === "scripture" || browseSection === "genres");

	return (
		<main className="home-container">
			<section className="home-hero">
				<h1 className="home-title">Logos2Rhema</h1>
				<div className="home-kicker">
					<span className="home-sync-pill">
						<Headphones size={12} />
						<span>Audio Available</span>
					</span>
				</div>
				<div className="home-features">
					<h2 className="home-section-title">Features</h2>
					<ul className="home-subtitle">
						<li>
							Read {CANONICAL_BIBLES.en.code} and {CANONICAL_BIBLES.ko.code} side-by-side
						</li>
						<li>Hover any Korean word for instant dictionary and grammar notes</li>
						<li>Listen along verse by verse</li>
					</ul>
				</div>
			</section>

			<section
				className="home-section home-continue-section"
				aria-label="Continue Where You Left Off"
			>
				<div className="home-continue-card">
					<div className="home-continue-meta">
						<p className="home-continue-subtitle">Continue Where You Left Off</p>
						<h2 className="home-continue-ref">
							{lastBook.en} {lastChapter}:{lastVerse}{" "}
							<span className="home-continue-ko" lang="ko">
								· {lastBook.ko} {lastChapter}장 {lastVerse}절
							</span>
						</h2>
					</div>
					<button
						type="button"
						className="home-continue-btn"
						onClick={() =>
							onOpenPassage(lastBook.number, lastChapter, lastVerse > 1 ? lastVerse : undefined)
						}
					>
						<BookOpen size={15} />
						<span>Read</span>
						<ArrowRight size={15} />
					</button>
				</div>
			</section>

			<section className="home-section home-favorites-section" aria-label="Favorites">
				<h2 className="home-section-title">
					<button
						type="button"
						className="home-disclosure-btn"
						aria-expanded={favoritesOpen}
						aria-controls={favoritesOpen ? favoritesPanelId : undefined}
						onClick={() => setFavoritesOpen((prev) => !prev)}
					>
						<span className="home-disclosure-label">
							<span>Favorites</span>
							{favorites.length + highlights.length > 0 && (
								<span className="home-disclosure-count">
									{favorites.length + highlights.length}
								</span>
							)}
						</span>
						<span className="home-disclosure-icon" aria-hidden="true">
							{favoritesOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
						</span>
					</button>
				</h2>

				{favoritesOpen && (
					<div id={favoritesPanelId} className="home-favorites-panel">
						<FavoritesList
							favorites={favorites}
							highlights={highlights}
							onSelectFavorite={onOpenPassage}
							onRemoveFavorite={onRemoveFavorite}
							onRemoveHighlight={onRemoveHighlight}
							onClearFavorites={onClearFavorites}
							onClearHighlights={onClearHighlights}
						/>
					</div>
				)}
			</section>

			<section className="home-section" aria-label="Browse">
				<div className="home-browser-header">
					<h2 className="home-section-title">
						{isBookDrilldown ? `${selectedBook.en} · ${selectedBook.ko}` : "Browse"}
					</h2>

					{isBookDrilldown ? (
						<button
							type="button"
							className="icon-btn"
							onClick={() => setSelectedBook(null)}
							aria-label="Back to all books"
						>
							<ArrowLeft size={14} />
							<span>All Books</span>
						</button>
					) : (
						<div
							className="segmented-row home-grouping-toggle"
							role="tablist"
							aria-label="Browse sections"
						>
							{BROWSE_SECTIONS.map((option) => {
								const active = browseSection === option.id;
								return (
									<button
										key={option.id}
										id={`home-browse-tab-${option.id}`}
										type="button"
										role="tab"
										aria-selected={active}
										aria-controls={`home-browse-panel-${option.id}`}
										className={`segmented-btn ${active ? "active" : ""}`.trim()}
										onClick={() => {
											setSelectedBook(null);
											setBrowseSection(option.id);
										}}
									>
										{option.label}
									</button>
								);
							})}
						</div>
					)}
				</div>

				<div
					id={`home-browse-panel-${browseSection}`}
					role="tabpanel"
					aria-labelledby={`home-browse-tab-${browseSection}`}
					className="home-browse-panel"
				>
					{browseSection === "audio" ? (
						<HomeAudioBrowser
							initialBookNumber={lastBook.number}
							initialChapter={lastChapter}
							onOpenPassage={onOpenPassage}
						/>
					) : browseSection === "commentary" ? (
						<HomeCommentaryBrowser
							initialBookNumber={lastBook.number}
							initialChapter={lastChapter}
							source={activeCommentarySource}
							onChangeSource={handleChangeCommentarySource}
							onOpenPassage={onOpenPassage}
						/>
					) : browseSection === "dictionary" ? (
						<HomeDictionaryBrowser
							initialBookNumber={lastBook.number}
							initialChapter={lastChapter}
							onOpenPassage={onOpenPassage}
						/>
					) : (
						<>
							<form className="home-search-form" onSubmit={handleSearchSubmit}>
								<Search size={16} className="home-search-icon" />
								<input
									type="search"
									className="home-search-input"
									placeholder="Go to passage (e.g. John 3:16, 요 3:16, 시 23, Ruth 4)..."
									value={query}
									onChange={(e) => {
										setQuery(e.target.value);
										if (selectedBook) setSelectedBook(null);
									}}
									aria-label="Go to Bible passage"
								/>
								<button type="submit" className="home-search-submit">
									Go to
								</button>
							</form>

							{isBookDrilldown ? (
								<BookChapterGrid
									books={[]}
									selectedBook={selectedBook}
									currentBookNumber={lastBook.number}
									currentChapter={lastChapter}
									showChapterCount={true}
									onSelectBook={setSelectedBook}
									onSelectChapter={onOpenPassage}
								/>
							) : browseSection === "genres" ? (
								<GenresBrowser
									currentBookNumber={lastBook.number}
									allowedBookNumbers={query.trim() ? matchedBookNumbers : undefined}
									onSelectBook={setSelectedBook}
									onSelectChapter={onOpenPassage}
								/>
							) : (
								<div className="home-testaments">
									{[
										{ labelEn: "Old Testament", labelKo: "구약", books: otBooks },
										{ labelEn: "New Testament", labelKo: "신약", books: ntBooks },
									].map((col, idx) => (
										<Fragment key={col.labelEn}>
											{idx > 0 && <div className="home-testament-divider" aria-hidden="true" />}
											<div className="home-testament-col">
												<h3 className="home-testament-heading">
													<span>{col.labelEn}</span>
													<span className="home-testament-ko" lang="ko">
														{col.labelKo} ({col.books.length})
													</span>
												</h3>
												{col.books.length === 0 ? (
													<p className="home-testament-empty">No matching books</p>
												) : (
													<BookChapterGrid
														books={col.books}
														selectedBook={null}
														currentBookNumber={lastBook.number}
														currentChapter={lastChapter}
														showChapterCount={true}
														verticalColumns={testamentBookColumns}
														onSelectBook={setSelectedBook}
														onSelectChapter={onOpenPassage}
													/>
												)}
											</div>
										</Fragment>
									))}
								</div>
							)}
						</>
					)}
				</div>
			</section>

			<section className="home-section home-about-section" aria-label="About Logos2Rhema">
				<h2 className="home-section-title">About</h2>
				<p className="home-about-copy">
					Logos2Rhema was built first and foremost to give glory to God, strengthen Bible and
					language literacy, and bring the Word from the head to the heart, hence Logos to Rhema.
				</p>
			</section>

			<LegalFooter className="copyright-footer home-legal-footer" />
		</main>
	);
}
