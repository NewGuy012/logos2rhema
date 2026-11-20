import {
	hasVerseTimings,
	normalizeVerseTimings,
	SUPERTONIC_TRACK_ID,
} from "../../shared/audio-timings";
import { getBookByNumber } from "../../shared/books";
import { analyzeKoreanChapter, type ChapterAnalysisResult } from "../../shared/korean-morphology";
import { CANONICAL_BIBLES } from "../../shared/translations";
import type {
	AlignedVerse,
	BookAudioTimingsData,
	BookBibleData,
	BookMeta,
	ChapterAudioResponse,
	ChapterCommentaryResponse,
	ChapterTextResponse,
	CommentaryId,
	LexiconMap,
	VerseEntry,
} from "../../shared/types";

const MAX_COMMENTARY_CACHE_ENTRIES = 50;
export const MAX_ESV_CACHED_VERSES = 400;
const STATIC_TIMINGS_DIR_BY_TRACK_ID: Readonly<Record<string, string>> = {
	[SUPERTONIC_TRACK_ID]: "krv-supertonic",
};
const bundledBookCache = new Map<string, Promise<BookBibleData>>();
const esvChapterCache = new Map<string, { bookNumber: number; verses: VerseEntry[] }>();
const esvInFlightCache = new Map<string, Promise<VerseEntry[]>>();
const bundledTimingsCache = new Map<string, Promise<BookAudioTimingsData | null>>();
const commentaryCache = new Map<string, Promise<ChapterCommentaryResponse>>();
let lexiconPromise: Promise<LexiconMap> | null = null;

export function clearLoaderCaches(): void {
	bundledBookCache.clear();
	esvChapterCache.clear();
	esvInFlightCache.clear();
	bundledTimingsCache.clear();
	commentaryCache.clear();
	lexiconPromise = null;
}

export function getEsvCacheStats(): { chapters: number; verses: number } {
	let verses = 0;
	for (const entry of esvChapterCache.values()) {
		verses += entry.verses.length;
	}
	return { chapters: esvChapterCache.size, verses };
}

function cacheEsvChapter(book: BookMeta, chapter: number, verses: VerseEntry[]): void {
	if (verses.length > MAX_ESV_CACHED_VERSES) return;
	const key = `${book.usfm}:${chapter}`;
	esvChapterCache.delete(key);

	// Never cache more than half of any multi-chapter book (Crossway ESV compliance cap).
	if (book.chapters > 1) {
		const maxBookChapters = Math.floor(book.chapters / 2);
		const bookKeys: string[] = [];
		for (const [k, entry] of esvChapterCache.entries()) {
			if (entry.bookNumber === book.number) bookKeys.push(k);
		}
		while (bookKeys.length >= maxBookChapters) {
			const oldestBookKey = bookKeys.shift();
			if (oldestBookKey) esvChapterCache.delete(oldestBookKey);
		}
	}

	let totalVerses = getEsvCacheStats().verses;
	while (totalVerses + verses.length > MAX_ESV_CACHED_VERSES && esvChapterCache.size > 0) {
		const oldestKey = esvChapterCache.keys().next().value;
		if (!oldestKey) break;
		const oldest = esvChapterCache.get(oldestKey);
		esvChapterCache.delete(oldestKey);
		if (oldest) totalVerses -= oldest.verses.length;
	}

	esvChapterCache.set(key, { bookNumber: book.number, verses });
}

function cachedFetch<T>(
	cache: Map<string, Promise<T>>,
	key: string,
	loader: () => Promise<T>,
	maxEntries?: number,
): Promise<T> {
	const existing = cache.get(key);
	if (existing) {
		if (maxEntries) {
			cache.delete(key);
			cache.set(key, existing);
		}
		return existing;
	}
	if (maxEntries && cache.size >= maxEntries) {
		const oldestKey = cache.keys().next().value;
		if (oldestKey) cache.delete(oldestKey);
	}
	const promise = loader().catch((err) => {
		cache.delete(key);
		throw err;
	});
	cache.set(key, promise);
	return promise;
}

export async function loadLexicon(): Promise<LexiconMap> {
	if (!lexiconPromise) {
		lexiconPromise = fetch("/data/lexicon.json")
			.then(async (res) => {
				if (!res.ok) throw new Error("Failed to load lexicon");
				const payload: unknown = await res.json();
				return payload && typeof payload === "object" && !Array.isArray(payload)
					? (payload as LexiconMap)
					: {};
			})
			.catch(() => {
				lexiconPromise = null;
				return {};
			});
	}
	return lexiconPromise;
}

