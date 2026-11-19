import type { CommentaryEntry, CommentaryId, CommentaryMeta } from "./types";

const MAX_PREVIEW_PARAGRAPHS = 2;
const MAX_PREVIEW_CHARS = 480;

export const DEFAULT_COMMENTARY_ID: CommentaryId = "tyndale";

export const COMMENTARY_SOURCES: readonly CommentaryMeta[] = [
	{
		id: "tyndale",
		name: "Tyndale Open Study Notes",
		shortName: "Tyndale",
		description: "Concise verse-by-verse study notes & book introductions",
		license: "CC BY-SA 4.0",
		licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
		attribution: "Tyndale Open Study Notes (Tyndale House Publishers)",
	},
	{
		id: "matthew-henry",
		name: "Matthew Henry Bible Commentary",
		shortName: "Matthew Henry",
		description: "Classic devotional & expository pericope commentary",
		license: "Public Domain",
		licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
		attribution: "Matthew Henry's Complete Commentary on the Whole Bible",
	},
] as const;

const COMMENTARY_MAP = new Map<CommentaryId, CommentaryMeta>(
	COMMENTARY_SOURCES.map((source) => [source.id, source]),
);

export function isCommentaryId(value: unknown): value is CommentaryId {
	return typeof value === "string" && COMMENTARY_MAP.has(value as CommentaryId);
}

export function getCommentaryMeta(id: CommentaryId): CommentaryMeta {
	return COMMENTARY_MAP.get(id) ?? COMMENTARY_SOURCES[0];
}

export interface IndexedCommentaryEntry {
	entry: CommentaryEntry;
	effectiveEnd: number;
	verseLabel: string;
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

function formatEntryVerseLabel(verseStart: number, effectiveEnd: number): string {
	if (Number.isFinite(effectiveEnd) && effectiveEnd > verseStart) {
		return `v.${verseStart}–${effectiveEnd}`;
	}
	if (!Number.isFinite(effectiveEnd)) {
		return `v.${verseStart}+`;
	}
	return `v.${verseStart}`;
}

export function indexCommentaryEntries(
	entries: readonly CommentaryEntry[],
	source: CommentaryId,
	maxVerseInChapter?: number,
): IndexedCommentaryEntry[] {
	return entries.map((entry, idx) => {
		const effectiveEnd = getEffectiveVerseEnd(entry, idx, entries, source, maxVerseInChapter);
		return {
			entry,
			effectiveEnd,
			verseLabel: formatEntryVerseLabel(entry.verseStart, effectiveEnd),
		};
	});
}

export function filterCommentaryEntries(
	indexedEntries: readonly IndexedCommentaryEntry[],
	trimmedLowerQuery: string,
): IndexedCommentaryEntry[] {
	if (!trimmedLowerQuery) return [...indexedEntries];
	const verseQueryMatch = trimmedLowerQuery.match(/^v\.?\s*(\d+)$/i);
	const queryVerse = verseQueryMatch ? Number.parseInt(verseQueryMatch[1], 10) : null;

	return indexedEntries.filter(({ entry, effectiveEnd }) => {
		if (queryVerse !== null && queryVerse >= entry.verseStart && queryVerse <= effectiveEnd) {
			return true;
		}
		if (entry.heading?.toLowerCase().includes(trimmedLowerQuery)) return true;
		return entry.paragraphs.some((p) => p.toLowerCase().includes(trimmedLowerQuery));
	});
}

export function buildCommentaryPreview(paragraphs: readonly string[]): {
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
