import type { CommentaryId, CommentaryMeta } from "./types";

export const DEFAULT_COMMENTARY_ID: CommentaryId = "tyndale";

export const COMMENTARY_SOURCES: readonly CommentaryMeta[] = [
	{
		id: "tyndale",
		name: "Tyndale Open Study Notes",
		shortName: "Tyndale",
		description: "Concise verse-by-verse study notes & book introductions",
		license: "CC BY-SA 4.0",
		licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
		website: "https://tyndaleopenresources.com/",
		attribution: "Tyndale Open Study Notes (Tyndale House Publishers)",
	},
	{
		id: "matthew-henry",
		name: "Matthew Henry Bible Commentary",
		shortName: "Matthew Henry",
		description: "Classic devotional & expository pericope commentary",
		license: "Public Domain",
		licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
		website: "https://en.wikipedia.org/wiki/Matthew_Henry",
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
