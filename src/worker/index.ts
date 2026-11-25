import {
	AUDIO_CACHE_CONTROL,
	SUPERTONIC_TRACK_ATTRIBUTION,
	SUPERTONIC_TRACK_ID,
	SUPERTONIC_TRACK_LABEL,
} from "../shared/audio-timings";
import { getBookByUsfm, MAX_PASSAGE_VERSE_SPAN, MAX_VERSE_NUMBER } from "../shared/books";
import { isCommentaryId } from "../shared/commentaries";
import { CANONICAL_BIBLES } from "../shared/translations";
import type {
	AudioTrackOption,
	BookMeta,
	ChapterAudioResponse,
	ChapterTextResponse,
	TranslationLanguage,
	VerseEntry,
} from "../shared/types";
import { isSafeHttpsUrl } from "../shared/url";
import { fetchEsvAudioTrack, resolveEsvAudioUrl } from "./esv-audio";
import { fetchEsvVerses } from "./esv-text";
import { fetchHelloAoCommentaryChapter } from "./helloao";
import { cancelBody, type FetchLike } from "./http";

interface R2RangeResult {
	offset?: number;
	length?: number;
	suffix?: number;
}

export interface R2ObjectBodyLike {
	readonly size: number;
	readonly httpEtag?: string;
	readonly httpMetadata?: {
		readonly contentType?: string;
	};
	readonly range?: R2RangeResult;
	readonly body?: ReadableStream<Uint8Array> | null;
}

export interface R2BucketLike {
	head?(key: string): Promise<R2ObjectBodyLike | null>;
	get(
		key: string,
		options?: {
			range?:
				| { offset: number; length?: number }
				| { offset?: number; length: number }
				| { suffix: number };
		},
	): Promise<R2ObjectBodyLike | null>;
}

export interface WorkerBindings {
	ESV_API_KEY?: string;
	AUDIO_BASE_URL?: string;
	AUDIO_BUCKET?: R2BucketLike;
}

interface WorkerDeps {
	fetcher?: FetchLike;
	localEsvLoader?: (usfm: string, chapter: number) => Promise<VerseEntry[] | null>;
}

const SAFE_AUDIO_MIME_RE = /^audio\/[a-z0-9.+-]+$/i;
const RANGE_HEADER_RE = /^bytes=(?:(\d+)-(\d+)?|-(\d+))$/;
const NO_STORE_PRIVATE = "private, no-store";

type ParsedByteRange =
	| {
			kind: "bounded";
			start: number;
			end?: number;
			r2Range: { offset: number; length?: number };
	  }
	| {
			kind: "suffix";
			suffix: number;
			r2Range: { suffix: number };
	  };

function parseByteRangeHeader(
	rawHeader: string,
): { ok: true; value: ParsedByteRange } | { ok: false; status: 400 | 416 } {
	if (rawHeader.length > 128) return { ok: false, status: 400 };
	const match = RANGE_HEADER_RE.exec(rawHeader.trim());
	if (!match) return { ok: false, status: 400 };

	const [, startRaw, endRaw, suffixRaw] = match;
	if (suffixRaw !== undefined) {
		const suffix = Number(suffixRaw);
		if (!Number.isSafeInteger(suffix)) return { ok: false, status: 400 };
		if (suffix <= 0) return { ok: false, status: 416 };
		return { ok: true, value: { kind: "suffix", suffix, r2Range: { suffix } } };
	}

	const start = Number(startRaw);
	if (!Number.isSafeInteger(start) || start < 0) return { ok: false, status: 400 };

	if (endRaw !== undefined) {
		const end = Number(endRaw);
		if (!Number.isSafeInteger(end) || end < start) return { ok: false, status: 400 };
		const length = end - start + 1;
		if (!Number.isSafeInteger(length)) return { ok: false, status: 400 };
		return {
			ok: true,
			value: { kind: "bounded", start, end, r2Range: { offset: start, length } },
		};
	}

	return { ok: true, value: { kind: "bounded", start, r2Range: { offset: start } } };
}

function isR2InvalidRangeError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	return msg.includes("10039") || msg.includes("not satisfiable") || msg.includes("invalidrange");
}

function matchesIfNoneMatch(
	header: string | null | undefined,
	httpEtag: string | undefined,
): boolean {
	if (!header || header.length > 2048 || !httpEtag) return false;
	const trimmed = header.trim();
	if (trimmed === "*") return true;
	const normalize = (tag: string) => tag.trim().replace(/^W\//, "");
	const target = normalize(httpEtag);
	const tokens = trimmed.match(/(?:W\/)?"(?:\\.|[^"\\])*"|[^,\s]+/g);
	return tokens?.some((token) => normalize(token) === target) ?? false;
}

