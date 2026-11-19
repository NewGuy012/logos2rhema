import {
	hasVerseTimings,
	normalizeVerseTimings,
	SUPERTONIC_TRACK_ID,
} from "../../shared/audio-timings";
import { getBookByNumber } from "../../shared/books";
import { analyzeKoreanChapter, type ChapterAnalysisResult } from "../../shared/korean-morphology";
import type {
	AlignedVerse,
	BookAudioTimingsData,
	BookBibleData,
	ChapterAudioResponse,
	ChapterCommentaryResponse,
	CommentaryId,
	LexiconMap,
	ReaderConfigResponse,
	VerseEntry,
} from "../../shared/types";

const MAX_COMMENTARY_CACHE_ENTRIES = 50;
const STATIC_TIMINGS_DIR_BY_TRACK_ID: Readonly<Record<string, string>> = {
	[SUPERTONIC_TRACK_ID]: "krv-supertonic",
};
const bundledBookCache = new Map<string, Promise<BookBibleData>>();
const bundledTimingsCache = new Map<string, Promise<BookAudioTimingsData | null>>();
const commentaryCache = new Map<string, Promise<ChapterCommentaryResponse>>();
let lexiconPromise: Promise<LexiconMap> | null = null;

export function clearCommentaryCache(): void {
	commentaryCache.clear();
}

export function clearAudioTimingsCache(): void {
	bundledTimingsCache.clear();
}

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
		// Fallback when API is unreachable during isolated testing
	}
	return { krvSyncedAudioEnabled: false };
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
	translationId: string,
	bookNumber: number,
	chapter: number,
): Promise<VerseEntry[]> {
	const book = getBookByNumber(bookNumber);
	if (!book) throw new Error(`Unknown book number ${bookNumber}`);

	const data = await fetchBundledBook(translationId, book.usfm);
	return data.chapters[String(chapter)] ?? [];
}

function fetchStaticBookTimings(
	timingsKey: string,
	usfm: string,
): Promise<BookAudioTimingsData | null> {
	const cacheKey = `${timingsKey}:${usfm}`;
	const existing = bundledTimingsCache.get(cacheKey);
	if (existing) return existing;

	const promise = fetch(
		`/data/timings/${encodeURIComponent(timingsKey)}/${encodeURIComponent(usfm)}.json`,
	)
		.then((res) => {
			if (!res.ok) return null;
			return res.json() as Promise<BookAudioTimingsData>;
		})
		.catch(() => {
			bundledTimingsCache.delete(cacheKey);
			return null;
		});
	bundledTimingsCache.set(cacheKey, promise);
	return promise;
}

export async function loadSyncedChapterAudio(options: {
	usfm: string;
	chapter: number;
}): Promise<ChapterAudioResponse> {
	try {
		const res = await fetch(`/api/audio/${encodeURIComponent(options.usfm)}/${options.chapter}`);
		if (!res.ok) {
			return { tracks: [] };
		}
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
		// Fallback gracefully when running offline or in isolated DOM tests
	}
	return { tracks: [] };
}

export function loadChapterCommentary(options: {
	commentaryId: CommentaryId;
	usfm: string;
	chapter: number;
}): Promise<ChapterCommentaryResponse> {
	const key = `${options.commentaryId}:${options.usfm}:${options.chapter}`;
	const existing = commentaryCache.get(key);
	if (existing) {
		commentaryCache.delete(key);
		commentaryCache.set(key, existing);
		return existing;
	}

	if (commentaryCache.size >= MAX_COMMENTARY_CACHE_ENTRIES) {
		const oldestKey = commentaryCache.keys().next().value;
		if (oldestKey) commentaryCache.delete(oldestKey);
	}

	const url = `/api/commentary/${encodeURIComponent(options.commentaryId)}/${encodeURIComponent(options.usfm)}/${options.chapter}`;
	const promise = fetch(url)
		.then(async (res) => {
			if (!res.ok) {
				let message = "Unable to load commentary.";
				try {
					const payload = (await res.json()) as { error?: string };
					if (payload?.error) message = payload.error;
				} catch {
					// Ignore non-JSON error body
				}
				throw new Error(message);
			}
			return (await res.json()) as ChapterCommentaryResponse;
		})
		.catch((err) => {
			commentaryCache.delete(key);
			throw err;
		});

	commentaryCache.set(key, promise);
	return promise;
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
