import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	buildCommentaryPreview,
	COMMENTARY_SOURCES,
	filterCommentaryEntries,
	getCommentaryMeta,
	indexCommentaryEntries,
	type IndexedCommentaryEntry,
} from "../../shared/commentaries";
import type { ChapterCommentaryResponse, CommentaryId, CommentaryMeta } from "../../shared/types";
import { loadChapterCommentary } from "../lib/bible-loader";
import { scrollChildIntoContainer } from "../lib/scroll";
import {
	PanelDisclosure,
	PanelSearchInput,
	PanelStatus,
	SegmentedControl,
	toggleSetItem,
} from "./RailShared";

export function useChapterCommentary({
	commentaryId,
	usfm,
	chapter,
	enabled = true,
}: {
	commentaryId: CommentaryId;
	usfm: string;
	chapter: number;
	enabled?: boolean;
}) {
	const [data, setData] = useState<ChapterCommentaryResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [retrySeq, setRetrySeq] = useState(0);
	const loadedKeyRef = useRef<string | null>(null);

	useEffect(() => {
		const targetKey = `${commentaryId}:${usfm}:${chapter}`;
		const matchesCurrent = loadedKeyRef.current === targetKey;

		if (!matchesCurrent) {
			loadedKeyRef.current = null;
			setData(null);
		}
		setError(null);

		if (!enabled) {
			setLoading(false);
			return;
		}

		const controller = new AbortController();
		setLoading(!matchesCurrent);
		loadChapterCommentary({ commentaryId, usfm, chapter, signal: controller.signal })
			.then((res) => {
				if (controller.signal.aborted) return;
				loadedKeyRef.current = targetKey;
				setData(res);
				setLoading(false);
			})
			.catch((err: unknown) => {
				if (controller.signal.aborted) return;
				loadedKeyRef.current = null;
				setError(err instanceof Error ? err.message : "Unable to load commentary.");
				setLoading(false);
			});

		return () => controller.abort();
	}, [commentaryId, usfm, chapter, enabled, retrySeq]);

	const retry = useCallback(() => setRetrySeq((seq) => seq + 1), []);
	return { data, loading, error, retry };
}

export function useFilteredCommentary(
	data: ChapterCommentaryResponse | null,
	source: CommentaryId,
	query: string,
	maxVerseInChapter?: number,
) {
	const sourceMeta = useMemo(() => getCommentaryMeta(source), [source]);
	const indexedEntries = useMemo(
		() => indexCommentaryEntries(data?.entries ?? [], source, maxVerseInChapter),
		[data?.entries, source, maxVerseInChapter],
	);
	const visibleEntries = useMemo(
		() => filterCommentaryEntries(indexedEntries, query.trim().toLowerCase()),
		[indexedEntries, query],
	);
	return { sourceMeta, visibleEntries };
}

const COMMENTARY_SOURCE_OPTIONS = COMMENTARY_SOURCES.map((item) => ({
	value: item.id,
	label: item.shortName,
	title: item.description,
}));

export function CommentarySourceToggle({
	source,
	onChangeSource,
	className = "commentary-source-row",
}: {
	source: CommentaryId;
	onChangeSource: (source: CommentaryId) => void;
	className?: string;
}) {
	return (
		<SegmentedControl
			value={source}
			options={COMMENTARY_SOURCE_OPTIONS}
			onChange={onChangeSource}
			className={className}
			ariaLabel="Commentary source"
		/>
	);
}

interface CommentaryPanelProps {
	bookEn: string;
	chapter: number;
	maxVerseInChapter?: number;
	source: CommentaryId;
	data: ChapterCommentaryResponse | null;
	loading: boolean;
	error: string | null;
	selectedVerse: number | null;
	onChangeSource: (source: CommentaryId) => void;
	onRetry: () => void;
	onJumpToVerse: (verseNumber: number) => void;
}

interface CommentaryBodyProps {
	bookEn: string;
	chapter: number;
	sourceMeta: CommentaryMeta;
	data: ChapterCommentaryResponse | null;
	loading: boolean;
	error: string | null;
	query: string;
	visibleEntries: readonly IndexedCommentaryEntry[];
	matchedEntryId?: string | null;
	onRetry: () => void;
	onJumpToVerse: (verseNumber: number) => void;
}

