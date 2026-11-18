import type { CSSProperties } from "react";

import type { BookMeta, Testament } from "../../shared/types";

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
