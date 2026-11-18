import { getBookByNumber } from "../../shared/books";
import { analyzeKoreanChapter, type ChapterAnalysisResult } from "../../shared/korean-morphology";
import { CANONICAL_BIBLES } from "../../shared/translations";
import type {
	AlignedVerse,
	BookBibleData,
	ChapterAudioResponse,
	LexiconMap,
	ReaderConfigResponse,
	TranslationMeta,
	VerseEntry,
} from "../../shared/types";

const bundledBookCache = new Map<string, Promise<BookBibleData>>();
const remotePassageCache = new Map<string, Promise<VerseEntry[]>>();
let lexiconPromise: Promise<LexiconMap> | null = null;

export async function loadLexicon(): Promise<LexiconMap> {
	if (!lexiconPromise) {
		lexiconPromise = fetch("/data/lexicon.json")
			.then((res) => {
				if (!res.ok) throw new Error("Failed to load lexicon");
				return res.json() as Promise<LexiconMap>;
			})
			.catch(() => {
				lexiconPromise = null;
				return {};
			});
	}
	return lexiconPromise;
}

export async function loadReaderConfig(): Promise<ReaderConfigResponse> {
	try {
		const res = await fetch("/api/config");
		if (res.ok) {
			return (await res.json()) as ReaderConfigResponse;
		}
	} catch {
		// Fallback to canonical bundled config if API is unreachable during isolated testing
	}
	return {
		english: CANONICAL_BIBLES.en,
		korean: CANONICAL_BIBLES.ko,
		bibleBrainEnabled: false,
		esvAudioEnabled: false,
	};
}

async function fetchBundledBook(translationId: string, usfm: string): Promise<BookBibleData> {
	const cacheKey = `${translationId}:${usfm}`;
	const existing = bundledBookCache.get(cacheKey);
	if (existing) return existing;

	const promise = fetch(`/data/bibles/${translationId}/${usfm}.json`)
		.then((res) => {
			if (!res.ok) {
				throw new Error(`Failed to load ${translationId} ${usfm}`);
			}
			return res.json() as Promise<BookBibleData>;
		})
		.catch((err) => {
			bundledBookCache.delete(cacheKey);
			throw err;
		});
	bundledBookCache.set(cacheKey, promise);
	return promise;
}

export async function loadTranslationChapter(
	translation: TranslationMeta,
	bookNumber: number,
	chapter: number,
): Promise<VerseEntry[]> {
	const book = getBookByNumber(bookNumber);
	if (!book) throw new Error(`Unknown book number ${bookNumber}`);

	if (translation.source === "bundled") {
		const data = await fetchBundledBook(translation.id, book.usfm);
		return data.chapters[String(chapter)] ?? [];
	}

	const cacheKey = `${translation.id}:${book.usfm}:${chapter}`;
	const existing = remotePassageCache.get(cacheKey);
	if (existing) return existing;

	const promise = fetch(
		`/api/passage/${encodeURIComponent(translation.id)}/${book.usfm}/${chapter}`,
	)
		.then(async (res) => {
			if (!res.ok) {
				throw new Error(`${translation.code} does not have ${book.en} ${chapter}`);
			}
			const payload = (await res.json()) as { verses?: VerseEntry[] };
			return payload.verses ?? [];
		})
		.catch((err) => {
			remotePassageCache.delete(cacheKey);
			throw err;
		});
	remotePassageCache.set(cacheKey, promise);
	return promise;
}

export async function loadSyncedChapterAudio(options: {
	usfm: string;
	chapter: number;
}): Promise<ChapterAudioResponse> {
	try {
		const res = await fetch(`/api/audio/${options.usfm}/${options.chapter}`);
		if (res.ok) {
			return (await res.json()) as ChapterAudioResponse;
		}
	} catch {
		// Fallback gracefully when running offline or in isolated DOM tests
	}
	return {
		bookUsfm: options.usfm,
		chapter: options.chapter,
		tracks: [],
		unavailableReason: "Audio lookup failed for this chapter.",
	};
}

export function alignChapterVerses(
	enVerses: VerseEntry[],
	koVerses: VerseEntry[],
	lexicon: LexiconMap,
): { aligned: AlignedVerse[]; analysis: ChapterAnalysisResult } {
	const analysis = analyzeKoreanChapter(koVerses, lexicon);
	const enMap = new Map<number, VerseEntry>(enVerses.map((v) => [v.verse, v]));
	const koMap = new Map<number, VerseEntry>(koVerses.map((v) => [v.verse, v]));

	const allVerseNumbers = [...new Set([...enMap.keys(), ...koMap.keys()])].sort((a, b) => a - b);

	const aligned: AlignedVerse[] = allVerseNumbers.map((verseNum) => {
		const enEntry = enMap.get(verseNum);
		const koEntry = koMap.get(verseNum);
		return {
			verse: verseNum,
			enText: enEntry?.text ?? null,
			enHeading: enEntry?.heading,
			koText: koEntry?.text ?? null,
			koHeading: koEntry?.heading,
			tokens: analysis.tokensByVerse.get(verseNum) ?? [],
		};
	});

	return { aligned, analysis };
}
