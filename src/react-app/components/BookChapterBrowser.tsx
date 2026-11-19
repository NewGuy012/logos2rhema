import type { CSSProperties } from "react";

import { BIBLE_GENRES, getBookByNumber, parsePassageReference } from "../../shared/books";
import type { BookMeta, Testament } from "../../shared/types";
import { ArrowLeft } from "./Icons";

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
		if (singleCandidate.chapters === 1) onOpenPassage(singleCandidate.number, 1);
		else onSelectBook(singleCandidate);
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
	compact = false,
	verticalColumns,
	onSelectBook,
	onSelectChapter,
}: {
	books: readonly BookMeta[];
	selectedBook: BookMeta | null;
	currentBookNumber: number;
	currentChapter: number;
	showChapterCount?: boolean;
	compact?: boolean;
	verticalColumns?: number;
	onSelectBook: (book: BookMeta) => void;
	onSelectChapter: (bookNumber: number, chapter: number) => void;
}) {
	if (selectedBook) {
		return (
			<div className={`chapters-grid ${compact ? "top-genre-chapters-grid" : ""}`.trim()}>
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

	const verticalStyle = verticalColumns
		? ({
				"--book-cols": verticalColumns,
				"--book-rows": Math.max(1, Math.ceil(books.length / verticalColumns)),
			} as CSSProperties)
		: undefined;

	return (
		<div
			className={`books-grid ${verticalColumns ? "books-grid-vertical" : ""}`.trim()}
			style={verticalStyle}
		>
			{books.map((book) => (
				<button
					key={book.usfm}
					type="button"
					className={`book-cell ${book.number === currentBookNumber ? "current" : ""}`}
					onClick={() =>
						book.chapters === 1 ? onSelectChapter(book.number, 1) : onSelectBook(book)
					}
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
	selectedBook,
	currentBookNumber,
	currentChapter,
	compact = false,
	onSelectBook,
	onSelectChapter,
}: {
	selectedBook: BookMeta | null;
	currentBookNumber: number;
	currentChapter: number;
	compact?: boolean;
	onSelectBook: (book: BookMeta | null) => void;
	onSelectChapter: (bookNumber: number, chapter: number) => void;
}) {
	if (selectedBook) {
		return (
			<div className="home-genre-detail">
				<div className="home-browser-header">
					<h3 className="home-genre-book-title">
						{selectedBook.en} · {selectedBook.ko}
					</h3>
					<button
						type="button"
						className="icon-btn"
						onClick={() => onSelectBook(null)}
						aria-label="Back to all genres"
					>
						<ArrowLeft size={14} />
						<span>All Genres</span>
					</button>
				</div>
				<BookChapterGrid
					books={[]}
					selectedBook={selectedBook}
					currentBookNumber={currentBookNumber}
					currentChapter={currentChapter}
					showChapterCount={true}
					compact={compact}
					onSelectBook={onSelectBook}
					onSelectChapter={onSelectChapter}
				/>
			</div>
		);
	}

	return (
		<div className={`home-genres-list ${compact ? "top-genres-list" : ""}`.trim()}>
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
									className={`home-genre-chip ${book.number === currentBookNumber ? "current" : ""}`}
									onClick={() =>
										book.chapters === 1 ? onSelectChapter(book.number, 1) : onSelectBook(book)
									}
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
	);
}
