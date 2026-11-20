import { type Context, Hono } from "hono";

import { SUPERTONIC_TRACK_ID } from "../shared/audio-timings";
import { getBookByUsfm } from "../shared/books";
import { isCommentaryId } from "../shared/commentaries";
import { CANONICAL_BIBLES } from "../shared/translations";
import type {
	AudioTrackOption,
	BookMeta,
	ChapterAudioResponse,
	ChapterTextResponse,
	VerseEntry,
} from "../shared/types";
import { isSafeHttpsUrl } from "../shared/url";
import { fetchEsvAudioTrack, resolveEsvAudioUrl } from "./esv-audio";
import { fetchEsvChapterVerses } from "./esv-text";
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

export interface WorkerDeps {
	fetcher?: FetchLike;
	localEsvLoader?: (usfm: string, chapter: number) => Promise<VerseEntry[] | null>;
}

const SAFE_AUDIO_MIME_RE = /^audio\/[a-z0-9.+-]+$/i;
const RANGE_HEADER_RE = /^bytes=(?:(\d+)-(\d+)?|-(\d+))$/;
const AUDIO_CACHE_CONTROL = "public, max-age=31536000, immutable";

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

function matchesIfNoneMatch(header: string | undefined, httpEtag: string | undefined): boolean {
	if (!header || !httpEtag) return false;
	const trimmed = header.trim();
	if (trimmed === "*") return true;
	const normalize = (tag: string) => tag.trim().replace(/^W\//, "");
	const target = normalize(httpEtag);
	const tokens = trimmed.match(/(?:W\/)?"(?:\\.|[^"])*"|[^,\s]+/g);
	return tokens?.some((token) => normalize(token) === target) ?? false;
}

function sanitizeAudioMime(rawType: string | null | undefined): string {
	const cleanType = (rawType ?? "").split(";")[0].trim();
	return SAFE_AUDIO_MIME_RE.test(cleanType) ? cleanType : "audio/mpeg";
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
	return customAudioBase && isSafeHttpsUrl(customAudioBase)
		? customAudioBase.replace(/\/+$/, "")
		: null;
}

function applySecurityHeaders(headers: Headers): void {
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	headers.set("X-Frame-Options", "DENY");
	headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
}

function jsonError(
	c: Context<{ Bindings: WorkerBindings }>,
	status: 400 | 404 | 405 | 429 | 502 | 503,
	error: string,
	cacheControl = "no-store",
): Response {
	c.header("Cache-Control", cacheControl);
	return c.json({ error }, status);
}

function parsePositiveInt(raw: string | undefined, min: number, max: number): number | null {
	if (!raw || !/^\d+$/.test(raw)) return null;
	const val = Number.parseInt(raw, 10);
	return val >= min && val <= max ? val : null;
}

function parseChapterRef(
	c: Context<{ Bindings: WorkerBindings }>,
): { book: BookMeta; usfm: string; chapter: number } | null {
	const usfm = (c.req.param("usfm") ?? "").toUpperCase();
	const book = getBookByUsfm(usfm);
	if (!book) return null;
	const chapter = parsePositiveInt(c.req.param("chapter"), 1, book.chapters);
	return chapter !== null ? { book, usfm, chapter } : null;
}

