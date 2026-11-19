import {
	type CSSProperties,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

import { containsHangul, romanizeHangul } from "../../shared/hangul";
import type { FootnoteVocabEntry, KrvGrammarNote } from "../../shared/types";
import { useKoreanSpeech } from "../hooks/useKoreanSpeech";
import { type AnchorPos, computeAnchorPos, useDismissListeners } from "../hooks/usePopover";
import { scrollChildIntoContainer } from "../lib/scroll";
import { ChevronDown, ChevronRight, Search, Volume2, X } from "./Icons";

interface VerseRefSelectProps {
	lemma: string;
	verses: number[];
	isOpen: boolean;
	scrollContainerRef: RefObject<HTMLDivElement | null>;
	onToggle: () => void;
	onClose: () => void;
	onJumpToVerse: (verseNumber: number) => void;
}

function VerseRefSelect({
	lemma,
	verses,
	isOpen,
	scrollContainerRef,
	onToggle,
	onClose,
	onJumpToVerse,
}: VerseRefSelectProps) {
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [pos, setPos] = useState<AnchorPos | null>(null);

	const updatePosition = useCallback(() => {
		if (!triggerRef.current) return;
		setPos(
			computeAnchorPos(triggerRef.current.getBoundingClientRect(), {
				minSpace: 160,
				halfWidth: 108,
				gap: 6,
			}),
		);
	}, []);

	useDismissListeners(isOpen, {
		refs: [triggerRef, menuRef],
		onDismiss: onClose,
		onScroll: true,
		onResize: true,
	});

	useEffect(() => {
		if (!isOpen) return;
		const scrollEl = scrollContainerRef.current;
		if (!scrollEl) return;
		scrollEl.addEventListener("scroll", onClose, { passive: true });
		return () => scrollEl.removeEventListener("scroll", onClose);
	}, [isOpen, onClose, scrollContainerRef]);

	if (verses.length === 0) return null;

	if (verses.length === 1) {
		return (
			<button
				type="button"
				className="verse-ref-chip"
				onClick={() => onJumpToVerse(verses[0])}
				title={`Go to verse ${verses[0]}`}
			>
				v.{verses[0]}
			</button>
		);
	}

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				className={`verse-ref-chip verse-ref-select ${isOpen ? "active" : ""}`.trim()}
				onClick={() => {
					if (!isOpen) updatePosition();
					onToggle();
				}}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				aria-label={`${lemma} verses: v.${verses[0]} and ${verses.length - 1} more`}
				title={`Appears in ${verses.length} verses`}
			>
				<span>v.{verses[0]}</span>
				<span className="verse-ref-more">+{verses.length - 1}</span>
				<ChevronDown size={10} className="verse-ref-caret" />
			</button>

			{isOpen &&
				pos &&
				typeof document !== "undefined" &&
				createPortal(
					<div
						ref={menuRef}
						role="menu"
						aria-label={`${lemma} verse occurrences`}
						className="verse-ref-menu"
						style={{
							left: `${pos.left}px`,
							top: `${pos.top}px`,
							transform: pos.placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
						}}
					>
						<div className="verse-ref-menu-title">{verses.length} verses</div>
						<div
							className="verse-ref-menu-grid"
							style={{ "--verse-cols": Math.min(verses.length, 4) } as CSSProperties}
						>
							{verses.map((v) => (
								<button
									key={v}
									type="button"
									role="menuitem"
									className="verse-ref-menu-item"
									onClick={() => {
										onJumpToVerse(v);
										onClose();
									}}
									title={`Go to verse ${v}`}
								>
									v.{v}
								</button>
							))}
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}

interface FootnotesGuideProps {
	bookEn: string;
	bookKo: string;
	chapter: number;
	footnotes: FootnoteVocabEntry[];
	grammarNotes: KrvGrammarNote[];
	highlightedFootnoteId: string | null;
	highlightSeq?: number;
	variant?: "sidebar" | "sheet";
	embedded?: boolean;
	onMinimize?: () => void;
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
	embedded = false,
	onMinimize,
	onJumpToVerse,
}: FootnotesGuideProps) {
	const [query, setQuery] = useState("");
	const [grammarOpen, setGrammarOpen] = useState(false);
	const [wordsOpen, setWordsOpen] = useState(false);
	const [openVerseId, setOpenVerseId] = useState<string | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const closeVerseMenu = useCallback(() => setOpenVerseId(null), []);
	const {
		speakingKey: speakingId,
		speechErrorKey: speechErrorId,
		speak: handleSpeak,
		clearSpeechError,
	} = useKoreanSpeech<string>();

	useEffect(() => {
		clearSpeechError();
	}, [bookEn, chapter, wordsOpen, clearSpeechError]);

	useEffect(() => {
		setOpenVerseId(null);
	}, [bookEn, chapter, wordsOpen, query, footnotes]);

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

		scrollChildIntoContainer(container, targetEl);
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

	const hasGrammarSection = grammarNotes.length > 0 && !query.trim();

	const bodyContent = (
		<>
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

			<div
				className={`dict-panel-scroll ${wordsOpen && grammarOpen && hasGrammarSection ? "both-open" : ""}`.trim()}
			>
				<section className={`dict-disclosure ${wordsOpen ? "open" : ""}`.trim()} aria-label="Words">
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
						<div className="vocab-list" ref={scrollContainerRef}>
							{visibleEntries.length === 0 ? (
								<div className="vocab-row">
									<span className="vocab-forms">
										No matching vocabulary entries in this chapter.
									</span>
								</div>
							) : (
								visibleEntries.map((entry) => {
									const romanized = containsHangul(entry.lemma) ? romanizeHangul(entry.lemma) : "";
									const hasVariantForms = entry.surfaceForms.some((f) => f !== entry.lemma);
									return (
										<div
											key={entry.id}
											id={entry.id}
											data-footnote-id={entry.id}
											className={`vocab-row ${highlightedFootnoteId === entry.id ? "highlighted" : ""}`}
										>
											<div className="vocab-main">
												<div className="vocab-head-row">
													<div className="vocab-lemma-group">
														<div className="vocab-lemma">
															{entry.lemma}
															{entry.hanja && <span className="vocab-hanja">{entry.hanja}</span>}
														</div>
														<button
															type="button"
															className={`vocab-speak-btn ${speakingId === entry.id ? "speaking" : ""}`.trim()}
															onClick={() => handleSpeak(entry.lemma, entry.id)}
															aria-label={`Pronounce ${entry.lemma}`}
															title={`Pronounce ${entry.lemma}`}
														>
															<Volume2 size={13} />
														</button>
													</div>
													<div className="vocab-head-meta">
														{entry.pos && <span className="vocab-pos">{entry.pos}</span>}
														<VerseRefSelect
															lemma={entry.lemma}
															verses={entry.verses}
															isOpen={openVerseId === entry.id}
															scrollContainerRef={scrollContainerRef}
															onToggle={() =>
																setOpenVerseId((prev) => (prev === entry.id ? null : entry.id))
															}
															onClose={closeVerseMenu}
															onJumpToVerse={onJumpToVerse}
														/>
													</div>
												</div>

												{romanized && <div className="vocab-phonetics">[{romanized}]</div>}
												<div className="vocab-gloss">{entry.gloss}</div>
												{(entry.grammarNote || hasVariantForms) && (
													<div className="vocab-forms">
														{hasVariantForms && <span>{entry.surfaceForms.join(", ")}</span>}
														{hasVariantForms && entry.grammarNote && <span> · </span>}
														{entry.grammarNote && <span>{entry.grammarNote}</span>}
													</div>
												)}
												{speechErrorId === entry.id && (
													<div className="vocab-speech-note">
														Korean voice unavailable in this browser.
													</div>
												)}
											</div>
										</div>
									);
								})
							)}
						</div>
					)}
				</section>

				{hasGrammarSection && (
					<section
						className={`dict-disclosure ${grammarOpen ? "open" : ""}`.trim()}
						aria-label="Grammar Notes"
					>
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
		</>
	);

	if (embedded) return bodyContent;

	return (
		<aside
			id="footnotes"
			className={`dict-panel dict-panel-${variant}`}
			aria-label="Korean Dictionary & Grammar Guide"
		>
			<div className="dict-panel-header">
				<span aria-hidden="true" />
				<div className="panel-header-text">
					<h2 className="panel-title">Dictionary</h2>
					<p className="panel-subtitle">
						{bookEn} {chapter} ·{" "}
						<span lang="ko">
							{bookKo} {chapter}장
						</span>
					</p>
				</div>
				{onMinimize && (
					<button
						type="button"
						className="pill-nav-btn dict-minimize-btn"
						onClick={onMinimize}
						aria-expanded={true}
						aria-label="Minimize dictionary"
						title="Minimize dictionary"
					>
						{variant === "sheet" ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
					</button>
				)}
			</div>
			{bodyContent}
		</aside>
	);
}