export async function loadTranslationChapter(
	translationId: string,
	bookNumber: number,
	chapter: number,
): Promise<VerseEntry[]> {
	const book = getBookByNumber(bookNumber);
	if (!book) throw new Error(`Unknown book number ${bookNumber}`);

	if (translationId === CANONICAL_BIBLES.en.id) {
		const key = `${book.usfm}:${chapter}`;
		const cached = esvChapterCache.get(key);
		if (cached) {
			esvChapterCache.delete(key);
			esvChapterCache.set(key, cached);
			return cached.verses;
		}
		const existing = esvInFlightCache.get(key);
		if (existing) return existing;

		const promise = fetch(`/api/esv/${encodeURIComponent(book.usfm)}/${chapter}`)
			.then(async (res) => {
				if (!res.ok) {
					let message = `Failed to load ${translationId} ${book.usfm} ${chapter}`;
					try {
						const payload = (await res.json()) as { error?: string };
						if (payload?.error) message = payload.error;
					} catch {}
					throw new Error(message);
				}
				const payload = (await res.json()) as Partial<ChapterTextResponse>;
				const verses = Array.isArray(payload.verses) ? payload.verses : [];
				cacheEsvChapter(book, chapter, verses);
				return verses;
			})
			.finally(() => {
				esvInFlightCache.delete(key);
			});

		esvInFlightCache.set(key, promise);
		return promise;
	}

	const data = await cachedFetch(bundledBookCache, `${translationId}:${book.usfm}`, async () => {
		const res = await fetch(
			`/data/bibles/${encodeURIComponent(translationId)}/${encodeURIComponent(book.usfm)}.json`,
		);
		if (!res.ok) throw new Error(`Failed to load ${translationId} ${book.usfm}`);
		return (await res.json()) as BookBibleData;
	});
	return data.chapters[String(chapter)] ?? [];
}

function fetchStaticBookTimings(
	timingsKey: string,
	usfm: string,
): Promise<BookAudioTimingsData | null> {
	return cachedFetch(bundledTimingsCache, `${timingsKey}:${usfm}`, async () => {
		const res = await fetch(
			`/data/timings/${encodeURIComponent(timingsKey)}/${encodeURIComponent(usfm)}.json`,
		);
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`Failed to load timings ${usfm}`);
		return (await res.json()) as BookAudioTimingsData;
	}).catch(() => null);
}

export async function loadSyncedChapterAudio(options: {
	usfm: string;
	chapter: number;
}): Promise<ChapterAudioResponse> {
	try {
		const res = await fetch(`/api/audio/${encodeURIComponent(options.usfm)}/${options.chapter}`);
		if (!res.ok) return { tracks: [] };
		const payload = (await res.json()) as ChapterAudioResponse;
		const tracks = await Promise.all(
			payload.tracks.map(async (track) => {
				if (hasVerseTimings(track.verseTimings)) return track;
				const timingsDir = STATIC_TIMINGS_DIR_BY_TRACK_ID[track.id];
				if (!timingsDir) return track;

				const bookTimings = await fetchStaticBookTimings(timingsDir, options.usfm);
				const chapterTimings = normalizeVerseTimings(
					bookTimings?.chapters?.[String(options.chapter)],
				);
				return chapterTimings ? { ...track, verseTimings: chapterTimings } : track;
			}),
		);
		return { tracks };
	} catch {
		return { tracks: [] };
	}
}

export function loadChapterCommentary(options: {
	commentaryId: CommentaryId;
	usfm: string;
	chapter: number;
}): Promise<ChapterCommentaryResponse> {
	const key = `${options.commentaryId}:${options.usfm}:${options.chapter}`;
	const url = `/api/commentary/${encodeURIComponent(options.commentaryId)}/${encodeURIComponent(options.usfm)}/${options.chapter}`;
	return cachedFetch(
		commentaryCache,
		key,
		async () => {
			const res = await fetch(url);
			if (!res.ok) {
				let message = "Unable to load commentary.";
				try {
					const payload = (await res.json()) as { error?: string };
					if (payload?.error) message = payload.error;
				} catch {}
				throw new Error(message);
			}
			return (await res.json()) as ChapterCommentaryResponse;
		},
		MAX_COMMENTARY_CACHE_ENTRIES,
	);
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
			heading: enEntry?.heading ?? koEntry?.heading,
			enText: enEntry?.text ?? null,
			koText: koEntry?.text ?? null,
			tokens: analysis.tokensByVerse.get(verseNum) ?? [],
		};
	});

	return { aligned, analysis };
}
