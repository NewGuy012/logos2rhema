import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
	formatVerseRefBilingual,
	getBookOrDefault,
	parseVerseRangeReference,
} from "../../shared/books";
import {
	MEMORIZE_STARTER_PACKS,
	type MemorizePackCategory,
	type MemorizeStarterPack,
} from "../../shared/memorize-packs";
import { CANONICAL_BIBLES } from "../../shared/translations";
import type {
	FavoriteItem,
	LexiconMap,
	MemorizeCard,
	MemorizeRating,
	MemorizeStats,
	VerseRef,
} from "../../shared/types";
import { loadTranslationPassage } from "../lib/bible-loader";
import { makeMemorizeCardId, type MemorizeStudyPrefs, truncateKoPreview } from "../lib/memorize";
import {
	buildStudyQueue,
	formatDueStatusLabel,
	getCardMastery,
	isCardDue,
} from "../lib/memorize-srs";
import { FlashcardSession } from "./FlashcardSession";
import {
	ArrowRight,
	BookOpen,
	ChevronDown,
	ChevronRight,
	Layers,
	Pencil,
	Plus,
	Search,
	Shuffle,
	Sparkles,
	X,
} from "./Icons";
import { LegalFooter } from "./LegalFooter";
import { SegmentedControl, type SegmentedOption } from "./RailShared";
import type { StackOrder } from "./VerseBlock";

type DeckFilter = "all" | "due" | "learning" | "mastered";
type PackCategoryFilter = "all" | MemorizePackCategory;

const PACK_FILTER_OPTIONS: ReadonlyArray<SegmentedOption<PackCategoryFilter>> = [
	{ value: "all", label: "All Packs" },
	{ value: "essential", label: "Essentials" },
	{ value: "testament", label: "Testaments" },
	{ value: "theme", label: "Themes" },
];

const PACK_CATEGORY_LABELS: Record<MemorizePackCategory, string> = {
	essential: "Essential",
	testament: "Collection",
	theme: "Theme",
};

const DECK_FILTER_OPTIONS: ReadonlyArray<SegmentedOption<DeckFilter>> = [
	{ value: "all", label: "All" },
	{ value: "due", label: "Due" },
	{ value: "learning", label: "Learning" },
	{ value: "mastered", label: "Mastered" },
];

interface MemorizePageProps {
	cards: readonly MemorizeCard[];
	stats: MemorizeStats;
	studyPrefs: MemorizeStudyPrefs;
	favorites: readonly FavoriteItem[];
	stackOrder: StackOrder;
	wordTooltip: boolean;
	lexicon: LexiconMap;
	onChangeStudyPrefs: (patch: Partial<MemorizeStudyPrefs>) => void;
	onAddCard: (input: VerseRef & { koPreview?: string | null; note?: string }) => {
		added: boolean;
		card: MemorizeCard | null;
	};
	onRemoveCard: (id: string) => void;
	onUpdateNote: (id: string, note: string) => void;
	onAddStarterPack: (pack: MemorizeStarterPack, koPreviews?: ReadonlyMap<string, string>) => number;
	onImportBookmarks: () => number;
	onReviewCard: (cardId: string, rating: MemorizeRating) => void;
	onCompleteSession: (reviewedCount: number) => void;
	onClearDeck: () => void;
	onOpenPassage: (bookNumber: number, chapter: number, verse?: number) => void;
}

