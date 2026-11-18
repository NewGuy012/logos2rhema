import { useEffect, useMemo, useRef, useState } from "react";

import type { FootnoteVocabEntry, KrvGrammarNote } from "../../shared/types";
import { ChevronDown, ChevronRight, Search, X } from "./Icons";

interface FootnotesGuideProps {
	bookEn: string;
	bookKo: string;
	chapter: number;
	footnotes: FootnoteVocabEntry[];
	grammarNotes: KrvGrammarNote[];
	highlightedFootnoteId: string | null;
	highlightSeq?: number;
	variant?: "sidebar" | "sheet";
	onClose?: () => void;
	onJumpToVerse: (verseNumber: number) => void;
}

export function FootnotesGuide({
	bookEn,
	bookKo,
	chapter,
	footnotes,
	grammarNotes,
	highlightedFootnoteId,
	highlightSeq = 0,
	variant = "sidebar",
	onClose,
	onJumpToVerse,
}: FootnotesGuideProps) {
	const [query, setQuery] = useState("");
	const [grammarOpen, setGrammarOpen] = useState(false);
	const [wordsOpen, setWordsOpen] = useState(false);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);

	// Automatically expand Words and clear search filter when tapping a verse word
	useEffect(() => {
		if (!highlightedFootnoteId) return;
		setWordsOpen(true);
		setQuery((prev) => (prev ? "" : prev));
	}, [highlightedFootnoteId, highlightSeq]);

	// Scroll only inside the dictionary container so the Scripture column stays on the active verse
	useEffect(() => {
		if (!highlightedFootnoteId || !wordsOpen) return;
		const container = scrollContainerRef.current;
		if (!container) return;
		const targetEl = Array.from(container.querySelectorAll<HTMLElement>("[data-footnote-id]")).find(
			(el) => el.dataset.footnoteId === highlightedFootnoteId,
		);
		if (!targetEl) return;

		const containerRect = container.getBoundingClientRect();
		const targetRect = targetEl.getBoundingClientRect();
		if (containerRect.height > 0) {
			const topOffset = Math.max(12, Math.round(containerRect.height * 0.2));
			const nextTop = container.scrollTop + (targetRect.top - containerRect.top) - topOffset;
			if (typeof container.scrollTo === "function") {
				container.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
			} else {
				container.scrollTop = Math.max(0, nextTop);
			}
		} else if (typeof targetEl.scrollIntoView === "function") {
			targetEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
		}
	}, [highlightedFootnoteId, highlightSeq, query, wordsOpen, footnotes]);

	const visibleEntries = useMemo(() => {
		const trimmed = query.trim().toLowerCase();
		if (!trimmed) return footnotes;
		return footnotes.filter(
			(entry) =>
				entry.lemma.toLowerCase().includes(trimmed) ||
				entry.gloss.toLowerCase().includes(trimmed) ||
				entry.surfaceForms.some((form) => form.toLowerCase().includes(trimmed)),
		);
	}, [footnotes, query]);

	return (
		<aside
			id="footnotes"
			className={`dict-panel dict-panel-${variant}`}
			aria-label="Korean Dictionary & Grammar Guide"
		>
			<div className="dict-panel-header">
				<div className="dict-header-text">
					<h2 className="panel-title">Dictionary</h2>
					<p className="panel-subtitle">
						{bookEn} {chapter} ·{" "}
						<span lang="ko">
							{bookKo} {chapter}장
						</span>
					</p>
				</div>
				{onClose && (
					<button
						type="button"
						className="pill-nav-btn dict-close-btn"
						onClick={onClose}
						aria-label="Close dictionary panel"
						title="Close dictionary"
					>
						<X size={15} />
					</button>
				)}
			</div>

			<div className="dict-panel-controls">
				<div className="dict-search-wrap">
					<Search size={13} className="dict-search-icon" />
					<input
						type="search"
						className={`footnote-search ${query ? "has-value" : ""}`}
						placeholder="Search Korean or English..."
						value={query}
						onChange={(e) => {
							const next = e.target.value;
							setQuery(next);
							if (next.trim()) {
								setWordsOpen(true);
							}
						}}
						aria-label="Filter vocabulary footnotes"
					/>
					{query && (
						<button
							type="button"
							className="dict-search-clear"
							onClick={() => setQuery("")}
							aria-label="Clear search"
							title="Clear search"
						>
							<X size={12} />
						</button>
					)}
				</div>
			</div>

			<div className="dict-panel-scroll" ref={scrollContainerRef}>
				<section className="dict-disclosure" aria-label="Words">
					<button
						type="button"
						className="dict-disclosure-btn"
						aria-expanded={wordsOpen}
						onClick={() => setWordsOpen((prev) => !prev)}
					>
						<span>Words ({visibleEntries.length})</span>
						{wordsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
					</button>
					{wordsOpen && (
						<div className="vocab-list">
							{visibleEntries.length === 0 ? (
								<div className="vocab-row">
									<span className="vocab-forms">
										No matching vocabulary entries in this chapter.
									</span>
								</div>
							) : (
								visibleEntries.map((entry) => (
									<div
										key={entry.id}
										id={entry.id}
										data-footnote-id={entry.id}
										className={`vocab-row ${highlightedFootnoteId === entry.id ? "highlighted" : ""}`}
									>
										<div className="vocab-main">
											<div className="vocab-head-row">
												<div className="vocab-lemma">
													{entry.lemma}
													{entry.hanja && <span className="vocab-hanja">{entry.hanja}</span>}
												</div>
												<div className="vocab-verses">
													{entry.verses.slice(0, 4).map((v) => (
														<button
															key={v}
															type="button"
															className="verse-ref-chip"
															onClick={() => onJumpToVerse(v)}
															title={`Jump to verse ${v}`}
														>
															v.{v}
														</button>
													))}
													{entry.verses.length > 4 && (
														<span className="vocab-forms">+{entry.verses.length - 4}</span>
													)}
												</div>
											</div>

											<div className="vocab-gloss">{entry.gloss}</div>
											{(entry.grammarNote || entry.surfaceForms.some((f) => f !== entry.lemma)) && (
												<div className="vocab-forms">
													{entry.surfaceForms.some((f) => f !== entry.lemma) && (
														<span>{entry.surfaceForms.join(", ")}</span>
													)}
													{entry.surfaceForms.some((f) => f !== entry.lemma) &&
														entry.grammarNote && <span> · </span>}
													{entry.grammarNote && <span>{entry.grammarNote}</span>}
												</div>
											)}
										</div>
									</div>
								))
							)}
						</div>
					)}
				</section>

				{grammarNotes.length > 0 && !query.trim() && (
					<section className="dict-disclosure" aria-label="Grammar Notes">
						<button
							type="button"
							className="dict-disclosure-btn"
							aria-expanded={grammarOpen}
							onClick={() => setGrammarOpen((prev) => !prev)}
						>
							<span>Grammar ({grammarNotes.length})</span>
							{grammarOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
						</button>
						{grammarOpen && (
							<div className="grammar-cards">
								{grammarNotes.map((note) => (
									<div key={note.id} className="grammar-card">
										<div className="grammar-pattern">{note.pattern}</div>
										<div className="grammar-modern">
											Modern: {note.modern} · e.g. {note.examples.join(", ")}
										</div>
										<p className="grammar-desc">{note.explanation}</p>
									</div>
								))}
							</div>
						)}
					</section>
				)}
			</div>
		</aside>
	);
}
