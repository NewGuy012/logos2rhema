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

import type { FootnoteVocabEntry, KrvGrammarNote } from "../../shared/types";
import { useKoreanSpeech } from "../hooks/useKoreanSpeech";
import { anchorPosStyle, useAnchoredPopover } from "../hooks/usePopover";
import { scrollChildIntoContainer } from "../lib/scroll";
import { ChevronDown } from "./Icons";
import {
	filterVocabEntries,
	GrammarRuleCard,
	PanelDisclosure,
	PanelSearchInput,
	VocabEntryBody,
} from "./RailShared";

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
	const { triggerRef, menuRef, pos, updatePosition } = useAnchoredPopover(isOpen, {
		minSpace: 160,
		halfWidth: 108,
		gap: 6,
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
						style={anchorPosStyle(pos)}
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
	chapter: number;
	footnotes: FootnoteVocabEntry[];
	grammarNotes: KrvGrammarNote[];
	highlightedFootnoteId: string | null;
	highlightSeq?: number;
	onJumpToVerse: (verseNumber: number) => void;
}

export function FootnotesGuide({
	bookEn,
	chapter,
	footnotes,
	grammarNotes,
	highlightedFootnoteId,
	highlightSeq = 0,
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
		scrollChildIntoContainer(scrollContainerRef.current, "data-footnote-id", highlightedFootnoteId);
	}, [highlightedFootnoteId, highlightSeq, query, wordsOpen, footnotes]);

	const visibleEntries = useMemo(() => filterVocabEntries(footnotes, query), [footnotes, query]);

	const hasGrammarSection = grammarNotes.length > 0 && !query.trim();

	return (
		<>
			<div className="dict-panel-controls">
				<PanelSearchInput
					value={query}
					onChange={(next) => {
						setQuery(next);
						if (next.trim()) setWordsOpen(true);
					}}
					placeholder="Search"
					ariaLabel="Filter vocabulary footnotes"
					clearAriaLabel="Clear search"
				/>
			</div>

			<div
				className={`dict-panel-scroll ${wordsOpen && grammarOpen && hasGrammarSection ? "both-open" : ""}`.trim()}
			>
				<PanelDisclosure
					label={`Words (${visibleEntries.length})`}
					ariaLabel="Words"
					open={wordsOpen}
					onToggle={() => setWordsOpen((prev) => !prev)}
				>
					<div className="vocab-list" ref={scrollContainerRef}>
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
										<VocabEntryBody
											lemma={entry.lemma}
											hanja={entry.hanja}
											pos={entry.pos}
											gloss={entry.gloss}
											surfaceForms={entry.surfaceForms}
											grammarNote={entry.grammarNote}
											isSpeaking={speakingId === entry.id}
											hasSpeechError={speechErrorId === entry.id}
											onSpeak={() => handleSpeak(entry.lemma, entry.id)}
											metaSuffix={
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
											}
										/>
									</div>
								</div>
							))
						)}
					</div>
				</PanelDisclosure>

				{hasGrammarSection && (
					<PanelDisclosure
						label={`Grammar (${grammarNotes.length})`}
						ariaLabel="Grammar Notes"
						open={grammarOpen}
						onToggle={() => setGrammarOpen((prev) => !prev)}
					>
						<div className="grammar-cards">
							{grammarNotes.map((note) => (
								<GrammarRuleCard
									key={note.id}
									pattern={note.pattern}
									modernText={`Modern: ${note.modern} · e.g. ${note.examples.join(", ")}`}
									explanation={note.explanation}
								/>
							))}
						</div>
					</PanelDisclosure>
				)}
			</div>
		</>
	);
}
