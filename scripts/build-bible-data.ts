import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { BIBLICAL_GLOSSARY } from "../src/shared/biblical-glossary";
import { BIBLE_BOOKS, getBookByNumber } from "../src/shared/books";
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
	"https://raw.githubusercontent.com/bluesaurel/Korean-Bible-1961-KRV/2fdb91e77d323b99bacaa9b61fc18f318b703240/bible_1961_krv.json";
const KENGDIC_SOURCE_URL =
	"https://raw.githubusercontent.com/garfieldnate/kengdic/793de2369c9a98b944154eb4695d26854d2de59b/kengdic.tsv";

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
	const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
	if (!res.ok) {
		throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
	}
	await mkdir(DATA_SOURCES_DIR, { recursive: true });
	await Bun.write(targetPath, await res.arrayBuffer());
	return targetPath;
}

interface KengdicCandidate {
	entry: LexiconEntry;
	grade: string;
}

const ENGLISH_STOPWORDS = new Set([
	"the",
	"and",
	"that",
	"for",
	"with",
	"his",
	"her",
	"was",
	"were",
	"are",
	"not",
	"but",
	"they",
	"them",
	"their",
	"you",
	"your",
	"our",
	"all",
	"who",
	"from",
	"into",
	"unto",
	"shall",
	"will",
	"have",
	"had",
	"has",
	"this",
	"then",
	"said",
	"when",
	"upon",
	"out",
	"one",
	"there",
	"she",
	"him",
	"sth",
	"etc",
	"some",
]);

function extractEnglishKeywords(text: string): string[] {
	const matches = text.toLowerCase().match(/[a-z]{3,}/g);
	if (!matches) return [];
	return matches.filter((w) => !ENGLISH_STOPWORDS.has(w));
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
	let result = parts.slice(0, 2).join(", ");
	const openParens = (result.match(/\(/g) ?? []).length;
	const closeParens = (result.match(/\)/g) ?? []).length;
	if (openParens > closeParens) {
		result = `${result})`;
	} else if (closeParens > openParens) {
		result = result.replace(/\)+$/, "");
	}
	return result;
}

function scoreKengdicSense(candidate: KengdicCandidate, esvContext?: Map<string, number>): number {
	const { entry, grade } = candidate;
	const gloss = entry.gloss;
	let score = 0;

	// Use Kengdic frequency grade (A > B > C) instead of blindly rewarding Hanja homographs
	if (grade === "A") score += 25;
	else if (grade === "B") score += 16;
	else if (grade === "C") score += 6;

	if (gloss.length >= 2 && gloss.length <= 28) score += 12;
	if (gloss.length > 55) score -= 12;
	if (
		/bus|train|register|gizzard|slang|computing|glottis|softshell|librarian|emasculate|nonsuit|demimondaine|bedtick|calyptra|voiceprint/i.test(
			gloss,
		)
	) {
		score -= 30;
	}
	if (!/[()]/.test(gloss)) score += 3;

	if (esvContext) {
		let esvHits = 0;
		for (const kw of extractEnglishKeywords(gloss)) {
			const exact = esvContext.get(kw) ?? 0;
			const plural = esvContext.get(`${kw}s`) ?? 0;
			esvHits += exact + plural;
		}
		score += Math.min(45, esvHits * 8);
	}

	return score;
}

async function loadKengdicCandidates(tsvPath: string): Promise<Map<string, KengdicCandidate[]>> {
	const tsv = await Bun.file(tsvPath).text();
	const lines = tsv.split(/\r?\n/);
	const candidates = new Map<string, KengdicCandidate[]>();

	for (let i = 1; i < lines.length; i++) {
		const cols = lines[i].split("\t");
		if (cols.length < 4) continue;
		const surface = cols[1]?.trim();
		const rawHanja = cols[2]?.trim() ?? "";
		const rawGloss = cols[3]?.trim() ?? "";
		const grade = cols[4]?.trim() ?? "";
		if (!surface || !rawGloss || !containsHangul(surface) || surface.includes(" ")) {
			continue;
		}
		const cleaned = cleanGloss(rawGloss);
		if (!cleaned || cleaned.length < 2) continue;

		const entry: LexiconEntry = { gloss: cleaned };
		if (rawHanja) entry.hanja = rawHanja;
		const list = candidates.get(surface);
		if (list) {
			list.push({ entry, grade });
		} else {
			candidates.set(surface, [{ entry, grade }]);
		}
	}

	return candidates;
}

