import type { AlignedVerse } from "../../shared/types";
import { KoreanToken } from "./KoreanToken";

export type StackOrder = "en-first" | "ko-first";
export type StudyMaskMode = "none" | "mask-en" | "mask-ko";

interface VerseBlockProps {
	verse: AlignedVerse;
	stackOrder: StackOrder;
	studyMask: StudyMaskMode;
	isSelected: boolean;
	isAudioActive: boolean;
	enCode: string;
	koCode: string;
	hasVerseTimestamps: boolean;
	onSelectVerse: (verseNum: number) => void;
	onSelectFootnote: (footnoteId: string) => void;
}

export function VerseBlock({
	verse,
	stackOrder,
	studyMask,
	isSelected,
	isAudioActive,
	enCode,
	koCode,
	hasVerseTimestamps,
	onSelectVerse,
	onSelectFootnote,
}: VerseBlockProps) {
	const heading = verse.enHeading ?? verse.koHeading;

	const englishLine = (
		<p
			key="en"
			className={`verse-en ${stackOrder === "en-first" ? "verse-line-primary" : "verse-line-secondary"} ${studyMask === "mask-en" ? "study-masked" : ""}`}
		>
			{verse.enText !== null ? (
				verse.enText
			) : (
				<span className="verse-omitted">[Verse omitted in {enCode} manuscripts]</span>
			)}
		</p>
	);

	const seenTokenCounts = new Map<string, number>();

	const koreanLine = (
		<p
			key="ko"
			lang="ko"
			className={`verse-ko ${stackOrder === "ko-first" ? "verse-line-primary" : "verse-line-secondary"} ${studyMask === "mask-ko" ? "study-masked" : ""}`}
		>
			{verse.koText !== null ? (
				verse.tokens.length > 0 ? (
					verse.tokens.map((token, idx) => {
						const occurrence = seenTokenCounts.get(token.raw) ?? 0;
						seenTokenCounts.set(token.raw, occurrence + 1);
						return (
							<span key={`${verse.verse}-${token.raw}-${occurrence}`}>
								{idx > 0 ? " " : null}
								<KoreanToken token={token} onSelectFootnote={onSelectFootnote} />
							</span>
						);
					})
				) : (
					verse.koText
				)
			) : (
				<span className="verse-omitted">[{koCode} 본문 없음]</span>
			)}
		</p>
	);

	return (
		<article
			id={`verse-${verse.verse}`}
			className={`verse-block ${isSelected ? "selected" : ""} ${isAudioActive ? "audio-active" : ""}`}
		>
			{heading && <h3 className="verse-heading">{heading}</h3>}
			<div className="verse-grid">
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
				<div className="verse-lines">
					{stackOrder === "en-first" ? [englishLine, koreanLine] : [koreanLine, englishLine]}
				</div>
			</div>
		</article>
	);
}
