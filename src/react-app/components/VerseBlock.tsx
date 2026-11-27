import { Fragment, memo, type MouseEvent } from "react";

import { CANONICAL_BIBLES } from "../../shared/translations";
import type { AlignedVerse, HighlightItem } from "../../shared/types";
import { renderHighlightedText } from "./HighlightText";
import { Bookmark, Layers } from "./Icons";
import { KoreanTokensLine } from "./KoreanToken";

export type StackOrder = "en-first" | "ko-first";
export type StudyMaskMode = "none" | "mask-en" | "mask-ko";

const INTERACTIVE_DESCENDANT_SELECTOR = "button, a, input, select, textarea, [role='button']";

function hasTextSelectionIn(container: HTMLElement): boolean {
	const selection = typeof window !== "undefined" ? window.getSelection() : null;
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
	if (!selection.toString().trim()) return false;
	for (let i = 0; i < selection.rangeCount; i++) {
		const range = selection.getRangeAt(i);
		if (typeof range.intersectsNode === "function") {
			if (range.intersectsNode(container)) return true;
		} else if (container.contains(range.startContainer) || container.contains(range.endContainer)) {
			return true;
		}
	}
	return false;
}

interface VerseBlockProps {
	verse: AlignedVerse;
	stackOrder: StackOrder;
	studyMask: StudyMaskMode;
	isSelected: boolean;
	isAudioActive: boolean;
	isFavorited?: boolean;
	isInMemorize?: boolean;
	enHighlights?: readonly HighlightItem[];
	koHighlights?: readonly HighlightItem[];
	enUnavailable?: boolean;
	hasVerseTimestamps: boolean;
	wordTooltip?: boolean;
	onSelectVerse: (verseNum: number) => void;
	onToggleFavorite?: (verse: AlignedVerse) => void;
	onToggleMemorize?: (verse: AlignedVerse) => void;
	onSelectFootnote: (footnoteId: string) => void;
}

export const VerseBlock = memo(function VerseBlock({
	verse,
	stackOrder,
	studyMask,
	isSelected,
	isAudioActive,
	isFavorited = false,
	isInMemorize = false,
	enHighlights = [],
	koHighlights = [],
	enUnavailable = false,
	hasVerseTimestamps,
	wordTooltip = true,
	onSelectVerse,
	onToggleFavorite,
	onToggleMemorize,
	onSelectFootnote,
}: VerseBlockProps) {
	const englishLine =
		enUnavailable && verse.enText === null ? null : (
			<p
				key="en"
				data-verse={verse.enText !== null ? verse.verse : undefined}
				data-lang={verse.enText !== null ? "en" : undefined}
				className={`verse-en ${stackOrder === "en-first" ? "verse-line-primary" : "verse-line-secondary"} ${studyMask === "mask-en" ? "study-masked" : ""}`}
			>
				{verse.enText !== null ? (
					renderHighlightedText(verse.enText, 0, enHighlights)
				) : (
					<span className="verse-omitted">
						[Verse omitted in {CANONICAL_BIBLES.en.code} manuscripts]
					</span>
				)}
			</p>
		);

	const koreanLine = (
		<p
			key="ko"
			lang="ko"
			data-verse={verse.koText !== null ? verse.verse : undefined}
			data-lang={verse.koText !== null ? "ko" : undefined}
			className={`verse-ko ${stackOrder === "ko-first" ? "verse-line-primary" : "verse-line-secondary"} ${studyMask === "mask-ko" ? "study-masked" : ""}`}
		>
			{verse.koText !== null ? (
				verse.tokens.length > 0 ? (
					<KoreanTokensLine
						verseNumber={verse.verse}
						tokens={verse.tokens}
						koHighlights={koHighlights}
						wordTooltip={wordTooltip}
						onSelectFootnote={onSelectFootnote}
					/>
				) : (
					renderHighlightedText(verse.koText, 0, koHighlights)
				)
			) : (
				<span className="verse-omitted">[{CANONICAL_BIBLES.ko.code} 본문 없음]</span>
			)}
		</p>
	);

	const handleBlockClick = (e: MouseEvent<HTMLElement>) => {
		const target = e.target;
		if (!(target instanceof Node) || !e.currentTarget.contains(target)) return;
		const targetEl = target instanceof Element ? target : target.parentElement;
		if (targetEl?.closest(INTERACTIVE_DESCENDANT_SELECTOR)) return;
		if (hasTextSelectionIn(e.currentTarget)) return;
		onSelectVerse(verse.verse);
	};

	return (
		<article
			id={`verse-${verse.verse}`}
			className={`verse-block ${isSelected ? "selected" : ""} ${isAudioActive ? "audio-active" : ""}`}
			onClick={handleBlockClick}
		>
			{verse.heading && <h3 className="verse-heading">{verse.heading}</h3>}
			<div className="verse-grid">
				<div className="verse-gutter">
					<button
						type="button"
						className="verse-num-btn"
						onClick={() => onSelectVerse(verse.verse)}
						title={
							hasVerseTimestamps
								? `Jump audio to verse ${verse.verse}`
								: `Select verse ${verse.verse}`
						}
						aria-label={`Verse ${verse.verse}`}
					>
						{verse.verse}
					</button>
					<button
						type="button"
						className={`verse-favorite-btn ${isFavorited ? "active" : ""}`.trim()}
						onClick={() => onToggleFavorite?.(verse)}
						aria-pressed={isFavorited}
						aria-label={
							isFavorited
								? `Remove verse ${verse.verse} from favorites`
								: `Bookmark verse ${verse.verse}`
						}
						title={isFavorited ? "Remove verse from favorites" : "Bookmark verse to favorites"}
					>
						<Bookmark size={12} filled={isFavorited} />
					</button>
					{onToggleMemorize && (
						<button
							type="button"
							className={`verse-memorize-btn ${isInMemorize ? "active" : ""}`.trim()}
							onClick={() => onToggleMemorize(verse)}
							aria-pressed={isInMemorize}
							aria-label={
								isInMemorize
									? `Remove verse ${verse.verse} from Memorize`
									: `Add verse ${verse.verse} to Memorize`
							}
							title={isInMemorize ? "Remove from Memorize" : "Save to Memorize"}
						>
							<Layers size={12} />
						</button>
					)}
				</div>
				<div className="verse-lines">
					{(stackOrder === "en-first"
						? [englishLine, koreanLine]
						: [koreanLine, englishLine]
					).filter(Boolean)}
				</div>
			</div>
		</article>
	);
});

