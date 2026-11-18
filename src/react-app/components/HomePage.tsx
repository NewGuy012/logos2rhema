import { Fragment, useMemo, useState } from "react";

import {
	BIBLE_BOOKS,
	BIBLE_GENRES,
	filterBooks,
	getBookByNumber,
	parsePassageReference,
} from "../../shared/books";
import type { BookMeta, TranslationMeta } from "../../shared/types";
import { BookChapterGrid } from "./BookChapterBrowser";
import { ArrowLeft, ArrowRight, BookOpen, Headphones, Search } from "./Icons";

interface HomePageProps {
	lastBookNumber: number;
	lastChapter: number;
	selectedEn: TranslationMeta;
	selectedKo: TranslationMeta;
	bibleBrainEnabled: boolean;
	onOpenPassage: (bookNumber: number, chapter: number, verse?: number) => void;
}

export function HomePage({
	lastBookNumber,
	lastChapter,
	selectedEn,
	selectedKo,
	bibleBrainEnabled,
	onOpenPassage,
}: HomePageProps) {
	const [query, setQuery] = useState("");
	const [selectedBook, setSelectedBook] = useState<BookMeta | null>(null);
	const [selectedGenreBook, setSelectedGenreBook] = useState<BookMeta | null>(null);

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
				<h1 className="home-title">
					Logos2Rhema{" "}
					<span className="home-title-ko" lang="ko">
						말씀
					</span>
				</h1>

				<div className="home-kicker">
					<span>
						{selectedEn.code} · {selectedKo.code}
					</span>
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
					<div>
						<div className="home-continue-label">Continue Reading</div>
						<div className="home-continue-ref">
							{lastBook.en} {lastChapter}{" "}
							<span className="home-continue-ko" lang="ko">
								· {lastBook.ko} {lastChapter}장
							</span>
						</div>
					</div>
					<button
						type="button"
						className="home-continue-btn"
						onClick={() => onOpenPassage(lastBook.number, lastChapter)}
					>
						<BookOpen size={15} />
						<span>Open Chapter</span>
						<ArrowRight size={15} />
					</button>
				</div>
			</section>

			<section className="home-section" aria-label="Bible Genres">
				<div className="home-browser-header">
					<h2 className="home-section-title">
						{selectedGenreBook ? `${selectedGenreBook.en} · ${selectedGenreBook.ko}` : "Genres"}
					</h2>

					{selectedGenreBook && (
						<button
							type="button"
							className="icon-btn"
							onClick={() => setSelectedGenreBook(null)}
							aria-label="Back to all genres"
						>
							<ArrowLeft size={14} />
							<span>All Genres</span>
						</button>
					)}
				</div>

				{selectedGenreBook ? (
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
						Go
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
		</main>
	);
}
