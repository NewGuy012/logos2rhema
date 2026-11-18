import type { CSSProperties } from "react";

import { BIBLE_GENRES, getBookByNumber } from "../../shared/books";
import type { BookMeta, Testament } from "../../shared/types";
import { ArrowLeft } from "./Icons";

export function TestamentTabs({
	testament,
	onChange,
}: {
	testament: Testament;
	onChange: (next: Testament) => void;
}) {
	return (
		<div className="filter-tabs" role="tablist" aria-label="Testament">
			<button
				type="button"
				role="tab"
				aria-selected={testament === "OT"}
				className={`filter-tab ${testament === "OT" ? "active" : ""}`}
				onClick={() => onChange("OT")}
			>
				Old Testament · 구약 (39)
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={testament === "NT"}
				className={`filter-tab ${testament === "NT" ? "active" : ""}`}
				onClick={() => onChange("NT")}
			>
				New Testament · 신약 (27)
			</button>
		</div>
	);
}

export function BookChapterGrid({
	books,
	selectedBook,
	currentBookNumber,
	currentChapter,
	showChapterCount = false,
	classPrefix = "",
	verticalColumns,
	onSelectBook,
	onSelectChapter,
}: {
	books: readonly BookMeta[];
	selectedBook: BookMeta | null;
	currentBookNumber: number;
	currentChapter: number;
	showChapterCount?: boolean;
	classPrefix?: string;
	verticalColumns?: number;
	onSelectBook: (book: BookMeta) => void;
	onSelectChapter: (bookNumber: number, chapter: number) => void;
}) {
	if (selectedBook) {
		return (
			<div className={`chapters-grid ${classPrefix ? `${classPrefix}-chapters-grid` : ""}`.trim()}>
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
			className={`books-grid ${verticalColumns ? "books-grid-vertical" : ""} ${classPrefix ? `${classPrefix}-books-grid` : ""}`.trim()}
			style={verticalStyle}
		>
			{books.map((book) => (
				<button
					key={book.usfm}
					type="button"
					className={`book-cell ${book.number === currentBookNumber ? "current" : ""}`}
					onClick={() => {
						if (book.chapters === 1) {
							onSelectChapter(book.number, 1);
						} else {
							onSelectBook(book);
						}
					}}
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
					classPrefix={compact ? "top-genre" : "home"}
					onSelectBook={(book) => onSelectBook(book)}
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
									onClick={() => {
										if (book.chapters === 1) {
											onSelectChapter(book.number, 1);
										} else {
											onSelectBook(book);
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
	);
}
