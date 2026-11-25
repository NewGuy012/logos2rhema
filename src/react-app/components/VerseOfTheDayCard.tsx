import { Fragment, useMemo, useState } from "react";

import { formatVerseRefBilingual } from "../../shared/books";
import type { LexiconMap } from "../../shared/types";
import { getVerseOfTheDay } from "../../shared/verse-of-the-day";
import { useBilingualPassage } from "../hooks/useBilingualPassage";
import { ChevronLeft, ChevronRight, Sparkles } from "./Icons";
import { KoreanTokensLine } from "./KoreanToken";
import type { StackOrder } from "./VerseBlock";

interface VerseOfTheDayCardProps {
	stackOrder?: StackOrder;
	wordTooltip?: boolean;
	lexicon?: LexiconMap;
	onOpenPassage: (bookNumber: number, chapter: number, verse?: number) => void;
}

export function VerseOfTheDayCard({
	stackOrder = "en-first",
	wordTooltip = true,
	lexicon,
	onOpenPassage,
}: VerseOfTheDayCardProps) {
	const [offsetDays, setOffsetDays] = useState(0);

	const daily = useMemo(() => getVerseOfTheDay(new Date(), offsetDays), [offsetDays]);
	const { ref } = daily;
	const { refEn, refKo } = useMemo(() => formatVerseRefBilingual(ref), [ref]);
	const isMultiVerse = Boolean(ref.verseEnd && ref.verseEnd > ref.verseStart);

	const { aligned, koLoading, enLoading, koError, enError, retry } = useBilingualPassage({
		passageRef: ref,
		lexicon,
	});

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
					<span className="votd-date">{daily.displayDate}</span>
				</div>

				<div className="votd-browse-controls">
					{!daily.isToday && (
						<button
							type="button"
							className="votd-today-btn"
							onClick={() => setOffsetDays(0)}
							title="Return to today's verse"
						>
							Today
						</button>
					)}
					<button
						type="button"
						className="votd-nav-btn"
						onClick={() => setOffsetDays((prev) => prev - 1)}
						aria-label="Previous verse"
						title="Previous verse"
					>
						<ChevronLeft size={14} />
					</button>
					<button
						type="button"
						className="votd-nav-btn"
						onClick={() => setOffsetDays((prev) => prev + 1)}
						aria-label="Next verse"
						title="Next verse"
					>
						<ChevronRight size={14} />
					</button>
				</div>
			</div>

			<div className="votd-body">
				{stackOrder === "en-first" ? [englishBlock, koreanBlock] : [koreanBlock, englishBlock]}
			</div>

			<figcaption className="home-featured-verse-meta votd-footer">
				<button
					type="button"
					className="home-featured-verse-ref votd-ref-link"
					onClick={() => onOpenPassage(ref.bookNumber, ref.chapter, ref.verseStart)}
					title={`Read ${refEn} in context`}
				>
					<span>{refEn}</span>
					<span className="home-featured-verse-ko" lang="ko">
						· {refKo}
					</span>
				</button>
			</figcaption>
		</figure>
	);
}