function sanitizeAudioMime(rawType: string | null | undefined): {
	mime: string;
	isAudio: boolean;
} {
	const cleanType = (rawType ?? "").split(";")[0].trim();
	const isAudio = SAFE_AUDIO_MIME_RE.test(cleanType);
	return { mime: isAudio ? cleanType : "audio/mpeg", isAudio };
}

function resolveReturnedRange(
	object: R2ObjectBodyLike,
	parsedRange: ParsedByteRange,
): { offset: number; length: number } {
	const r: R2RangeResult = object.range ?? parsedRange.r2Range;
	if (r.suffix !== undefined) {
		const length = Math.min(r.suffix, object.size);
		return { offset: object.size - length, length };
	}
	const offset = r.offset ?? (parsedRange.kind === "bounded" ? parsedRange.start : 0);
	const maxLen = Math.max(0, object.size - offset);
	return { offset, length: Math.min(r.length ?? maxLen, maxLen) };
}

function rangeNotSatisfiableResponse(size?: number): Response {
	const headers = new Headers({ "Cache-Control": "no-store" });
	if (size !== undefined) {
		headers.set("Content-Range", `bytes */${size}`);
	}
	return new Response(null, { status: 416, headers });
}

function hasConfiguredAudioBase(env: WorkerBindings | undefined): string | null {
	const customAudioBase = env?.AUDIO_BASE_URL?.trim();
	if (
		!customAudioBase ||
		customAudioBase.includes("?") ||
		customAudioBase.includes("#") ||
		!isSafeHttpsUrl(customAudioBase)
	) {
		return null;
	}
	return customAudioBase.replace(/\/+$/, "");
}

function applySecurityHeaders(headers: Headers): void {
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	headers.set("X-Frame-Options", "DENY");
	headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	headers.set("Cross-Origin-Opener-Policy", "same-origin");
	headers.set("Cross-Origin-Resource-Policy", "same-origin");
	headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
}

export interface WorkerApp {
	fetch(request: Request, env?: WorkerBindings): Promise<Response>;
}

function jsonResponse(
	data: unknown,
	status = 200,
	cacheControl?: string,
	extraHeaders?: HeadersInit,
): Response {
	const headers = new Headers(extraHeaders);
	if (cacheControl) {
		headers.set("Cache-Control", cacheControl);
	}
	return Response.json(data, { status, headers });
}

function jsonError(
	status: 400 | 404 | 405 | 429 | 502 | 503,
	error: string,
	cacheControl = "no-store",
	extraHeaders?: HeadersInit,
): Response {
	return jsonResponse({ error }, status, cacheControl, extraHeaders);
}

function decodeSegment(raw: string): string | null {
	try {
		return decodeURIComponent(raw);
	} catch {
		return null;
	}
}

function parsePositiveInt(raw: string | undefined, min: number, max: number): number | null {
	if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
	const val = Number.parseInt(raw, 10);
	return Number.isSafeInteger(val) && val >= min && val <= max ? val : null;
}

function parseChapterRef(
	usfmRaw: string,
	chapterRaw: string,
): { book: BookMeta; usfm: string; chapter: number } | null {
	const decodedUsfm = decodeSegment(usfmRaw);
	const decodedChapter = decodeSegment(chapterRaw);
	if (decodedUsfm === null || decodedChapter === null) return null;
	const usfm = decodedUsfm.toUpperCase();
	const book = getBookByUsfm(usfm);
	if (!book) return null;
	const chapter = parsePositiveInt(decodedChapter, 1, book.chapters);
	return chapter !== null ? { book, usfm, chapter } : null;
}

function parseVerseRangeParam(raw: string): { verseStart: number; verseEnd?: number } | null {
	const decoded = decodeSegment(raw);
	if (decoded === null) return null;
	const match = /^([1-9]\d*)(?:-([1-9]\d*))?$/.exec(decoded);
	if (!match) return null;
	const verseStart = Number.parseInt(match[1], 10);
	const verseEnd = match[2] ? Number.parseInt(match[2], 10) : verseStart;
	if (
		!Number.isSafeInteger(verseStart) ||
		!Number.isSafeInteger(verseEnd) ||
		verseStart < 1 ||
		verseEnd < verseStart ||
		verseEnd > MAX_VERSE_NUMBER ||
		verseEnd - verseStart + 1 > MAX_PASSAGE_VERSE_SPAN
	) {
		return null;
	}
	return verseEnd > verseStart ? { verseStart, verseEnd } : { verseStart };
}

