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
import {
	type DraggableRailProps,
	DraggableRailShell,
	PanelHeaderText,
	PanelSnapBackButton,
	SegmentedControl,
	type SegmentedOption,
} from "./RailShared";

interface StudyRightRailProps extends DraggableRailProps {
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

const RIGHT_RAIL_TAB_OPTIONS: ReadonlyArray<SegmentedOption<RightRailTab>> = [
	{
		value: "dictionary",
		id: "right-rail-tab-dictionary",
		controls: "right-rail-panel-dictionary",
		label: (
			<>
				<BookOpen size={13} />
				<span>Dictionary</span>
			</>
		),
	},
	{
		value: "commentary",
		id: "right-rail-tab-commentary",
		controls: "right-rail-panel-commentary",
		label: (
			<>
				<BookText size={13} />
				<span>Commentary</span>
			</>
		),
	},
];

export function StudyRightRail({
	activeTab,
	onChangeTab,
	variant = "sidebar",
	onMinimize,
	floatingPosition,
	onFloatingPositionChange,
	isActiveFloating = false,
	onActivateFloating,
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
	const canDrag = variant === "sidebar";

	return (
		<DraggableRailShell
			id="footnotes"
			className={`dict-panel dict-panel-${variant}`}
			ariaLabel={isDictionary ? "Korean Dictionary & Grammar Guide" : "Bible Commentary"}
			draggable={canDrag}
			ignoreSelector=".right-rail-tabpanel"
			floatingPosition={floatingPosition}
			onFloatingPositionChange={onFloatingPositionChange}
			isActiveFloating={isActiveFloating}
			onActivateFloating={onActivateFloating}
		>
			{({ isFloating, resetPosition }) => (
				<>
					<div className={`dict-panel-header ${canDrag ? "panel-drag-handle" : ""}`.trim()}>
						{isFloating ? (
							<PanelSnapBackButton
								onClick={resetPosition}
								ariaLabel={
									isDictionary
										? "Snap dictionary back to original position"
										: "Snap commentary back to original position"
								}
							/>
						) : (
							<span aria-hidden="true" />
						)}
						<PanelHeaderText
							title={isDictionary ? "Dictionary" : "Commentary"}
							bookEn={bookEn}
							bookKo={bookKo}
							chapter={chapter}
						/>
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
						<SegmentedControl
							value={activeTab}
							options={RIGHT_RAIL_TAB_OPTIONS}
							onChange={onChangeTab}
							className="right-rail-tabs"
							buttonClassName="right-rail-tab"
							role="tablist"
							ariaLabel="Study panel"
							ariaOrientation="vertical"
						/>
					</div>

					<div
						id={isDictionary ? "right-rail-panel-dictionary" : "right-rail-panel-commentary"}
						role="tabpanel"
						aria-labelledby={
							isDictionary ? "right-rail-tab-dictionary" : "right-rail-tab-commentary"
						}
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
				</>
			)}
		</DraggableRailShell>
	);
}