export function CommentaryBody({
	bookEn,
	chapter,
	sourceMeta,
	data,
	loading,
	error,
	query,
	visibleEntries,
	matchedEntryId = null,
	onRetry,
	onJumpToVerse,
}: CommentaryBodyProps) {
	const [chapterIntroOpen, setChapterIntroOpen] = useState(false);
	const [bookIntroOpen, setBookIntroOpen] = useState(false);
	const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

	useEffect(() => {
		setBookIntroOpen(false);
	}, [bookEn, sourceMeta.id]);

	useEffect(() => {
		setChapterIntroOpen(false);
		setExpandedIds(new Set());
	}, [bookEn, chapter, sourceMeta.id]);

	const trimmedQuery = query.trim().toLowerCase();
	const entries = data?.entries ?? [];
	const chapterIntro = data?.introduction ?? [];
	const bookIntro = data?.bookIntroduction ?? [];
	const isEmpty =
		!data || (entries.length === 0 && chapterIntro.length === 0 && bookIntro.length === 0);

	if (loading || error || isEmpty) {
		return (
			<PanelStatus
				loading={loading}
				loadingText={`Loading ${sourceMeta.shortName} notes...`}
				error={error}
				onRetry={onRetry}
				emptyText={`No notes available in ${sourceMeta.name} for ${bookEn} ${chapter}.`}
			/>
		);
	}

	return (
		<>
			{!trimmedQuery && chapterIntro.length > 0 && (
				<PanelDisclosure
					label="Chapter Overview"
					open={chapterIntroOpen}
					onToggle={() => setChapterIntroOpen((prev) => !prev)}
				>
					<div className="commentary-intro-body">
						{chapterIntro.map((paragraph, idx) => (
							<p key={`ch-intro-${idx}`} className="commentary-prose">
								{paragraph}
							</p>
						))}
					</div>
				</PanelDisclosure>
			)}

			{!trimmedQuery && bookIntro.length > 0 && (
				<PanelDisclosure
					label="Book Introduction"
					open={bookIntroOpen}
					onToggle={() => setBookIntroOpen((prev) => !prev)}
				>
					<div className="commentary-intro-body">
						{bookIntro.map((paragraph, idx) => (
							<p key={`book-intro-${idx}`} className="commentary-prose">
								{paragraph}
							</p>
						))}
					</div>
				</PanelDisclosure>
			)}

			{visibleEntries.length === 0 ? (
				<PanelStatus
					emptyText={`No matching commentary notes for "${query.trim()}" in ${bookEn} ${chapter}.`}
				/>
			) : (
				<div className="commentary-list">
					{visibleEntries.map(({ entry, verseLabel }) => {
						const { preview, isTruncated } = buildCommentaryPreview(entry.paragraphs);
						const searchMatchesRemainder =
							Boolean(trimmedQuery) &&
							isTruncated &&
							entry.paragraphs
								.slice(preview.length)
								.some((p) => p.toLowerCase().includes(trimmedQuery));
						const isExpanded = expandedIds.has(entry.id) || searchMatchesRemainder;
						const shownParagraphs = isExpanded ? entry.paragraphs : preview;
						const isHighlighted = matchedEntryId === entry.id;

						return (
							<article
								key={entry.id}
								data-commentary-id={entry.id}
								className={`commentary-card ${isHighlighted ? "highlighted" : ""}`.trim()}
							>
								<div className="commentary-card-head">
									<button
										type="button"
										className="verse-ref-chip"
										onClick={() => onJumpToVerse(entry.verseStart)}
										title={`Go to verse ${entry.verseStart}`}
									>
										{verseLabel}
									</button>
									{entry.heading && <h3 className="commentary-heading">{entry.heading}</h3>}
								</div>

								<div className="commentary-paragraphs">
									{shownParagraphs.map((paragraph, idx) => (
										<p key={`${entry.id}-p-${idx}`} className="commentary-prose">
											{paragraph}
										</p>
									))}
								</div>

								{isTruncated && !searchMatchesRemainder && (
									<button
										type="button"
										className="commentary-expand-btn"
										aria-expanded={isExpanded}
										onClick={() => setExpandedIds((prev) => toggleSetItem(prev, entry.id))}
									>
										{isExpanded ? "Show less" : "Read full note"}
									</button>
								)}
							</article>
						);
					})}
				</div>
			)}
		</>
	);
}

export function CommentaryAttribution({
	sourceMeta,
	className = "commentary-attribution",
}: {
	sourceMeta: CommentaryMeta;
	className?: string;
}) {
	return (
		<footer className={className}>
			<span>{sourceMeta.attribution} · </span>
			<a href={sourceMeta.licenseUrl} target="_blank" rel="noopener noreferrer">
				{sourceMeta.license}
			</a>
		</footer>
	);
}

export function CommentaryPanel({
	bookEn,
	chapter,
	maxVerseInChapter,
	source,
	data,
	loading,
	error,
	selectedVerse,
	onChangeSource,
	onRetry,
	onJumpToVerse,
}: CommentaryPanelProps) {
	const [query, setQuery] = useState("");
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const { sourceMeta, visibleEntries } = useFilteredCommentary(
		data,
		source,
		query,
		maxVerseInChapter,
	);

	const matchedEntryId = useMemo(() => {
		if (selectedVerse === null) return null;
		const found = visibleEntries.find(
			({ entry, effectiveEnd }) =>
				selectedVerse >= entry.verseStart && selectedVerse <= effectiveEnd,
		);
		return found?.entry.id ?? null;
	}, [visibleEntries, selectedVerse]);

	useEffect(() => {
		if (!matchedEntryId || loading) return;
		scrollChildIntoContainer(scrollContainerRef.current, "data-commentary-id", matchedEntryId);
	}, [matchedEntryId, loading, data]);

	return (
		<>
			<div className="dict-panel-controls">
				<CommentarySourceToggle source={source} onChangeSource={onChangeSource} />

				<PanelSearchInput
					value={query}
					onChange={setQuery}
					placeholder="Search"
					ariaLabel="Filter commentary notes"
					clearAriaLabel="Clear commentary search"
				/>
			</div>

			<div className="commentary-scroll" ref={scrollContainerRef}>
				<CommentaryBody
					bookEn={bookEn}
					chapter={chapter}
					sourceMeta={sourceMeta}
					data={data}
					loading={loading}
					error={error}
					query={query}
					visibleEntries={visibleEntries}
					matchedEntryId={matchedEntryId}
					onRetry={onRetry}
					onJumpToVerse={onJumpToVerse}
				/>
			</div>

			<CommentaryAttribution sourceMeta={sourceMeta} />
		</>
	);
}
