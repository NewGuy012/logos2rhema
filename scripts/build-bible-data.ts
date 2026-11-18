import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { BIBLICAL_GLOSSARY } from "../src/shared/biblical-glossary";
import { BIBLE_BOOKS, getBookByNumber, KRV_BOOK_NAME_TO_NUMBER } from "../src/shared/books";
import {
	containsHangul,
	replaceLastFinalConsonant,
	stripLastFinalConsonant,
} from "../src/shared/hangul";
import { analyzeKoreanVerse } from "../src/shared/korean-morphology";
import { parseSpbContent } from "../src/shared/spb-parser";
import type { BookBibleData, LexiconEntry, LexiconMap, VerseEntry } from "../src/shared/types";

const ROOT_DIR = join(import.meta.dir, "..");
const DATA_SOURCES_DIR = join(ROOT_DIR, "data-sources");
const PUBLIC_DATA_DIR = join(ROOT_DIR, "public", "data");

const KRV_SOURCE_URL =
	"https://raw.githubusercontent.com/bluesaurel/Korean-Bible-1961-KRV/main/bible_1961_krv.json";
const KENGDIC_SOURCE_URL =
	"https://raw.githubusercontent.com/garfieldnate/kengdic/master/kengdic.tsv";

interface RawKrvBook {
	book: string;
	chapters: Array<{
		chapter: number;
		verses: Array<{
			verse: number;
			text: string;
		}>;
	}>;
}

async function ensureSourceFile(filename: string, url?: string): Promise<string> {
	const targetPath = join(DATA_SOURCES_DIR, filename);
	const file = Bun.file(targetPath);
	if (await file.exists()) {
		return targetPath;
	}
	if (!url) {
		throw new Error(`Required source file missing: ${targetPath}`);
	}
	console.log(`Downloading ${filename} from ${url}...`);
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
	}
	await mkdir(DATA_SOURCES_DIR, { recursive: true });
	await Bun.write(targetPath, await res.arrayBuffer());
	return targetPath;
}

function cleanGloss(rawGloss: string): string {
	let cleaned = rawGloss.replace(/\s+/g, " ").trim();
	// Drop unbalanced leading "(" artifacts found in some kengdic entries
	if (cleaned.startsWith("(") && !cleaned.includes(")")) {
		cleaned = cleaned.slice(1).trim();
	}
	// Strip leading "A " / "The " only if uppercase artifact
	cleaned = cleaned.replace(/^(?:A|An|The)\s+([a-z])/i, "$1");
	// Keep at most 2 comma-separated senses for tooltip readability
	const parts = cleaned
		.split(/\s*[;,]\s*/)
		.map((s) => s.trim())
		.filter(Boolean);
	return parts.slice(0, 2).join(", ");
}

function scoreKengdicSense(gloss: string, hanja: string): number {
	let score = 0;
	if (gloss.length >= 2 && gloss.length <= 28) score += 20;
	if (gloss.length > 55) score -= 15;
	if (/bus|train|register|gizzard|slang|computing/i.test(gloss)) score -= 30;
	if (/god|heaven|earth|spirit|love|faith|grace|truth|king|light|dark/i.test(gloss)) score += 10;
	if (hanja) score += 5;
	if (!/[()]/.test(gloss)) score += 3;
	return score;
}

async function loadFullKengdic(tsvPath: string): Promise<LexiconMap> {
	const tsv = await Bun.file(tsvPath).text();
	const lines = tsv.split(/\r?\n/);
	const bestScored = new Map<string, { entry: LexiconEntry; score: number }>();

	for (let i = 1; i < lines.length; i++) {
		const cols = lines[i].split("\t");
		if (cols.length < 4) continue;
		const surface = cols[1]?.trim();
		const rawHanja = cols[2]?.trim() ?? "";
		const rawGloss = cols[3]?.trim() ?? "";
		if (!surface || !rawGloss || !containsHangul(surface) || surface.includes(" ")) {
			continue;
		}
		const cleaned = cleanGloss(rawGloss);
		if (!cleaned || cleaned.length < 2) continue;

		const score = scoreKengdicSense(cleaned, rawHanja);
		const existing = bestScored.get(surface);
		if (!existing || score > existing.score) {
			const entry: LexiconEntry = { gloss: cleaned };
			if (rawHanja) entry.hanja = rawHanja;
			bestScored.set(surface, { entry, score });
		}
	}

	const map: LexiconMap = {};
	for (const [key, value] of bestScored.entries()) {
		map[key] = value.entry;
	}
	return map;
}

