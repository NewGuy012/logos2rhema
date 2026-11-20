import { BIBLE_BOOKS, findBookByQuery, getBookByUsfm } from "../../src/shared/books";
import type { BookMeta } from "../../src/shared/types";

function normalizeQuery(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isExactBookMatch(book: BookMeta, raw: string, normalized: string): boolean {
	return (
		book.usfm.toLowerCase() === normalized ||
		book.en.toLowerCase() === normalized ||
		book.enShort.toLowerCase() === normalized ||
		book.ko === raw ||
		book.koShort === raw
	);
}

/**
 * Resolve a single book identifier (USFM, English, Korean, short form, or unambiguous prefix).
 */
export function resolveBookToken(rawToken: string): BookMeta {
	const raw = rawToken.trim();
	if (!raw) {
		throw new Error("Empty book identifier.");
	}

	const byUsfm = getBookByUsfm(raw);
	if (byUsfm) return byUsfm;

	const normalized = normalizeQuery(raw);
	for (const book of BIBLE_BOOKS) {
		if (isExactBookMatch(book, raw, normalized)) {
			return book;
		}
	}

	const compact = normalized.replace(/\s+/g, "");
	const prefixMatches = BIBLE_BOOKS.filter(
		(book) =>
			book.en.toLowerCase().replace(/\s+/g, "").startsWith(compact) || book.ko.startsWith(raw),
	);
	if (prefixMatches.length === 1) {
		return prefixMatches[0];
	}
	if (prefixMatches.length > 1) {
		const preview = prefixMatches
			.slice(0, 5)
			.map((b) => `${b.usfm} (${b.en})`)
			.join(", ");
		const suffix = prefixMatches.length > 5 ? ", ..." : "";
		throw new Error(`Ambiguous book identifier "${rawToken}" (matches: ${preview}${suffix})`);
	}

	// Fall back to explicit aliases in findBookByQuery (e.g. "psalm", "sos", "jn", "요한1서")
	const aliasMatch = findBookByQuery(raw);
	if (aliasMatch) {
		const aliasCompact = normalizeQuery(aliasMatch.en).replace(/\s+/g, "");
		if (aliasMatch.ko !== raw && !aliasCompact.startsWith(compact)) {
			return aliasMatch;
		}
	}

	throw new Error(`Unknown book identifier: "${rawToken}"`);
}

/**
 * Parse repeatable / comma-separated `--book` and `--books` arguments into deduplicated BookMeta entries.
 */
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
