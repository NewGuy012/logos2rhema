import type {
	ChapterCommentaryResponse,
	CommentaryId,
	FootnoteVocabEntry,
	KrvGrammarNote,
	RightRailTab,
} from "../../shared/types";
import { DEFAULT_MAX_DICT_RAIL_WIDTH, DEFAULT_MIN_DICT_HEIGHT } from "../hooks/useResizablePanel";
import { CommentaryPanel } from "./CommentaryPanel";
import { FootnotesGuide } from "./FootnotesGuide";
import { BookOpen, BookText, ChevronDown, ChevronRight } from "./Icons";
import {
	type DraggableRailProps,
	DraggableRailShell,
	PanelHeaderText,
	PanelResetButton,
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
	wordTooltip?: boolean;
	onToggleWordTooltip?: () => void;
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
	railSize,
	onRailSizeChange,
	maxRailWidth,
	maxRailHeight,
	bookEn,
	bookKo,
	chapter,
	footnotes,
	grammarNotes,
	highlightedFootnoteId,
	highlightSeq = 0,
	wordTooltip = true,
	onToggleWordTooltip,
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
			dockSide="right"
			resizeLabel={isDictionary ? "Resize dictionary panel" : "Resize commentary panel"}
			ignoreSelector=".right-rail-tabpanel"
			floatingPosition={floatingPosition}
			onFloatingPositionChange={onFloatingPositionChange}
			isActiveFloating={isActiveFloating}
			onActivateFloating={onActivateFloating}
			railSize={variant === "sidebar" ? railSize : undefined}
			onRailSizeChange={variant === "sidebar" ? onRailSizeChange : undefined}
			maxRailWidth={
				variant === "sidebar" ? (maxRailWidth ?? DEFAULT_MAX_DICT_RAIL_WIDTH) : undefined
			}
			minRailHeight={DEFAULT_MIN_DICT_HEIGHT}
			maxRailHeight={variant === "sidebar" ? maxRailHeight : undefined}
		>
			{({ isModified, resetPanel }) => (
				<>
					<div className={`dict-panel-header ${canDrag ? "panel-drag-handle" : ""}`.trim()}>
						{isModified ? (
							<PanelResetButton
								onClick={resetPanel}
								ariaLabel={
									isDictionary
										? "Reset dictionary to original position and size"
										: "Reset commentary to original position and size"
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
								wordTooltip={wordTooltip}
								onToggleWordTooltip={onToggleWordTooltip}
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
