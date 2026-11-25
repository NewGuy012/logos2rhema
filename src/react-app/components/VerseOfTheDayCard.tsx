import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { formatVerseRefBilingual } from "../../shared/books";
import type { LexiconMap, VerseRef } from "../../shared/types";
import {
	getNextRandomVotdIndex,
	getVerseOfTheDay,
	getVerseOfTheDayByIndex,
} from "../../shared/verse-of-the-day";
import { useBilingualPassage } from "../hooks/useBilingualPassage";
import { useKoreanSpeech } from "../hooks/useKoreanSpeech";
import { makeFavoriteId } from "../lib/favorites";
import { makeMemorizeCardId } from "../lib/memorize";
import {
	Bookmark,
	BookOpen,
	Check,
	ChevronLeft,
	ChevronRight,
	Copy,
	Layers,
	Shuffle,
	Sparkles,
	Volume2,
} from "./Icons";
import { KoreanTokensLine } from "./KoreanToken";
import type { StackOrder } from "./VerseBlock";

type VotdBrowseState = { mode: "day"; offsetDays: number } | { mode: "custom"; index: number };

interface VerseOfTheDayCardProps {
	stackOrder?: StackOrder;
	wordTooltip?: boolean;
	lexicon?: LexiconMap;
	favoriteIds?: ReadonlySet<string>;
	memorizeCardIds?: ReadonlySet<string>;
	onOpenPassage: (bookNumber: number, chapter: number, verse?: number) => void;
	onToggleFavorite?: (input: {
		bookNumber: number;
		chapter: number;
		verse: number;
		koText?: string | null;
	}) => void;
	onToggleMemorize?: (input: VerseRef & { koPreview?: string | null }) => void;
}

