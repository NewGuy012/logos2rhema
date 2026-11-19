import { useEffect, useMemo, useRef, useState } from "react";

import { COMMENTARY_SOURCES, getCommentaryMeta } from "../../shared/commentaries";
import type { ChapterCommentaryResponse, CommentaryEntry, CommentaryId } from "../../shared/types";
import { scrollChildIntoContainer } from "../lib/scroll";
import { Loader2 } from "./Icons";
import { PanelDisclosure, PanelSearchInput } from "./RailShared";

const MAX_PREVIEW_PARAGRAPHS = 2;
const MAX_PREVIEW_CHARS = 480;

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

function getEffectiveVerseEnd(
	entry: CommentaryEntry,
	index: number,
	entries: readonly CommentaryEntry[],
	source: CommentaryId,
	maxVerseInChapter?: number,
): number {
	if (entry.verseEnd !== undefined) return entry.verseEnd;
	if (source === "matthew-henry" && index === entries.length - 1) {
		return maxVerseInChapter && maxVerseInChapter > entry.verseStart
			? maxVerseInChapter
			: Number.POSITIVE_INFINITY;
	}
	return entry.verseStart;
}

function formatEntryVerseLabel(
	entry: CommentaryEntry,
	index: number,
	entries: readonly CommentaryEntry[],
	source: CommentaryId,
	maxVerseInChapter?: number,
): string {
	const end = getEffectiveVerseEnd(entry, index, entries, source, maxVerseInChapter);
	if (Number.isFinite(end) && end > entry.verseStart) {
		return `v.${entry.verseStart}–${end}`;
	}
	if (!Number.isFinite(end)) {
		return `v.${entry.verseStart}+`;
	}
	return `v.${entry.verseStart}`;
}

function buildEntryPreview(paragraphs: readonly string[]): {
	preview: string[];
	isTruncated: boolean;
} {
	const totalChars = paragraphs.reduce((sum, p) => sum + p.length, 0);
	if (paragraphs.length <= 3 && totalChars <= 650) {
		return { preview: [...paragraphs], isTruncated: false };
	}

	const preview: string[] = [];
	let usedChars = 0;
	for (const paragraph of paragraphs) {
		if (preview.length >= MAX_PREVIEW_PARAGRAPHS) break;
		const remaining = MAX_PREVIEW_CHARS - usedChars;
		if (remaining <= 60 && preview.length > 0) break;

		if (paragraph.length <= remaining) {
			preview.push(paragraph);
			usedChars += paragraph.length;
		} else {
			const slice = paragraph.slice(0, Math.max(80, remaining));
			const wordBreak = slice.lastIndexOf(" ");
			const trimmed = wordBreak > 60 ? slice.slice(0, wordBreak) : slice;
			preview.push(`${trimmed.trimEnd()}…`);
			return { preview, isTruncated: true };
		}
	}

	return {
		preview,
		isTruncated: preview.length < paragraphs.length,
	};
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
	const [chapterIntroOpen, setChapterIntroOpen] = useState(false);
	const [bookIntroOpen, setBookIntroOpen] = useState(false);
	const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);

	const sourceMeta = useMemo(() => getCommentaryMeta(source), [source]);

	useEffect(() => {
		setBookIntroOpen(false);
		setExpandedIds(new Set());
	}, [bookEn, source]);

	useEffect(() => {
		setChapterIntroOpen(false);
		setExpandedIds(new Set());
	}, [bookEn, chapter, source]);

	const entries = data?.entries ?? [];
	const trimmedQuery = query.trim().toLowerCase();

	const indexedEntries = useMemo(
		() =>
			entries.map((entry, idx) => ({
				entry,
				effectiveEnd: getEffectiveVerseEnd(entry, idx, entries, source, maxVerseInChapter),
				verseLabel: formatEntryVerseLabel(entry, idx, entries, source, maxVerseInChapter),
			})),
		[entries, source, maxVerseInChapter],
	);

	const visibleEntries = useMemo(() => {
		if (!trimmedQuery) return indexedEntries;
		const verseQueryMatch = trimmedQuery.match(/^v\.?\s*(\d+)$/i);
		const queryVerse = verseQueryMatch ? Number.parseInt(verseQueryMatch[1], 10) : null;

		return indexedEntries.filter(({ entry, effectiveEnd }) => {
			if (queryVerse !== null && queryVerse >= entry.verseStart && queryVerse <= effectiveEnd) {
				return true;
			}
			if (entry.heading?.toLowerCase().includes(trimmedQuery)) return true;
			return entry.paragraphs.some((p) => p.toLowerCase().includes(trimmedQuery));
		});
	}, [indexedEntries, trimmedQuery]);

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

	const toggleExpanded = (id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const chapterIntro = data?.introduction ?? [];
	const bookIntro = data?.bookIntroduction ?? [];

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
				{loading ? (
					<div className="commentary-status" role="status">
						<Loader2 size={16} className="spin" />
						<span>Loading {sourceMeta.shortName} notes...</span>
					</div>
				) : error ? (
					<div className="commentary-status commentary-error">
						<p className="commentary-status-text">{error}</p>
						<button type="button" className="quick-inline-chip active" onClick={onRetry}>
							Try again
						</button>
					</div>
				) : !data ||
				  (entries.length === 0 && chapterIntro.length === 0 && bookIntro.length === 0) ? (
					<div className="commentary-status">
						<p className="commentary-status-text">
							No notes available in {sourceMeta.name} for {bookEn} {chapter}.
						</p>
					</div>
				) : (
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
							<div className="commentary-status">
								<p className="commentary-status-text">
									No matching commentary notes for "{query.trim()}" in {bookEn} {chapter}.
								</p>
							</div>
						) : (
							<div className="commentary-list">
								{visibleEntries.map(({ entry, verseLabel }) => {
									const { preview, isTruncated } = buildEntryPreview(entry.paragraphs);
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
				)}
			</div>

			<footer className="commentary-attribution">
				<span>{sourceMeta.attribution} · </span>
				<a href={sourceMeta.licenseUrl} target="_blank" rel="noopener noreferrer">
					{sourceMeta.license}
				</a>
			</footer>
		</>
	);
}