function esvPassageOpts(book: BookMeta, chapter: number) {
	return { bookEn: book.en, chapter, chaptersInBook: book.chapters };
}

function esvTextSuccess(
	book: BookMeta,
	usfm: string,
	chapter: number,
	verses: VerseEntry[],
): Response {
	return jsonResponse(
		{
			translationId: CANONICAL_BIBLES.en.id,
			bookNumber: book.number,
			usfm,
			chapter,
			verses,
		} satisfies ChapterTextResponse,
		200,
		NO_STORE_PRIVATE,
	);
}

function esvFetchErrorResponse(status: "not_found" | "rate_limited" | "error"): Response {
	if (status === "rate_limited") {
		return jsonError(
			429,
			"ESV API rate limit reached. Please try again shortly.",
			NO_STORE_PRIVATE,
		);
	}
	if (status === "not_found") {
		return jsonError(404, "Verse not found in chapter", NO_STORE_PRIVATE);
	}
	return jsonError(502, "ESV passage unavailable", NO_STORE_PRIVATE);
}

function finalizeResponse(response: Response, isHead: boolean): Response {
	if (response.status >= 400 && !response.headers.has("Cache-Control")) {
		response.headers.set("Cache-Control", "no-store");
	}
	applySecurityHeaders(response.headers);
	if (isHead && response.body !== null) {
		cancelBody(response);
		return new Response(null, { status: response.status, headers: response.headers });
	}
	return response;
}

async function handleEsvText(
	usfmRaw: string,
	chapterRaw: string,
	verseRangeRaw: string | undefined,
	env: WorkerBindings,
	fetcher: FetchLike,
	localEsvLoader?: WorkerDeps["localEsvLoader"],
): Promise<Response> {
	const parsed = parseChapterRef(usfmRaw, chapterRaw);
	if (!parsed) {
		return jsonError(400, "Invalid book or chapter reference", NO_STORE_PRIVATE);
	}
	const range = verseRangeRaw !== undefined ? parseVerseRangeParam(verseRangeRaw) : undefined;
	if (range === null) {
		return jsonError(400, "Invalid verse range", NO_STORE_PRIVATE);
	}
	const { book, usfm, chapter } = parsed;

	let verses = localEsvLoader ? await localEsvLoader(usfm, chapter).catch(() => null) : null;
	if (verses && verses.length > 0) {
		if (range) {
			const end = range.verseEnd ?? range.verseStart;
			verses = verses.filter((v) => v.verse >= range.verseStart && v.verse <= end);
			if (verses.length === 0) return esvFetchErrorResponse("not_found");
		}
		return esvTextSuccess(book, usfm, chapter, verses);
	}

	const esvApiKey = env.ESV_API_KEY?.trim();
	if (!esvApiKey) {
		return jsonError(503, "ESV text is not configured", NO_STORE_PRIVATE);
	}
	const result = await fetchEsvVerses(
		esvApiKey,
		{ ...esvPassageOpts(book, chapter), ...(range ?? {}) },
		fetcher,
	);
	if (result.status !== "ok") {
		return esvFetchErrorResponse(result.status);
	}
	return esvTextSuccess(book, usfm, chapter, result.verses);
}

