import { memo, type MouseEvent } from "react";

import { CANONICAL_BIBLES } from "../../shared/translations";
import type { AlignedVerse, HighlightItem } from "../../shared/types";
import { renderHighlightedText } from "./HighlightText";
import { Bookmark } from "./Icons";
import { KoreanToken } from "./KoreanToken";

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
	enHighlights?: readonly HighlightItem[];
	koHighlights?: readonly HighlightItem[];
	enUnavailable?: boolean;
	hasVerseTimestamps: boolean;
	onSelectVerse: (verseNum: number) => void;
	onToggleFavorite?: (verse: AlignedVerse) => void;
	onSelectFootnote: (footnoteId: string) => void;
}

export const VerseBlock = memo(function VerseBlock({
	verse,
	stackOrder,
	studyMask,
	isSelected,
	isAudioActive,
	isFavorited = false,
	enHighlights = [],
	koHighlights = [],
	enUnavailable = false,
	hasVerseTimestamps,
	onSelectVerse,
	onToggleFavorite,
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

	const seenTokenCounts = new Map<string, number>();
	let koOffset = 0;

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
					verse.tokens.map((token, idx) => {
						const occurrence = seenTokenCounts.get(token.raw) ?? 0;
						seenTokenCounts.set(token.raw, occurrence + 1);
						const spaceNode = idx > 0 ? renderHighlightedText(" ", koOffset, koHighlights) : null;
						if (idx > 0) koOffset += 1;
						const tokenOffset = koOffset;
						koOffset += token.raw.length;
						return (
							<span key={`${verse.verse}-${token.raw}-${occurrence}`}>
								{spaceNode}
								<KoreanToken
									token={token}
									tokenOffset={tokenOffset}
									highlights={koHighlights}
									onSelectFootnote={onSelectFootnote}
								/>
							</span>
						);
					})
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
