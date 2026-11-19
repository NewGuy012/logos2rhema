import { useCallback, useEffect, useMemo, useState } from "react";

import { BIBLE_BOOKS, getBookByNumber } from "../../shared/books";
import {
	COMMENTARY_SOURCES,
	filterCommentaryEntries,
	getCommentaryMeta,
	indexCommentaryEntries,
} from "../../shared/commentaries";
import type { ChapterCommentaryResponse, CommentaryId, RightRailTab } from "../../shared/types";
import { loadChapterCommentary } from "../lib/bible-loader";
import { CommentaryAttribution, CommentaryBody } from "./CommentaryPanel";
import { HomePassageBar } from "./HomeStudyShared";
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
	const initialBook = getBookByNumber(initialBookNumber) ?? BIBLE_BOOKS[0];
	const [bookNumber, setBookNumber] = useState(initialBook.number);
	const [chapter, setChapter] = useState(initialChapter);
	const [query, setQuery] = useState("");
	const [data, setData] = useState<ChapterCommentaryResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [retrySeq, setRetrySeq] = useState(0);

	const currentBook = useMemo(() => getBookByNumber(bookNumber) ?? BIBLE_BOOKS[0], [bookNumber]);
	const sourceMeta = useMemo(() => getCommentaryMeta(source), [source]);

	const handleChangePassage = useCallback((nextBookNumber: number, nextChapter: number) => {
		const target = getBookByNumber(nextBookNumber) ?? BIBLE_BOOKS[0];
		setBookNumber(target.number);
		setChapter(Math.max(1, Math.min(target.chapters, nextChapter)));
	}, []);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		setData(null);

		loadChapterCommentary({
			commentaryId: source,
			usfm: currentBook.usfm,
			chapter,
		})
			.then((res) => {
				if (cancelled) return;
				setData(res);
				setLoading(false);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "Unable to load commentary.");
				setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [source, currentBook.usfm, chapter, retrySeq]);

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
					onChangePassage={handleChangePassage}
					onOpenInReader={() =>
						onOpenPassage(currentBook.number, chapter, undefined, { rightRailTab: "commentary" })
					}
				/>

				<div className="home-commentary-controls-row">
					<div
						className="segmented-row home-commentary-source-toggle"
						role="group"
						aria-label="Commentary source"
					>
						{COMMENTARY_SOURCES.map((item) => {
							const active = source === item.id;
							return (
								<button
									key={item.id}
									type="button"
									className={`segmented-btn ${active ? "active" : ""}`.trim()}
									aria-pressed={active}
									title={item.description}
									onClick={() => {
										if (!active) onChangeSource(item.id);
									}}
								>
									{item.shortName}
								</button>
							);
						})}
					</div>

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
					onRetry={() => setRetrySeq((seq) => seq + 1)}
					onJumpToVerse={(verse) =>
						onOpenPassage(currentBook.number, chapter, verse, { rightRailTab: "commentary" })
					}
				/>

				<CommentaryAttribution sourceMeta={sourceMeta} />
			</div>
		</div>
	);
}
