import { Hono } from "hono";

import { SUPERTONIC_TRACK_ID } from "../shared/audio-timings";
import { getBookByUsfm } from "../shared/books";
import { isCommentaryId } from "../shared/commentaries";
import type {
	AudioTrackOption,
	BookMeta,
	ChapterAudioResponse,
	ReaderConfigResponse,
} from "../shared/types";
import { fetchEsvAudioTrack, resolveEsvAudioUrl } from "./esv-audio";
import { fetchHelloAoCommentaryChapter } from "./helloao";
import { type FetchLike, isSafeHttpsUrl } from "./http";

export interface R2RangeResult {
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
	writeHttpMetadata?: (headers: Headers) => void;
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
		return {
			ok: true,
			value: { kind: "suffix", suffix, r2Range: { suffix } },
		};
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
			value: {
				kind: "bounded",
				start,
				end,
				r2Range: { offset: start, length },
			},
		};
	}

	return {
		ok: true,
		value: {
			kind: "bounded",
			start,
			r2Range: { offset: start },
		},
	};
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

function resolveSafeAudioMime(object: R2ObjectBodyLike): string {
	let rawType = object.httpMetadata?.contentType;
	if (!rawType && object.writeHttpMetadata) {
		const metaHeaders = new Headers();
		object.writeHttpMetadata(metaHeaders);
		rawType = metaHeaders.get("content-type") ?? undefined;
	}
	const cleanType = (rawType ?? "").split(";")[0].trim();
	return SAFE_AUDIO_MIME_RE.test(cleanType) ? cleanType : "audio/mpeg";
}

