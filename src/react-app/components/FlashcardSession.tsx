import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatVerseRefBilingual, getBookOrDefault } from "../../shared/books";
import { CANONICAL_BIBLES } from "../../shared/translations";
import type {
	LexiconMap,
	MemorizeCard,
	MemorizeRating,
	MemorizeStudyMode,
	TranslationLanguage,
} from "../../shared/types";
import { useBilingualPassage } from "../hooks/useBilingualPassage";
import { useVerseAudio } from "../hooks/useVerseAudio";
import { loadTranslationPassage } from "../lib/bible-loader";
import type { BilingualDirection, ClozeLevel, MemorizeStudyPrefs } from "../lib/memorize";
import { buildClozeSlots, buildVerseHint } from "../lib/memorize-hints";
import { previewReviewIntervals } from "../lib/memorize-srs";
import { VerseAudioButton } from "./AudioShared";
import {
	ArrowLeft,
	ArrowRight,
	BookOpen,
	Eye,
	EyeOff,
	RefreshCw,
	RotateCcw,
	Sparkles,
} from "./Icons";
import { KoreanTokensLine } from "./KoreanToken";
import { SegmentedControl, type SegmentedOption } from "./RailShared";
import type { StackOrder } from "./VerseBlock";

interface FlashcardSessionProps {
	cards: readonly MemorizeCard[];
	initialQueueIds: readonly string[];
	studyPrefs: MemorizeStudyPrefs;
	stackOrder: StackOrder;
	wordTooltip: boolean;
	lexicon: LexiconMap;
	streakDays: number;
	onChangeStudyPrefs: (patch: Partial<MemorizeStudyPrefs>) => void;
	onReviewCard: (cardId: string, rating: MemorizeRating) => void;
	onOpenPassage: (bookNumber: number, chapter: number, verse?: number) => void;
	onCompleteSession: (reviewedCount: number) => void;
	onExit: () => void;
}

const STUDY_MODE_OPTIONS: ReadonlyArray<SegmentedOption<MemorizeStudyMode>> = [
	{ value: "flip", label: "Flip", title: "Reference to Verse" },
	{ value: "reverse", label: "Ref Quiz", title: "Verse to Reference" },
	{ value: "bilingual", label: "EN ↔ 한", title: "Bilingual Translation Bridge" },
	{ value: "cloze", label: "Blanks", title: "Progressive Fill-in-the-Blank" },
];

const LANG_MODE_OPTIONS = [
	{ value: "both", label: "Both" },
	{ value: "en", label: "EN" },
	{ value: "ko", label: "한" },
] as const;

const CLOZE_LEVEL_OPTIONS: ReadonlyArray<SegmentedOption<ClozeLevel>> = [
	{ value: 25, label: "25%" },
	{ value: 50, label: "50%" },
	{ value: 75, label: "75%" },
	{ value: "initials", label: "Initials / 초성" },
];

const BILINGUAL_DIR_OPTIONS: ReadonlyArray<SegmentedOption<BilingualDirection>> = [
	{ value: "en-to-ko", label: "EN → 한" },
	{ value: "ko-to-en", label: "한 → EN" },
];

const RATING_SPECS: ReadonlyArray<{
	rating: MemorizeRating;
	label: string;
	shortcut: string;
}> = [
	{ rating: "again", label: "Again", shortcut: "1" },
	{ rating: "hard", label: "Hard", shortcut: "2" },
	{ rating: "good", label: "Good", shortcut: "3" },
	{ rating: "easy", label: "Easy", shortcut: "4" },
];

