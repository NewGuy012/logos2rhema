import { useMemo, useState } from "react";
import type { FootnoteVocabEntry, KrvGrammarNote } from "../../shared/types";

interface FootnotesGuideProps {
	bookEn: string;
	bookKo: string;
	chapter: number;
	footnotes: FootnoteVocabEntry[];
	grammarNotes: KrvGrammarNote[];
	highlightedFootnoteId: string | null;
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
	onJumpToVerse,
}: FootnotesGuideProps) {
	const [filterMode, setFilterMode] = useState<VocabFilter>("key");
	const [query, setQuery] = useState("");

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
		<section id="footnotes" className="footnotes-section" aria-label="Chapter Vocabulary Footnotes">
			<div className="footnotes-header">
				<div>
					<h2 className="footnotes-title">
						Footnotes &amp; Korean Word Guide · {bookEn} {chapter} ({bookKo} {chapter}장)
					</h2>
					<p className="footnotes-subtitle">
						Korean-to-English vocabulary roots, particle breakdowns, and 개역한글 (KRV) literary
						forms in order of appearance.
					</p>
				</div>
				<a href="#top" className="footnote-jump-link">
					Back to top ↑
				</a>
			</div>

			{grammarNotes.length > 0 && (
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

			<div className="footnotes-toolbar">
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
						All Words ({footnotes.length})
					</button>
				</div>

				<input
					type="search"
					className="footnote-search"
					placeholder="Filter Korean or English..."
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					aria-label="Filter vocabulary footnotes"
				/>
			</div>

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
							className={`vocab-row ${highlightedFootnoteId === entry.id ? "highlighted" : ""}`}
						>
							<div>
								<div className="vocab-lemma">
									{entry.lemma}
									{entry.hanja && <span className="vocab-hanja">{entry.hanja}</span>}
								</div>
								{entry.surfaceForms.some((f) => f !== entry.lemma) && (
									<div className="vocab-forms">In text: {entry.surfaceForms.join(", ")}</div>
								)}
							</div>

							<div>
								<div className="vocab-gloss">{entry.gloss}</div>
								{entry.grammarNote && <div className="vocab-grammar">{entry.grammarNote}</div>}
							</div>

							<div className="vocab-verses">
								{entry.verses.slice(0, 5).map((v) => (
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
								{entry.verses.length > 5 && (
									<span className="vocab-forms">+{entry.verses.length - 5}</span>
								)}
							</div>
						</div>
					))
				)}
			</div>
		</section>
	);
}