export function VerseOfTheDayCard({
	stackOrder = "en-first",
	wordTooltip = true,
	lexicon,
	favoriteIds,
	memorizeCardIds,
	onOpenPassage,
	onToggleFavorite,
	onToggleMemorize,
}: VerseOfTheDayCardProps) {
	const [browse, setBrowse] = useState<VotdBrowseState>({ mode: "day", offsetDays: 0 });
	const [copied, setCopied] = useState(false);
	const copyTimerRef = useRef<number | null>(null);
	const { speakingKey, speak } = useKoreanSpeech<"votd">();

	useEffect(
		() => () => {
			if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
		},
		[],
	);

	const selection = useMemo(() => {
		if (browse.mode === "day") {
			const daily = getVerseOfTheDay(new Date(), browse.offsetDays);
			return {
				ref: daily.ref,
				index: daily.index,
				subtitle: daily.displayDate,
				isToday: daily.isToday,
			};
		}
		const custom = getVerseOfTheDayByIndex(browse.index);
		return {
			ref: custom.ref,
			index: custom.index,
			subtitle: "Curated Verse",
			isToday: false,
		};
	}, [browse]);

	const { ref } = selection;
	const { refEn, refKo } = useMemo(() => formatVerseRefBilingual(ref), [ref]);
	const isMultiVerse = Boolean(ref.verseEnd && ref.verseEnd > ref.verseStart);

	const { aligned, combinedEn, combinedKo, koLoading, enLoading, koError, enError, retry } =
		useBilingualPassage({
			passageRef: ref,
			lexicon,
		});

	const cardId = makeMemorizeCardId(ref.bookNumber, ref.chapter, ref.verseStart, ref.verseEnd);
	const favId = makeFavoriteId(ref.bookNumber, ref.chapter, ref.verseStart);
	const isInDeck = Boolean(memorizeCardIds?.has(cardId));
	const isFavorited = Boolean(favoriteIds?.has(favId));

	const handlePrev = () => {
		setBrowse((prev) =>
			prev.mode === "day"
				? { mode: "day", offsetDays: prev.offsetDays - 1 }
				: { mode: "custom", index: prev.index - 1 },
		);
	};

	const handleNext = () => {
		setBrowse((prev) =>
			prev.mode === "day"
				? { mode: "day", offsetDays: prev.offsetDays + 1 }
				: { mode: "custom", index: prev.index + 1 },
		);
	};

	const handleShuffle = () => {
		setBrowse({ mode: "custom", index: getNextRandomVotdIndex(selection.index) });
	};

	const handleCopy = async () => {
		const parts = [combinedEn ? `“${combinedEn}”` : "", combinedKo, `— ${refEn} · ${refKo}`].filter(
			Boolean,
		);
		if (parts.length === 0) return;
		try {
			await navigator.clipboard?.writeText(parts.join("\n"));
			setCopied(true);
			if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
			copyTimerRef.current = window.setTimeout(() => {
				copyTimerRef.current = null;
				setCopied(false);
			}, 1800);
		} catch {}
	};

	const enNodes = aligned.filter((v) => v.enText);
	const koNodes = aligned.filter((v) => v.koText);

	const englishBlock = (
		<div key="en" className="votd-line-wrap">
			{enNodes.length > 0 ? (
				<blockquote className="home-featured-verse-quote votd-en-quote">
					“
					{enNodes.map((v, idx) => (
						<Fragment key={v.verse}>
							{idx > 0 && " "}
							{isMultiVerse && <sup className="votd-verse-num">{v.verse}</sup>}
							{v.enText}
						</Fragment>
					))}
					”
				</blockquote>
			) : enLoading ? (
				<p className="votd-status-note">Loading English (ESV)…</p>
			) : enError ? (
				<div className="votd-en-fallback">
					<span>English (ESV) unavailable</span>
					<button type="button" className="quick-inline-chip active" onClick={retry}>
						Retry
					</button>
				</div>
			) : null}
		</div>
	);

	const koreanBlock = (
		<div key="ko" className="votd-line-wrap">
			{koNodes.length > 0 ? (
				<p className="votd-ko-quote" lang="ko">
					{koNodes.map((v, idx) => (
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
				<p className="votd-status-note">Loading Korean (개역한글)…</p>
			) : koError ? (
				<p className="votd-status-note">{koError}</p>
			) : null}
		</div>
	);

	return (
		<figure className="home-featured-verse votd-card" aria-label={`Verse of the Day: ${refEn}`}>
			<div className="votd-header">
				<div className="votd-eyebrow-group">
					<span className="votd-eyebrow">
						<Sparkles size={12} />
						<span>Verse of the Day</span>
					</span>
					<span className="votd-date">{selection.subtitle}</span>
				</div>

				<div className="votd-browse-controls">
					{!selection.isToday && (
						<button
							type="button"
							className="votd-today-btn"
							onClick={() => setBrowse({ mode: "day", offsetDays: 0 })}
							title="Return to today's verse"
						>
							Today
						</button>
					)}
					<button
						type="button"
						className="votd-nav-btn"
						onClick={handlePrev}
						aria-label="Previous verse"
						title="Previous verse"
					>
						<ChevronLeft size={14} />
					</button>
					<button
						type="button"
						className="votd-nav-btn"
						onClick={handleNext}
						aria-label="Next verse"
						title="Next verse"
					>
						<ChevronRight size={14} />
					</button>
					<button
						type="button"
						className="votd-nav-btn"
						onClick={handleShuffle}
						aria-label="Shuffle verse"
						title="Show another curated verse"
					>
						<Shuffle size={13} />
					</button>
				</div>
			</div>

			<div className="votd-body">
				{stackOrder === "en-first" ? [englishBlock, koreanBlock] : [koreanBlock, englishBlock]}
			</div>

			<figcaption className="home-featured-verse-meta votd-footer">
				<span className="home-featured-verse-ref">
					<span>{refEn}</span>
					<span className="home-featured-verse-ko" lang="ko">
						· {refKo}
					</span>
				</span>

				<div className="votd-actions">
					<button
						type="button"
						className="votd-action-btn"
						onClick={() => onOpenPassage(ref.bookNumber, ref.chapter, ref.verseStart)}
						title={`Read ${refEn} in context`}
					>
						<BookOpen size={13} />
						<span>Read</span>
					</button>

					{onToggleMemorize && (
						<button
							type="button"
							className={`votd-action-btn ${isInDeck ? "active" : ""}`.trim()}
							onClick={() =>
								onToggleMemorize({
									...ref,
									koPreview: combinedKo || undefined,
								})
							}
							aria-pressed={isInDeck}
							title={isInDeck ? "Remove from Memorize deck" : "Add to Memorize deck"}
						>
							<Layers size={13} />
							<span>{isInDeck ? "In Deck" : "Memorize"}</span>
						</button>
					)}

					{onToggleFavorite && (
						<button
							type="button"
							className={`votd-action-btn votd-action-icon ${isFavorited ? "active" : ""}`.trim()}
							onClick={() =>
								onToggleFavorite({
									bookNumber: ref.bookNumber,
									chapter: ref.chapter,
									verse: ref.verseStart,
									koText: combinedKo || undefined,
								})
							}
							aria-pressed={isFavorited}
							aria-label={isFavorited ? `Remove ${refEn} from favorites` : `Bookmark ${refEn}`}
							title={isFavorited ? "Remove from favorites" : "Bookmark verse"}
						>
							<Bookmark size={13} filled={isFavorited} />
						</button>
					)}

					<button
						type="button"
						className={`votd-action-btn votd-action-icon ${speakingKey === "votd" ? "active" : ""}`.trim()}
						disabled={!combinedKo}
						onClick={() => combinedKo && speak(combinedKo, "votd")}
						aria-label="Pronounce Korean verse"
						title="Pronounce Korean verse"
					>
						<Volume2 size={13} />
					</button>

					<button
						type="button"
						className={`votd-action-btn ${copied ? "active" : ""}`.trim()}
						disabled={!combinedEn && !combinedKo}
						onClick={handleCopy}
						aria-label={copied ? "Copied verse" : "Copy verse"}
						title="Copy verse"
					>
						{copied ? <Check size={13} /> : <Copy size={13} />}
						{copied && <span>Copied</span>}
					</button>
				</div>
			</figcaption>
		</figure>
	);
}