export function createApp(deps: WorkerDeps = {}) {
	const fetcher = deps.fetcher ?? fetch;
	const app = new Hono<{ Bindings: WorkerBindings }>();

	app.use("*", async (c, next) => {
		if (c.req.method !== "GET" && c.req.method !== "HEAD") {
			const res = c.json({ error: "Method not allowed" }, 405, {
				Allow: "GET, HEAD",
				"Cache-Control": "no-store",
			});
			applySecurityHeaders(res.headers);
			return res;
		}
		await next();
		if (c.res.status >= 400 && !c.res.headers.has("Cache-Control")) {
			c.res.headers.set("Cache-Control", "no-store");
		}
		applySecurityHeaders(c.res.headers);
		if (c.req.method === "HEAD" && c.res.body !== null) {
			cancelBody(c.res);
			c.res = new Response(null, { status: c.res.status, headers: c.res.headers });
		}
	});

	app.notFound((c) => jsonError(c, 404, "Not found"));

	app.onError((_err, c) => {
		const res = jsonError(c, 502, "Upstream service error");
		applySecurityHeaders(res.headers);
		return res;
	});

	app.get("/api/esv/:usfm/:chapter", async (c) => {
		const parsed = parseChapterRef(c);
		if (!parsed) {
			return jsonError(c, 400, "Invalid book or chapter reference", "private, no-store");
		}
		const { book, usfm, chapter } = parsed;

		if (deps.localEsvLoader) {
			const localVerses = await deps.localEsvLoader(usfm, chapter).catch(() => null);
			if (localVerses && localVerses.length > 0) {
				const responseBody: ChapterTextResponse = {
					translationId: CANONICAL_BIBLES.en.id,
					bookNumber: book.number,
					usfm,
					chapter,
					verses: localVerses,
				};
				c.header("Cache-Control", "private, no-store");
				return c.json(responseBody);
			}
		}

		const esvApiKey = c.env?.ESV_API_KEY?.trim();
		if (!esvApiKey) {
			return jsonError(c, 503, "ESV text is not configured", "private, no-store");
		}

		const result = await fetchEsvChapterVerses(
			esvApiKey,
			{ bookEn: book.en, chapter, chaptersInBook: book.chapters },
			fetcher,
		).catch(() => ({ status: "error" as const }));

		if (result.status === "rate_limited") {
			return jsonError(
				c,
				429,
				"ESV API rate limit reached. Please try again shortly.",
				"private, no-store",
			);
		}
		if (result.status !== "ok") {
			return jsonError(c, 502, "ESV passage unavailable", "private, no-store");
		}

		const responseBody: ChapterTextResponse = {
			translationId: CANONICAL_BIBLES.en.id,
			bookNumber: book.number,
			usfm,
			chapter,
			verses: result.verses,
		};
		c.header("Cache-Control", "private, no-store");
		return c.json(responseBody);
	});

	app.get("/api/audio/:usfm/:chapter", async (c) => {
		const parsed = parseChapterRef(c);
		if (!parsed) {
			return jsonError(c, 400, "Invalid book or chapter reference");
		}
		const { book, usfm, chapter } = parsed;

		const esvApiKey = c.env?.ESV_API_KEY?.trim();
		const customAudioBase = hasConfiguredAudioBase(c.env);
		const tracks: AudioTrackOption[] = [];

		const krvUrl = c.env?.AUDIO_BUCKET
			? `/api/audio/krv/${usfm}/${chapter}`
			: customAudioBase
				? `${customAudioBase}/${usfm}/${chapter}.mp3`
				: null;
		if (krvUrl) {
			tracks.push({
				id: SUPERTONIC_TRACK_ID,
				label: CANONICAL_BIBLES.ko.code,
				language: "ko",
				url: krvUrl,
			});
		}

		if (esvApiKey) {
			const esvTrack = await fetchEsvAudioTrack(
				esvApiKey,
				{ usfm, bookEn: book.en, chapter, chaptersInBook: book.chapters },
				fetcher,
			).catch(() => null);
			if (esvTrack) tracks.push(esvTrack);
		}

		const responseBody: ChapterAudioResponse = { tracks };
		c.header("Cache-Control", "private, max-age=1800");
		return c.json(responseBody);
	});

	app.get("/api/audio/krv/:usfm/:chapter", async (c) => {
		const parsed = parseChapterRef(c);
		if (!parsed) {
			return jsonError(c, 400, "Invalid book or chapter reference");
		}

		const bucket = c.env?.AUDIO_BUCKET;
		if (!bucket) {
			return jsonError(c, 503, "Korean audio is not configured");
		}

		const rawRangeHeader = c.req.header("Range");
		let parsedRange: ParsedByteRange | undefined;
		if (rawRangeHeader !== undefined) {
			const rangeResult = parseByteRangeHeader(rawRangeHeader);
			if (!rangeResult.ok) {
				return rangeResult.status === 416
					? rangeNotSatisfiableResponse()
					: new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });
			}
			parsedRange = rangeResult.value;
		}

		const key = `${parsed.usfm}/${parsed.chapter}.mp3`;
		const isHead = c.req.method === "HEAD";
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
			return jsonError(c, 404, "Korean audio chapter not found");
		}

		if (matchesIfNoneMatch(c.req.header("If-None-Match"), object.httpEtag)) {
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
		headers.set("Content-Type", sanitizeAudioMime(object.httpMetadata?.contentType));
		headers.set("Accept-Ranges", "bytes");
		headers.set("Content-Disposition", "inline");
		headers.set("Cache-Control", AUDIO_CACHE_CONTROL);
		if (object.httpEtag) {
			headers.set("ETag", object.httpEtag);
		}

		if (isHead) {
			cancelBody(object);
		} else if (object.size > 0 && !object.body) {
			return jsonError(c, 502, "Korean audio stream unavailable");
		}

		if (parsedRange) {
			const { offset, length } = resolveReturnedRange(object, parsedRange);
			if (length <= 0 || offset < 0 || offset + length > object.size) {
				if (!isHead) cancelBody(object);
				return rangeNotSatisfiableResponse(object.size);
			}
			headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
			headers.set("Content-Length", String(length));
			return new Response(isHead ? null : (object.body ?? null), { status: 206, headers });
		}

		headers.set("Content-Length", String(object.size));
		return new Response(isHead ? null : (object.body ?? null), { status: 200, headers });
	});

	app.get("/api/audio/esv/:usfm/:chapter", async (c) => {
		const parsed = parseChapterRef(c);
		if (!parsed) {
			return jsonError(c, 400, "Invalid book or chapter reference");
		}
		const { book, chapter } = parsed;

		const esvApiKey = c.env?.ESV_API_KEY?.trim();
		if (!esvApiKey) {
			return jsonError(c, 503, "ESV audio is not configured");
		}

		const resolved = await resolveEsvAudioUrl(
			esvApiKey,
			{ bookEn: book.en, chapter, chaptersInBook: book.chapters },
			fetcher,
		).catch(() => null);
		if (!resolved) {
			return jsonError(c, 502, "ESV audio unavailable for this passage");
		}

		if (resolved.url) {
			c.header("Cache-Control", "private, max-age=1800");
			return c.redirect(resolved.url, 302);
		}

		if (resolved.directStreamResponse) {
			const headers = new Headers();
			headers.set(
				"Content-Type",
				sanitizeAudioMime(resolved.directStreamResponse.headers.get("content-type")),
			);
			headers.set("Content-Disposition", "inline");
			headers.set("Cache-Control", "private, max-age=1800");
			const contentLength = resolved.directStreamResponse.headers.get("content-length")?.trim();
			if (contentLength && /^\d+$/.test(contentLength)) {
				headers.set("Content-Length", contentLength);
			}
			return new Response(resolved.directStreamResponse.body, {
				status: 200,
				headers,
			});
		}

		return jsonError(c, 502, "ESV audio unavailable");
	});

	app.get("/api/commentary/:commentaryId/:usfm/:chapter", async (c) => {
		const commentaryId = c.req.param("commentaryId");
		if (!isCommentaryId(commentaryId)) {
			return jsonError(c, 400, "Unsupported commentary source");
		}
		const parsed = parseChapterRef(c);
		if (!parsed) {
			return jsonError(c, 400, "Invalid book or chapter reference");
		}

		const result = await fetchHelloAoCommentaryChapter(
			commentaryId,
			parsed.usfm,
			parsed.chapter,
			fetcher,
		);
		if (result.status === "error") {
			return jsonError(c, 502, "Commentary lookup failed");
		}

		c.header(
			"Cache-Control",
			result.status === "empty" ? "public, max-age=3600" : "public, max-age=86400",
		);
		return c.json(result.data);
	});

	return app;
}

const app = createApp();
export default app;
