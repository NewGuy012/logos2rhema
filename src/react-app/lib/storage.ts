import { getBookByNumber } from "../../shared/books";
import type { BookMeta } from "../../shared/types";

export const MAX_STORED_ITEMS = 200;

export function readJsonStorage(key: string): unknown {
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

export function writeJsonStorage(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {}
}

export function parseStoredBookChapter(
	rec: Record<string, unknown>,
): { book: BookMeta; chapter: number } | null {
	const book = typeof rec.bookNumber === "number" ? getBookByNumber(rec.bookNumber) : undefined;
	if (
		!book ||
		typeof rec.chapter !== "number" ||
		!Number.isInteger(rec.chapter) ||
		rec.chapter < 1 ||
		rec.chapter > book.chapters
	) {
		return null;
	}
	return { book, chapter: rec.chapter };
}

export function readStoredCollection<T extends { id: string }>(
	key: string,
	parse: (rec: Record<string, unknown>, bookNumber: number, chapter: number) => T | null,
): T[] {
	const parsed = readJsonStorage(key);
	if (!Array.isArray(parsed)) return [];
	const seen = new Set<string>();
	const items: T[] = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== "object") continue;
		const rec = entry as Record<string, unknown>;
		const ref = parseStoredBookChapter(rec);
		if (!ref) continue;
		const item = parse(rec, ref.book.number, ref.chapter);
		if (!item || seen.has(item.id)) continue;
		seen.add(item.id);
		items.push(item);
		if (items.length >= MAX_STORED_ITEMS) break;
	}
	return items;
}

export function finiteTimestamp(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