export function MemorizePage({
	cards,
	stats,
	studyPrefs,
	favorites,
	stackOrder,
	wordTooltip,
	lexicon,
	onChangeStudyPrefs,
	onAddCard,
	onRemoveCard,
	onUpdateNote,
	onAddStarterPack,
	onImportBookmarks,
	onReviewCard,
	onCompleteSession,
	onClearDeck,
	onOpenPassage,
}: MemorizePageProps) {
	const [sessionQueueIds, setSessionQueueIds] = useState<string[] | null>(null);
	const [addQuery, setAddQuery] = useState("");
	const [addingVerse, setAddingVerse] = useState(false);
	const [statusMessage, setStatusMessage] = useState<{
		kind: "ok" | "error";
		text: string;
	} | null>(null);
	const [packsOpen, setPacksOpen] = useState(() => cards.length === 0);
	const [packCategory, setPackCategory] = useState<PackCategoryFilter>("all");
	const [expandedPackId, setExpandedPackId] = useState<string | null>(null);
	const [addingPackId, setAddingPackId] = useState<string | null>(null);
	const [filter, setFilter] = useState<DeckFilter>("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
	const [noteDraft, setNoteDraft] = useState("");
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const now = Date.now();
	const cardIds = useMemo(() => new Set(cards.map((c) => c.id)), [cards]);
	const dueCards = useMemo(() => cards.filter((c) => isCardDue(c, now)), [cards, now]);
	const masteredCount = useMemo(
		() => cards.filter((c) => getCardMastery(c) === "mastered").length,
		[cards],
	);

	const importableBookmarksCount = useMemo(() => {
		let count = 0;
		for (const fav of favorites) {
			if (fav.verse === undefined) continue;
			const id = makeMemorizeCardId(fav.bookNumber, fav.chapter, fav.verse);
			if (!cardIds.has(id)) count++;
		}
		return count;
	}, [favorites, cardIds]);

	const filteredCards = useMemo(() => {
		const trimmed = searchQuery.trim().toLowerCase();
		return cards.filter((card) => {
			if (filter === "due" && !isCardDue(card, now)) return false;
			if (filter === "mastered" && getCardMastery(card) !== "mastered") return false;
			if (filter === "learning" && getCardMastery(card) === "mastered") return false;
			if (!trimmed) return true;
			const book = getBookOrDefault(card.bookNumber);
			const { refEn, refKo } = formatVerseRefBilingual(card);
			return (
				refEn.toLowerCase().includes(trimmed) ||
				refKo.includes(searchQuery.trim()) ||
				book.enShort.toLowerCase().includes(trimmed) ||
				book.koShort.includes(searchQuery.trim()) ||
				Boolean(card.koPreview?.includes(searchQuery.trim())) ||
				Boolean(card.note?.toLowerCase().includes(trimmed))
			);
		});
	}, [cards, filter, searchQuery, now]);

	const filteredPacks = useMemo(
		() =>
			MEMORIZE_STARTER_PACKS.filter(
				(pack) => packCategory === "all" || pack.category === packCategory,
			),
		[packCategory],
	);

	const startSession = (mode: "due" | "all", shuffle = false, singleId?: string) => {
		if (singleId) {
			setSessionQueueIds([singleId]);
			return;
		}
		const queue = buildStudyQueue(cards, { mode, shuffle });
		if (queue.length > 0) {
			setSessionQueueIds(queue.map((c) => c.id));
		}
	};

	const handleAddSubmit = async (e: FormEvent) => {
		e.preventDefault();
		const parsed = parseVerseRangeReference(addQuery);
		if (!parsed) {
			setStatusMessage({
				kind: "error",
				text: "Enter a verse or range (e.g. John 3:16, Prov 3:5-6, 시 23:1-3).",
			});
			return;
		}
		const book = getBookOrDefault(parsed.bookNumber);
		const { refEn } = formatVerseRefBilingual(parsed);
		setAddingVerse(true);
		setStatusMessage(null);
		try {
			const verses = await loadTranslationPassage(
				CANONICAL_BIBLES.ko.id,
				parsed.bookNumber,
				parsed.chapter,
				parsed.verseStart,
				parsed.verseEnd,
			);
			if (!mountedRef.current) return;
			const hasStart = verses.some((v) => v.verse === parsed.verseStart);
			const hasEnd =
				parsed.verseEnd === undefined || verses.some((v) => v.verse === parsed.verseEnd);
			if (!hasStart || !hasEnd) {
				setStatusMessage({
					kind: "error",
					text: `Verse not found in ${book.en} ${parsed.chapter}.`,
				});
				return;
			}
			const koPreview = truncateKoPreview(verses.map((v) => v.text).join(" "));
			const res = onAddCard({ ...parsed, koPreview });
			setAddQuery("");
			setStatusMessage({
				kind: "ok",
				text: res.added ? `Added ${refEn} to your deck.` : `${refEn} is already in your deck.`,
			});
		} catch {
			if (!mountedRef.current) return;
			const res = onAddCard(parsed);
			setAddQuery("");
			setStatusMessage({
				kind: "ok",
				text: res.added ? `Added ${refEn} to your deck.` : `${refEn} is already in your deck.`,
			});
		} finally {
			if (mountedRef.current) setAddingVerse(false);
		}
	};

	const handleAddPack = async (pack: MemorizeStarterPack) => {
		setAddingPackId(pack.id);
		const previews = new Map<string, string>();
		try {
			await Promise.allSettled(
				pack.refs.map(async (ref) => {
					const verses = await loadTranslationPassage(
						CANONICAL_BIBLES.ko.id,
						ref.bookNumber,
						ref.chapter,
						ref.verseStart,
						ref.verseEnd,
					);
					const joined = truncateKoPreview(verses.map((v) => v.text).join(" "));
					if (joined) {
						previews.set(
							makeMemorizeCardId(ref.bookNumber, ref.chapter, ref.verseStart, ref.verseEnd),
							joined,
						);
					}
				}),
			);
		} catch {}
		if (!mountedRef.current) return;
		const addedCount = onAddStarterPack(pack, previews);
		setAddingPackId(null);
		setStatusMessage({
			kind: "ok",
			text:
				addedCount > 0
					? `Added ${addedCount} verse${addedCount === 1 ? "" : "s"} from ${pack.titleEn}.`
					: `All verses from ${pack.titleEn} are already in your deck.`,
		});
	};

	if (sessionQueueIds && sessionQueueIds.length > 0) {
		return (
			<main className="memorize-container memorize-session-shell">
				<FlashcardSession
					cards={cards}
					initialQueueIds={sessionQueueIds}
					studyPrefs={studyPrefs}
					stackOrder={stackOrder}
					wordTooltip={wordTooltip}
					lexicon={lexicon}
					streakDays={stats.streakDays}
					onChangeStudyPrefs={onChangeStudyPrefs}
					onReviewCard={onReviewCard}
					onOpenPassage={onOpenPassage}
					onCompleteSession={onCompleteSession}
					onExit={() => setSessionQueueIds(null)}
				/>
			</main>
		);
	}

	return (
		<main className="memorize-container">
			<header className="memorize-header">
				<div className="memorize-title-group">
					<p className="memorize-eyebrow">
						<Layers size={13} />
						<span>Scripture Memorization · 말씀 암송</span>
					</p>
					<h1 className="memorize-title">Memorize Deck</h1>
					<p className="memorize-subtitle">
						Practice English (ESV) and Korean (개역한글) side-by-side with spaced repetition,
						bilingual recall, and progressive Korean 초성 hints.
					</p>
				</div>

				<div className="memorize-cta-group">
					<button
						type="button"
						className="home-continue-btn memorize-study-primary"
						disabled={dueCards.length === 0}
						onClick={() => startSession("due")}
					>
						<span>Study Due ({dueCards.length})</span>
						<ArrowRight size={15} />
					</button>
					{cards.length > 0 && (
						<>
							<button
								type="button"
								className="home-memorize-btn"
								onClick={() => startSession("all", false)}
							>
								<span>Practice All ({cards.length})</span>
							</button>
							<button
								type="button"
								className="votd-action-btn"
								onClick={() => startSession("all", true)}
								aria-label="Shuffle and practice all"
								title="Shuffle and practice all"
							>
								<Shuffle size={14} />
								<span>Shuffle</span>
							</button>
						</>
					)}
				</div>
			</header>

			<section className="memorize-stats-row" aria-label="Study statistics">
				<div className="memorize-stat-card">
					<span className="memorize-stat-val">{dueCards.length}</span>
					<span className="memorize-stat-label">Due Today</span>
				</div>
				<div className="memorize-stat-card">
					<span className="memorize-stat-val">{masteredCount}</span>
					<span className="memorize-stat-label">Mastered</span>
				</div>
				<div className="memorize-stat-card">
					<span className="memorize-stat-val">{cards.length}</span>
					<span className="memorize-stat-label">Total Cards</span>
				</div>
				<div className="memorize-stat-card">
					<span className="memorize-stat-val">{stats.streakDays}d</span>
					<span className="memorize-stat-label">Study Streak</span>
				</div>
			</section>

			<section className="memorize-add-section" aria-label="Add verses to deck">
				<form className="home-search-form memorize-add-form" onSubmit={handleAddSubmit}>
					<Plus size={16} className="home-search-icon" />
					<input
						type="text"
						className="home-search-input"
						placeholder="Add verse or range (e.g. John 3:16, Prov 3:5-6, 시 23:1-3)..."
						value={addQuery}
						onChange={(e) => setAddQuery(e.target.value)}
						aria-label="Add verse reference"
					/>
					<button
						type="submit"
						className="home-search-submit memorize-add-submit"
						disabled={addingVerse || !addQuery.trim()}
					>
						{addingVerse ? "Adding..." : "Add Verse"}
					</button>
				</form>

				<div className="memorize-quick-imports">
					<button
						type="button"
						className="votd-action-btn"
						aria-expanded={packsOpen}
						onClick={() => setPacksOpen((prev) => !prev)}
					>
						<Sparkles size={13} />
						<span>Starter Packs</span>
						{packsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
					</button>

					{importableBookmarksCount > 0 && (
						<button
							type="button"
							className="votd-action-btn"
							onClick={() => {
								const addedCount = onImportBookmarks();
								setStatusMessage({
									kind: "ok",
									text: `Imported ${addedCount} bookmarked verse${addedCount === 1 ? "" : "s"} into your deck.`,
								});
							}}
						>
							<Plus size={13} />
							<span>Import {importableBookmarksCount} from Bookmarks</span>
						</button>
					)}
				</div>

				{statusMessage && (
					<p
						className={`memorize-feedback ${statusMessage.kind === "error" ? "error" : ""}`.trim()}
						role={statusMessage.kind === "error" ? "alert" : "status"}
					>
						{statusMessage.text}
					</p>
				)}

				{packsOpen && (
					<div className="memorize-packs-panel">
						<div className="memorize-packs-toolbar">
							<SegmentedControl
								value={packCategory}
								options={PACK_FILTER_OPTIONS}
								onChange={setPackCategory}
								ariaLabel="Filter starter packs by category"
							/>
							<span className="memorize-packs-count">
								{filteredPacks.length === 1 ? "1 pack" : `${filteredPacks.length} packs`}
							</span>
						</div>

						<div className="memorize-packs-grid">
							{filteredPacks.map((pack) => {
								const inDeckCount = pack.refs.filter((ref) =>
									cardIds.has(
										makeMemorizeCardId(ref.bookNumber, ref.chapter, ref.verseStart, ref.verseEnd),
									),
								).length;
								const allAdded = inDeckCount === pack.refs.length;
								const isExpanded = expandedPackId === pack.id;
								const visibleRefs = isExpanded ? pack.refs : pack.refs.slice(0, 4);
								const hiddenCount = pack.refs.length - visibleRefs.length;

								return (
									<div key={pack.id} className="memorize-pack-card">
										<div className="memorize-pack-head">
											<div>
												<div className="memorize-pack-meta">
													<span className="memorize-pack-badge">
														{PACK_CATEGORY_LABELS[pack.category]} · {pack.refs.length} verses
													</span>
													{inDeckCount > 0 && !allAdded && (
														<span className="memorize-pack-progress">
															{inDeckCount}/{pack.refs.length} in deck
														</span>
													)}
												</div>
												<h3 className="memorize-pack-title">
													{pack.titleEn}{" "}
													<span className="memorize-pack-ko" lang="ko">
														· {pack.titleKo}
													</span>
												</h3>
												<p className="memorize-pack-desc">{pack.description}</p>
											</div>
											<button
												type="button"
												className={`votd-action-btn ${allAdded ? "active" : ""}`.trim()}
												disabled={allAdded || addingPackId === pack.id}
												onClick={() => handleAddPack(pack)}
												aria-label={
													allAdded
														? `${pack.titleEn} already added`
														: `Add ${pack.titleEn} pack (${pack.refs.length - inDeckCount} verses)`
												}
											>
												{addingPackId === pack.id
													? "Adding..."
													: allAdded
														? `Added (${pack.refs.length})`
														: `Add ${pack.refs.length - inDeckCount}`}
											</button>
										</div>

										<div className="memorize-pack-refs">
											<span>
												{visibleRefs
													.map((ref) => {
														const book = getBookOrDefault(ref.bookNumber);
														return ref.verseEnd && ref.verseEnd > ref.verseStart
															? `${book.enShort} ${ref.chapter}:${ref.verseStart}–${ref.verseEnd}`
															: `${book.enShort} ${ref.chapter}:${ref.verseStart}`;
													})
													.join(" · ")}
											</span>
											{pack.refs.length > 4 && (
												<button
													type="button"
													className="memorize-pack-more-btn"
													onClick={() => setExpandedPackId(isExpanded ? null : pack.id)}
												>
													{isExpanded ? "Show less" : `+${hiddenCount} more`}
												</button>
											)}
										</div>
									</div>
								);
							})}
						</div>
					</div>
				)}
			</section>

			<section className="memorize-deck-section" aria-label="Flashcard deck">
				{cards.length > 0 && (
					<div className="memorize-deck-toolbar">
						<SegmentedControl
							value={filter}
							options={DECK_FILTER_OPTIONS}
							onChange={setFilter}
							ariaLabel="Filter cards by status"
						/>

						<div className="memorize-deck-tools-right">
							<div className="memorize-deck-search-wrap">
								<Search size={14} className="memorize-deck-search-icon" />
								<input
									type="search"
									className="memorize-deck-search"
									placeholder="Filter deck..."
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									aria-label="Filter saved flashcards"
								/>
							</div>
							<button
								type="button"
								className="home-clear-btn"
								onClick={onClearDeck}
								aria-label="Clear all flashcards"
							>
								Clear deck
							</button>
						</div>
					</div>
				)}

				{cards.length === 0 ? (
					<div className="memorize-empty-state">
						<p className="memorize-empty-title">Your memorization deck is empty.</p>
						<p className="memorize-empty-copy">
							Add a verse above, pick a Starter Pack, or tap the deck icon next to any verse in the
							Reader or Verse of the Day.
						</p>
					</div>
				) : filteredCards.length === 0 ? (
					<p className="home-favorites-empty">No flashcards match your current filter.</p>
				) : (
					<div className="memorize-cards-list">
						{filteredCards.map((card) => {
							const { refEn, refKo } = formatVerseRefBilingual(card);
							const mastery = getCardMastery(card);
							const dueLabel = formatDueStatusLabel(card, now);
							const isDue = isCardDue(card, now);
							const isEditing = editingNoteId === card.id;

							return (
								<article key={card.id} className="memorize-deck-card" data-card-id={card.id}>
									<div className="memorize-deck-card-head">
										<div className="memorize-deck-card-refs">
											<span className="memorize-deck-ref-en">{refEn}</span>
											<span className="memorize-deck-ref-ko" lang="ko">
												· {refKo}
											</span>
										</div>
										<div className="memorize-deck-badges">
											<span className={`memorize-mastery-pill mastery-${mastery}`}>{mastery}</span>
											<span className={`memorize-due-pill ${isDue ? "is-due" : ""}`.trim()}>
												{dueLabel}
											</span>
										</div>
									</div>

									{card.koPreview && (
										<p className="memorize-deck-preview" lang="ko">
											{card.koPreview}
										</p>
									)}

									{isEditing ? (
										<form
											className="memorize-note-form"
											onSubmit={(e) => {
												e.preventDefault();
												onUpdateNote(card.id, noteDraft);
												setEditingNoteId(null);
											}}
										>
											<input
												type="text"
												className="memorize-note-input"
												placeholder="Add a personal cue or theme..."
												value={noteDraft}
												onChange={(e) => setNoteDraft(e.target.value)}
												aria-label={`Edit note for ${refEn}`}
												maxLength={240}
											/>
											<button type="submit" className="votd-action-btn active">
												Save
											</button>
											<button
												type="button"
												className="votd-action-btn"
												onClick={() => setEditingNoteId(null)}
											>
												Cancel
											</button>
										</form>
									) : (
										card.note && <p className="memorize-deck-note">{card.note}</p>
									)}

									<div className="memorize-deck-card-actions">
										<button
											type="button"
											className="votd-action-btn"
											onClick={() => startSession("all", false, card.id)}
										>
											<Layers size={13} />
											<span>Study</span>
										</button>
										<button
											type="button"
											className="votd-action-btn"
											onClick={() => {
												setEditingNoteId(card.id);
												setNoteDraft(card.note ?? "");
											}}
											aria-label={`Edit note for ${refEn}`}
										>
											<Pencil size={12} />
											<span>{card.note ? "Edit Note" : "Add Note"}</span>
										</button>
										<button
											type="button"
											className="votd-action-btn"
											onClick={() => onOpenPassage(card.bookNumber, card.chapter, card.verseStart)}
											aria-label={`Open ${refEn} in Reader`}
										>
											<BookOpen size={13} />
											<span>Read</span>
										</button>
										<button
											type="button"
											className="home-favorite-remove memorize-remove-btn"
											onClick={() => onRemoveCard(card.id)}
											aria-label={`Remove ${refEn} from memorize deck`}
											title={`Remove ${refEn}`}
										>
											<X size={14} />
										</button>
									</div>
								</article>
							);
						})}
					</div>
				)}
			</section>

			<LegalFooter className="copyright-footer home-legal-footer" />
		</main>
	);
}
