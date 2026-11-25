import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { filterBooks, getBookByNumber } from "../../shared/books";
import type { BookMeta, Testament } from "../../shared/types";
import { useDismissListeners } from "../hooks/usePopover";
import { BookChapterGrid, submitPassageQuery, TestamentTabs } from "./BookChapterBrowser";
import { ArrowLeft, X } from "./Icons";

interface PassagePickerProps {
	isOpen: boolean;
	currentBookNumber: number;
	currentChapter: number;
	onClose: () => void;
	onNavigate: (bookNumber: number, chapter: number, verse?: number) => void;
}

export function PassagePicker({
	isOpen,
	currentBookNumber,
	currentChapter,
	onClose,
	onNavigate,
}: PassagePickerProps) {
	const [query, setQuery] = useState("");
	const [testament, setTestament] = useState<Testament>("OT");
	const [activeBook, setActiveBook] = useState<BookMeta | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (!isOpen) return;
		const book = getBookByNumber(currentBookNumber);
		setTestament(book?.testament ?? "OT");
		setActiveBook(null);
		setQuery("");
		const rafId = requestAnimationFrame(() => inputRef.current?.focus());
		return () => cancelAnimationFrame(rafId);
	}, [isOpen, currentBookNumber]);

	useDismissListeners(isOpen, { onDismiss: onClose });

	const filteredBooks = useMemo(() => filterBooks(query, testament), [query, testament]);

	if (!isOpen) return null;

	const selectChapter = (bookNum: number, chap: number, verse?: number) => {
		onNavigate(bookNum, chap, verse);
		onClose();
	};

	const handleSubmitReference = (e: FormEvent) => {
		e.preventDefault();
		submitPassageQuery(
			query,
			filteredBooks.length === 1 ? filteredBooks[0] : undefined,
			selectChapter,
			setActiveBook,
		);
	};

	return (
		<div className="modal-backdrop">
			<button
				type="button"
				className="modal-dismiss-layer"
				onClick={onClose}
				aria-label="Close passage picker"
			/>
			<div
				className="modal-panel"
				role="dialog"
				aria-modal="true"
				aria-label="Select Bible passage"
			>
				<div className="modal-header">
					<form className="modal-search-row" onSubmit={handleSubmitReference}>
						{activeBook && (
							<button
								type="button"
								className="icon-btn"
								onClick={() => setActiveBook(null)}
								aria-label="Back to books"
							>
								<ArrowLeft size={16} />
							</button>
						)}
						<input
							ref={inputRef}
							type="search"
							className="modal-search-input"
							placeholder="Go to passage (e.g. John 3:16, 요 3:16, 시 23, Rom 8)..."
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								if (activeBook) setActiveBook(null);
							}}
						/>
						<button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
							<X size={18} />
						</button>
					</form>

					{!activeBook && !query.trim() && (
						<TestamentTabs testament={testament} onChange={setTestament} />
					)}
				</div>

				<div className="modal-body">
					{activeBook && (
						<p className="popover-title picker-book-title">
							{activeBook.en} · {activeBook.ko}
						</p>
					)}
					<BookChapterGrid
						books={filteredBooks}
						selectedBook={activeBook}
						currentBookNumber={currentBookNumber}
						currentChapter={currentChapter}
						verticalLayout={true}
						onSelectBook={setActiveBook}
						onSelectChapter={selectChapter}
					/>
				</div>
			</div>
		</div>
	);
}
