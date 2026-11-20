import { BIBLE_GENRES, getBookByNumber, parsePassageReference } from "../../shared/books";
import type { BookMeta, Testament } from "../../shared/types";

function openBookOrChapter(
	book: BookMeta,
	onSelectBook: (book: BookMeta) => void,
	onSelectChapter: (bookNumber: number, chapter: number) => void,
): void {
	if (book.chapters === 1) onSelectChapter(book.number, 1);
	else onSelectBook(book);
}

export function submitPassageQuery(
	query: string,
	singleCandidate: BookMeta | undefined,
	onOpenPassage: (bookNumber: number, chapter: number, verse?: number) => void,
	onSelectBook: (book: BookMeta) => void,
): void {
	const parsed = parsePassageReference(query);
	if (parsed) {
		onOpenPassage(parsed.bookNumber, parsed.chapter, parsed.verse);
	} else if (singleCandidate) {
		openBookOrChapter(singleCandidate, onSelectBook, onOpenPassage);
	}
}

export function TestamentTabs({
	testament,
	onChange,
}: {
	testament: Testament;
	onChange: (next: Testament) => void;
}) {
	const tabs: ReadonlyArray<{ id: Testament; label: string }> = [
		{ id: "OT", label: "Old Testament · 구약 (39)" },
		{ id: "NT", label: "New Testament · 신약 (27)" },
	];
	return (
		<div className="filter-tabs" role="tablist" aria-label="Testament">
			{tabs.map((tab) => (
				<button
					key={tab.id}
					type="button"
					role="tab"
					aria-selected={testament === tab.id}
					className={`filter-tab ${testament === tab.id ? "active" : ""}`}
					onClick={() => onChange(tab.id)}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}

export function BookChapterGrid({
	books,
	selectedBook,
	currentBookNumber,
	currentChapter,
	showChapterCount = false,
	verticalLayout = false,
	onSelectBook,
	onSelectChapter,
}: {
	books: readonly BookMeta[];
	selectedBook: BookMeta | null;
	currentBookNumber: number;
	currentChapter: number;
	showChapterCount?: boolean;
	verticalLayout?: boolean;
	onSelectBook: (book: BookMeta) => void;
	onSelectChapter: (bookNumber: number, chapter: number) => void;
}) {
	if (selectedBook) {
		return (
			<div className="chapters-grid">
				{Array.from({ length: selectedBook.chapters }, (_, i) => i + 1).map((ch) => (
					<button
						key={ch}
						type="button"
						className={`chapter-cell ${
							selectedBook.number === currentBookNumber && ch === currentChapter ? "current" : ""
						}`}
						onClick={() => onSelectChapter(selectedBook.number, ch)}
					>
						{ch}
					</button>
				))}
			</div>
		);
	}

	return (
		<div className={`books-grid ${verticalLayout ? "books-grid-vertical" : ""}`.trim()}>
			{books.map((book) => (
				<button
					key={book.usfm}
					type="button"
					className={`book-cell ${book.number === currentBookNumber ? "current" : ""}`}
					onClick={() => openBookOrChapter(book, onSelectBook, onSelectChapter)}
				>
					<div className="book-cell-en">{book.en}</div>
					<div className="book-cell-ko" lang="ko">
						{showChapterCount ? `${book.ko} · ${book.chapters}ch` : book.ko}
					</div>
				</button>
			))}
		</div>
	);
}

export function GenresBrowser({
	currentBookNumber,
	allowedBookNumbers,
	onSelectBook,
	onSelectChapter,
}: {
	currentBookNumber: number;
	allowedBookNumbers?: ReadonlySet<number>;
	onSelectBook: (book: BookMeta) => void;
	onSelectChapter: (bookNumber: number, chapter: number) => void;
}) {
	const visibleGenres = BIBLE_GENRES.map((genre) => ({
		genre,
		books: genre.bookNumbers
			.map((num) => getBookByNumber(num))
			.filter((b): b is BookMeta =>
				Boolean(b && (!allowedBookNumbers || allowedBookNumbers.has(b.number))),
			),
	})).filter((entry) => entry.books.length > 0);

	if (visibleGenres.length === 0) {
		return <p className="home-testament-empty">No matching books</p>;
	}

	return (
		<div className="home-genres-list">
			{visibleGenres.map(({ genre, books }) => (
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
								className={`home-genre-chip ${book.number === currentBookNumber ? "current" : ""}`}
								onClick={() => openBookOrChapter(book, onSelectBook, onSelectChapter)}
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
			))}
		</div>
	);
}
