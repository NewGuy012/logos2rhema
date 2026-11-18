import { Hono } from "hono";

import { getBookByUsfm } from "../shared/books";
import { CANONICAL_BIBLES } from "../shared/translations";
import type {
	AudioTrackOption,
	BookMeta,
	ChapterAudioResponse,
	ReaderConfigResponse,
	TranslationMeta,
} from "../shared/types";
import {
	fetchBibleBrainAudioTrack,
	fetchBibleBrainChapterText,
	fetchBibleBrainLanguages,
	resolveBibleBrainLanguageTextFileset,
	resolveCanonicalAudioFilesets,
	type ResolvedAudioFileset,
} from "./bible-brain";
import { fetchEsvAudioTrack, resolveEsvAudioUrl } from "./esv-audio";
import { extractHelloAoAudioTracks, fetchHelloAoChapter } from "./helloao";
import { type FetchLike, isSafeHttpsUrl } from "./http";

export interface WorkerBindings {
	ESV_API_KEY?: string;
	BIBLE_BRAIN_API_KEY?: string;
	BIBLE_BRAIN_EN_BIBLE_ID?: string;
	BIBLE_BRAIN_KO_BIBLE_ID?: string;
	AUDIO_BASE_URL?: string;
}

export interface WorkerDeps {
	fetcher?: FetchLike;
}

async function resolveBibleBrainTracksForLanguage(
	apiKey: string,
	options: {
		language: string;
		translationId: string;
		usfm: string;
		chapter: number;
		testament: "OT" | "NT";
		bibleId?: string;
		fallbackFilesets?: readonly string[];
	},
	fetcher: FetchLike,
): Promise<AudioTrackOption[]> {
	const filesets = await resolveCanonicalAudioFilesets(
		apiKey,
		{
			language: options.language,
			testament: options.testament,
			bibleId: options.bibleId,
			fallbackFilesets: options.fallbackFilesets,
		},
		fetcher,
	).catch(() => []);

	if (filesets.length === 0) return [];

	// Keep up to one standard and one drama fileset candidate to avoid excessive upstream calls
	const picked: ResolvedAudioFileset[] = [
		filesets.find((f) => f.audioStyle === "standard"),
		filesets.find((f) => f.audioStyle === "drama"),
	].filter((f): f is ResolvedAudioFileset => f !== undefined);

	const results = await Promise.all(
		picked.map((candidate) => {
			const styleLabel = candidate.audioStyle === "drama" ? "Drama" : "Narration";
			return fetchBibleBrainAudioTrack(
				apiKey,
				{
					filesetId: candidate.filesetId,
					usfm: options.usfm,
					chapter: options.chapter,
					translationId: options.translationId,
					language: options.language,
					audioStyle: candidate.audioStyle,
					label: `${candidate.bibleName} · ${styleLabel}`,
				},
				fetcher,
			).catch(() => null);
		}),
	);

	return results.filter((t): t is AudioTrackOption => t !== null);
}

function parsePositiveInt(raw: string | undefined, min: number, max: number): number | null {
	if (!raw || !/^\d+$/.test(raw)) return null;
	const val = Number.parseInt(raw, 10);
	return val >= min && val <= max ? val : null;
}

const FILESET_ID_RE = /^[A-Za-z0-9_-]{4,24}$/;
const ISO_639_3_RE = /^[a-z]{3}$/i;
const BIBLE_ABBR_RE = /^[A-Za-z0-9_-]{2,16}$/;

function parseChapterRef(
	usfmRaw: string,
	chapterRaw: string,
): { book: BookMeta; usfm: string; chapter: number } | null {
	if (!/^\d+$/.test(chapterRaw)) return null;
	const usfm = usfmRaw.toUpperCase();
	const chapter = Number.parseInt(chapterRaw, 10);
	const book = getBookByUsfm(usfm);
	if (!book || chapter < 1 || chapter > book.chapters) return null;
	return { book, usfm, chapter };
}