function buildEsvContextIndex(
	esvBooks: Map<number, BookBibleData>,
	krvBooks: Map<number, BookBibleData>,
	candidatesBySurface: Map<string, KengdicCandidate[]>,
): Map<string, Map<string, number>> {
	// Only track ESV co-occurrence for multi-sense Kengdic entries to keep memory minimal
	const ambiguousKeys = new Set<string>();
	for (const [key, list] of candidatesBySurface.entries()) {
		if (list.length >= 2 && key.length >= 2) {
			ambiguousKeys.add(key);
		}
	}

	const placeholderLexicon: LexiconMap = {};
	for (const key of ambiguousKeys) {
		placeholderLexicon[key] = { gloss: key };
	}

	const contextMap = new Map<string, Map<string, number>>();

	for (const [bookNum, krvBook] of krvBooks.entries()) {
		const esvBook = esvBooks.get(bookNum);
		if (!esvBook) continue;

		for (const [chapKey, krvVerses] of Object.entries(krvBook.chapters)) {
			const esvVerses = esvBook.chapters[chapKey];
			if (!esvVerses) continue;
			const esvByNum = new Map(esvVerses.map((v) => [v.verse, v.text]));

			for (const krvVerse of krvVerses) {
				const esvText = esvByNum.get(krvVerse.verse);
				if (!esvText) continue;
				const esvWords = [...new Set(extractEnglishKeywords(esvText))];
				if (esvWords.length === 0) continue;

				const tokens = analyzeKoreanVerse(krvVerse.text, placeholderLexicon);
				for (const tok of tokens) {
					if (!tok.matched || !ambiguousKeys.has(tok.lemma)) continue;
					let counts = contextMap.get(tok.lemma);
					if (!counts) {
						counts = new Map<string, number>();
						contextMap.set(tok.lemma, counts);
					}
					for (const ew of esvWords) {
						counts.set(ew, (counts.get(ew) ?? 0) + 1);
					}
				}
			}
		}
	}

	return contextMap;
}

function selectBestKengdicLexicon(
	candidatesBySurface: Map<string, KengdicCandidate[]>,
	contextIndex: Map<string, Map<string, number>>,
): LexiconMap {
	const map: LexiconMap = {};
	for (const [key, list] of candidatesBySurface.entries()) {
		const esvCtx = contextIndex.get(key);
		let best = list[0];
		let bestScore = scoreKengdicSense(best, esvCtx);
		for (let i = 1; i < list.length; i++) {
			const score = scoreKengdicSense(list[i], esvCtx);
			if (score > bestScore) {
				best = list[i];
				bestScore = score;
			}
		}
		map[key] = best.entry;
	}
	return map;
}

const KRV_BOOK_NAME_TO_NUMBER: Record<string, number> = Object.fromEntries(
	BIBLE_BOOKS.map((b) => [b.en.replace(/\s+/g, ""), b.number]),
);

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
						if (
							token.lemma.length >= 2 &&
							!BIBLICAL_GLOSSARY[token.lemma] &&
							fullKengdic[token.lemma]
						) {
							compact[token.lemma] = fullKengdic[token.lemma];
						}
					} else {
						// Check a couple extra stem possibilities directly against fullKengdic
						const withRieul = replaceLastFinalConsonant(token.lemma, "ㄹ");
						const altCandidates = [
							token.lemma,
							`${token.lemma}다`,
							withRieul ? `${withRieul}다` : "",
							stripLastFinalConsonant(token.lemma)?.stem ?? "",
						].filter((c) => c.length >= 2);
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

	const [esvText, krvRaw, kengdicCandidates] = await Promise.all([
		Bun.file(esvPath).text(),
		Bun.file(krvPath).json() as Promise<RawKrvBook[]>,
		loadKengdicCandidates(kengdicPath),
	]);

	const esvParsed = parseSpbContent(esvText, "esv");
	const krvBooks = parseKrvBooks(krvRaw);
	const esvContextIndex = buildEsvContextIndex(esvParsed.books, krvBooks, kengdicCandidates);
	const fullKengdic = selectBestKengdicLexicon(kengdicCandidates, esvContextIndex);

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
