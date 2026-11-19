import { describe, expect, it } from "bun:test";

import { normalizeVerseTimings } from "../src/shared/audio-timings";
import { CANONICAL_BIBLES } from "../src/shared/translations";
import type {
	ChapterAudioResponse,
	ChapterCommentaryResponse,
	CommentaryMeta,
	ReaderConfigResponse,
} from "../src/shared/types";
import { type FetchLike, isSafeHttpsUrl } from "../src/worker/http";
import { createApp } from "../src/worker/index";

describe("Canonical 1-version-per-language & Supertonic/ESV Worker API", () => {
	it("returns strictly one canonical version per language (ESV & KRV) and validates AUDIO_BASE_URL in /api/config", async () => {
		expect(CANONICAL_BIBLES.en.id).toBe("esv");
		expect(CANONICAL_BIBLES.ko.id).toBe("krv");

		const app = createApp();
		const res = await app.request("/api/config", undefined, {
			ESV_API_KEY: "secret-esv-key",
			AUDIO_BASE_URL: "https://r2.example.com/krv/",
		});
		expect(res.status).toBe(200);

		const text = await res.text();
		expect(text).not.toContain("secret-esv-key");
		const body = JSON.parse(text) as ReaderConfigResponse;
		expect(body.english.id).toBe("esv");
		expect(body.english.code).toBe("ESV");
		expect(body.english.hasAudio).toBe(true);
		expect(body.english.audioLabel).toBe("Crossway ESV (David Cochran Heath)");
		expect(body.korean.id).toBe("krv");
		expect(body.korean.code).toBe("개역한글");
		expect(body.korean.audioLabel).toBe("Supertonic 3 Korean · Daniel (Verse-Synced)");
		expect(body.krvSyncedAudioEnabled).toBe(true);
		expect(body.esvAudioEnabled).toBe(true);

		const badRes = await app.request("/api/config", undefined, {
			AUDIO_BASE_URL: "http://insecure.example.com/krv",
		});
		const badBody = (await badRes.json()) as ReaderConfigResponse;
		expect(badBody.krvSyncedAudioEnabled).toBe(false);
		expect(badBody.korean.hasAudio).toBe(false);
		expect(badBody.korean.audioLabel).toBeUndefined();
		expect(badBody.esvAudioEnabled).toBe(false);
		expect(badBody.english.hasAudio).toBe(false);
	});

	it("serves Supertonic custom KRV track with stable ID and Crossway ESV track when AUDIO_BASE_URL and ESV_API_KEY are set", async () => {
		const captured = { authHeader: null as string | null, query: null as string | null };

		const mockFetch: FetchLike = async (input, init) => {
			const url = String(input);
			if (url.startsWith("https://api.esv.org/v3/passage/audio/")) {
				captured.authHeader = new Headers(init?.headers).get("Authorization");
				captured.query = new URL(url).searchParams.get("q");
				return new Response(null, {
					status: 302,
					headers: { Location: "https://audio.esv.org/hw/43003001-43003036.mp3" },
				});
			}
			return new Response("Not Found", { status: 404 });
		};

		const app = createApp({ fetcher: mockFetch });
		const res = await app.request("/api/audio/JHN/3", undefined, {
			AUDIO_BASE_URL: "https://cdn.example.com/krv/",
			ESV_API_KEY: "esv-secret-key",
		});

		expect(res.status).toBe(200);
		expect(captured.authHeader).toBe("Token esv-secret-key");
		expect(captured.query).toBe("John 3");

		const text = await res.text();
		expect(text).not.toContain("esv-secret-key");

		const body = JSON.parse(text) as ChapterAudioResponse;
		const koTrack = body.tracks.find((t) => t.language === "ko");
		const enTrack = body.tracks.find((t) => t.language === "en");

		expect(koTrack).toEqual({
			id: "custom:krv:supertonic",
			label: "개역한글 · Daniel (AI)",
			language: "ko",
			translationId: "krv",
			url: "https://cdn.example.com/krv/JHN/3.mp3",
			source: "custom",
			note: "AI-synthesized narration (Supertonic 3 · Daniel)",
		});
		expect(enTrack?.source).toBe("esv-api");
		expect(enTrack?.url).toBe("https://audio.esv.org/hw/43003001-43003036.mp3");
	});

	it("returns only Crossway single-chapter ESV track and omits KRV audio when AUDIO_BASE_URL is unset", async () => {
		const secretKey = "esv-super-secret-token-123";
		const captured = { authHeader: null as string | null, query: null as string | null };

		const mockFetch: FetchLike = async (input, init) => {
			const url = String(input);
			if (url.startsWith("https://api.esv.org/v3/passage/audio/")) {
				captured.authHeader = new Headers(init?.headers).get("Authorization");
				captured.query = new URL(url).searchParams.get("q");
				return new Response(null, {
					status: 302,
					headers: { Location: "https://audio.esv.org/hw/65001001-65001025.mp3" },
				});
			}
			return new Response(`unexpected upstream fetch: ${url}`, { status: 500 });
		};

		const app = createApp({ fetcher: mockFetch });
		const audioRes = await app.request("/api/audio/JUD/1", undefined, {
			ESV_API_KEY: secretKey,
		});
		expect(audioRes.status).toBe(200);
		const audioText = await audioRes.text();
		expect(audioText).not.toContain(secretKey);
		expect(captured.authHeader).toBe(`Token ${secretKey}`);
		expect(captured.query).toBe("Jude 1:1-99");

		const audioBody = JSON.parse(audioText) as ChapterAudioResponse;
		const koTrack = audioBody.tracks.find((t) => t.language === "ko");
		const enTrack = audioBody.tracks.find((t) => t.language === "en");
		expect(koTrack).toBeUndefined();
		expect(enTrack?.source).toBe("esv-api");
		expect(enTrack?.url).toBe("https://audio.esv.org/hw/65001001-65001025.mp3");
	});

	it("validates invalid chapter references, removed legacy endpoints, methods, SSRF URLs, and error headers", async () => {
		const mockFetch: FetchLike = async () => new Response("Upstream Down", { status: 503 });

		expect(isSafeHttpsUrl("https://cdn.example.com/gen1.mp3")).toBe(true);
		expect(isSafeHttpsUrl("https://127.0.0.1/gen1.mp3")).toBe(false);
		expect(isSafeHttpsUrl("https://0x7f000001/gen1.mp3")).toBe(false);
		expect(isSafeHttpsUrl("https://[::1]/gen1.mp3")).toBe(false);
		expect(isSafeHttpsUrl("https://localhost/gen1.mp3")).toBe(false);
		expect(isSafeHttpsUrl("https://cdn.example.com:8443/gen1.mp3")).toBe(false);
		expect(
			isSafeHttpsUrl("https://cdn.example.com/a.mp3?k=a%2Bb", { forbiddenSubstring: "a+b" }),
		).toBe(false);

		const app = createApp({ fetcher: mockFetch });
		expect((await app.request("/api/audio/GEN/999")).status).toBe(400);
		expect((await app.request("/api/audio/GEN/1abc")).status).toBe(400);
		expect((await app.request("/api/languages")).status).toBe(404);
		expect((await app.request("/api/passage/lang:spa/JHN/3")).status).toBe(404);

		const badMethod = await app.request("/api/audio/GEN/1", { method: "POST" });
		expect(badMethod.status).toBe(405);
		expect(badMethod.headers.get("x-content-type-options")).toBe("nosniff");
		expect(badMethod.headers.get("content-security-policy")).toContain("default-src 'none'");

		const ssrfAudioRes = await app.request("/api/audio/GEN/1", undefined, {
			AUDIO_BASE_URL: "https://127.0.0.1/krv",
		});
		expect(ssrfAudioRes.status).toBe(200);
		expect(ssrfAudioRes.headers.get("x-content-type-options")).toBe("nosniff");
		const ssrfBody = (await ssrfAudioRes.json()) as ChapterAudioResponse;
		expect(ssrfBody.tracks).toEqual([]);
	});

	it("serves curated Tyndale & Matthew Henry commentaries, normalizes content, and handles 404/400/502", async () => {
		const mockFetch: FetchLike = async (input) => {
			const url = String(input);
			if (url === "https://bible.helloao.org/api/c/tyndale/GEN/1.json") {
				return Response.json({
					book: {
						introductionSummary: "The Book of Genesis\n\nPurpose\n\nBeginnings.",
						introduction: "Genesis introduces God's covenant.",
					},
					chapter: {
						number: 1,
						content: [
							{
								type: "verse",
								number: 1,
								content: ["1:1–2:3 Overview paragraph.", "1:1 In the beginning God created."],
							},
							{
								type: "verse",
								number: 6,
								content: ["1:6-8 The expanse of the sky."],
							},
							{
								type: "verse",
								number: 9,
								content: [{ text: "1:9 " }, { text: "God gathered the waters." }],
							},
						],
					},
				});
			}
			if (url === "https://bible.helloao.org/api/c/matthew-henry/JHN/3.json") {
				return Response.json({
					book: { introduction: "An Exposition of John" },
					chapter: {
						number: 3,
						introduction: "Christ's discourse with Nicodemus.",
						content: [
							{ type: "heading", content: ["The New Birth"] },
							{
								type: "verse",
								number: 1,
								content: ["Paragraph one.\nI. Paragraph two."],
							},
							{
								type: "verse",
								number: 22,
								content: ["John Baptist's witness."],
							},
						],
					},
				});
			}
			if (url === "https://bible.helloao.org/api/c/tyndale/JDG/1.json") {
				return new Response("Not Found", { status: 404 });
			}
			return new Response("Upstream Error", { status: 503 });
		};

		const app = createApp({ fetcher: mockFetch });

		const listRes = await app.request("/api/commentaries");
		expect(listRes.status).toBe(200);
		expect(listRes.headers.get("cache-control")).toBe("public, max-age=86400");
		const listBody = (await listRes.json()) as { commentaries: CommentaryMeta[] };
		expect(listBody.commentaries.map((c) => c.id)).toEqual(["tyndale", "matthew-henry"]);

		const tyndaleRes = await app.request("/api/commentary/tyndale/gen/1");
		expect(tyndaleRes.status).toBe(200);
		expect(tyndaleRes.headers.get("cache-control")).toBe("public, max-age=86400");
		const tyndaleBody = (await tyndaleRes.json()) as ChapterCommentaryResponse;
		expect(tyndaleBody.commentary.id).toBe("tyndale");
		expect(tyndaleBody.bookUsfm).toBe("GEN");
		expect(tyndaleBody.bookIntroduction).toEqual([
			"The Book of Genesis",
			"Purpose",
			"Beginnings.",
			"Genesis introduces God's covenant.",
		]);
		expect(tyndaleBody.entries[0]?.verseStart).toBe(1);
		expect(tyndaleBody.entries[0]?.verseEnd).toBeUndefined();
		expect(tyndaleBody.entries[0]?.paragraphs).toEqual([
			"1:1–2:3 Overview paragraph.",
			"1:1 In the beginning God created.",
		]);
		expect(tyndaleBody.entries[1]?.verseStart).toBe(6);
		expect(tyndaleBody.entries[1]?.verseEnd).toBe(8);
		expect(tyndaleBody.entries[2]?.paragraphs).toEqual(["1:9 God gathered the waters."]);

		const mhRes = await app.request("/api/commentary/matthew-henry/JHN/3");
		expect(mhRes.status).toBe(200);
		const mhBody = (await mhRes.json()) as ChapterCommentaryResponse;
		expect(mhBody.introduction).toEqual(["Christ's discourse with Nicodemus."]);
		expect(mhBody.entries[0]?.heading).toBe("The New Birth");
		expect(mhBody.entries[0]?.verseStart).toBe(1);
		expect(mhBody.entries[0]?.verseEnd).toBe(21);
		expect(mhBody.entries[0]?.paragraphs).toEqual(["Paragraph one.", "I. Paragraph two."]);
		expect(mhBody.entries[1]?.verseStart).toBe(22);

		const emptyRes = await app.request("/api/commentary/tyndale/JDG/1");
		expect(emptyRes.status).toBe(200);
		const emptyBody = (await emptyRes.json()) as ChapterCommentaryResponse;
		expect(emptyBody.entries).toEqual([]);

		expect((await app.request("/api/commentary/adam-clarke/GEN/1")).status).toBe(400);
		expect((await app.request("/api/commentary/tyndale/GEN/999")).status).toBe(400);
		expect((await app.request("/api/commentary/tyndale/GEN/1", { method: "POST" })).status).toBe(
			405,
		);

		const failRes = await app.request("/api/commentary/matthew-henry/EXO/1");
		expect(failRes.status).toBe(502);
		expect(failRes.headers.get("cache-control")).toBe("no-store");
		expect(failRes.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("normalizes verse timings only when valid positive numeric verse entries exist", () => {
		expect(normalizeVerseTimings("invalid-string")).toBeUndefined();
		expect(normalizeVerseTimings({ "0": 0, bad: Number.NaN, "-1": 5, "3": -2 })).toBeUndefined();
		expect(normalizeVerseTimings({ "1": 1.2, "2": 6.8, bad: "x" })).toEqual({ 1: 1.2, 2: 6.8 });
	});
});