/** Shared bilingual verse lines renderer used by Verse of the Day and Memorize cards. */
export function BilingualPassageLines({
	aligned,
	isMultiVerse,
	stackOrder,
	studyMask = "none",
	wordTooltip,
	koLoading,
	enLoading,
	koError,
	enError,
	loadEn = true,
	onRetry,
	wrapClassName,
	enClassName,
	koClassName,
	statusClassName,
	quoteEn = false,
}: {
	aligned: readonly AlignedVerse[];
	isMultiVerse: boolean;
	stackOrder: StackOrder;
	studyMask?: StudyMaskMode;
	wordTooltip: boolean;
	koLoading: boolean;
	enLoading: boolean;
	koError: string | null;
	enError: string | null;
	loadEn?: boolean;
	onRetry: () => void;
	wrapClassName: string;
	enClassName: string;
	koClassName: string;
	statusClassName: string;
	quoteEn?: boolean;
}) {
	const resolvedEnClassName =
		`${enClassName} ${studyMask === "mask-en" ? "study-masked" : ""}`.trim();
	const resolvedKoClassName =
		`${koClassName} ${studyMask === "mask-ko" ? "study-masked" : ""}`.trim();
	const enVerses = aligned.filter((v) => v.enText);
	const koVerses = aligned.filter((v) => v.koText);
	const enContent = enVerses.map((v, idx) => (
		<Fragment key={v.verse}>
			{idx > 0 && " "}
			{isMultiVerse && <sup className="votd-verse-num">{v.verse}</sup>}
			{v.enText}
		</Fragment>
	));

	const englishBlock = (
		<div key="en" className={wrapClassName}>
			{enVerses.length > 0 ? (
				quoteEn ? (
					<blockquote className={resolvedEnClassName}>“{enContent}”</blockquote>
				) : (
					<p className={resolvedEnClassName}>{enContent}</p>
				)
			) : enLoading || !loadEn ? (
				<p className={statusClassName}>Loading English (ESV)…</p>
			) : enError ? (
				<div className="votd-en-fallback">
					<span>English (ESV) unavailable</span>
					<button type="button" className="quick-inline-chip active" onClick={onRetry}>
						Retry
					</button>
				</div>
			) : null}
		</div>
	);

	const koreanBlock = (
		<div key="ko" className={wrapClassName}>
			{koVerses.length > 0 ? (
				<p className={resolvedKoClassName} lang="ko">
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
				<p className={statusClassName}>Loading Korean (개역한글)…</p>
			) : koError ? (
				<p className={statusClassName}>{koError}</p>
			) : null}
		</div>
	);

	return (
		<>{stackOrder === "en-first" ? [englishBlock, koreanBlock] : [koreanBlock, englishBlock]}</>
	);
}