export function createApp(deps: WorkerDeps = {}) {
	const fetcher = deps.fetcher ?? fetch;
	const app = new Hono<{ Bindings: WorkerBindings }>();

	app.use("*", async (c, next) => {
		if (c.req.method !== "GET" && c.req.method !== "HEAD") {
			c.header("Allow", "GET, HEAD");
			return c.json({ error: "Method not allowed" }, 405);
		}
		await next();
		c.header("X-Content-Type-Options", "nosniff");
		c.header("Referrer-Policy", "strict-origin-when-cross-origin");
		c.header("X-Frame-Options", "DENY");
	});

	app.get("/api/health", (c) => c.json({ ok: true, service: "logos" }));

	app.get("/api/config", (c) => {
		const esvApiKey = c.env?.ESV_API_KEY?.trim();
		const apiKey = c.env?.BIBLE_BRAIN_API_KEY?.trim();
		const esvAudioEnabled = Boolean(apiKey || esvApiKey);

		const english: TranslationMeta = {
			...CANONICAL_BIBLES.en,
			hasAudio: esvAudioEnabled,
			audioLabel: apiKey
				? "Bible Brain ESV (Verse-Synced)"
				: esvApiKey
					? "Crossway ESV (David Cochran Heath)"
					: undefined,
		};

		const korean: TranslationMeta = {
			...CANONICAL_BIBLES.ko,
			hasAudio: true,
			audioLabel: apiKey ? "Bible Brain Korean (Verse-Synced)" : "Wordproject Korean Narration",
		};

		const body: ReaderConfigResponse = {
			english,
			korean,
			bibleBrainEnabled: Boolean(apiKey),
			esvAudioEnabled,
		};

		c.header("Cache-Control", "private, max-age=300");
		return c.json(body);
	});

	app.get("/api/languages", async (c) => {
		const apiKey = c.env?.BIBLE_BRAIN_API_KEY?.trim();
		if (!apiKey) {
			return c.json({
				bibleBrainEnabled: false,
				languages: [
					{ iso: "eng", name: "English", autonym: "English", canonicalId: "esv" },
					{ iso: "kor", name: "Korean", autonym: "한국어", canonicalId: "krv" },
				],
			});
		}

		const pageParam = c.req.query("page");
		const limitParam = c.req.query("limit");
		const page = pageParam !== undefined ? parsePositiveInt(pageParam, 1, 500) : 1;
		const limit = limitParam !== undefined ? parsePositiveInt(limitParam, 1, 250) : 250;
		if (page === null || limit === null) {
			return c.json({ error: "Invalid page or limit parameter" }, 400);
		}

		const { languages, pagination } = await fetchBibleBrainLanguages(
			apiKey,
			{ page, limit },
			fetcher,
		).catch(() => ({ languages: [], pagination: undefined }));
		c.header("Cache-Control", "private, max-age=3600");
		return c.json({ bibleBrainEnabled: true, languages, ...(pagination ? { pagination } : {}) });
	});

	app.get("/api/passage/:target/:usfm/:chapter", async (c) => {
		const target = c.req.param("target");
		const parsed = parseChapterRef(c.req.param("usfm"), c.req.param("chapter"));
		if (!parsed) {
			return c.json({ error: "Invalid book or chapter reference" }, 400);
		}
		const { usfm, chapter } = parsed;

		if (target === "esv" || target === "krv") {
			return c.json(
				{ error: `Use static /data/bibles/${target}/${usfm}.json for bundled canonical text` },
				400,
			);
		}

		const apiKey = c.env?.BIBLE_BRAIN_API_KEY?.trim();
		if (!apiKey) {
			return c.json(
				{ error: "BIBLE_BRAIN_API_KEY is required for additional Bible Brain languages" },
				400,
			);
		}

		if (target.startsWith("bb:")) {
			const filesetId = target.slice(3);
			if (!FILESET_ID_RE.test(filesetId)) {
				return c.json({ error: "Invalid fileset identifier" }, 400);
			}
			const verses = await fetchBibleBrainChapterText(apiKey, filesetId, usfm, chapter, fetcher);
			c.header("Cache-Control", "public, max-age=3600");
			return c.json({ translationId: target, usfm, chapter, verses });
		}

		if (target.startsWith("lang:")) {
			const langIso = target.slice(5);
			const abbr = c.req.query("abbr");
			if (!ISO_639_3_RE.test(langIso) || (abbr !== undefined && !BIBLE_ABBR_RE.test(abbr))) {
				return c.json({ error: "Invalid language or Bible abbreviation" }, 400);
			}
			const resolved = await resolveBibleBrainLanguageTextFileset(apiKey, langIso, abbr, fetcher);
			if (!resolved) {
				return c.json({ error: `No text fileset found for language ${langIso}` }, 404);
			}
			const verses = await fetchBibleBrainChapterText(
				apiKey,
				resolved.textFilesetId,
				usfm,
				chapter,
				fetcher,
			);
			c.header("Cache-Control", "public, max-age=3600");
			return c.json({
				translationId: `bb:${resolved.textFilesetId}`,
				abbr: resolved.bible.abbr,
				usfm,
				chapter,
				verses,
			});
		}

		return c.json({ error: "Unsupported passage target" }, 400);
	});

	app.get("/api/audio/:usfm/:chapter", async (c) => {
		const parsed = parseChapterRef(c.req.param("usfm"), c.req.param("chapter"));
		if (!parsed) {
			return c.json({ error: "Invalid book or chapter reference" }, 400);
		}
		const { book, usfm, chapter } = parsed;

		const esvApiKey = c.env?.ESV_API_KEY?.trim();
		const apiKey = c.env?.BIBLE_BRAIN_API_KEY?.trim();
		const customAudioBase = c.env?.AUDIO_BASE_URL?.trim();
		const enBibleIdOverride = c.env?.BIBLE_BRAIN_EN_BIBLE_ID?.trim();
		const koBibleIdOverride = c.env?.BIBLE_BRAIN_KO_BIBLE_ID?.trim();

		const resolveKoreanTracks = async (): Promise<AudioTrackOption[]> => {
			const koTracks: AudioTrackOption[] = [];

			// 1. Primary: Bible Brain Korean audio + verse timestamps
			if (apiKey) {
				const bbKo = await resolveBibleBrainTracksForLanguage(
					apiKey,
					{
						language: "ko",
						translationId: "krv",
						usfm,
						chapter,
						testament: book.testament,
						bibleId: koBibleIdOverride,
					},
					fetcher,
				);
				koTracks.push(...bbKo);
			}

			// 2. Custom hosted/R2 KRV MP3 files
			if (customAudioBase && isSafeHttpsUrl(customAudioBase)) {
				const cleanBase = customAudioBase.replace(/\/+$/, "");
				koTracks.push({
					id: `custom:krv:${usfm}:${chapter}`,
					label: "개역한글 Reader (Custom)",
					language: "ko",
					translationId: "krv",
					url: `${cleanBase}/${usfm}/${chapter}.mp3`,
					source: "custom",
					audioStyle: "standard",
				});
			}

			// 3. Zero-key fallback: HelloAO Wordproject Korean human narration
			if (koTracks.length === 0) {
				const korPayload = await fetchHelloAoChapter("kor_old", usfm, chapter, fetcher).catch(
					() => null,
				);
				if (korPayload) {
					koTracks.push(
						...extractHelloAoAudioTracks(korPayload, {
							translationId: "krv",
							language: "ko",
							note: "Paired with Wordproject Korean human narration",
						}),
					);
				}
			}

			return koTracks;
		};

		const resolveEnglishTracks = async (): Promise<AudioTrackOption[]> => {
			const enTracks: AudioTrackOption[] = [];

			// 1. Primary: Bible Brain ESV audio + verse timestamps
			if (apiKey) {
				const enMeta = CANONICAL_BIBLES.en;
				const fallbackFilesets =
					book.testament === "OT"
						? enMeta.preferredAudioFilesets?.OT
						: enMeta.preferredAudioFilesets?.NT;

				const bbEn = await resolveBibleBrainTracksForLanguage(
					apiKey,
					{
						language: "en",
						translationId: "esv",
						usfm,
						chapter,
						testament: book.testament,
						bibleId: enBibleIdOverride || enMeta.bibleBrainBibleId,
						fallbackFilesets,
					},
					fetcher,
				);
				enTracks.push(...bbEn);
			}

			// 2. Fallback: Direct Crossway ESV API when Bible Brain has no licensed ESV track
			if (enTracks.length === 0 && esvApiKey) {
				const esvTrack = await fetchEsvAudioTrack(
					esvApiKey,
					{
						usfm,
						bookEn: book.en,
						chapter,
						chaptersInBook: book.chapters,
					},
					fetcher,
				).catch(() => null);
				if (esvTrack) {
					enTracks.push(esvTrack);
				}
			}

			return enTracks;
		};

		const extraLang = c.req.query("lang")?.toLowerCase();
		const extraBible = c.req.query("bible");
		if (extraLang !== undefined && !ISO_639_3_RE.test(extraLang)) {
			return c.json({ error: "Invalid ISO 639-3 language code" }, 400);
		}
		if (extraBible !== undefined && !BIBLE_ABBR_RE.test(extraBible)) {
			return c.json({ error: "Invalid Bible identifier" }, 400);
		}

		const [koTracks, enTracks, extraTracks] = await Promise.all([
			resolveKoreanTracks(),
			resolveEnglishTracks(),
			extraLang && apiKey && extraLang !== "kor" && extraLang !== "eng"
				? resolveBibleBrainTracksForLanguage(
						apiKey,
						{
							language: extraLang,
							translationId: extraBible ?? `lang:${extraLang}`,
							usfm,
							chapter,
							testament: book.testament,
							bibleId: extraBible,
						},
						fetcher,
					)
				: Promise.resolve([]),
		]);

		const responseBody: ChapterAudioResponse = {
			bookUsfm: usfm,
			chapter,
			tracks: [...koTracks, ...enTracks, ...extraTracks],
			providerStatus: {
				bibleBrainEnabled: Boolean(apiKey),
				esvAudioEnabled: Boolean(apiKey || esvApiKey),
			},
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
			{
				bookEn: book.en,
				chapter,
				chaptersInBook: book.chapters,
			},
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
			const contentType = rawType.startsWith("audio/") ? rawType : "audio/mpeg";
			headers.set("Content-Type", contentType);
			headers.set("Cache-Control", "private, max-age=1800");
			return new Response(resolved.directStreamResponse.body, {
				status: resolved.directStreamResponse.status,
				headers,
			});
		}

		return c.json({ error: "ESV audio unavailable" }, 502);
	});

	return app;
}

const app = createApp();
export default app;
