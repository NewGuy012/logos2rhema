import { BIBLE_BOOKS, BOOK_ALIASES, getBookByNumber, getBookByUsfm } from "../../src/shared/books";
import type { BookMeta } from "../../src/shared/types";

function normalizeQuery(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isExactBookMatch(book: BookMeta, raw: string, normalized: string): boolean {
	return (
		book.en.toLowerCase() === normalized ||
		book.enShort.toLowerCase() === normalized ||
		book.ko === raw ||
		book.koShort === raw
	);
}

/** Resolve a single book token (USFM, English, Korean, alias, or unambiguous prefix). */
export function resolveBookToken(rawToken: string): BookMeta {
	const raw = rawToken.trim();
	if (!raw) {
		throw new Error("Empty book identifier.");
	}

	const byUsfm = getBookByUsfm(raw);
	if (byUsfm) return byUsfm;

	const normalized = normalizeQuery(raw);
	for (const book of BIBLE_BOOKS) {
		if (isExactBookMatch(book, raw, normalized)) return book;
	}

	const aliasNum = BOOK_ALIASES.get(normalized) ?? BOOK_ALIASES.get(raw);
	if (aliasNum !== undefined) {
		const aliased = getBookByNumber(aliasNum);
		if (aliased) return aliased;
	}

	const compact = normalized.replace(/\s+/g, "");
	const prefixMatches = BIBLE_BOOKS.filter(
		(book) =>
			book.en.toLowerCase().replace(/\s+/g, "").startsWith(compact) || book.ko.startsWith(raw),
	);
	if (prefixMatches.length === 1) return prefixMatches[0];
	if (prefixMatches.length > 1) {
		const preview = prefixMatches
			.slice(0, 5)
			.map((b) => `${b.usfm} (${b.en})`)
			.join(", ");
		const suffix = prefixMatches.length > 5 ? ", ..." : "";
		throw new Error(`Ambiguous book identifier "${rawToken}" (matches: ${preview}${suffix})`);
	}

	throw new Error(`Unknown book identifier: "${rawToken}"`);
}

/** Parse repeatable or comma-separated `--book` / `--books` tokens into unique `BookMeta` entries. */
export function resolveBookList(rawValues: readonly string[]): BookMeta[] {
	const seen = new Set<string>();
	const resolved: BookMeta[] = [];

	for (const raw of rawValues) {
		for (const part of raw.split(",")) {
			const token = part.trim();
			if (!token) continue;
			const book = resolveBookToken(token);
			if (!seen.has(book.usfm)) {
				seen.add(book.usfm);
				resolved.push(book);
			}
		}
	}

	if (resolved.length === 0) {
		throw new Error("Expected at least one book identifier after --book / --books.");
	}

	return resolved;
}
