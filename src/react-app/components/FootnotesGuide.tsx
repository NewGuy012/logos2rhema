import { useEffect, useMemo, useRef, useState } from "react";

import type { FootnoteVocabEntry, KrvGrammarNote } from "../../shared/types";
import { X } from "./Icons";

interface FootnotesGuideProps {
	bookEn: string;
	bookKo: string;
	chapter: number;
	footnotes: FootnoteVocabEntry[];
	grammarNotes: KrvGrammarNote[];
	highlightedFootnoteId: string | null;
	variant?: "sidebar" | "sheet";
	onClose?: () => void;
	onJumpToVerse: (verseNumber: number) => void;
}

type VocabFilter = "key" | "all";

export function FootnotesGuide({
	bookEn,
	bookKo,
	chapter,
	footnotes,
	grammarNotes,
	highlightedFootnoteId,
	variant = "sidebar",
	onClose,
	onJumpToVerse,
}: FootnotesGuideProps) {
	const [filterMode, setFilterMode] = useState<VocabFilter>("key");
	const [query, setQuery] = useState("");
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);

	// Automatically switch to "All Words" if a highlighted word is a particle/pronoun hidden by "Key Vocab"
	useEffect(() => {
		if (!highlightedFootnoteId) return;
		const target = footnotes.find((f) => f.id === highlightedFootnoteId);
		if (target && (target.pos === "pronoun" || target.pos === "particle")) {
			setFilterMode("all");
		}
		if (query) setQuery("");
	}, [highlightedFootnoteId, footnotes, query]);

	// Scroll only inside the dictionary container so the Scripture column stays on the active verse
	useEffect(() => {
		if (!highlightedFootnoteId) return;
		const container = scrollContainerRef.current;
		if (!container) return;
		const targetEl = container.querySelector<HTMLElement>(
			`[data-footnote-id="${highlightedFootnoteId}"]`,
		);
		if (targetEl && typeof targetEl.scrollIntoView === "function") {
			targetEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
		}
	}, [highlightedFootnoteId, filterMode]);

	const visibleEntries = useMemo(() => {
		const trimmed = query.trim().toLowerCase();
		return footnotes.filter((entry) => {
			if (
				filterMode === "key" &&
				!trimmed &&
				(entry.pos === "pronoun" || entry.pos === "particle")
			) {
				return false;
			}
			if (!trimmed) return true;
			return (
				entry.lemma.toLowerCase().includes(trimmed) ||
				entry.gloss.toLowerCase().includes(trimmed) ||
				entry.surfaceForms.some((form) => form.toLowerCase().includes(trimmed))
			);
		});
	}, [footnotes, filterMode, query]);

	return (
		<aside
			id="footnotes"
			className={`dict-panel dict-panel-${variant}`}
			aria-label="Korean Dictionary & Grammar Guide"
		>
			<div className="dict-panel-header">
				<div>
					<h2 className="dict-panel-title">
						Korean Dictionary · {bookEn} {chapter}
					</h2>
					<p className="dict-panel-subtitle" lang="ko">
						{bookKo} {chapter}장 어휘 · 개역한글 가이드
					</p>
				</div>
				{onClose && (
					<button
						type="button"
						className="pill-nav-btn"
						onClick={onClose}
						aria-label="Close dictionary panel"
						title="Close dictionary"
					>
						<X size={16} />
					</button>
				)}
			</div>

			<div className="dict-panel-controls">
				<div className="filter-tabs" role="tablist" aria-label="Vocabulary filter">
					<button
						type="button"
						role="tab"
						aria-selected={filterMode === "key"}
						className={`filter-tab ${filterMode === "key" ? "active" : ""}`}
						onClick={() => setFilterMode("key")}
					>
						Key Vocab
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={filterMode === "all"}
						className={`filter-tab ${filterMode === "all" ? "active" : ""}`}
						onClick={() => setFilterMode("all")}
					>
						All ({footnotes.length})
					</button>
				</div>

				<input
					type="search"
					className="footnote-search"
					placeholder="Search Korean or English..."
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					aria-label="Filter vocabulary footnotes"
				/>
			</div>

			<div className="dict-panel-scroll" ref={scrollContainerRef}>
				{grammarNotes.length > 0 && !query.trim() && (
					<section className="grammar-cards" aria-label="KRV Grammar Notes">
						{grammarNotes.map((note) => (
							<div key={note.id} className="grammar-card">
								<div className="grammar-pattern">{note.pattern}</div>
								<div className="grammar-modern">
									Modern: {note.modern} · e.g. {note.examples.join(", ")}
								</div>
								<p className="grammar-desc">{note.explanation}</p>
							</div>
						))}
					</section>
				)}

				<div className="vocab-list">
					{visibleEntries.length === 0 ? (
						<div className="vocab-row">
							<span className="vocab-forms">No matching vocabulary entries in this chapter.</span>
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
											{entry.surfaceForms.some((f) => f !== entry.lemma) && entry.grammarNote && (
												<span> · </span>
											)}
											{entry.grammarNote && <span>{entry.grammarNote}</span>}
										</div>
									)}
								</div>
							</div>
						))
					)}
				</div>
			</div>
		</aside>
	);
}
