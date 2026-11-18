import { getBookByNumber } from "../../shared/books";
import { analyzeKoreanChapter, type ChapterAnalysisResult } from "../../shared/korean-morphology";
import {
	BUILTIN_ENGLISH_TRANSLATIONS,
	BUILTIN_KOREAN_TRANSLATIONS,
} from "../../shared/translations";
import type {
	AlignedVerse,
	BookBibleData,
	ChapterAudioResponse,
	LexiconMap,
	TranslationMeta,
	VerseEntry,
} from "../../shared/types";

const bundledBookCache = new Map<string, Promise<BookBibleData>>();
const remotePassageCache = new Map<string, Promise<VerseEntry[]>>();
let lexiconPromise: Promise<LexiconMap> | null = null;

export async function loadLexicon(): Promise<LexiconMap> {
	if (!lexiconPromise) {
		lexiconPromise = fetch("/data/lexicon.json").then(async (res) => {
			if (!res.ok) return {};
			return (await res.json()) as LexiconMap;
		});
	}
	return lexiconPromise;
}

export async function loadAvailableTranslations(): Promise<{
	english: TranslationMeta[];
	korean: TranslationMeta[];
	bibleBrainEnabled: boolean;
}> {
	try {
		const res = await fetch("/api/translations");
		if (res.ok) {
			return (await res.json()) as {
				english: TranslationMeta[];
				korean: TranslationMeta[];
				bibleBrainEnabled: boolean;
			};
		}
	} catch {
		// Fallback to built-ins if API is unreachable during isolated testing
	}
	return {
		english: [...BUILTIN_ENGLISH_TRANSLATIONS],
		korean: [...BUILTIN_KOREAN_TRANSLATIONS],
		bibleBrainEnabled: false,
	};
}

async function fetchBundledBook(translationId: string, usfm: string): Promise<BookBibleData> {
	const cacheKey = `${translationId}:${usfm}`;
	const existing = bundledBookCache.get(cacheKey);
	if (existing) return existing;

	const promise = fetch(`/data/bibles/${translationId}/${usfm}.json`).then(async (res) => {
		if (!res.ok) {
			throw new Error(`Failed to load ${translationId} ${usfm}`);
		}
		return (await res.json()) as BookBibleData;
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
	).then(async (res) => {
		if (!res.ok) {
			throw new Error(`${translation.code} does not have ${book.en} ${chapter}`);
		}
		const payload = (await res.json()) as { verses?: VerseEntry[] };
		return payload.verses ?? [];
	});
	remotePassageCache.set(cacheKey, promise);
	return promise;
}

export async function loadSyncedChapterAudio(options: {
	usfm: string;
	chapter: number;
	koTranslation: TranslationMeta;
	enTranslation: TranslationMeta;
}): Promise<ChapterAudioResponse> {
	const params = new URLSearchParams({
		ko: options.koTranslation.id,
		en: options.enTranslation.id,
	});
	if (options.koTranslation.audioFilesetIds?.length) {
		params.set("koFileset", options.koTranslation.audioFilesetIds.join(","));
	}
	if (options.enTranslation.audioFilesetIds?.length) {
		params.set("enFileset", options.enTranslation.audioFilesetIds.join(","));
	}

	const res = await fetch(`/api/audio/${options.usfm}/${options.chapter}?${params.toString()}`);
	if (!res.ok) {
		return {
			bookUsfm: options.usfm,
			chapter: options.chapter,
			tracks: [],
			unavailableReason: "Audio lookup failed for this chapter.",
		};
	}
	return (await res.json()) as ChapterAudioResponse;
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
