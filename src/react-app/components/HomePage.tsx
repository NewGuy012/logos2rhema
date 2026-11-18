import { Fragment, useId, useMemo, useState } from "react";

import {
	BIBLE_BOOKS,
	BIBLE_GENRES,
	filterBooks,
	getBookByNumber,
	parsePassageReference,
} from "../../shared/books";
import type { BookMeta, TranslationMeta } from "../../shared/types";
import { BookChapterGrid } from "./BookChapterBrowser";
import {
	ArrowLeft,
	ArrowRight,
	BookOpen,
	ChevronDown,
	ChevronRight,
	Headphones,
	Search,
} from "./Icons";

interface HomePageProps {
	lastBookNumber: number;
	lastChapter: number;
	lastVerse?: number;
	selectedEn: TranslationMeta;
	selectedKo: TranslationMeta;
	bibleBrainEnabled: boolean;
	onOpenPassage: (bookNumber: number, chapter: number, verse?: number) => void;
}

export function HomePage({
	lastBookNumber,
	lastChapter,
	lastVerse = 1,
	selectedEn,
	selectedKo,
	bibleBrainEnabled,
	onOpenPassage,
}: HomePageProps) {
	const [query, setQuery] = useState("");
	const [selectedBook, setSelectedBook] = useState<BookMeta | null>(null);
	const [genresOpen, setGenresOpen] = useState(false);
	const [selectedGenreBook, setSelectedGenreBook] = useState<BookMeta | null>(null);
	const genresPanelId = useId();

	const lastBook = useMemo(
		() => getBookByNumber(lastBookNumber) ?? BIBLE_BOOKS[0],
		[lastBookNumber],
	);

	const { otBooks, ntBooks, totalMatches } = useMemo(() => {
		const matches = filterBooks(query);
		const ot = matches.filter((b) => b.testament === "OT");
		const nt = matches.filter((b) => b.testament === "NT");
		return { otBooks: ot, ntBooks: nt, totalMatches: matches.length };
	}, [query]);

	const handleSearchSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const parsed = parsePassageReference(query);
		if (parsed) {
			onOpenPassage(parsed.bookNumber, parsed.chapter, parsed.verse);
			return;
		}
		if (totalMatches === 1) {
			const only = otBooks[0] ?? ntBooks[0];
			if (only.chapters === 1) {
				onOpenPassage(only.number, 1);
			} else {
				setSelectedBook(only);
			}
		}
	};

	return (
		<main className="home-container">
			<section className="home-hero">
				<h1 className="home-title">Logos2Rhema</h1>

				<div className="home-kicker">
					<span className="home-sync-pill">
						<Headphones size={12} />
						<span>{bibleBrainEnabled ? "Bible Brain Verse-Synced Audio" : "Audio Available"}</span>
					</span>
				</div>
				<p className="home-subtitle">
					Read {selectedEn.code} and {selectedKo.code} side-by-side, hover any Korean word for
					instant dictionary and grammar notes, and listen along verse by verse.
				</p>

				<div className="home-continue-card">
					<div className="home-continue-ref">
						{lastBook.en} {lastChapter}:{lastVerse}{" "}
						<span className="home-continue-ko" lang="ko">
							· {lastBook.ko} {lastChapter}장 {lastVerse}절
						</span>
					</div>
					<button
						type="button"
						className="home-continue-btn"
						onClick={() =>
							lastVerse > 1
								? onOpenPassage(lastBook.number, lastChapter, lastVerse)
								: onOpenPassage(lastBook.number, lastChapter)
						}
					>
						<BookOpen size={15} />
						<span>Continue Reading</span>
						<ArrowRight size={15} />
					</button>
				</div>
			</section>

			<section className="home-section home-genres-section" aria-label="Bible Genres">
				<h2 className="home-section-title">
					<button
						type="button"
						className="home-disclosure-btn"
						aria-expanded={genresOpen}
						aria-controls={genresOpen ? genresPanelId : undefined}
						onClick={() => {
							if (genresOpen) {
								setSelectedGenreBook(null);
								setGenresOpen(false);
							} else {
								setGenresOpen(true);
							}
						}}
					>
						<span>Browse Genres</span>
						<span className="home-disclosure-icon" aria-hidden="true">
							{genresOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
						</span>
					</button>
				</h2>

				{genresOpen && (
					<div id={genresPanelId}>
						{selectedGenreBook ? (
							<div className="home-genre-detail">
								<div className="home-browser-header">
									<h3 className="home-genre-book-title">
										{selectedGenreBook.en} · {selectedGenreBook.ko}
									</h3>
									<button
										type="button"
										className="icon-btn"
										onClick={() => setSelectedGenreBook(null)}
										aria-label="Back to all genres"
									>
										<ArrowLeft size={14} />
										<span>All Genres</span>
									</button>
								</div>
								<BookChapterGrid
									books={[]}
									selectedBook={selectedGenreBook}
									currentBookNumber={lastBook.number}
									currentChapter={lastChapter}
									showChapterCount={true}
									classPrefix="home"
									onSelectBook={setSelectedGenreBook}
									onSelectChapter={onOpenPassage}
								/>
							</div>
						) : (
							<div className="home-genres-list">
								{BIBLE_GENRES.map((genre) => {
									const books = genre.bookNumbers
										.map((num) => getBookByNumber(num))
										.filter((b): b is BookMeta => Boolean(b));
									return (
										<div key={genre.id} className="home-genre-card">
											<div className="home-genre-head">
												<div className="home-genre-title">
													<span className="home-genre-name">{genre.nameEn}</span>
													<span className="home-genre-ko" lang="ko">
														{genre.nameKo}
													</span>
												</div>
												<span className="home-genre-meta">
													{genre.testament} · {books.length}
												</span>
											</div>
											<div className="home-genre-books">
												{books.map((book) => (
													<button
														key={book.usfm}
														type="button"
														className={`home-genre-chip ${book.number === lastBook.number ? "current" : ""}`}
														onClick={() => {
															if (book.chapters === 1) {
																onOpenPassage(book.number, 1);
															} else {
																setSelectedGenreBook(book);
															}
														}}
														title={`${book.en} · ${book.ko} (${book.chapters}ch)`}
													>
														<span>{book.en}</span>
														<span className="home-genre-chip-ko" lang="ko">
															{book.ko}
														</span>
													</button>
												))}
											</div>
										</div>
									);
								})}
							</div>
						)}
					</div>
				)}
			</section>

			<section className="home-section" aria-label="Browse All Books">
				<div className="home-browser-header">
					<h2 className="home-section-title">
						{selectedBook ? `${selectedBook.en} · ${selectedBook.ko}` : "Browse Scripture"}
					</h2>

					{selectedBook && (
						<button
							type="button"
							className="icon-btn"
							onClick={() => setSelectedBook(null)}
							aria-label="Back to all books"
						>
							<ArrowLeft size={14} />
							<span>All Books</span>
						</button>
					)}
				</div>

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

				{selectedBook ? (
					<BookChapterGrid
						books={[]}
						selectedBook={selectedBook}
						currentBookNumber={lastBook.number}
						currentChapter={lastChapter}
						showChapterCount={true}
						classPrefix="home"
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
											classPrefix="home"
											verticalColumns={2}
											onSelectBook={setSelectedBook}
											onSelectChapter={onOpenPassage}
										/>
									)}
								</div>
							</Fragment>
						))}
					</div>
				)}
			</section>

			<section className="home-section home-about-section" aria-label="About Logos2Rhema">
				<h2 className="home-section-title">About</h2>
				<p className="home-about-copy">
					Logos2Rhema was built first to give glory to God, strengthen Bible and language literacy,
					and bring the Word from the head to the heart—from <em>Logos</em> to <em>Rhema</em>.
				</p>
			</section>
		</main>
	);
}
