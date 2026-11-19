import type {
	ChapterCommentaryResponse,
	CommentaryId,
	FootnoteVocabEntry,
	KrvGrammarNote,
	RightRailTab,
} from "../../shared/types";
import { CommentaryPanel } from "./CommentaryPanel";
import { FootnotesGuide } from "./FootnotesGuide";
import { BookOpen, BookText, ChevronDown, ChevronRight } from "./Icons";

interface StudyRightRailProps {
	activeTab: RightRailTab;
	onChangeTab: (tab: RightRailTab) => void;
	variant?: "sidebar" | "sheet";
	onMinimize?: () => void;
	bookEn: string;
	bookKo: string;
	chapter: number;
	footnotes: FootnoteVocabEntry[];
	grammarNotes: KrvGrammarNote[];
	highlightedFootnoteId: string | null;
	highlightSeq?: number;
	commentarySource: CommentaryId;
	commentaryData: ChapterCommentaryResponse | null;
	commentaryLoading: boolean;
	commentaryError: string | null;
	maxVerseInChapter?: number;
	selectedVerse: number | null;
	onChangeCommentarySource: (source: CommentaryId) => void;
	onRetryCommentary: () => void;
	onJumpToVerse: (verseNumber: number) => void;
}

export function StudyRightRail({
	activeTab,
	onChangeTab,
	variant = "sidebar",
	onMinimize,
	bookEn,
	bookKo,
	chapter,
	footnotes,
	grammarNotes,
	highlightedFootnoteId,
	highlightSeq = 0,
	commentarySource,
	commentaryData,
	commentaryLoading,
	commentaryError,
	maxVerseInChapter,
	selectedVerse,
	onChangeCommentarySource,
	onRetryCommentary,
	onJumpToVerse,
}: StudyRightRailProps) {
	const isDictionary = activeTab === "dictionary";

	return (
		<aside
			id="footnotes"
			className={`dict-panel dict-panel-${variant}`}
			aria-label={isDictionary ? "Korean Dictionary & Grammar Guide" : "Bible Commentary"}
		>
			<div className="dict-panel-header">
				<span aria-hidden="true" />
				<div className="panel-header-text">
					<h2 className="panel-title">{isDictionary ? "Dictionary" : "Commentary"}</h2>
					<p className="panel-subtitle">
						{bookEn} {chapter} ·{" "}
						<span lang="ko">
							{bookKo} {chapter}장
						</span>
					</p>
				</div>
				{onMinimize && (
					<button
						type="button"
						className="pill-nav-btn dict-minimize-btn"
						onClick={onMinimize}
						aria-expanded={true}
						aria-label={isDictionary ? "Minimize dictionary" : "Minimize commentary"}
						title={isDictionary ? "Minimize dictionary" : "Minimize commentary"}
					>
						{variant === "sheet" ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
					</button>
				)}
			</div>

			<div className="right-rail-tabs-wrap">
				<div className="segmented-row right-rail-tabs" role="tablist" aria-label="Study panel">
					<button
						id="right-rail-tab-dictionary"
						type="button"
						role="tab"
						aria-selected={isDictionary}
						aria-controls="right-rail-panel-dictionary"
						className={`segmented-btn right-rail-tab ${isDictionary ? "active" : ""}`.trim()}
						onClick={() => {
							if (!isDictionary) onChangeTab("dictionary");
						}}
					>
						<BookOpen size={13} />
						<span>Dictionary</span>
					</button>
					<button
						id="right-rail-tab-commentary"
						type="button"
						role="tab"
						aria-selected={!isDictionary}
						aria-controls="right-rail-panel-commentary"
						className={`segmented-btn right-rail-tab ${!isDictionary ? "active" : ""}`.trim()}
						onClick={() => {
							if (isDictionary) onChangeTab("commentary");
						}}
					>
						<BookText size={13} />
						<span>Commentary</span>
					</button>
				</div>
			</div>

			<div
				id={isDictionary ? "right-rail-panel-dictionary" : "right-rail-panel-commentary"}
				role="tabpanel"
				aria-labelledby={isDictionary ? "right-rail-tab-dictionary" : "right-rail-tab-commentary"}
				className="right-rail-tabpanel"
			>
				{isDictionary ? (
					<FootnotesGuide
						bookEn={bookEn}
						chapter={chapter}
						footnotes={footnotes}
						grammarNotes={grammarNotes}
						highlightedFootnoteId={highlightedFootnoteId}
						highlightSeq={highlightSeq}
						onJumpToVerse={onJumpToVerse}
					/>
				) : (
					<CommentaryPanel
						bookEn={bookEn}
						chapter={chapter}
						maxVerseInChapter={maxVerseInChapter}
						source={commentarySource}
						data={commentaryData}
						loading={commentaryLoading}
						error={commentaryError}
						selectedVerse={selectedVerse}
						onChangeSource={onChangeCommentarySource}
						onRetry={onRetryCommentary}
						onJumpToVerse={onJumpToVerse}
					/>
				)}
			</div>
		</aside>
	);
}