async function handleAudioTracks(
	request: Request,
	usfmRaw: string,
	chapterRaw: string,
	env: WorkerBindings,
	fetcher: FetchLike,
): Promise<Response> {
	const parsed = parseChapterRef(usfmRaw, chapterRaw);
	if (!parsed) {
		return jsonError(400, "Invalid book or chapter reference");
	}
	const { book, usfm, chapter } = parsed;

	const url = new URL(request.url);
	let requestedLang: TranslationLanguage | null = null;
	if (url.searchParams.has("lang")) {
		const rawLang = url.searchParams.get("lang");
		if (rawLang !== "ko" && rawLang !== "en") {
			return jsonError(400, "Unsupported audio language");
		}
		requestedLang = rawLang;
	}
	const includeKo = requestedLang === null || requestedLang === "ko";
	const includeEn = requestedLang === null || requestedLang === "en";

	const esvApiKey = env.ESV_API_KEY?.trim();
	const customAudioBase = hasConfiguredAudioBase(env);
	const tracks: AudioTrackOption[] = [];

	if (includeKo) {
		const krvUrl = env.AUDIO_BUCKET
			? `/api/audio/krv/${usfm}/${chapter}`
			: customAudioBase
				? `${customAudioBase}/${usfm}/${chapter}.mp3`
				: null;
		if (krvUrl) {
			tracks.push({
				id: SUPERTONIC_TRACK_ID,
				label: SUPERTONIC_TRACK_LABEL,
				language: "ko",
				url: krvUrl,
				isAiGenerated: true,
				attribution: SUPERTONIC_TRACK_ATTRIBUTION,
			});
		}
	}

	let esvDegraded = false;
	if (includeEn && esvApiKey) {
		const esvTrack = await fetchEsvAudioTrack(
			esvApiKey,
			{ usfm, ...esvPassageOpts(book, chapter) },
			fetcher,
		);
		if (esvTrack) tracks.push(esvTrack);
		else esvDegraded = true;
	}

	return jsonResponse(
		{ tracks } satisfies ChapterAudioResponse,
		200,
		esvDegraded ? NO_STORE_PRIVATE : "private, max-age=1800",
	);
}

async function handleKrvAudio(
	request: Request,
	usfmRaw: string,
	chapterRaw: string,
	env: WorkerBindings,
): Promise<Response> {
	const parsed = parseChapterRef(usfmRaw, chapterRaw);
	if (!parsed) {
		return jsonError(400, "Invalid book or chapter reference");
	}

	const bucket = env.AUDIO_BUCKET;
	if (!bucket) {
		return jsonError(503, "Korean audio is not configured");
	}

	const rawRangeHeader = request.headers.get("Range");
	let parsedRange: ParsedByteRange | undefined;
	if (rawRangeHeader !== null) {
		const rangeResult = parseByteRangeHeader(rawRangeHeader);
		if (!rangeResult.ok) {
			return rangeResult.status === 416
				? rangeNotSatisfiableResponse()
				: new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });
		}
		parsedRange = rangeResult.value;
	}

	const key = `${parsed.usfm}/${parsed.chapter}.mp3`;
	const isHead = request.method === "HEAD";
	let object: R2ObjectBodyLike | null;
	try {
		object =
			isHead && bucket.head
				? await bucket.head(key)
				: await bucket.get(key, parsedRange ? { range: parsedRange.r2Range } : undefined);
	} catch (err) {
		if (parsedRange && isR2InvalidRangeError(err)) {
			return rangeNotSatisfiableResponse();
		}
		throw err;
	}

	if (!object) {
		return jsonError(404, "Korean audio chapter not found");
	}

	if (matchesIfNoneMatch(request.headers.get("If-None-Match"), object.httpEtag)) {
		cancelBody(object);
		const headers = new Headers({ "Cache-Control": AUDIO_CACHE_CONTROL });
		if (object.httpEtag) headers.set("ETag", object.httpEtag);
		return new Response(null, { status: 304, headers });
	}

	if (parsedRange) {
		const isOutOfBounds =
			object.size <= 0 || (parsedRange.kind === "bounded" && parsedRange.start >= object.size);
		if (isOutOfBounds) {
			cancelBody(object);
			return rangeNotSatisfiableResponse(object.size);
		}
	}

	const headers = new Headers();
	headers.set("Content-Type", sanitizeAudioMime(object.httpMetadata?.contentType).mime);
	headers.set("Accept-Ranges", "bytes");
	headers.set("Content-Disposition", "inline");
	headers.set("Cache-Control", AUDIO_CACHE_CONTROL);
	if (object.httpEtag) {
		headers.set("ETag", object.httpEtag);
	}

	if (isHead) {
		cancelBody(object);
	} else if (object.size > 0 && !object.body) {
		return jsonError(502, "Korean audio stream unavailable");
	}

	if (parsedRange) {
		const { offset, length } = resolveReturnedRange(object, parsedRange);
		if (length <= 0 || offset < 0 || offset + length > object.size) {
			cancelBody(object);
			return rangeNotSatisfiableResponse(object.size);
		}
		headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
		headers.set("Content-Length", String(length));
		return new Response(isHead ? null : (object.body ?? null), { status: 206, headers });
	}

	headers.set("Content-Length", String(object.size));
	return new Response(isHead ? null : (object.body ?? null), { status: 200, headers });
}

