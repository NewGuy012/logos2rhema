import { describe, expect, it } from "bun:test";

import type { ChapterAudioResponse, VerseEntry } from "../src/shared/types";
import { type FetchLike, parseHelloAoVerses } from "../src/worker/helloao";
import { createApp } from "../src/worker/index";

describe("HelloAO parser & Hono Worker API", () => {
	it("parses HelloAO chapter nodes with headings and inline noteId filtering", () => {
		const verses = parseHelloAoVerses({
			chapter: {
				number: 1,
				content: [
					{ type: "heading", content: ["The Creation"] },
					{ type: "line_break" },
					{
						type: "verse",
						number: 1,
						content: ["In the beginning", { noteId: 0 }, "God created."],
					},
				],
			},
		});

		expect(verses).toEqual([
			{
				verse: 1,
				heading: "The Creation",
				text: "In the beginning God created.",
			},
		]);
	});

	it("returns built-in translations and expands Bible Brain translations when API key exists", async () => {
		const mockFetch: FetchLike = async (input) => {
			const url = String(input);
			if (url.includes("language_code=kor")) {
				return Response.json({
					data: [
						{
							abbr: "KORNKV",
							name: "New Korean Revised Version",
							vname: "개역개정",
							language_iso: "kor",
							filesets: {
								"dbp-prod": [
									{ id: "KORNKVT", type: "text_plain" },
									{ id: "KORNKVN1DA", type: "audio" },
								],
							},
						},
					],
				});
			}
			return Response.json({ data: [] });
		};

		const app = createApp({ fetcher: mockFetch });

		const withoutKey = await app.request("/api/translations");
		expect(withoutKey.status).toBe(200);
		const basicBody = (await withoutKey.json()) as {
			english: Array<{ id: string }>;
			korean: Array<{ id: string }>;
			bibleBrainEnabled: boolean;
		};
		expect(basicBody.bibleBrainEnabled).toBe(false);
		expect(basicBody.english.map((t) => t.id)).toContain("esv");
		expect(basicBody.korean.map((t) => t.id)).toContain("krv");

		const withKey = await app.request("/api/translations", undefined, {
			BIBLE_BRAIN_API_KEY: "test-key",
		});
		const expandedBody = (await withKey.json()) as {
			korean: Array<{ id: string; hasAudio: boolean; audioFilesetIds?: string[] }>;
			bibleBrainEnabled: boolean;
		};
		expect(expandedBody.bibleBrainEnabled).toBe(true);
		const bbEntry = expandedBody.korean.find((t) => t.id === "bb:KORNKVT");
		expect(bbEntry?.hasAudio).toBe(true);
		expect(bbEntry?.audioFilesetIds).toEqual(["KORNKVN1DA"]);
	});

	it("syncs Korean and English human audio tracks to selected translations", async () => {
		const mockFetch: FetchLike = async (input) => {
			const url = String(input);
			if (url.includes("/kor_old/GEN/1.json")) {
				return Response.json({
					thisChapterAudioLinks: {
						wordproject: "https://audio.bible.helloao.org/api/kor_old/GEN/1/audio/wordproject.mp3",
					},
				});
			}
			if (url.includes("/BSB/GEN/1.json")) {
				return Response.json({
					chapter: {
						number: 1,
						content: [{ type: "verse", number: 1, content: ["In the beginning God created."] }],
					},
					thisChapterAudioLinks: {
						david: "https://audio.bible.helloao.org/api/BSB/GEN/1/audio/david.mp3",
						hays: "https://audio.bible.helloao.org/api/BSB/GEN/1/audio/hays.mp3",
					},
				});
			}
			return new Response("Not Found", { status: 404 });
		};

		const app = createApp({ fetcher: mockFetch });

		const passageRes = await app.request("/api/passage/bsb/GEN/1");
		expect(passageRes.status).toBe(200);
		const passageBody = (await passageRes.json()) as {
			verses: VerseEntry[];
			audioTracks: Array<{ id: string }>;
		};
		expect(passageBody.verses).toHaveLength(1);
		expect(passageBody.audioTracks).toHaveLength(2);

		const audioRes = await app.request("/api/audio/GEN/1?ko=krv&en=bsb");
		expect(audioRes.status).toBe(200);
		const audioBody = (await audioRes.json()) as ChapterAudioResponse;
		expect(
			audioBody.tracks.some((t) => t.language === "ko" && t.url.includes("wordproject.mp3")),
		).toBe(true);
		expect(audioBody.tracks.filter((t) => t.language === "en")).toHaveLength(2);
	});

	it("supports custom KRV audio URLs and Bible Brain timestamps", async () => {
		const mockFetch: FetchLike = async (input) => {
			const url = String(input);
			if (url.includes("/filesets/ENGESVN2DA/JHN/3")) {
				return Response.json({
					data: [{ path: "https://cdn.example.com/esv-jhn-3.mp3" }],
				});
			}
			if (url.includes("/timestamps/ENGESVN2DA/JHN/3")) {
				return Response.json({
					data: [
						{ verse_start: 1, timestamp: 1.5 },
						{ verse_start: 16, timestamp: 48.2 },
					],
				});
			}
			return new Response("Not Found", { status: 404 });
		};

		const app = createApp({ fetcher: mockFetch });
		const res = await app.request("/api/audio/JHN/3?ko=krv&en=esv", undefined, {
			BIBLE_BRAIN_API_KEY: "bb-key",
			AUDIO_BASE_URL: "https://media.example.com/krv/",
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as ChapterAudioResponse;
		const koTrack = body.tracks.find((t) => t.language === "ko");
		const enTrack = body.tracks.find((t) => t.language === "en");
		expect(koTrack?.url).toBe("https://media.example.com/krv/JHN/3.mp3");
		expect(enTrack?.url).toBe("https://cdn.example.com/esv-jhn-3.mp3");
		expect(enTrack?.verseTimings?.[16]).toBe(48.2);
	});

	it("validates invalid chapter references with HTTP 400", async () => {
		const app = createApp();
		const res = await app.request("/api/audio/GEN/999");
		expect(res.status).toBe(400);
	});
});
