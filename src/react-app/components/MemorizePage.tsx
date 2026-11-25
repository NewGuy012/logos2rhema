import { type FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";

import {
	formatVerseRefBilingual,
	getBookOrDefault,
	parseVerseRangeReference,
} from "../../shared/books";
import { MEMORIZE_STARTER_PACKS, type MemorizeStarterPack } from "../../shared/memorize-packs";
import { CANONICAL_BIBLES } from "../../shared/translations";
import type { FavoriteItem, LexiconMap, MemorizeCard, VerseRef } from "../../shared/types";
import { useBilingualPassage } from "../hooks/useBilingualPassage";
import {
	getVerseAudioTargetKey,
	useVerseAudio,
	type VerseAudioSource,
	type VerseAudioTarget,
} from "../hooks/useVerseAudio";
import { loadTranslationPassage } from "../lib/bible-loader";
import { makeMemorizeCardId } from "../lib/memorize";
import { VerseAudioButton } from "./AudioShared";
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Sparkles, X } from "./Icons";
import { KoreanTokensLine } from "./KoreanToken";
import { LegalFooter } from "./LegalFooter";
import { SegmentedControl, type SegmentedOption } from "./RailShared";
import type { StackOrder } from "./VerseBlock";

type MemorizeViewMode = "all" | "flashcard";

const VIEW_MODE_OPTIONS: ReadonlyArray<SegmentedOption<MemorizeViewMode>> = [
	{ value: "all", label: "All" },
	{ value: "flashcard", label: "Flashcard" },
];

interface MemorizePageProps {
	cards: readonly MemorizeCard[];
	favorites: readonly FavoriteItem[];
	stackOrder: StackOrder;
	wordTooltip: boolean;
	lexicon: LexiconMap;
	onAddCard: (input: VerseRef) => {
		added: boolean;
		card: MemorizeCard | null;
	};
	onRemoveCard: (id: string) => void;
	onAddStarterPack: (pack: MemorizeStarterPack) => number;
	onImportBookmarks: () => number;
	onClearDeck: () => void;
}

