import type { FavoriteItem } from "../../shared/types";
import {
	finiteTimestamp,
	formatBilingualRef,
	MAX_STORED_ITEMS,
	readStoredCollection,
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
	return readStoredCollection(FAVORITES_STORAGE_KEY, (rec, bookNumber, chapter) => {
		const verse =
			typeof rec.verse === "number" && Number.isInteger(rec.verse) && rec.verse >= 1
				? rec.verse
				: undefined;
		return {
			id: makeFavoriteId(bookNumber, chapter, verse),
			bookNumber,
			chapter,
			verse,
			koText: truncatePreview(typeof rec.koText === "string" ? rec.koText : undefined),
			createdAt: finiteTimestamp(rec.createdAt),
		};
	});
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
