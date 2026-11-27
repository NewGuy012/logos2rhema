import { useMemo, useState } from "react";

import { formatVerseRefBilingual } from "../../shared/books";
import type { LexiconMap } from "../../shared/types";
import { getVerseOfTheDay } from "../../shared/verse-of-the-day";
import { useBilingualPassage } from "../hooks/useBilingualPassage";
import { ChevronLeft, ChevronRight, Sparkles } from "./Icons";
import { BilingualPassageLines, type StackOrder, type StudyMaskMode } from "./VerseBlock";

interface VerseOfTheDayCardProps {
	stackOrder?: StackOrder;
	studyMask?: StudyMaskMode;
	wordTooltip?: boolean;
	lexicon?: LexiconMap;
	onOpenPassage: (bookNumber: number, chapter: number, verse?: number) => void;
}

export function VerseOfTheDayCard({
	stackOrder = "en-first",
	studyMask = "none",
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
				<BilingualPassageLines
					aligned={aligned}
					isMultiVerse={isMultiVerse}
					stackOrder={stackOrder}
					studyMask={studyMask}
					wordTooltip={wordTooltip}
					koLoading={koLoading}
					enLoading={enLoading}
					koError={koError}
					enError={enError}
					onRetry={retry}
					wrapClassName="votd-line-wrap"
					enClassName="home-featured-verse-quote votd-en-quote"
					koClassName="votd-ko-quote"
					statusClassName="votd-status-note"
					quoteEn={true}
				/>
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