function MemorizeVerseItem({
	card,
	stackOrder,
	wordTooltip,
	lexicon,
	activeAudioKey,
	isAudioPlaying,
	isAudioLoading,
	audioSource,
	onToggleAudio,
	onRemove,
}: {
	card: MemorizeCard;
	stackOrder: StackOrder;
	wordTooltip: boolean;
	lexicon: LexiconMap;
	activeAudioKey: string | null;
	isAudioPlaying: boolean;
	isAudioLoading: boolean;
	audioSource: VerseAudioSource;
	onToggleAudio: (target: VerseAudioTarget) => void;
	onRemove: (id: string) => void;
}) {
	const book = getBookOrDefault(card.bookNumber);
	const { refEn, refKo } = formatVerseRefBilingual(card);
	const isMultiVerse = Boolean(card.verseEnd && card.verseEnd > card.verseStart);
	const audioKey = getVerseAudioTargetKey({
		usfm: book.usfm,
		chapter: card.chapter,
		verseStart: card.verseStart,
		verseEnd: card.verseEnd,
	});
	const isThisAudio = activeAudioKey === audioKey;

	const itemRef = useRef<HTMLElement | null>(null);
	const [shouldLoadEn, setShouldLoadEn] = useState(
		() => typeof IntersectionObserver === "undefined",
	);

	useEffect(() => {
		if (shouldLoadEn) return;
		const el = itemRef.current;
		if (!el || typeof IntersectionObserver === "undefined") {
			setShouldLoadEn(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setShouldLoadEn(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "300px 0px" },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [shouldLoadEn]);

	const { aligned, combinedKo, koLoading, enLoading, koError, enError, retry } =
		useBilingualPassage({
			passageRef: card,
			lexicon,
			loadEn: shouldLoadEn,
		});

	const enVerses = aligned.filter((v) => v.enText);
	const koVerses = aligned.filter((v) => v.koText);

	const englishLine = (
		<div key="en" className="memorize-verse-line">
			{enVerses.length > 0 ? (
				<p className="memorize-verse-en">
					{enVerses.map((v, idx) => (
						<Fragment key={v.verse}>
							{idx > 0 && " "}
							{isMultiVerse && <sup className="votd-verse-num">{v.verse}</sup>}
							{v.enText}
						</Fragment>
					))}
				</p>
			) : enError ? (
				<div className="votd-en-fallback">
					<span>English (ESV) unavailable</span>
					<button type="button" className="quick-inline-chip active" onClick={retry}>
						Retry
					</button>
				</div>
			) : enLoading || !shouldLoadEn ? (
				<p className="memorize-verse-status">Loading English (ESV)…</p>
			) : null}
		</div>
	);

	const koreanLine = (
		<div key="ko" className="memorize-verse-line">
			{koVerses.length > 0 ? (
				<p className="memorize-verse-ko" lang="ko">
					{koVerses.map((v, idx) => (
						<Fragment key={v.verse}>
							{idx > 0 && " "}
							{isMultiVerse && <sup className="votd-verse-num">{v.verse}</sup>}
							{v.tokens.length > 0 ? (
								<KoreanTokensLine
									verseNumber={v.verse}
									tokens={v.tokens}
									wordTooltip={wordTooltip}
								/>
							) : (
								v.koText
							)}
						</Fragment>
					))}
				</p>
			) : koLoading ? (
				<p className="memorize-verse-status">Loading Korean (개역한글)…</p>
			) : koError ? (
				<p className="memorize-verse-status">{koError}</p>
			) : null}
		</div>
	);

	return (
		<article ref={itemRef} className="memorize-verse-item" data-card-id={card.id}>
			<div className="memorize-verse-head">
				<h2 className="memorize-verse-ref">
					<span>{refEn}</span>
					<span className="memorize-verse-ref-ko" lang="ko">
						· {refKo}
					</span>
				</h2>
				<div className="memorize-verse-actions">
					<VerseAudioButton
						isPlaying={isThisAudio && isAudioPlaying}
						isLoading={isThisAudio && isAudioLoading}
						isSupertonic={isThisAudio && audioSource === "supertonic"}
						onToggle={() =>
							onToggleAudio({
								usfm: book.usfm,
								chapter: card.chapter,
								verseStart: card.verseStart,
								verseEnd: card.verseEnd,
								fallbackKoText: combinedKo,
							})
						}
					/>
					<button
						type="button"
						className="home-favorite-remove memorize-remove-btn"
						onClick={() => onRemove(card.id)}
						aria-label={`Remove ${refEn}`}
						title={`Remove ${refEn}`}
					>
						<X size={14} />
					</button>
				</div>
			</div>

			<div className="memorize-verse-body">
				{stackOrder === "en-first" ? [englishLine, koreanLine] : [koreanLine, englishLine]}
			</div>
		</article>
	);
}

export function MemorizePage({
	cards,
	favorites,
	stackOrder,
	wordTooltip,
	lexicon,
	onAddCard,
	onRemoveCard,
	onAddStarterPack,
	onImportBookmarks,
	onClearDeck,
}: MemorizePageProps) {
	const [addQuery, setAddQuery] = useState("");
	const [addingVerse, setAddingVerse] = useState(false);
	const [packsOpen, setPacksOpen] = useState(false);
	const [viewMode, setViewMode] = useState<MemorizeViewMode>("all");
	const [activeIndex, setActiveIndex] = useState(0);
	const [statusMessage, setStatusMessage] = useState<{
		kind: "ok" | "error";
		text: string;
	} | null>(null);
	const mountedRef = useRef(true);
	const verseAudio = useVerseAudio();
	const { activeTargetKey, stop: stopAudio } = verseAudio;

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const cardIds = useMemo(() => new Set(cards.map((c) => c.id)), [cards]);
	const safeIndex = cards.length === 0 ? 0 : Math.min(activeIndex, cards.length - 1);
	const activeCard = viewMode === "flashcard" ? (cards[safeIndex] ?? null) : null;

	useEffect(() => {
		if (safeIndex !== activeIndex) {
			setActiveIndex(safeIndex);
		}
	}, [safeIndex, activeIndex]);

	// Stop audio if the playing verse is removed, cleared, or paged away in flashcard mode.
	useEffect(() => {
		if (!activeTargetKey) return;
		const visibleCards = viewMode === "flashcard" ? (activeCard ? [activeCard] : []) : cards;
		const stillVisible = visibleCards.some((card) => {
			const book = getBookOrDefault(card.bookNumber);
			return (
				getVerseAudioTargetKey({
					usfm: book.usfm,
					chapter: card.chapter,
					verseStart: card.verseStart,
					verseEnd: card.verseEnd,
				}) === activeTargetKey
			);
		});
		if (!stillVisible) {
			stopAudio();
		}
	}, [cards, viewMode, activeCard, activeTargetKey, stopAudio]);

	useEffect(() => {
		if (viewMode !== "flashcard" || cards.length <= 1) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			const tag = target?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
				return;
			}
			if (document.querySelector(".modal-panel")) return;
			if (e.key === "ArrowLeft") {
				e.preventDefault();
				setActiveIndex((prev) => (prev - 1 + cards.length) % cards.length);
			} else if (e.key === "ArrowRight") {
				e.preventDefault();
				setActiveIndex((prev) => (prev + 1) % cards.length);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [viewMode, cards.length]);

	const importableBookmarksCount = useMemo(() => {
		let count = 0;
		for (const fav of favorites) {
			if (fav.verse === undefined) continue;
			const id = makeMemorizeCardId(fav.bookNumber, fav.chapter, fav.verse);
			if (!cardIds.has(id)) count++;
		}
		return count;
	}, [favorites, cardIds]);

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
			const res = onAddCard(parsed);
			if (res.added) setActiveIndex(0);
			setAddQuery("");
			setStatusMessage({
				kind: "ok",
				text: res.added ? `Added ${refEn}.` : `${refEn} is already saved.`,
			});
		} catch {
			if (!mountedRef.current) return;
			const res = onAddCard(parsed);
			if (res.added) setActiveIndex(0);
			setAddQuery("");
			setStatusMessage({
				kind: "ok",
				text: res.added ? `Added ${refEn}.` : `${refEn} is already saved.`,
			});
		} finally {
			if (mountedRef.current) setAddingVerse(false);
		}
	};

	const handleAddPack = (pack: MemorizeStarterPack) => {
		const addedCount = onAddStarterPack(pack);
		if (addedCount > 0) setActiveIndex(0);
		setStatusMessage({
			kind: "ok",
			text:
				addedCount > 0
					? `Added ${addedCount} verse${addedCount === 1 ? "" : "s"} from ${pack.titleEn}.`
					: `All verses from ${pack.titleEn} are already saved.`,
		});
	};

	const handlePrevVerse = () => {
		if (cards.length <= 1) return;
		setActiveIndex((safeIndex - 1 + cards.length) % cards.length);
	};

	const handleNextVerse = () => {
		if (cards.length <= 1) return;
		setActiveIndex((safeIndex + 1) % cards.length);
	};

	return (
		<main className="memorize-container">
			<header className="memorize-header">
				<h1 className="memorize-title">Scripture Memorization</h1>

				{cards.length > 0 && (
					<div className="memorize-header-controls">
						<span className="memorize-count">
							{cards.length} {cards.length === 1 ? "verse" : "verses"}
						</span>
						<SegmentedControl
							value={viewMode}
							options={VIEW_MODE_OPTIONS}
							onChange={setViewMode}
							ariaLabel="Memorize view mode"
							className="memorize-view-toggle"
						/>
					</div>
				)}
			</header>

			<section className="memorize-add-section" aria-label="Add verses to memorize">
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
						{addingVerse ? "Adding..." : "Add"}
					</button>
				</form>

				<div className="memorize-quick-actions">
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
									if (addedCount > 0) setActiveIndex(0);
									setStatusMessage({
										kind: "ok",
										text: `Imported ${addedCount} bookmarked verse${addedCount === 1 ? "" : "s"}.`,
									});
								}}
							>
								<Plus size={13} />
								<span>Import {importableBookmarksCount} from Bookmarks</span>
							</button>
						)}
					</div>

					{cards.length > 0 && (
						<button
							type="button"
							className="home-clear-btn memorize-clear-btn"
							onClick={() => {
								onClearDeck();
								setStatusMessage(null);
							}}
							aria-label="Clear all saved verses"
						>
							Clear all
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
						<div className="memorize-packs-list">
							{MEMORIZE_STARTER_PACKS.map((pack) => {
								const inDeckCount = pack.refs.filter((ref) =>
									cardIds.has(
										makeMemorizeCardId(ref.bookNumber, ref.chapter, ref.verseStart, ref.verseEnd),
									),
								).length;
								const allAdded = inDeckCount === pack.refs.length;
								const remaining = pack.refs.length - inDeckCount;

								return (
									<div key={pack.id} className="memorize-pack-row">
										<div className="memorize-pack-info">
											<span className="memorize-pack-title">
												{pack.titleEn}{" "}
												<span className="memorize-pack-ko" lang="ko">
													· {pack.titleKo}
												</span>
											</span>
											<span className="memorize-pack-count">
												{inDeckCount > 0 && !allAdded
													? `${inDeckCount}/${pack.refs.length} saved`
													: `${pack.refs.length} verses`}
											</span>
										</div>
										<button
											type="button"
											className={`votd-action-btn ${allAdded ? "active" : ""}`.trim()}
											disabled={allAdded}
											onClick={() => handleAddPack(pack)}
											aria-label={
												allAdded
													? `${pack.titleEn} already added`
													: `Add ${pack.titleEn} pack (${remaining} verses)`
											}
										>
											{allAdded ? "Added" : `Add ${remaining}`}
										</button>
									</div>
								);
							})}
						</div>
					</div>
				)}
			</section>

			<section className="memorize-verses-section" aria-label="Saved verses">
				{cards.length === 0 ? (
					<div className="memorize-empty-state">
						<p className="memorize-empty-title">No verses saved yet.</p>
						<p className="memorize-empty-copy">
							Add a verse above, pick from Starter Packs, or tap the save icon next to any verse in
							the Reader.
						</p>
					</div>
				) : viewMode === "flashcard" && activeCard ? (
					<div className="memorize-flashcard-stage">
						<div className="memorize-flashcard-card">
							<MemorizeVerseItem
								key={activeCard.id}
								card={activeCard}
								stackOrder={stackOrder}
								wordTooltip={wordTooltip}
								lexicon={lexicon}
								activeAudioKey={verseAudio.activeTargetKey}
								isAudioPlaying={verseAudio.isPlaying}
								isAudioLoading={verseAudio.isLoading}
								audioSource={verseAudio.source}
								onToggleAudio={verseAudio.togglePlay}
								onRemove={onRemoveCard}
							/>

							<nav className="memorize-flashcard-nav" aria-label="Flashcard verse navigation">
								<button
									type="button"
									className="nav-chapter-btn nav-chapter-btn-compact"
									disabled={cards.length <= 1}
									onClick={handlePrevVerse}
								>
									<ChevronLeft size={15} />
									<span>Previous</span>
								</button>

								<span className="memorize-flashcard-counter">
									{safeIndex + 1} / {cards.length}
								</span>

								<button
									type="button"
									className="nav-chapter-btn nav-chapter-btn-compact"
									disabled={cards.length <= 1}
									onClick={handleNextVerse}
								>
									<span>Next</span>
									<ChevronRight size={15} />
								</button>
							</nav>
						</div>
					</div>
				) : (
					<div className="memorize-verses-list">
						{cards.map((card) => (
							<MemorizeVerseItem
								key={card.id}
								card={card}
								stackOrder={stackOrder}
								wordTooltip={wordTooltip}
								lexicon={lexicon}
								activeAudioKey={verseAudio.activeTargetKey}
								isAudioPlaying={verseAudio.isPlaying}
								isAudioLoading={verseAudio.isLoading}
								audioSource={verseAudio.source}
								onToggleAudio={verseAudio.togglePlay}
								onRemove={onRemoveCard}
							/>
						))}
					</div>
				)}
			</section>

			<LegalFooter className="copyright-footer home-legal-footer" />
		</main>
	);
}
