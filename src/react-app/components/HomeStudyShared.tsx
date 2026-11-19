import { useCallback, useState } from "react";

import {
	BIBLE_BOOKS,
	getAdjacentChapter,
	getBookByNumber,
	resolveBookChapter,
} from "../../shared/books";
import { ArrowRight, BookOpen, ChevronLeft, ChevronRight } from "./Icons";

export function usePassageSelection(initialBookNumber: number, initialChapter: number) {
	const [{ book, chapter }, setSelection] = useState(() =>
		resolveBookChapter(initialBookNumber, initialChapter),
	);
	const selectPassage = useCallback((nextBookNumber: number, nextChapter: number) => {
		setSelection(resolveBookChapter(nextBookNumber, nextChapter));
	}, []);
	return { book, chapter, selectPassage };
}

interface HomePassageBarProps {
	bookNumber: number;
	chapter: number;
	onChangePassage: (bookNumber: number, chapter: number) => void;
	onOpenInReader: () => void;
}

export function HomePassageBar({
	bookNumber,
	chapter,
	onChangePassage,
	onOpenInReader,
}: HomePassageBarProps) {
	const currentBook = getBookByNumber(bookNumber) ?? BIBLE_BOOKS[0];
	const prevTarget = getAdjacentChapter(bookNumber, chapter, -1);
	const nextTarget = getAdjacentChapter(bookNumber, chapter, 1);

	return (
		<div className="home-passage-bar">
			<div className="home-passage-controls">
				<label className="home-select-wrap">
					<span className="sr-only">Book</span>
					<select
						className="home-passage-select"
						aria-label="Select book"
						value={currentBook.number}
						onChange={(e) => {
							const nextBook = Number.parseInt(e.target.value, 10);
							if (!Number.isNaN(nextBook)) onChangePassage(nextBook, 1);
						}}
					>
						{BIBLE_BOOKS.map((book) => (
							<option key={book.usfm} value={book.number}>
								{book.en} · {book.ko}
							</option>
						))}
					</select>
				</label>

				<label className="home-select-wrap">
					<span className="sr-only">Chapter</span>
					<select
						className="home-passage-select home-chapter-select"
						aria-label="Select chapter"
						value={chapter}
						onChange={(e) => {
							const nextChapter = Number.parseInt(e.target.value, 10);
							if (!Number.isNaN(nextChapter)) onChangePassage(currentBook.number, nextChapter);
						}}
					>
						{Array.from({ length: currentBook.chapters }, (_, i) => i + 1).map((ch) => (
							<option key={ch} value={ch}>
								Ch {ch} ({ch}장)
							</option>
						))}
					</select>
				</label>

				<div className="home-passage-steppers">
					<button
						type="button"
						className="pill-nav-btn home-step-btn"
						disabled={!prevTarget}
						onClick={() => prevTarget && onChangePassage(prevTarget.bookNumber, prevTarget.chapter)}
						aria-label="Previous chapter"
						title="Previous chapter"
					>
						<ChevronLeft size={15} />
					</button>
					<button
						type="button"
						className="pill-nav-btn home-step-btn"
						disabled={!nextTarget}
						onClick={() => nextTarget && onChangePassage(nextTarget.bookNumber, nextTarget.chapter)}
						aria-label="Next chapter"
						title="Next chapter"
					>
						<ChevronRight size={15} />
					</button>
				</div>
			</div>

			<button type="button" className="home-open-reader-btn" onClick={onOpenInReader}>
				<BookOpen size={14} />
				<span>Open in Reader</span>
				<ArrowRight size={14} />
			</button>
		</div>
	);
}
