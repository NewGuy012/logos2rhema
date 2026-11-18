import { Hono } from "hono";
import { getBookByUsfm } from "../shared/books";
import {
	BUILTIN_ENGLISH_TRANSLATIONS,
	BUILTIN_KOREAN_TRANSLATIONS,
	getBuiltinTranslation,
} from "../shared/translations";
import type { AudioTrackOption, ChapterAudioResponse, TranslationMeta } from "../shared/types";
import {
	fetchBibleBrainAudioTrack,
	fetchBibleBrainChapterText,
	listBibleBrainTranslations,
} from "./bible-brain";
import {
	extractHelloAoAudioTracks,
	type FetchLike,
	fetchHelloAoChapter,
	parseHelloAoVerses,
} from "./helloao";

export interface WorkerBindings {
	BIBLE_BRAIN_API_KEY?: string;
	AUDIO_BASE_URL?: string;
}

function pickFilesetsForTestament(
	rawFilesetParam: string,
	testament: "OT" | "NT",
	fallbackOt?: string,
	fallbackNt?: string,
): string[] {
	const explicit = rawFilesetParam
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (explicit.length > 0) {
		const testamentChar = testament === "OT" ? "O" : "N";
		const preferred = explicit.filter(
			(id) => id.includes(`${testamentChar}1`) || id.includes(`${testamentChar}2`),
		);
		const others = explicit.filter((id) => !preferred.includes(id));
		return [...preferred, ...others];
	}
	const fallback = testament === "OT" ? fallbackOt : fallbackNt;
	return fallback ? [fallback] : [];
}

export interface WorkerDeps {
	fetcher?: FetchLike;
}

