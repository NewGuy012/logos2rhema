import { useMemo, useState } from "react";

import {
	filterCommentaryEntries,
	getCommentaryMeta,
	indexCommentaryEntries,
} from "../../shared/commentaries";
import type { CommentaryId, RightRailTab } from "../../shared/types";
import {
	CommentaryAttribution,
	CommentaryBody,
	CommentarySourceToggle,
	useChapterCommentary,
} from "./CommentaryPanel";
import { HomePassageBar, usePassageSelection } from "./HomeStudyShared";
import { PanelSearchInput } from "./RailShared";

interface HomeCommentaryBrowserProps {
	initialBookNumber: number;
	initialChapter: number;
	source: CommentaryId;
	onChangeSource: (source: CommentaryId) => void;
	onOpenPassage: (
		bookNumber: number,
		chapter: number,
		verse?: number,
		options?: { rightRailTab?: RightRailTab },
	) => void;
}

export function HomeCommentaryBrowser({
	initialBookNumber,
	initialChapter,
	source,
	onChangeSource,
	onOpenPassage,
}: HomeCommentaryBrowserProps) {
	const {
		book: currentBook,
		chapter,
		selectPassage,
	} = usePassageSelection(initialBookNumber, initialChapter);
	const [query, setQuery] = useState("");
	const sourceMeta = useMemo(() => getCommentaryMeta(source), [source]);

	const { data, loading, error, retry } = useChapterCommentary({
		commentaryId: source,
		usfm: currentBook.usfm,
		chapter,
	});

	const indexedEntries = useMemo(
		() => indexCommentaryEntries(data?.entries ?? [], source),
		[data?.entries, source],
	);
	const visibleEntries = useMemo(
		() => filterCommentaryEntries(indexedEntries, query.trim().toLowerCase()),
		[indexedEntries, query],
	);

	return (
		<div className="home-study-browser">
			<div className="home-study-card home-study-toolbar">
				<HomePassageBar
					bookNumber={currentBook.number}
					chapter={chapter}
					onChangePassage={selectPassage}
					onOpenInReader={() =>
						onOpenPassage(currentBook.number, chapter, undefined, { rightRailTab: "commentary" })
					}
				/>

				<div className="home-commentary-controls-row">
					<CommentarySourceToggle
						source={source}
						onChangeSource={onChangeSource}
						className="home-commentary-source-toggle"
					/>

					<p className="home-source-desc">{sourceMeta.description}</p>
				</div>

				<PanelSearchInput
					value={query}
					onChange={setQuery}
					placeholder="Search notes or verse (e.g. v.16, grace)..."
					ariaLabel="Filter commentary notes"
					clearAriaLabel="Clear commentary search"
				/>
			</div>

			<div className="home-study-card home-commentary-body-card">
				<div className="home-commentary-card-header">
					<h3 className="home-study-passage-title">
						{sourceMeta.name} · {currentBook.en} {chapter}{" "}
						<span className="home-continue-ko" lang="ko">
							({currentBook.ko} {chapter}장)
						</span>
					</h3>
					{!loading && !error && data && (
						<span className="home-study-badge">
							{visibleEntries.length} {visibleEntries.length === 1 ? "note" : "notes"}
						</span>
					)}
				</div>

				<CommentaryBody
					bookEn={currentBook.en}
					chapter={chapter}
					sourceMeta={sourceMeta}
					data={data}
					loading={loading}
					error={error}
					query={query}
					visibleEntries={visibleEntries}
					onRetry={retry}
					onJumpToVerse={(verse) =>
						onOpenPassage(currentBook.number, chapter, verse, { rightRailTab: "commentary" })
					}
				/>

				<CommentaryAttribution sourceMeta={sourceMeta} />
			</div>
		</div>
	);
}
