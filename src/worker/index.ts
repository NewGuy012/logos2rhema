import { Hono } from "hono";

import { getBookByUsfm } from "../shared/books";
import { COMMENTARY_SOURCES, isCommentaryId } from "../shared/commentaries";
import { CANONICAL_BIBLES } from "../shared/translations";
import type {
	AudioTrackOption,
	BookMeta,
	ChapterAudioResponse,
	ReaderConfigResponse,
	TranslationMeta,
} from "../shared/types";
import { fetchEsvAudioTrack, resolveEsvAudioUrl } from "./esv-audio";
import { fetchHelloAoCommentaryChapter } from "./helloao";
import { type FetchLike, isSafeHttpsUrl } from "./http";

export interface WorkerBindings {
	ESV_API_KEY?: string;
	AUDIO_BASE_URL?: string;
}

interface WorkerDeps {
	fetcher?: FetchLike;
}

function applySecurityHeaders(headers: Headers): void {
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	headers.set("X-Frame-Options", "DENY");
	headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
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
	});

	app.onError((_err, c) => {
		const res = c.json({ error: "Upstream service error" }, 502);
		res.headers.set("Cache-Control", "no-store");
		applySecurityHeaders(res.headers);
		return res;
	});

	app.get("/api/health", (c) => c.json({ ok: true, service: "logos" }));

	app.get("/api/config", (c) => {
		const esvApiKey = c.env?.ESV_API_KEY?.trim();
		const customAudioBase = c.env?.AUDIO_BASE_URL?.trim();
		const hasCustomAudio = Boolean(customAudioBase && isSafeHttpsUrl(customAudioBase));
		const esvAudioEnabled = Boolean(esvApiKey);

		const english: TranslationMeta = {
			...CANONICAL_BIBLES.en,
			hasAudio: esvAudioEnabled,
			audioLabel: esvApiKey ? "Crossway ESV (David Cochran Heath)" : undefined,
		};

		const korean: TranslationMeta = {
			...CANONICAL_BIBLES.ko,
			hasAudio: hasCustomAudio,
			audioLabel: hasCustomAudio ? "Supertonic 3 Korean · Daniel (Verse-Synced)" : undefined,
		};

		const body: ReaderConfigResponse = {
			english,
			korean,
			krvSyncedAudioEnabled: hasCustomAudio,
			esvAudioEnabled,
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
		const customAudioBase = c.env?.AUDIO_BASE_URL?.trim();

		const resolveKoreanTracks = async (): Promise<AudioTrackOption[]> => {
			if (!customAudioBase || !isSafeHttpsUrl(customAudioBase)) {
				return [];
			}
			const cleanBase = customAudioBase.replace(/\/+$/, "");
			return [
				{
					id: "custom:krv:supertonic",
					label: "개역한글 · Daniel (AI)",
					language: "ko",
					translationId: "krv",
					url: `${cleanBase}/${usfm}/${chapter}.mp3`,
					source: "custom",
					note: "AI-synthesized narration (Supertonic 3 · Daniel)",
				},
			];
		};

		const resolveEnglishTracks = async (): Promise<AudioTrackOption[]> => {
			if (!esvApiKey) return [];
			const esvTrack = await fetchEsvAudioTrack(
				esvApiKey,
				{ usfm, bookEn: book.en, chapter, chaptersInBook: book.chapters },
				fetcher,
			).catch(() => null);
			return esvTrack ? [esvTrack] : [];
		};

		const [koTracks, enTracks] = await Promise.all([resolveKoreanTracks(), resolveEnglishTracks()]);

		const responseBody: ChapterAudioResponse = {
			bookUsfm: usfm,
			chapter,
			tracks: [...koTracks, ...enTracks],
		};

		c.header("Cache-Control", "private, max-age=1800");
		return c.json(responseBody);
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
			const rawType = resolved.directStreamResponse.headers.get("content-type") ?? "";
			headers.set("Content-Type", rawType.startsWith("audio/") ? rawType : "audio/mpeg");
			headers.set("Cache-Control", "private, max-age=1800");
			return new Response(resolved.directStreamResponse.body, {
				status: resolved.directStreamResponse.status,
				headers,
			});
		}

		return c.json({ error: "ESV audio unavailable" }, 502);
	});

	app.get("/api/commentaries", (c) => {
		c.header("Cache-Control", "public, max-age=86400");
		return c.json({ commentaries: COMMENTARY_SOURCES });
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