export function createApp(deps: WorkerDeps = {}) {
	const fetcher = deps.fetcher ?? fetch;
	const app = new Hono<{ Bindings: WorkerBindings }>();

	app.get("/api/health", (c) => c.json({ ok: true, service: "logos" }));

	app.get("/api/translations", async (c) => {
		const english: TranslationMeta[] = [...BUILTIN_ENGLISH_TRANSLATIONS];
		const korean: TranslationMeta[] = [...BUILTIN_KOREAN_TRANSLATIONS];
		const apiKey = c.env?.BIBLE_BRAIN_API_KEY?.trim();

		if (apiKey) {
			const [bbKo, bbEn] = await Promise.all([
				listBibleBrainTranslations(apiKey, "ko", fetcher).catch(() => []),
				listBibleBrainTranslations(apiKey, "en", fetcher).catch(() => []),
			]);
			korean.push(...bbKo);
			english.push(...bbEn);
		}

		c.header("Cache-Control", "public, max-age=300");
		return c.json({
			english,
			korean,
			bibleBrainEnabled: Boolean(apiKey),
		});
	});

	app.get("/api/passage/:translationId/:usfm/:chapter", async (c) => {
		const translationId = c.req.param("translationId");
		const usfm = c.req.param("usfm").toUpperCase();
		const chapter = Number.parseInt(c.req.param("chapter"), 10);

		const book = getBookByUsfm(usfm);
		if (!book || Number.isNaN(chapter) || chapter < 1 || chapter > book.chapters) {
			return c.json({ error: "Invalid book or chapter reference" }, 400);
		}

		const builtin = getBuiltinTranslation(translationId);
		if (builtin?.source === "helloao" && builtin.externalId) {
			const payload = await fetchHelloAoChapter(builtin.externalId, usfm, chapter, fetcher);
			if (!payload) {
				return c.json({ error: `Chapter unavailable in ${builtin.code}` }, 404);
			}
			const verses = parseHelloAoVerses(payload);
			const audioTracks = extractHelloAoAudioTracks(payload, {
				translationId: builtin.id,
				language: builtin.language,
			});
			c.header("Cache-Control", "public, max-age=3600");
			return c.json({
				translationId: builtin.id,
				usfm,
				chapter,
				verses,
				audioTracks,
			});
		}

		if (translationId.startsWith("bb:")) {
			const apiKey = c.env?.BIBLE_BRAIN_API_KEY?.trim();
			if (!apiKey) {
				return c.json({ error: "BIBLE_BRAIN_API_KEY is not configured" }, 400);
			}
			const filesetId = translationId.slice(3);
			const verses = await fetchBibleBrainChapterText(apiKey, filesetId, usfm, chapter, fetcher);
			c.header("Cache-Control", "public, max-age=3600");
			return c.json({
				translationId,
				usfm,
				chapter,
				verses,
				audioTracks: [],
			});
		}

		return c.json(
			{ error: "Use static /data/bibles/{id}/{USFM}.json for bundled translations" },
			400,
		);
	});

	app.get("/api/audio/:usfm/:chapter", async (c) => {
		const usfm = c.req.param("usfm").toUpperCase();
		const chapter = Number.parseInt(c.req.param("chapter"), 10);
		const koId = c.req.query("ko") || "krv";
		const enId = c.req.query("en") || "esv";
		const koFileset = c.req.query("koFileset") || "";
		const enFileset = c.req.query("enFileset") || "";

		const book = getBookByUsfm(usfm);
		if (!book || Number.isNaN(chapter) || chapter < 1 || chapter > book.chapters) {
			return c.json({ error: "Invalid book or chapter reference" }, 400);
		}

		const tracks: AudioTrackOption[] = [];
		const apiKey = c.env?.BIBLE_BRAIN_API_KEY?.trim();
		const customAudioBase = c.env?.AUDIO_BASE_URL?.trim();

		// 1. Sync Korean audio for selected Korean translation
		if (koId === "krv" && customAudioBase) {
			const cleanBase = customAudioBase.replace(/\/+$/, "");
			tracks.push({
				id: `custom:krv:${usfm}:${chapter}`,
				label: "개역한글 Reader (Custom)",
				language: "ko",
				translationId: "krv",
				url: `${cleanBase}/${usfm}/${chapter}.mp3`,
				source: "custom",
			});
		}

		if (apiKey && (koFileset || koId.startsWith("bb:"))) {
			const candidates = pickFilesetsForTestament(koFileset || koId.slice(3), book.testament);
			for (const targetFileset of candidates) {
				const bbTrack = await fetchBibleBrainAudioTrack(
					apiKey,
					{
						filesetId: targetFileset,
						usfm,
						chapter,
						translationId: koId,
						language: "ko",
						label: `Korean Audio (${targetFileset})`,
					},
					fetcher,
				).catch(() => null);
				if (bbTrack) {
					tracks.push(bbTrack);
					break;
				}
			}
		}

		if (koId === "kor_old" || (koId === "krv" && !tracks.some((t) => t.language === "ko"))) {
			const korPayload = await fetchHelloAoChapter("kor_old", usfm, chapter, fetcher).catch(
				() => null,
			);
			if (korPayload) {
				tracks.push(
					...extractHelloAoAudioTracks(korPayload, {
						translationId: koId,
						language: "ko",
						note:
							koId === "krv"
								? "Paired with Wordproject Korean human narration (traditional Korean wording)"
								: undefined,
					}),
				);
			}
		}

		// 2. Sync English audio for selected English translation
		const enBuiltin = getBuiltinTranslation(enId);
		if (enBuiltin?.source === "helloao" && enBuiltin.externalId && enBuiltin.hasAudio) {
			const enPayload = await fetchHelloAoChapter(
				enBuiltin.externalId,
				usfm,
				chapter,
				fetcher,
			).catch(() => null);
			if (enPayload) {
				tracks.push(
					...extractHelloAoAudioTracks(enPayload, {
						translationId: enBuiltin.id,
						language: "en",
					}),
				);
			}
		} else if (apiKey && (enFileset || enId === "esv" || enId.startsWith("bb:"))) {
			const candidates = pickFilesetsForTestament(
				enFileset || (enId === "esv" ? "" : enId.slice(3)),
				book.testament,
				enId === "esv" ? "ENGESVO2DA" : undefined,
				enId === "esv" ? "ENGESVN2DA" : undefined,
			);
			for (const targetFileset of candidates) {
				const bbEnTrack = await fetchBibleBrainAudioTrack(
					apiKey,
					{
						filesetId: targetFileset,
						usfm,
						chapter,
						translationId: enId,
						language: "en",
						label: `${enId.toUpperCase()} Audio (${targetFileset})`,
					},
					fetcher,
				).catch(() => null);
				if (bbEnTrack) {
					tracks.push(bbEnTrack);
					break;
				}
			}
		}

		const responseBody: ChapterAudioResponse = {
			bookUsfm: usfm,
			chapter,
			tracks,
		};

		c.header("Cache-Control", "public, max-age=1800");
		return c.json(responseBody);
	});

	return app;
}

const app = createApp();
export default app;
