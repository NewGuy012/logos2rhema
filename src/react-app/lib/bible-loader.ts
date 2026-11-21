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
	TranslationLanguage,
	VerseEntry,
} from "../../shared/types";

const MAX_COMMENTARY_CACHE_ENTRIES = 50;
export const MAX_ESV_CACHED_VERSES = 400;
const STATIC_TIMINGS_DIR_BY_TRACK_ID: Readonly<Record<string, string>> = {
	[SUPERTONIC_TRACK_ID]: "krv-supertonic",
};
interface SharedFetchTask<T> {
	promise: Promise<T>;
	controller: AbortController;
	consumers: number;
	settled: boolean;
}

const bundledBookCache = new Map<string, SharedFetchTask<BookBibleData>>();
const esvChapterCache = new Map<string, { bookNumber: number; verses: VerseEntry[] }>();
const esvInFlightCache = new Map<string, SharedFetchTask<VerseEntry[]>>();
const bundledTimingsCache = new Map<string, SharedFetchTask<BookAudioTimingsData | null>>();
const commentaryCache = new Map<string, SharedFetchTask<ChapterCommentaryResponse>>();
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

function createAbortError(signal: AbortSignal): unknown {
	return signal.reason !== undefined
		? signal.reason
		: new DOMException("The operation was aborted.", "AbortError");
}

