import { useEffect, useMemo, useRef, useState } from "react";

import {
	buildCommentaryPreview,
	COMMENTARY_SOURCES,
	filterCommentaryEntries,
	getCommentaryMeta,
	indexCommentaryEntries,
	type IndexedCommentaryEntry,
} from "../../shared/commentaries";
import type { ChapterCommentaryResponse, CommentaryId, CommentaryMeta } from "../../shared/types";
import { scrollChildIntoContainer } from "../lib/scroll";
import { Loader2 } from "./Icons";
import { PanelDisclosure, PanelSearchInput } from "./RailShared";

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
	listClassName?: string;
	cardClassName?: string;
	statusClassName?: string;
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
	listClassName = "commentary-list",
	cardClassName = "commentary-card",
	statusClassName = "commentary-status",
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

	const toggleExpanded = (id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const trimmedQuery = query.trim().toLowerCase();
	const entries = data?.entries ?? [];
	const chapterIntro = data?.introduction ?? [];
	const bookIntro = data?.bookIntroduction ?? [];

	if (loading) {
		return (
			<div className={statusClassName} role="status">
				<Loader2 size={16} className="spin" />
				<span>Loading {sourceMeta.shortName} notes...</span>
			</div>
		);
	}

	if (error) {
		return (
			<div className={`${statusClassName} commentary-error`.trim()}>
				<p className="commentary-status-text">{error}</p>
				<button type="button" className="quick-inline-chip active" onClick={onRetry}>
					Try again
				</button>
			</div>
		);
	}

	if (!data || (entries.length === 0 && chapterIntro.length === 0 && bookIntro.length === 0)) {
		return (
			<div className={statusClassName}>
				<p className="commentary-status-text">
					No notes available in {sourceMeta.name} for {bookEn} {chapter}.
				</p>
			</div>
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
				<div className={statusClassName}>
					<p className="commentary-status-text">
						No matching commentary notes for "{query.trim()}" in {bookEn} {chapter}.
					</p>
				</div>
			) : (
				<div className={listClassName}>
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
								className={`${cardClassName} ${isHighlighted ? "highlighted" : ""}`.trim()}
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
										onClick={() => toggleExpanded(entry.id)}
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
	const sourceMeta = useMemo(() => getCommentaryMeta(source), [source]);

	const indexedEntries = useMemo(
		() => indexCommentaryEntries(data?.entries ?? [], source, maxVerseInChapter),
		[data?.entries, source, maxVerseInChapter],
	);

	const visibleEntries = useMemo(
		() => filterCommentaryEntries(indexedEntries, query.trim().toLowerCase()),
		[indexedEntries, query],
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
				<div
					className="segmented-row commentary-source-row"
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

				<PanelSearchInput
					value={query}
					onChange={setQuery}
					placeholder="Search notes or verse..."
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
