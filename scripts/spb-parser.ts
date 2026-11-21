import { getBookByNumber } from "../src/shared/books";
import type { BookBibleData, VerseEntry } from "../src/shared/types";

interface SpbParseResult {
	abbreviation: string;
	books: Map<number, BookBibleData>;
}

const PSALM_SUPERSCRIPTION_RE =
	/^((?:[A-Z][A-Z0-9 ,:;'"\-()]*\.)(?:\s+[A-Z][A-Z0-9 ,:;'"\-()]*\.)*)\s*(.+)$/;
const MINOR_WORDS = new Set(["of", "the", "to", "for", "with", "when", "after", "in", "on"]);

function formatSuperscription(raw: string): string {
	return raw
		.trim()
		.replace(/\.$/, "")
		.toLowerCase()
		.replace(/\b[a-z]+/g, (word, offset: number) => {
			if (word === "lord") return "LORD";
			if (offset > 0 && MINOR_WORDS.has(word)) return word;
			return word.charAt(0).toUpperCase() + word.slice(1);
		});
}

export function normalizeSpbText(rawText: string): string {
	return rawText
		.replace(/([A-Za-z0-9,;:'"])-\s+/g, "$1—")
		.replace(/\s+--\s+/g, " — ")
		.replace(/\s+/g, " ")
		.trim();
}

export function extractPsalmSuperscription(
	bookNumber: number,
	verseNumber: number,
	text: string,
): { heading?: string; text: string } {
	if (bookNumber !== 19 || verseNumber !== 1) return { text };

	const match = text.match(PSALM_SUPERSCRIPTION_RE);
	if (!match) return { text };

	const candidateHeading = match[1];
	const remainder = match[2].trim();
	// Only treat as a superscription if at least 2 words (regex already enforces uppercase).
	if (!candidateHeading.includes(" ") || !remainder) {
		return { text };
	}

	return { heading: formatSuperscription(candidateHeading), text: remainder };
}

export function parseSpbContent(content: string, translationId = "esv"): SpbParseResult {
	const lines = content.split(/\r?\n/);
	let abbreviation = "ESV";
	let inVerses = false;
	const books = new Map<number, BookBibleData>();

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (!line) continue;

		if (!inVerses) {
			if (line === "-----") {
				inVerses = true;
			} else if (line.startsWith("##Abbreviation:")) {
				abbreviation = line.replace("##Abbreviation:", "").trim();
			}
			continue;
		}

		const parts = line.split("\t");
		if (parts.length < 5) continue;

		const bookNumber = Number.parseInt(parts[1], 10);
		const chapterNumber = Number.parseInt(parts[2], 10);
		const verseNumber = Number.parseInt(parts[3], 10);
		if (Number.isNaN(bookNumber) || Number.isNaN(chapterNumber) || Number.isNaN(verseNumber)) {
			continue;
		}

		const meta = getBookByNumber(bookNumber);
		if (!meta) continue;

		let bookData = books.get(bookNumber);
		if (!bookData) {
			bookData = { translationId, bookNumber, usfm: meta.usfm, chapters: {} };
			books.set(bookNumber, bookData);
		}

		const normalized = normalizeSpbText(parts.slice(4).join(" "));
		const { heading, text } = extractPsalmSuperscription(bookNumber, verseNumber, normalized);

		const chapterKey = String(chapterNumber);
		const chapterVerses = (bookData.chapters[chapterKey] ??= []);
		const entry: VerseEntry = heading
			? { verse: verseNumber, text, heading }
			: { verse: verseNumber, text };
		chapterVerses.push(entry);
	}

	return { abbreviation, books };
}
