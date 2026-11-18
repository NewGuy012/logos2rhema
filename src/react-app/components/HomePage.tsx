import { useMemo, useState } from "react";

import { BIBLE_BOOKS, getBookByNumber, parsePassageReference } from "../../shared/books";
import type { BookMeta, Testament, TranslationMeta } from "../../shared/types";
import { ArrowLeft, ArrowRight, BookOpen, Headphones, Search } from "./Icons";

interface HomePageProps {
	lastBookNumber: number;
	lastChapter: number;
	selectedEn: TranslationMeta;
	selectedKo: TranslationMeta;
	bibleBrainEnabled: boolean;
	onOpenPassage: (bookNumber: number, chapter: number, verse?: number) => void;
}

const FEATURED_PASSAGES: ReadonlyArray<{
	bookNumber: number;
	chapter: number;
	labelEn: string;
	labelKo: string;
	tag: string;
}> = [
	{ bookNumber: 1, chapter: 1, labelEn: "Genesis 1", labelKo: "창세기 1장", tag: "Creation" },
	{ bookNumber: 19, chapter: 23, labelEn: "Psalm 23", labelKo: "시편 23편", tag: "Poetry" },
	{ bookNumber: 8, chapter: 4, labelEn: "Ruth 4", labelKo: "룻기 4장", tag: "Narrative" },
	{ bookNumber: 43, chapter: 1, labelEn: "John 1", labelKo: "요한복음 1장", tag: "Logos" },
	{ bookNumber: 43, chapter: 3, labelEn: "John 3", labelKo: "요한복음 3장", tag: "Gospel" },
	{ bookNumber: 45, chapter: 8, labelEn: "Romans 8", labelKo: "로마서 8장", tag: "Epistle" },
];

export function HomePage({
	lastBookNumber,
	lastChapter,
	selectedEn,
	selectedKo,
	bibleBrainEnabled,
	onOpenPassage,
}: HomePageProps) {
	const [query, setQuery] = useState("");
	const [testament, setTestament] = useState<Testament>("OT");
	const [selectedBook, setSelectedBook] = useState<BookMeta | null>(null);

	const lastBook = useMemo(
		() => getBookByNumber(lastBookNumber) ?? BIBLE_BOOKS[0],
		[lastBookNumber],
	);

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

	const handleSearchSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const parsed = parsePassageReference(query);
		if (parsed) {
			onOpenPassage(parsed.bookNumber, parsed.chapter, parsed.verse);
			return;
		}
		if (filteredBooks.length === 1) {
			const only = filteredBooks[0];
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
				<div className="home-kicker">
					<span>
						{selectedEn.code} · {selectedKo.code}
					</span>
					<span className="home-sync-pill">
						<Headphones size={12} />
						<span>
							{bibleBrainEnabled ? "Bible Brain Verse-Synced Audio" : "Human Audio Ready"}
						</span>
					</span>
				</div>

				<h1 className="home-title">
					Logos{" "}
					<span className="home-title-ko" lang="ko">
						말씀
					</span>
				</h1>
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
			</section>

			<section className="home-section" aria-label="Featured Passages">
				<h2 className="home-section-title">Featured Chapters</h2>
				<div className="home-featured-grid">
					{FEATURED_PASSAGES.map((item) => (
						<button
							key={`${item.bookNumber}-${item.chapter}`}
							type="button"
							className="home-featured-card"
							onClick={() => onOpenPassage(item.bookNumber, item.chapter)}
						>
							<span className="home-featured-tag">{item.tag}</span>
							<span className="home-featured-en">{item.labelEn}</span>
							<span className="home-featured-ko" lang="ko">
								{item.labelKo}
							</span>
						</button>
					))}
				</div>
			</section>

			<section className="home-section" aria-label="Browse All Books">
				<div className="home-browser-header">
					<h2 className="home-section-title">
						{selectedBook ? `${selectedBook.en} · ${selectedBook.ko}` : "Browse Scripture"}
					</h2>

					{selectedBook ? (
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
						!query.trim() && (
							<div className="filter-tabs" role="tablist" aria-label="Testament">
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
						)
					)}
				</div>

				{selectedBook ? (
					<div className="chapters-grid home-chapters-grid">
						{Array.from({ length: selectedBook.chapters }, (_, idx) => idx + 1).map((ch) => (
							<button
								key={ch}
								type="button"
								className={`chapter-cell ${
									selectedBook.number === lastBook.number && ch === lastChapter ? "current" : ""
								}`}
								onClick={() => onOpenPassage(selectedBook.number, ch)}
							>
								{ch}
							</button>
						))}
					</div>
				) : (
					<div className="books-grid home-books-grid">
						{filteredBooks.map((book) => (
							<button
								key={book.usfm}
								type="button"
								className={`book-cell ${book.number === lastBook.number ? "current" : ""}`}
								onClick={() => {
									if (book.chapters === 1) {
										onOpenPassage(book.number, 1);
									} else {
										setSelectedBook(book);
									}
								}}
							>
								<div className="book-cell-en">{book.en}</div>
								<div className="book-cell-ko" lang="ko">
									{book.ko} · {book.chapters}ch
								</div>
							</button>
						))}
					</div>
				)}
			</section>
		</main>
	);
}