function parseKrvBooks(rawBooks: RawKrvBook[]): Map<number, BookBibleData> {
	const result = new Map<number, BookBibleData>();

	for (const rawBook of rawBooks) {
		const bookNumber = KRV_BOOK_NAME_TO_NUMBER[rawBook.book];
		if (!bookNumber) {
			throw new Error(`Unknown KRV book key: ${rawBook.book}`);
		}
		const meta = getBookByNumber(bookNumber);
		if (!meta) continue;

		const chapters: Record<string, VerseEntry[]> = {};
		for (const chap of rawBook.chapters) {
			chapters[String(chap.chapter)] = chap.verses.map((v) => ({
				verse: v.verse,
				text: v.text.replace(/\s+/g, " ").trim(),
			}));
		}

		result.set(bookNumber, {
			translationId: "krv",
			bookNumber,
			usfm: meta.usfm,
			chapters,
		});
	}

	return result;
}

function buildCompactBibleLexicon(
	krvBooks: Map<number, BookBibleData>,
	fullKengdic: LexiconMap,
): { lexicon: LexiconMap; totalHangulWords: number; matchedWords: number } {
	const compact: LexiconMap = {};
	let totalHangulWords = 0;
	let matchedWords = 0;

	// Pre-warm common suffixes so analyzeKoreanVerse extracts exact matched lemmas
	for (const book of krvBooks.values()) {
		for (const verses of Object.values(book.chapters)) {
			for (const verse of verses) {
				const tokens = analyzeKoreanVerse(verse.text, fullKengdic);
				for (const token of tokens) {
					if (!token.word || !containsHangul(token.word)) continue;
					totalHangulWords++;
					if (token.matched) {
						matchedWords++;
						if (!BIBLICAL_GLOSSARY[token.lemma] && fullKengdic[token.lemma]) {
							compact[token.lemma] = fullKengdic[token.lemma];
						}
					} else {
						// Check a couple extra stem possibilities directly against fullKengdic
						const altCandidates = [
							token.lemma,
							`${token.lemma}다`,
							replaceLastFinalConsonant(token.lemma, "ㄹ")
								? `${replaceLastFinalConsonant(token.lemma, "ㄹ")}다`
								: "",
							stripLastFinalConsonant(token.lemma)?.stem ?? "",
						].filter(Boolean);
						for (const alt of altCandidates) {
							if (fullKengdic[alt] && !BIBLICAL_GLOSSARY[alt]) {
								compact[alt] = fullKengdic[alt];
								break;
							}
						}
					}
				}
			}
		}
	}

	return { lexicon: compact, totalHangulWords, matchedWords };
}

async function main() {
	console.log("Building Logos bilingual Bible data...");

	const esvPath = await ensureSourceFile("esv.spb");
	const krvPath = await ensureSourceFile("krv_1961.json", KRV_SOURCE_URL);
	const kengdicPath = await ensureSourceFile("kengdic.tsv", KENGDIC_SOURCE_URL);

	const [esvText, krvRaw, fullKengdic] = await Promise.all([
		Bun.file(esvPath).text(),
		Bun.file(krvPath).json() as Promise<RawKrvBook[]>,
		loadFullKengdic(kengdicPath),
	]);

	const esvParsed = parseSpbContent(esvText, "esv");
	const krvBooks = parseKrvBooks(krvRaw);

	console.log(`Parsed ESV: ${esvParsed.books.size} books`);
	console.log(`Parsed KRV: ${krvBooks.size} books`);
	console.log(`Loaded Kengdic entries: ${Object.keys(fullKengdic).length}`);

	const esvOutDir = join(PUBLIC_DATA_DIR, "bibles", "esv");
	const krvOutDir = join(PUBLIC_DATA_DIR, "bibles", "krv");
	await mkdir(esvOutDir, { recursive: true });
	await mkdir(krvOutDir, { recursive: true });

	for (const book of BIBLE_BOOKS) {
		const esvBook = esvParsed.books.get(book.number);
		const krvBook = krvBooks.get(book.number);
		if (!esvBook || !krvBook) {
			throw new Error(`Missing book ${book.usfm} (${book.number})`);
		}
		await Promise.all([
			Bun.write(join(esvOutDir, `${book.usfm}.json`), JSON.stringify(esvBook)),
			Bun.write(join(krvOutDir, `${book.usfm}.json`), JSON.stringify(krvBook)),
		]);
	}

	await Bun.write(join(PUBLIC_DATA_DIR, "books.json"), JSON.stringify(BIBLE_BOOKS, null, 2));

	const { lexicon, totalHangulWords, matchedWords } = buildCompactBibleLexicon(
		krvBooks,
		fullKengdic,
	);
	const lexiconJson = JSON.stringify(lexicon);
	await Bun.write(join(PUBLIC_DATA_DIR, "lexicon.json"), lexiconJson);

	const pct = ((matchedWords / totalHangulWords) * 100).toFixed(1);
	console.log(
		`Built compact Bible lexicon: ${Object.keys(lexicon).length} entries (${(lexiconJson.length / 1024).toFixed(1)} KB)`,
	);
	console.log(`KRV word gloss coverage: ${matchedWords}/${totalHangulWords} (${pct}%)`);
	console.log("Done!");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
