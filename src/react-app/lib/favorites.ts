import { BIBLE_BOOKS, getBookByNumber } from "../../shared/books";
import type { FavoriteItem } from "../../shared/types";

export const FAVORITES_STORAGE_KEY = "logos.reader.favorites.v1";

export function makeFavoriteId(bookNumber: number, chapter: number, verse?: number): string {
	return verse !== undefined ? `${bookNumber}:${chapter}:${verse}` : `${bookNumber}:${chapter}`;
}

function truncatePreview(text: string | null | undefined, maxLen = 140): string | undefined {
	if (typeof text !== "string") return undefined;
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return undefined;
	if (normalized.length <= maxLen) return normalized;
	return `${normalized.slice(0, maxLen - 1).trimEnd()}…`;
}

export function readStoredFavorites(): FavoriteItem[] {
	if (typeof localStorage === "undefined") return [];
	try {
		const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const seen = new Set<string>();
		const items: FavoriteItem[] = [];
		for (const entry of parsed) {
			if (!entry || typeof entry !== "object") continue;
			const rec = entry as Record<string, unknown>;
			const book = typeof rec.bookNumber === "number" ? getBookByNumber(rec.bookNumber) : undefined;
			if (!book) continue;
			if (
				typeof rec.chapter !== "number" ||
				!Number.isInteger(rec.chapter) ||
				rec.chapter < 1 ||
				rec.chapter > book.chapters
			) {
				continue;
			}
			const verse =
				typeof rec.verse === "number" && Number.isInteger(rec.verse) && rec.verse >= 1
					? rec.verse
					: undefined;
			const id = makeFavoriteId(book.number, rec.chapter, verse);
			if (seen.has(id)) continue;
			seen.add(id);
			items.push({
				id,
				bookNumber: book.number,
				chapter: rec.chapter,
				verse,
				enText: truncatePreview(typeof rec.enText === "string" ? rec.enText : undefined),
				koText: truncatePreview(typeof rec.koText === "string" ? rec.koText : undefined),
				createdAt:
					typeof rec.createdAt === "number" && Number.isFinite(rec.createdAt) ? rec.createdAt : 0,
			});
		}
		return items;
	} catch {
		return [];
	}
}

export function writeStoredFavorites(items: FavoriteItem[]): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(items));
	} catch {
		// Ignore storage quota errors
	}
}

export function toggleFavoriteItem(
	items: FavoriteItem[],
	input: {
		bookNumber: number;
		chapter: number;
		verse?: number;
		enText?: string | null;
		koText?: string | null;
	},
): FavoriteItem[] {
	const id = makeFavoriteId(input.bookNumber, input.chapter, input.verse);
	if (items.some((item) => item.id === id)) {
		return items.filter((item) => item.id !== id);
	}
	const nextItem: FavoriteItem = {
		id,
		bookNumber: input.bookNumber,
		chapter: input.chapter,
		verse: input.verse,
		enText: truncatePreview(input.enText),
		koText: truncatePreview(input.koText),
		createdAt: Date.now(),
	};
	return [nextItem, ...items];
}

export function formatFavoriteLabel(item: FavoriteItem): {
	refEn: string;
	refKo: string;
	kind: "chapter" | "verse";
} {
	const book = getBookByNumber(item.bookNumber) ?? BIBLE_BOOKS[0];
	if (item.verse !== undefined) {
		return {
			refEn: `${book.en} ${item.chapter}:${item.verse}`,
			refKo: `${book.ko} ${item.chapter}장 ${item.verse}절`,
			kind: "verse",
		};
	}
	return {
		refEn: `${book.en} ${item.chapter}`,
		refKo: `${book.ko} ${item.chapter}장`,
		kind: "chapter",
	};
}
