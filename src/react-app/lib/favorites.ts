import type { FavoriteItem } from "../../shared/types";
import {
	formatBilingualRef,
	MAX_STORED_ITEMS,
	parseStoredBookChapter,
	readJsonStorage,
	writeJsonStorage,
} from "./storage";

export const FAVORITES_STORAGE_KEY = "logos.reader.favorites.v1";

export function makeFavoriteId(bookNumber: number, chapter: number, verse?: number): string {
	return verse !== undefined ? `${bookNumber}:${chapter}:${verse}` : `${bookNumber}:${chapter}`;
}

function truncatePreview(text: string | null | undefined, maxLen = 140): string | undefined {
	if (typeof text !== "string") return undefined;
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return undefined;
	return normalized.length <= maxLen ? normalized : `${normalized.slice(0, maxLen - 1).trimEnd()}…`;
}

export function readStoredFavorites(): FavoriteItem[] {
	const parsed = readJsonStorage(FAVORITES_STORAGE_KEY);
	if (!Array.isArray(parsed)) return [];
	const seen = new Set<string>();
	const items: FavoriteItem[] = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== "object") continue;
		const rec = entry as Record<string, unknown>;
		const ref = parseStoredBookChapter(rec);
		if (!ref) continue;
		const verse =
			typeof rec.verse === "number" && Number.isInteger(rec.verse) && rec.verse >= 1
				? rec.verse
				: undefined;
		const id = makeFavoriteId(ref.book.number, ref.chapter, verse);
		if (seen.has(id)) continue;
		seen.add(id);
		items.push({
			id,
			bookNumber: ref.book.number,
			chapter: ref.chapter,
			verse,
			enText: truncatePreview(typeof rec.enText === "string" ? rec.enText : undefined),
			koText: truncatePreview(typeof rec.koText === "string" ? rec.koText : undefined),
			createdAt:
				typeof rec.createdAt === "number" && Number.isFinite(rec.createdAt) ? rec.createdAt : 0,
		});
		if (items.length >= MAX_STORED_ITEMS) break;
	}
	return items;
}

export function writeStoredFavorites(items: FavoriteItem[]): void {
	writeJsonStorage(FAVORITES_STORAGE_KEY, items.slice(0, MAX_STORED_ITEMS));
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
	return [nextItem, ...items].slice(0, MAX_STORED_ITEMS);
}

export function formatFavoriteLabel(item: FavoriteItem): {
	refEn: string;
	refKo: string;
	kind: "chapter" | "verse";
} {
	return {
		...formatBilingualRef(item.bookNumber, item.chapter, item.verse),
		kind: item.verse !== undefined ? "verse" : "chapter",
	};
}