function resolveReturnedRange(
	object: R2ObjectBodyLike,
	parsedRange: ParsedByteRange,
): { offset: number; length: number } {
	const returned = object.range;
	if (returned) {
		if (returned.suffix !== undefined) {
			const length = Math.min(returned.suffix, object.size);
			return { offset: object.size - length, length };
		}
		const offset = returned.offset ?? (parsedRange.kind === "bounded" ? parsedRange.start : 0);
		const maxLen = Math.max(0, object.size - offset);
		const length = Math.min(returned.length ?? maxLen, maxLen);
		return { offset, length };
	}

	if (parsedRange.kind === "suffix") {
		const length = Math.min(parsedRange.suffix, object.size);
		return { offset: object.size - length, length };
	}

	const offset = parsedRange.start;
	const maxLen = Math.max(0, object.size - offset);
	const length =
		parsedRange.end !== undefined ? Math.min(parsedRange.end - offset + 1, maxLen) : maxLen;
	return { offset, length };
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

function parsePositiveInt(raw: string | undefined, min: number, max: number): number | null {
	if (!raw || !/^\d+$/.test(raw)) return null;
	const val = Number.parseInt(raw, 10);
	return val >= min && val <= max ? val : null;
}

function parseChapterRef(
	usfmRaw: string,
	chapterRaw: string,
): { book: BookMeta; usfm: string; chapter: number } | null {
	const usfm = usfmRaw.toUpperCase();
	const book = getBookByUsfm(usfm);
	if (!book) return null;
	const chapter = parsePositiveInt(chapterRaw, 1, book.chapters);
	return chapter !== null ? { book, usfm, chapter } : null;
}

export function createApp(deps: WorkerDeps = {}) {
	const fetcher = deps.fetcher ?? fetch;
	const app = new Hono<{ Bindings: WorkerBindings }>();

	app.use("*", async (c, next) => {
		if (c.req.method !== "GET" && c.req.method !== "HEAD") {
			const res = c.json({ error: "Method not allowed" }, 405);
			res.headers.set("Allow", "GET, HEAD");
			applySecurityHeaders(res.headers);
			return res;
		}
		await next();
		applySecurityHeaders(c.res.headers);
		if (c.req.method === "HEAD" && c.res.body !== null) {
			c.res.body.cancel?.().catch(() => {});
			c.res = new Response(null, { status: c.res.status, headers: c.res.headers });
		}
	});

	app.onError((_err, c) => {
		const res = c.json({ error: "Upstream service error" }, 502);
		res.headers.set("Cache-Control", "no-store");
		applySecurityHeaders(res.headers);
		return res;
	});

	app.get("/api/config", (c) => {
		const body: ReaderConfigResponse = {
			krvSyncedAudioEnabled: Boolean(c.env?.AUDIO_BUCKET || hasConfiguredAudioBase(c.env)),
		};

		c.header("Cache-Control", "private, max-age=300");
		return c.json(body);
	});

	app.get("/api/audio/:usfm/:chapter", async (c) => {
		const parsed = parseChapterRef(c.req.param("usfm"), c.req.param("chapter"));
		if (!parsed) {
			return c.json({ error: "Invalid book or chapter reference" }, 400);
		}
		const { book, usfm, chapter } = parsed;

		const esvApiKey = c.env?.ESV_API_KEY?.trim();
		const customAudioBase = hasConfiguredAudioBase(c.env);
		const tracks: AudioTrackOption[] = [];

		if (c.env?.AUDIO_BUCKET) {
			tracks.push({
				id: SUPERTONIC_TRACK_ID,
				label: "개역한글 · Daniel (AI)",
				language: "ko",
				url: `/api/audio/krv/${usfm}/${chapter}`,
			});
		} else if (customAudioBase) {
			tracks.push({
				id: SUPERTONIC_TRACK_ID,
				label: "개역한글 · Daniel (AI)",
				language: "ko",
				url: `${customAudioBase}/${usfm}/${chapter}.mp3`,
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
		const parsed = parseChapterRef(c.req.param("usfm"), c.req.param("chapter"));
		if (!parsed) {
			return c.json({ error: "Invalid book or chapter reference" }, 400);
		}

		const bucket = c.env?.AUDIO_BUCKET;
		if (!bucket) {
			c.header("Cache-Control", "no-store");
			return c.json({ error: "Korean audio is not configured" }, 503);
		}

		const rawRangeHeader = c.req.header("Range");
		let parsedRange: ParsedByteRange | undefined;
		if (rawRangeHeader !== undefined) {
			const rangeResult = parseByteRangeHeader(rawRangeHeader);
			if (!rangeResult.ok) {
				return new Response(null, {
					status: rangeResult.status,
					headers: { "Cache-Control": "no-store" },
				});
			}
			parsedRange = rangeResult.value;
		}

		const key = `${parsed.usfm}/${parsed.chapter}.mp3`;
		const isHead = c.req.method === "HEAD";
		let object: R2ObjectBodyLike | null;
		try {
			object =
				isHead && !parsedRange && bucket.head
					? await bucket.head(key)
					: await bucket.get(key, parsedRange ? { range: parsedRange.r2Range } : undefined);
		} catch (err) {
			if (parsedRange && isR2InvalidRangeError(err)) {
				return rangeNotSatisfiableResponse();
			}
			throw err;
		}

		if (!object) {
			c.header("Cache-Control", "no-store");
			return c.json({ error: "Korean audio chapter not found" }, 404);
		}

		if (matchesIfNoneMatch(c.req.header("If-None-Match"), object.httpEtag)) {
			object.body?.cancel?.().catch(() => {});
			const headers = new Headers({ "Cache-Control": AUDIO_CACHE_CONTROL });
			if (object.httpEtag) headers.set("ETag", object.httpEtag);
			return new Response(null, { status: 304, headers });
		}

		if (parsedRange) {
			const isOutOfBounds =
				object.size <= 0 || (parsedRange.kind === "bounded" && parsedRange.start >= object.size);
			if (isOutOfBounds) {
				object.body?.cancel?.().catch(() => {});
				return rangeNotSatisfiableResponse(object.size);
			}
		}

		const headers = new Headers();
		headers.set("Content-Type", resolveSafeAudioMime(object));
		headers.set("Accept-Ranges", "bytes");
		headers.set("Content-Disposition", "inline");
		headers.set("Cache-Control", AUDIO_CACHE_CONTROL);
		if (object.httpEtag) {
			headers.set("ETag", object.httpEtag);
		}

		if (isHead) {
			object.body?.cancel?.().catch(() => {});
		} else if (object.size > 0 && !object.body) {
			c.header("Cache-Control", "no-store");
			return c.json({ error: "Korean audio stream unavailable" }, 502);
		}

		if (parsedRange) {
			const { offset, length } = resolveReturnedRange(object, parsedRange);
			if (length <= 0 || offset < 0 || offset + length > object.size) {
				if (!isHead) object.body?.cancel?.().catch(() => {});
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
		const parsed = parseChapterRef(c.req.param("usfm"), c.req.param("chapter"));
		if (!parsed) {
			return c.json({ error: "Invalid book or chapter reference" }, 400);
		}
		const { book, chapter } = parsed;

		const esvApiKey = c.env?.ESV_API_KEY?.trim();
		if (!esvApiKey) {
			return c.json({ error: "ESV audio is not configured" }, 503);
		}

		const resolved = await resolveEsvAudioUrl(
			esvApiKey,
			{ bookEn: book.en, chapter, chaptersInBook: book.chapters },
			fetcher,
		).catch(() => null);
		if (!resolved) {
			return c.json({ error: "ESV audio unavailable for this passage" }, 502);
		}

		if (resolved.url) {
			c.header("Cache-Control", "private, max-age=1800");
			return c.redirect(resolved.url, 302);
		}

		if (resolved.directStreamResponse) {
			const headers = new Headers();
			const rawType = (resolved.directStreamResponse.headers.get("content-type") ?? "")
				.split(";")[0]
				.trim();
			headers.set("Content-Type", SAFE_AUDIO_MIME_RE.test(rawType) ? rawType : "audio/mpeg");
			headers.set("Content-Disposition", "inline");
			headers.set("Cache-Control", "private, max-age=1800");
			return new Response(resolved.directStreamResponse.body, {
				status: resolved.directStreamResponse.status,
				headers,
			});
		}

		return c.json({ error: "ESV audio unavailable" }, 502);
	});

	app.get("/api/commentary/:commentaryId/:usfm/:chapter", async (c) => {
		const commentaryId = c.req.param("commentaryId");
		if (!isCommentaryId(commentaryId)) {
			return c.json({ error: "Unsupported commentary source" }, 400);
		}
		const parsed = parseChapterRef(c.req.param("usfm"), c.req.param("chapter"));
		if (!parsed) {
			return c.json({ error: "Invalid book or chapter reference" }, 400);
		}

		const result = await fetchHelloAoCommentaryChapter(
			commentaryId,
			parsed.usfm,
			parsed.chapter,
			fetcher,
		);
		if (result.status === "error") {
			c.header("Cache-Control", "no-store");
			return c.json({ error: "Commentary lookup failed" }, 502);
		}

		c.header("Cache-Control", "public, max-age=86400");
		return c.json(result.data);
	});

	return app;
}

const app = createApp();
export default app;