export function FlashcardSession({
	cards,
	initialQueueIds,
	studyPrefs,
	stackOrder,
	wordTooltip,
	lexicon,
	streakDays,
	onChangeStudyPrefs,
	onReviewCard,
	onOpenPassage,
	onCompleteSession,
	onExit,
}: FlashcardSessionProps) {
	const [queueIds, setQueueIds] = useState<string[]>(() => [...initialQueueIds]);
	const [currentIndex, setCurrentIndex] = useState(0);
	const [revealed, setRevealed] = useState(false);
	const [hintShown, setHintShown] = useState(false);
	const [peekedSlots, setPeekedSlots] = useState<Set<string>>(() => new Set());
	const [completed, setCompleted] = useState(false);
	const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => new Set());
	const [ratingCounts, setRatingCounts] = useState<Record<MemorizeRating, number>>({
		again: 0,
		hard: 0,
		good: 0,
		easy: 0,
	});
	const completionReportedRef = useRef(false);

	const cardMap = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
	const currentCardId = queueIds[currentIndex];
	const currentCard = currentCardId ? (cardMap.get(currentCardId) ?? null) : null;
	const nextCardId = queueIds[currentIndex + 1];
	const nextCard = nextCardId ? (cardMap.get(nextCardId) ?? null) : null;
	const verseAudio = useVerseAudio(currentCard && !completed ? currentCard.id : "done");

	const needEn = studyPrefs.studyMode === "bilingual" || studyPrefs.langMode !== "ko";

	const { aligned, combinedEn, combinedKo, koLoading, enLoading, koError, enError, retry } =
		useBilingualPassage({
			passageRef: currentCard,
			lexicon,
			enabled: Boolean(currentCard && !completed),
			loadEn: needEn,
		});

	// Prefetch only the single immediate next card to keep ESV requests minimal.
	useEffect(() => {
		if (!nextCard || completed) return;
		const controller = new AbortController();
		loadTranslationPassage(
			CANONICAL_BIBLES.ko.id,
			nextCard.bookNumber,
			nextCard.chapter,
			nextCard.verseStart,
			nextCard.verseEnd,
			controller.signal,
		).catch(() => {});
		if (needEn) {
			loadTranslationPassage(
				CANONICAL_BIBLES.en.id,
				nextCard.bookNumber,
				nextCard.chapter,
				nextCard.verseStart,
				nextCard.verseEnd,
				controller.signal,
			).catch(() => {});
		}
		return () => controller.abort();
	}, [nextCard, completed, needEn]);

	const resetCardViewState = useCallback(() => {
		setRevealed(false);
		setHintShown(false);
		setPeekedSlots(new Set());
	}, []);

	const handleChangeStudyMode = useCallback(
		(studyMode: MemorizeStudyMode) => {
			onChangeStudyPrefs({ studyMode });
			resetCardViewState();
		},
		[onChangeStudyPrefs, resetCardViewState],
	);

	const handleRate = useCallback(
		(rating: MemorizeRating) => {
			if (!currentCard || completed) return;
			onReviewCard(currentCard.id, rating);

			const nextReviewed = new Set(reviewedIds);
			nextReviewed.add(currentCard.id);
			setReviewedIds(nextReviewed);
			setRatingCounts((prev) => ({ ...prev, [rating]: prev[rating] + 1 }));

			let nextQueue = queueIds;
			if (rating === "again") {
				const insertAt = Math.min(queueIds.length, currentIndex + 3);
				nextQueue = [...queueIds.slice(0, insertAt), currentCard.id, ...queueIds.slice(insertAt)];
				setQueueIds(nextQueue);
			}

			const nextIdx = currentIndex + 1;
			if (nextIdx >= nextQueue.length) {
				setCompleted(true);
				if (!completionReportedRef.current) {
					completionReportedRef.current = true;
					onCompleteSession(nextReviewed.size);
				}
			} else {
				setCurrentIndex(nextIdx);
				resetCardViewState();
			}
		},
		[
			currentCard,
			completed,
			onReviewCard,
			reviewedIds,
			queueIds,
			currentIndex,
			onCompleteSession,
			resetCardViewState,
		],
	);

	const handleCycleClozeOrHint = useCallback(() => {
		if (studyPrefs.studyMode === "flip") {
			setHintShown((prev) => !prev);
		} else if (studyPrefs.studyMode === "cloze") {
			const order: ClozeLevel[] = [25, 50, 75, "initials"];
			const idx = order.indexOf(studyPrefs.clozeLevel);
			const next = order[(idx + 1) % order.length];
			onChangeStudyPrefs({ clozeLevel: next });
			setPeekedSlots(new Set());
		}
	}, [studyPrefs.studyMode, studyPrefs.clozeLevel, onChangeStudyPrefs]);

	useEffect(() => {
		if (completed || !currentCard) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			const tag = target?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
				return;
			}
			if (e.key === " " || (e.key === "Enter" && tag !== "BUTTON")) {
				if (document.querySelector(".modal-panel")) return;
				e.preventDefault();
				setRevealed((prev) => !prev);
				return;
			}
			if (e.key.toLowerCase() === "h") {
				e.preventDefault();
				handleCycleClozeOrHint();
				return;
			}
			if (revealed) {
				if (e.key === "1") handleRate("again");
				else if (e.key === "2") handleRate("hard");
				else if (e.key === "3") handleRate("good");
				else if (e.key === "4") handleRate("easy");
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [completed, currentCard, revealed, handleRate, handleCycleClozeOrHint]);

	const togglePeekSlot = (slotKey: string) => {
		setPeekedSlots((prev) => {
			const next = new Set(prev);
			if (next.has(slotKey)) next.delete(slotKey);
			else next.add(slotKey);
			return next;
		});
	};

	const handleRestart = () => {
		const freshIds = initialQueueIds.filter((id) => cardMap.has(id));
		if (freshIds.length === 0) {
			onExit();
			return;
		}
		setQueueIds(freshIds);
		setCurrentIndex(0);
		setCompleted(false);
		setReviewedIds(new Set());
		setRatingCounts({ again: 0, hard: 0, good: 0, easy: 0 });
		completionReportedRef.current = false;
		resetCardViewState();
	};

	if (completed || !currentCard) {
		const totalRated =
			ratingCounts.again + ratingCounts.hard + ratingCounts.good + ratingCounts.easy;
		return (
			<section className="flashcard-stage" aria-label="Study session summary">
				<div className="flashcard-summary-card">
					<div className="flashcard-summary-badge">
						<Sparkles size={15} />
						<span>Session Complete</span>
					</div>
					<h2 className="flashcard-summary-title">
						Well done! <span lang="ko">수고하셨습니다</span>
					</h2>
					<p className="flashcard-summary-sub">
						Reviewed {reviewedIds.size} verse{reviewedIds.size === 1 ? "" : "s"} ({totalRated}{" "}
						response{totalRated === 1 ? "" : "s"})
						{streakDays > 0 ? ` · ${streakDays} day streak` : ""}
					</p>

					<div className="flashcard-summary-ratings">
						{RATING_SPECS.map((spec) => (
							<div key={spec.rating} className="flashcard-summary-stat">
								<span className="flashcard-summary-stat-val">{ratingCounts[spec.rating]}</span>
								<span className="flashcard-summary-stat-label">{spec.label}</span>
							</div>
						))}
					</div>

					<div className="flashcard-summary-actions">
						<button type="button" className="home-memorize-btn" onClick={handleRestart}>
							<RotateCcw size={14} />
							<span>Practice Again</span>
						</button>
						<button type="button" className="home-continue-btn" onClick={onExit}>
							<span>Back to Deck</span>
							<ArrowRight size={14} />
						</button>
					</div>
				</div>
			</section>
		);
	}

	const { refEn, refKo } = formatVerseRefBilingual(currentCard);
	const currentBook = getBookOrDefault(currentCard.bookNumber);
	const isMultiVerse = Boolean(
		currentCard.verseEnd && currentCard.verseEnd > currentCard.verseStart,
	);
	const intervals = previewReviewIntervals(currentCard);
	const hints = buildVerseHint(combinedEn, combinedKo);
	const progressPct = Math.round(((currentIndex + (revealed ? 1 : 0)) / queueIds.length) * 100);

	const showEn =
		studyPrefs.studyMode === "bilingual"
			? studyPrefs.bilingualDir === "en-to-ko" || revealed
			: studyPrefs.langMode !== "ko";
	const showKo =
		studyPrefs.studyMode === "bilingual"
			? studyPrefs.bilingualDir === "ko-to-en" || revealed
			: studyPrefs.langMode !== "en";

	const renderVerseLine = (lang: TranslationLanguage, clozeMask: boolean) => {
		if (lang === "en") {
			const enVerses = aligned.filter((v) => v.enText);
			if (enVerses.length === 0) {
				if (enLoading) return <p className="flashcard-status">Loading English (ESV)…</p>;
				if (enError) {
					return (
						<div className="votd-en-fallback">
							<span>English (ESV) unavailable</span>
							<button type="button" className="quick-inline-chip active" onClick={retry}>
								Retry
							</button>
						</div>
					);
				}
				return null;
			}
			return (
				<p key="en" className="flashcard-verse-en">
					{enVerses.map((v, idx) => (
						<Fragment key={v.verse}>
							{idx > 0 && " "}
							{isMultiVerse && <sup className="votd-verse-num">{v.verse}</sup>}
							{clozeMask
								? buildClozeSlots(
										v.enText ?? "",
										"en",
										studyPrefs.clozeLevel,
										`${currentCard.id}:en:${v.verse}`,
									).map((slot, slotIdx) => {
										const key = `en:${v.verse}:${slot.index}`;
										const isPeeked = peekedSlots.has(key);
										return (
											<Fragment key={key}>
												{slotIdx > 0 && " "}
												{slot.leadPunct}
												{slot.isHidden ? (
													<button
														type="button"
														className={`cloze-blank-btn ${isPeeked ? "peeked" : ""}`.trim()}
														onClick={() => togglePeekSlot(key)}
														title={isPeeked ? "Hide word" : "Peek word"}
													>
														{isPeeked ? slot.word : slot.maskedText}
													</button>
												) : (
													slot.word
												)}
												{slot.trailPunct}
											</Fragment>
										);
									})
								: v.enText}
						</Fragment>
					))}
				</p>
			);
		}

		const koVerses = aligned.filter((v) => v.koText);
		if (koVerses.length === 0) {
			if (koLoading) return <p className="flashcard-status">Loading Korean (개역한글)…</p>;
			if (koError) return <p className="flashcard-status">{koError}</p>;
			return currentCard.koPreview ? (
				<p className="flashcard-verse-ko" lang="ko">
					{currentCard.koPreview}
				</p>
			) : null;
		}
		return (
			<p key="ko" className="flashcard-verse-ko" lang="ko">
				{koVerses.map((v, idx) => (
					<Fragment key={v.verse}>
						{idx > 0 && " "}
						{isMultiVerse && <sup className="votd-verse-num">{v.verse}</sup>}
						{clozeMask ? (
							buildClozeSlots(
								v.koText ?? "",
								"ko",
								studyPrefs.clozeLevel,
								`${currentCard.id}:ko:${v.verse}`,
							).map((slot, slotIdx) => {
								const key = `ko:${v.verse}:${slot.index}`;
								const isPeeked = peekedSlots.has(key);
								return (
									<Fragment key={key}>
										{slotIdx > 0 && " "}
										{slot.leadPunct}
										{slot.isHidden ? (
											<button
												type="button"
												className={`cloze-blank-btn ${isPeeked ? "peeked" : ""}`.trim()}
												onClick={() => togglePeekSlot(key)}
												title={isPeeked ? "Hide word" : "Peek word"}
											>
												{isPeeked ? slot.word : slot.maskedText}
											</button>
										) : (
											slot.word
										)}
										{slot.trailPunct}
									</Fragment>
								);
							})
						) : v.tokens.length > 0 ? (
							<KoreanTokensLine verseNumber={v.verse} tokens={v.tokens} wordTooltip={wordTooltip} />
						) : (
							v.koText
						)}
					</Fragment>
				))}
			</p>
		);
	};

	const renderStackedLines = (clozeMask: boolean) => {
		const enNode = showEn ? renderVerseLine("en", clozeMask) : null;
		const koNode = showKo ? renderVerseLine("ko", clozeMask) : null;
		if (studyPrefs.studyMode === "bilingual" && !revealed) {
			return studyPrefs.bilingualDir === "en-to-ko" ? enNode : koNode;
		}
		return (
			<div className="flashcard-verse-stack">
				{stackOrder === "en-first" ? (
					<>
						{enNode}
						{koNode}
					</>
				) : (
					<>
						{koNode}
						{enNode}
					</>
				)}
			</div>
		);
	};

	const showReferenceFront = studyPrefs.studyMode === "flip";
	const showClozePrompt = studyPrefs.studyMode === "cloze" && !revealed;

	return (
		<section className="flashcard-stage" aria-label="Flashcard study session">
			<div className="flashcard-topbar">
				<button type="button" className="icon-btn flashcard-back-btn" onClick={onExit}>
					<ArrowLeft size={15} />
					<span>Back to Deck</span>
				</button>

				<div className="flashcard-progress-wrap">
					<span className="flashcard-progress-text">
						{currentIndex + 1} / {queueIds.length}
					</span>
					<div className="flashcard-progress-track" aria-hidden="true">
						<div className="flashcard-progress-fill" style={{ width: `${progressPct}%` }} />
					</div>
				</div>
			</div>

			<div className="flashcard-controls-bar">
				<SegmentedControl
					value={studyPrefs.studyMode}
					options={STUDY_MODE_OPTIONS}
					onChange={handleChangeStudyMode}
					ariaLabel="Study mode"
					className="flashcard-mode-toggle"
				/>

				{studyPrefs.studyMode === "bilingual" ? (
					<SegmentedControl
						value={studyPrefs.bilingualDir}
						options={BILINGUAL_DIR_OPTIONS}
						onChange={(bilingualDir) => {
							onChangeStudyPrefs({ bilingualDir });
							resetCardViewState();
						}}
						ariaLabel="Translation direction"
						className="flashcard-lang-toggle"
					/>
				) : (
					<SegmentedControl
						value={studyPrefs.langMode}
						options={LANG_MODE_OPTIONS}
						onChange={(langMode) => onChangeStudyPrefs({ langMode })}
						ariaLabel="Card language filter"
						className="flashcard-lang-toggle"
					/>
				)}

				{studyPrefs.studyMode === "cloze" && (
					<SegmentedControl
						value={studyPrefs.clozeLevel}
						options={CLOZE_LEVEL_OPTIONS}
						onChange={(clozeLevel) => {
							onChangeStudyPrefs({ clozeLevel });
							setPeekedSlots(new Set());
						}}
						ariaLabel="Blank difficulty"
						className="flashcard-cloze-toggle"
					/>
				)}
			</div>

			<article
				className={`flashcard-card ${revealed ? "is-revealed" : ""}`.trim()}
				aria-label={`Flashcard ${refEn}`}
			>
				<div className="flashcard-card-head">
					<span className="flashcard-book-kicker">
						{currentBook.testament === "OT" ? "Old Testament" : "New Testament"} ·{" "}
						{currentCard.repetitions === 0 ? "New" : `${currentCard.intervalDays}d interval`}
					</span>
					<div className="flashcard-card-head-actions">
						{(showKo || revealed) && (
							<VerseAudioButton
								isPlaying={verseAudio.isPlaying}
								isLoading={verseAudio.isLoading}
								isSupertonic={verseAudio.source === "supertonic"}
								onToggle={() =>
									verseAudio.togglePlay({
										usfm: currentBook.usfm,
										chapter: currentCard.chapter,
										verseStart: currentCard.verseStart,
										verseEnd: currentCard.verseEnd,
										fallbackKoText: combinedKo,
									})
								}
							/>
						)}
						<button
							type="button"
							className="votd-action-btn"
							onClick={() =>
								onOpenPassage(currentCard.bookNumber, currentCard.chapter, currentCard.verseStart)
							}
							title={`Open ${refEn} in Reader`}
						>
							<BookOpen size={13} />
							<span>Read</span>
						</button>
					</div>
				</div>

				<div className="flashcard-card-body">
					{showReferenceFront ? (
						<div className="flashcard-prompt-ref">
							<h2 className="flashcard-ref-en">{refEn}</h2>
							<p className="flashcard-ref-ko" lang="ko">
								{refKo}
							</p>
							{currentCard.note && <p className="flashcard-card-note">{currentCard.note}</p>}

							{!revealed && (
								<div className="flashcard-hint-wrap">
									<button
										type="button"
										className="votd-action-btn"
										onClick={() => setHintShown((prev) => !prev)}
									>
										{hintShown ? <EyeOff size={13} /> : <Eye size={13} />}
										<span>{hintShown ? "Hide Hint" : "Peek Hint"}</span>
									</button>
									{hintShown && (
										<div className="flashcard-hint-box">
											{(showEn && hints.enHint) || (showKo && hints.koHint) ? (
												<>
													{showEn && hints.enHint && (
														<p className="flashcard-hint-en">{hints.enHint}</p>
													)}
													{showKo && hints.koHint && (
														<p className="flashcard-hint-ko" lang="ko">
															{hints.koHint}
														</p>
													)}
												</>
											) : (
												<p className="flashcard-status">
													{koLoading || enLoading ? "Loading hint…" : "Hint unavailable."}
												</p>
											)}
										</div>
									)}
								</div>
							)}
						</div>
					) : (
						<div className="flashcard-prompt-verse">
							{studyPrefs.studyMode === "reverse" && !revealed && (
								<p className="flashcard-prompt-label">Recall the book, chapter, and verse:</p>
							)}
							{studyPrefs.studyMode === "bilingual" && (
								<p className="flashcard-prompt-label">
									{studyPrefs.bilingualDir === "en-to-ko"
										? "Translate / recall the Korean (개역한글):"
										: "Translate / recall the English (ESV):"}
								</p>
							)}
							{showClozePrompt && (
								<div className="flashcard-cloze-header">
									<span className="flashcard-cloze-ref">
										{refEn} · <span lang="ko">{refKo}</span>
									</span>
									<span className="flashcard-cloze-tip">Tap any blank to peek one word</span>
								</div>
							)}
							{renderStackedLines(showClozePrompt)}
						</div>
					)}

					{revealed && (
						<div className="flashcard-answer-panel">
							{showReferenceFront ? (
								renderStackedLines(false)
							) : (
								<div className="flashcard-revealed-ref">
									<strong>{refEn}</strong>
									<span lang="ko"> · {refKo}</span>
									{currentCard.note && <p className="flashcard-card-note">{currentCard.note}</p>}
								</div>
							)}
						</div>
					)}
				</div>

				<div className="flashcard-card-footer">
					{!revealed ? (
						<button
							type="button"
							className="flashcard-reveal-btn"
							onClick={() => setRevealed(true)}
						>
							<Eye size={15} />
							<span>{showClozePrompt ? "Reveal All" : "Show Answer"}</span>
							<kbd className="flashcard-kbd">Space</kbd>
						</button>
					) : (
						<div className="flashcard-rating-grid" role="group" aria-label="Grade recall">
							{RATING_SPECS.map((spec) => (
								<button
									key={spec.rating}
									type="button"
									className={`flashcard-rate-btn rate-${spec.rating}`}
									onClick={() => handleRate(spec.rating)}
								>
									<span className="flashcard-rate-head">
										<span className="flashcard-rate-label">{spec.label}</span>
										<kbd className="flashcard-kbd">{spec.shortcut}</kbd>
									</span>
									<span className="flashcard-rate-interval">{intervals[spec.rating]}</span>
								</button>
							))}
						</div>
					)}
				</div>
			</article>

			<div className="flashcard-shortcuts-note">
				<span>
					Shortcuts: <kbd>Space</kbd> flip · <kbd>H</kbd> hint/difficulty · <kbd>1–4</kbd> rate
				</span>
				{revealed && (
					<button type="button" className="flashcard-hide-again-btn" onClick={resetCardViewState}>
						<RefreshCw size={11} />
						<span>Hide Answer</span>
					</button>
				)}
			</div>
		</section>
	);
}
