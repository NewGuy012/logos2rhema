import { ArrowLeft, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { BIBLE_BOOKS, parsePassageReference } from "../../shared/books";
import type { BookMeta, Testament } from "../../shared/types";

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
		const book = BIBLE_BOOKS.find((b) => b.number === currentBookNumber) ?? null;
		setTestament(book?.testament ?? "OT");
		setActiveBook(null);
		setQuery("");
		requestAnimationFrame(() => inputRef.current?.focus());
	}, [isOpen, currentBookNumber]);

	useEffect(() => {
		if (!isOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [isOpen, onClose]);

	const filteredBooks = useMemo(() => {
		const trimmed = query.trim().toLowerCase();
		if (!trimmed) {
			return BIBLE_BOOKS.filter((b) => b.testament === testament);
		}
		return BIBLE_BOOKS.filter(
			(b) =>
				b.en.toLowerCase().includes(trimmed) ||
				b.enShort.toLowerCase().includes(trimmed) ||
				b.ko.includes(query.trim()) ||
				b.koShort.includes(query.trim()),
		);
	}, [query, testament]);

	if (!isOpen) return null;

	const handleSubmitReference = (e: React.FormEvent) => {
		e.preventDefault();
		const parsed = parsePassageReference(query);
		if (parsed) {
			onNavigate(parsed.bookNumber, parsed.chapter, parsed.verse);
			onClose();
		} else if (filteredBooks.length === 1) {
			setActiveBook(filteredBooks[0]);
		}
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
							placeholder="Jump to passage (e.g. John 3:16, 요 3:16, 시 23, Rom 8)..."
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
						<div className="filter-tabs" role="tablist">
							<button
								type="button"
								role="tab"
								aria-selected={testament === "OT"}
								className={`filter-tab ${testament === "OT" ? "active" : ""}`}
								onClick={() => setTestament("OT")}
							>
								Old Testament · 구약 (39)
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={testament === "NT"}
								className={`filter-tab ${testament === "NT" ? "active" : ""}`}
								onClick={() => setTestament("NT")}
							>
								New Testament · 신약 (27)
							</button>
						</div>
					)}
				</div>

				<div className="modal-body">
					{activeBook ? (
						<div>
							<p className="popover-title" style={{ marginBottom: "0.75rem" }}>
								{activeBook.en} · {activeBook.ko}
							</p>
							<div className="chapters-grid">
								{Array.from({ length: activeBook.chapters }, (_, i) => i + 1).map((ch) => (
									<button
										key={ch}
										type="button"
										className={`chapter-cell ${
											activeBook.number === currentBookNumber && ch === currentChapter
												? "current"
												: ""
										}`}
										onClick={() => {
											onNavigate(activeBook.number, ch);
											onClose();
										}}
									>
										{ch}
									</button>
								))}
							</div>
						</div>
					) : (
						<div className="books-grid">
							{filteredBooks.map((book) => (
								<button
									key={book.usfm}
									type="button"
									className={`book-cell ${book.number === currentBookNumber ? "current" : ""}`}
									onClick={() => {
										if (book.chapters === 1) {
											onNavigate(book.number, 1);
											onClose();
										} else {
											setActiveBook(book);
										}
									}}
								>
									<div className="book-cell-en">{book.en}</div>
									<div className="book-cell-ko">{book.ko}</div>
								</button>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