async function handleEsvAudio(
	usfmRaw: string,
	chapterRaw: string,
	env: WorkerBindings,
	fetcher: FetchLike,
): Promise<Response> {
	const parsed = parseChapterRef(usfmRaw, chapterRaw);
	if (!parsed) {
		return jsonError(400, "Invalid book or chapter reference");
	}
	const { book, chapter } = parsed;

	const esvApiKey = env.ESV_API_KEY?.trim();
	if (!esvApiKey) {
		return jsonError(503, "ESV audio is not configured");
	}

	const resolved = await resolveEsvAudioUrl(esvApiKey, esvPassageOpts(book, chapter), fetcher);
	if (!resolved) {
		return jsonError(502, "ESV audio unavailable for this passage");
	}

	if (resolved.url) {
		return new Response(null, {
			status: 302,
			headers: {
				Location: resolved.url,
				"Cache-Control": "private, max-age=1800",
			},
		});
	}

	if (resolved.directStreamResponse) {
		const { mime, isAudio } = sanitizeAudioMime(
			resolved.directStreamResponse.headers.get("content-type"),
		);
		const headers = new Headers();
		headers.set("Content-Type", mime);
		headers.set("Content-Disposition", "inline");
		headers.set("Cache-Control", isAudio ? "private, max-age=1800" : NO_STORE_PRIVATE);
		const contentLength = resolved.directStreamResponse.headers.get("content-length")?.trim();
		if (contentLength && /^\d+$/.test(contentLength)) {
			headers.set("Content-Length", contentLength);
		}
		return new Response(resolved.directStreamResponse.body, {
			status: 200,
			headers,
		});
	}

	return jsonError(502, "ESV audio unavailable");
}

async function handleCommentary(
	commentaryIdRaw: string,
	usfmRaw: string,
	chapterRaw: string,
	fetcher: FetchLike,
): Promise<Response> {
	const commentaryId = decodeSegment(commentaryIdRaw);
	if (!commentaryId || !isCommentaryId(commentaryId)) {
		return jsonError(400, "Unsupported commentary source");
	}
	const parsed = parseChapterRef(usfmRaw, chapterRaw);
	if (!parsed) {
		return jsonError(400, "Invalid book or chapter reference");
	}

	const result = await fetchHelloAoCommentaryChapter(
		commentaryId,
		parsed.usfm,
		parsed.chapter,
		fetcher,
	);
	if (result.status === "error") {
		return jsonError(502, "Commentary lookup failed");
	}

	return jsonResponse(
		result.data,
		200,
		result.status === "empty" ? "public, max-age=3600" : "public, max-age=86400",
	);
}

export function createApp(deps: WorkerDeps = {}): WorkerApp {
	const fetcher = deps.fetcher ?? fetch;

	async function dispatch(request: Request, env: WorkerBindings): Promise<Response> {
		const { pathname } = new URL(request.url);
		const parts = pathname.startsWith("/") ? pathname.slice(1).split("/") : [];
		if (parts[0] !== "api" || parts.some((part) => part.length === 0)) {
			return jsonError(404, "Not found");
		}

		if (parts.length === 4) {
			if (parts[1] === "esv") {
				return handleEsvText(parts[2], parts[3], undefined, env, fetcher, deps.localEsvLoader);
			}
			if (parts[1] === "audio") {
				return handleAudioTracks(request, parts[2], parts[3], env, fetcher);
			}
		}

		if (parts.length === 5) {
			if (parts[1] === "esv") {
				return handleEsvText(parts[2], parts[3], parts[4], env, fetcher, deps.localEsvLoader);
			}
			if (parts[1] === "audio" && parts[2] === "krv") {
				return handleKrvAudio(request, parts[3], parts[4], env);
			}
			if (parts[1] === "audio" && parts[2] === "esv") {
				return handleEsvAudio(parts[3], parts[4], env, fetcher);
			}
			if (parts[1] === "commentary") {
				return handleCommentary(parts[2], parts[3], parts[4], fetcher);
			}
		}

		return jsonError(404, "Not found");
	}

	return {
		async fetch(request: Request, env: WorkerBindings = {}): Promise<Response> {
			const isHead = request.method === "HEAD";
			if (request.method !== "GET" && !isHead) {
				return finalizeResponse(
					jsonError(405, "Method not allowed", "no-store", { Allow: "GET, HEAD" }),
					false,
				);
			}

			let response: Response;
			try {
				response = await dispatch(request, env);
			} catch (err) {
				console.error("Worker route error:", err instanceof Error ? err.name : "UnknownError");
				response = jsonError(502, "Upstream service error");
			}
			return finalizeResponse(response, isHead);
		},
	};
}

const app = createApp();
export default app;