function subscribeTask<T>(
	cache: Map<string, SharedFetchTask<T>>,
	key: string,
	task: SharedFetchTask<T>,
	signal: AbortSignal,
): Promise<T> {
	const cancelIfUnused = () => {
		if (task.consumers === 0 && !task.settled) {
			if (cache.get(key) === task) cache.delete(key);
			task.controller.abort(signal.reason);
		}
	};

	if (signal.aborted) {
		cancelIfUnused();
		return Promise.reject(createAbortError(signal));
	}

	task.consumers++;
	return new Promise<T>((resolve, reject) => {
		let finished = false;
		const finish = (): boolean => {
			if (finished) return false;
			finished = true;
			signal.removeEventListener("abort", onAbort);
			task.consumers--;
			return true;
		};
		const onAbort = () => {
			if (!finish()) return;
			cancelIfUnused();
			reject(createAbortError(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		task.promise.then(
			(value) => {
				if (finish()) resolve(value);
			},
			(err) => {
				if (finish()) reject(err);
			},
		);
	});
}

function cachedFetch<T>(
	cache: Map<string, SharedFetchTask<T>>,
	key: string,
	loader: (signal: AbortSignal) => Promise<T>,
	options?: {
		signal?: AbortSignal;
		maxEntries?: number;
		evictOnSettle?: boolean;
	},
): Promise<T> {
	const signal = options?.signal;
	if (signal?.aborted) {
		return Promise.reject(createAbortError(signal));
	}

	let task = cache.get(key);
	if (task) {
		if (options?.maxEntries) {
			cache.delete(key);
			cache.set(key, task);
		}
	} else {
		if (options?.maxEntries && cache.size >= options.maxEntries) {
			const oldestKey = cache.keys().next().value;
			if (oldestKey) cache.delete(oldestKey);
		}
		const controller = new AbortController();
		const created: SharedFetchTask<T> = {
			controller,
			consumers: 0,
			settled: false,
			promise: null!,
		};
		let rawPromise: Promise<T>;
		try {
			rawPromise = loader(controller.signal);
		} catch (err) {
			rawPromise = Promise.reject(err);
		}
		const promise = rawPromise.then(
			(value) => {
				created.settled = true;
				if (options?.evictOnSettle && cache.get(key) === created) {
					cache.delete(key);
				}
				return value;
			},
			(err) => {
				created.settled = true;
				if (cache.get(key) === created) {
					cache.delete(key);
				}
				throw err;
			},
		);
		promise.catch(() => {});
		created.promise = promise;
		cache.set(key, created);
		task = created;
	}

	if (!signal) {
		task.consumers++;
		return task.promise;
	}
	return subscribeTask(cache, key, task, signal);
}

function isCommentaryResponse(value: unknown): value is ChapterCommentaryResponse {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const rec = value as Record<string, unknown>;
	if (!Array.isArray(rec.entries)) return false;
	return rec.entries.every(
		(entry) =>
			Boolean(entry) &&
			typeof entry === "object" &&
			typeof (entry as Record<string, unknown>).id === "string" &&
			typeof (entry as Record<string, unknown>).verseStart === "number" &&
			Array.isArray((entry as Record<string, unknown>).paragraphs),
	);
}

async function readApiError(res: Response, fallback: string): Promise<string> {
	try {
		const payload = (await res.json()) as { error?: unknown };
		if (typeof payload?.error === "string" && payload.error) return payload.error;
	} catch {}
	return fallback;
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
	signal?: AbortSignal,
): Promise<VerseEntry[]> {
	const book = getBookByNumber(bookNumber);
	if (!book) throw new Error(`Unknown book number ${bookNumber}`);

	if (translationId === CANONICAL_BIBLES.en.id) {
		if (signal?.aborted) {
			throw createAbortError(signal);
		}
		const key = `${book.usfm}:${chapter}`;
		const cached = esvChapterCache.get(key);
		if (cached) {
			esvChapterCache.delete(key);
			esvChapterCache.set(key, cached);
			return cached.verses;
		}
		return cachedFetch(
			esvInFlightCache,
			key,
			async (internalSignal) => {
				const res = await fetch(`/api/esv/${encodeURIComponent(book.usfm)}/${chapter}`, {
					signal: internalSignal,
				});
				if (!res.ok) {
					throw new Error(
						await readApiError(res, `Failed to load ${translationId} ${book.usfm} ${chapter}`),
					);
				}
				const payload = (await res.json()) as Partial<ChapterTextResponse>;
				const verses = Array.isArray(payload?.verses) ? payload.verses : [];
				if (verses.length > 0) cacheEsvChapter(book, chapter, verses);
				return verses;
			},
			{ signal, evictOnSettle: true },
		);
	}

	const data = await cachedFetch(
		bundledBookCache,
		`${translationId}:${book.usfm}`,
		async (internalSignal) => {
			const res = await fetch(
				`/data/bibles/${encodeURIComponent(translationId)}/${encodeURIComponent(book.usfm)}.json`,
				{ signal: internalSignal },
			);
			if (!res.ok) throw new Error(`Failed to load ${translationId} ${book.usfm}`);
			const parsed = (await res.json()) as Partial<BookBibleData>;
			if (!parsed || typeof parsed !== "object" || !parsed.chapters) {
				throw new Error(`Invalid chapter data for ${translationId} ${book.usfm}`);
			}
			return parsed as BookBibleData;
		},
		{ signal },
	);
	const verses = data.chapters[String(chapter)];
	return Array.isArray(verses) ? verses : [];
}

function fetchStaticBookTimings(
	timingsKey: string,
	usfm: string,
): Promise<BookAudioTimingsData | null> {
	return cachedFetch(bundledTimingsCache, `${timingsKey}:${usfm}`, async (internalSignal) => {
		const res = await fetch(
			`/data/timings/${encodeURIComponent(timingsKey)}/${encodeURIComponent(usfm)}.json`,
			{ signal: internalSignal },
		);
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`Failed to load timings ${usfm}`);
		return (await res.json()) as BookAudioTimingsData;
	}).catch(() => null);
}

export async function loadSyncedChapterAudio(options: {
	usfm: string;
	chapter: number;
	language?: TranslationLanguage;
	signal?: AbortSignal;
}): Promise<ChapterAudioResponse> {
	try {
		const baseUrl = `/api/audio/${encodeURIComponent(options.usfm)}/${options.chapter}`;
		const url = options.language
			? `${baseUrl}?lang=${encodeURIComponent(options.language)}`
			: baseUrl;
		const res = await fetch(url, options.signal ? { signal: options.signal } : undefined);
		if (!res.ok) return { tracks: [] };
		const payload = (await res.json()) as Partial<ChapterAudioResponse>;
		const rawTracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
		const tracks = await Promise.all(
			rawTracks.map(async (track) => {
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
	signal?: AbortSignal;
}): Promise<ChapterCommentaryResponse> {
	const key = `${options.commentaryId}:${options.usfm}:${options.chapter}`;
	const url = `/api/commentary/${encodeURIComponent(options.commentaryId)}/${encodeURIComponent(options.usfm)}/${options.chapter}`;
	return cachedFetch(
		commentaryCache,
		key,
		async (internalSignal) => {
			const res = await fetch(url, { signal: internalSignal });
			if (!res.ok) {
				throw new Error(await readApiError(res, "Unable to load commentary."));
			}
			const parsed: unknown = await res.json();
			if (!isCommentaryResponse(parsed)) {
				throw new Error("Invalid commentary response.");
			}
			return parsed;
		},
		{ signal: options.signal, maxEntries: MAX_COMMENTARY_CACHE_ENTRIES },
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
