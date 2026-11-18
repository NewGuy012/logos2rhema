import { beforeEach, describe, expect, it } from "bun:test";

import { CANONICAL_BIBLES } from "../src/shared/translations";
import type { ChapterAudioResponse, ReaderConfigResponse } from "../src/shared/types";
import { clearBibleBrainCache, selectAudioFilesetsForTestament } from "../src/worker/bible-brain";
import type { FetchLike } from "../src/worker/helloao";
import { createApp } from "../src/worker/index";

describe("Canonical 1-version-per-language & Bible Brain v4 Worker API", () => {
	beforeEach(() => {
		clearBibleBrainCache();
	});

	it("returns strictly one canonical version per language (ESV & KRV) from /api/config", async () => {
		expect(CANONICAL_BIBLES.en.id).toBe("esv");
		expect(CANONICAL_BIBLES.ko.id).toBe("krv");

		const app = createApp();
		const res = await app.request("/api/config", undefined, {
			ESV_API_KEY: "secret-esv-key",
		});
		expect(res.status).toBe(200);

		const text = await res.text();
		expect(text).not.toContain("secret-esv-key");
		const body = JSON.parse(text) as ReaderConfigResponse;
		expect(body.english.id).toBe("esv");
		expect(body.english.code).toBe("ESV");
		expect(body.english.hasAudio).toBe(true);
		expect(body.korean.id).toBe("krv");
		expect(body.korean.code).toBe("개역한글");
		expect(body.bibleBrainEnabled).toBe(false);
		expect(body.esvAudioEnabled).toBe(true);
	});

	it("filters Bible Brain filesets by testament and skips HLS/opus streams", () => {
		const filesets = selectAudioFilesetsForTestament(
			{
				abbr: "ENGESV",
				name: "English Standard Version",
				filesets: {
					"dbp-prod": [
						{ id: "ENGESVN2SA", type: "audio_drama_stream", size: "NT" },
						{ id: "ENGESVN2DA-opus16", type: "audio_drama", size: "NT" },
						{ id: "ENGESVN2DA", type: "audio_drama", size: "NT", codec: "mp3" },
						{ id: "ENGESVN1DA", type: "audio", size: "NT", codec: "mp3" },
						{ id: "ENGESVO1DA", type: "audio", size: "OT", codec: "mp3" },
					],
				},
			},
			"NT",
		);

		expect(filesets.map((f) => f.filesetId)).toEqual(["ENGESVN1DA", "ENGESVN2DA"]);
		expect(filesets[0]?.audioStyle).toBe("standard");
		expect(filesets[1]?.audioStyle).toBe("drama");
	});

	it("prioritizes Bible Brain audio + verse timestamps over Crossway when BIBLE_BRAIN_API_KEY is set", async () => {
		let crosswayCalled = false;
		const mockFetch: FetchLike = async (input) => {
			const url = String(input);
			if (url.startsWith("https://api.esv.org/")) {
				crosswayCalled = true;
				return new Response("unexpected", { status: 500 });
			}
			if (url.includes("/bibles/ENGESV?")) {
				return Response.json({
					data: {
						abbr: "ENGESV",
						name: "English Standard Version",
						filesets: {
							"dbp-prod": [
								{ id: "ENGESVN1DA", type: "audio", size: "NT" },
								{ id: "ENGESVN2DA", type: "audio_drama", size: "NT" },
							],
						},
					},
				});
			}
			if (url.includes("/bibles?language_code=kor")) {
				return Response.json({
					data: [
						{
							abbr: "KORNKV",
							name: "New Korean Revised Version",
							vname: "개역개정",
							filesets: {
								"dbp-prod": [{ id: "KORNKVN1DA", type: "audio", size: "NT" }],
							},
						},
						{
							abbr: "KORKRV",
							name: "Korean Revised Version",
							vname: "개역한글",
							filesets: {
								"dbp-prod": [{ id: "KORKRVN1DA", type: "audio", size: "NT" }],
							},
						},
					],
				});
			}
			if (url.includes("/bibles/filesets/ENGESVN1DA/JHN/3")) {
				return Response.json({ data: [{ path: "https://cdn.example.com/esv-std-jhn3.mp3" }] });
			}
			if (url.includes("/bibles/filesets/ENGESVN2DA/JHN/3")) {
				return Response.json({ data: [{ path: "https://cdn.example.com/esv-drama-jhn3.mp3" }] });
			}
			if (url.includes("/timestamps/ENGESVN1DA/JHN/3")) {
				return Response.json({
					data: [
						{ verse_start: 0, timestamp: 0 },
						{ verse_start: 1, timestamp: 2.1 },
						{ verse_start: "16", timestamp: "48.2" },
						{ verse_start: 16, timestamp: 50.0 },
					],
				});
			}
			if (url.includes("/bibles/filesets/KORKRVN1DA/JHN/3")) {
				return Response.json({ data: [{ path: "https://cdn.example.com/krv-jhn3.mp3" }] });
			}
			if (url.includes("/timestamps/KORKRVN1DA/JHN/3")) {
				return Response.json({
					data: [
						{ verse_start: 1, timestamp: 1.4 },
						{ verse_start: 16, timestamp: 51.7 },
					],
				});
			}
			return new Response("Not Found", { status: 404 });
		};

		const app = createApp({ fetcher: mockFetch });
		const res = await app.request("/api/audio/JHN/3", undefined, {
			BIBLE_BRAIN_API_KEY: "bb-secret-key",
			ESV_API_KEY: "esv-secret-key",
		});

		expect(res.status).toBe(200);
		expect(crosswayCalled).toBe(false);

		const text = await res.text();
		expect(text).not.toContain("bb-secret-key");
		expect(text).not.toContain("esv-secret-key");

		const body = JSON.parse(text) as ChapterAudioResponse;
		const koTrack = body.tracks.find((t) => t.language === "ko");
		const enStandard = body.tracks.find((t) => t.language === "en" && t.audioStyle === "standard");
		const enDrama = body.tracks.find((t) => t.language === "en" && t.audioStyle === "drama");

		expect(koTrack?.filesetId).toBe("KORKRVN1DA");
		expect(koTrack?.verseTimings?.[16]).toBe(51.7);
		expect(enStandard?.url).toBe("https://cdn.example.com/esv-std-jhn3.mp3");
		expect(enStandard?.verseTimings?.[16]).toBe(48.2);
		expect(enStandard?.verseTimings?.[0]).toBeUndefined();
		expect(enDrama?.url).toBe("https://cdn.example.com/esv-drama-jhn3.mp3");
	});

	it("falls back to Crossway ESV API and zero-key Wordproject Korean audio when Bible Brain lacks ESV or key", async () => {
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
			if (url.includes("/kor_old/JUD/1.json")) {
				return Response.json({
					thisChapterAudioLinks: {
						wordproject: "https://audio.bible.helloao.org/api/kor_old/JUD/1/audio/wordproject.mp3",
					},
				});
			}
			return new Response("Not Found", { status: 404 });
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
		expect(koTrack?.url).toContain("wordproject.mp3");
		expect(enTrack?.source).toBe("esv-api");
		expect(enTrack?.url).toBe("https://audio.esv.org/hw/65001001-65001025.mp3");
	});

	it("supports future Bible Brain languages & passage loading via /api/languages and /api/passage/lang:*", async () => {
		const mockFetch: FetchLike = async (input) => {
			const url = String(input);
			if (url.includes("/languages?")) {
				return Response.json({
					data: [
						{ id: 1, name: "English", iso: "eng", autonym: "English" },
						{ id: 2, name: "Spanish", iso: "spa", autonym: "Español" },
					],
				});
			}
			if (url.includes("/bibles?language_code=spa")) {
				return Response.json({
					data: [
						{
							abbr: "SPARVR",
							name: "Reina Valera",
							filesets: { "dbp-prod": [{ id: "SPARVRT", type: "text_plain" }] },
						},
					],
				});
			}
			if (url.includes("/bibles/filesets/SPARVRT/JHN/3")) {
				return Response.json({
					data: [{ verse_start: 16, verse_text: "Porque de tal manera amó Dios al mundo..." }],
				});
			}
			return new Response("Not Found", { status: 404 });
		};

		const app = createApp({ fetcher: mockFetch });
		const langRes = await app.request("/api/languages", undefined, {
			BIBLE_BRAIN_API_KEY: "bb-key",
		});
		expect(langRes.status).toBe(200);
		const langBody = (await langRes.json()) as {
			bibleBrainEnabled: boolean;
			languages: Array<{ iso: string }>;
		};
		expect(langBody.bibleBrainEnabled).toBe(true);
		expect(langBody.languages.some((l) => l.iso === "spa")).toBe(true);

		const passageRes = await app.request("/api/passage/lang:spa/JHN/3", undefined, {
			BIBLE_BRAIN_API_KEY: "bb-key",
		});
		expect(passageRes.status).toBe(200);
		const passageBody = (await passageRes.json()) as {
			abbr: string;
			verses: Array<{ verse: number; text: string }>;
		};
		expect(passageBody.abbr).toBe("SPARVR");
		expect(passageBody.verses[0]?.verse).toBe(16);
	});

	it("validates invalid chapter references with HTTP 400", async () => {
		const app = createApp();
		const res = await app.request("/api/audio/GEN/999");
		expect(res.status).toBe(400);
	});
});
