import { describe, expect, it } from "bun:test";

import {
	normalizePlaybackRate,
	parseCustomPlaybackRate,
	resolveTimeForVerse,
	resolveVerseAtTime,
} from "../src/react-app/hooks/useHumanAudio";
import {
	computeMaxDockedRailHeight,
	DEFAULT_FALLBACK_RAIL_WIDTH,
	DEFAULT_MIN_DICT_HEIGHT,
	DEFAULT_MIN_RAIL_WIDTH,
	getDefaultRailWidthPx,
	parseStoredRailDimension,
	resolveDockedRailWidths,
} from "../src/react-app/hooks/useResizablePanel";
import {
	clearLoaderCaches,
	getEsvCacheStats,
	loadChapterCommentary,
	loadSyncedChapterAudio,
	loadTranslationChapter,
	loadTranslationPassage,
	MAX_ESV_CACHED_VERSES,
} from "../src/react-app/lib/bible-loader";
import {
	FAVORITES_STORAGE_KEY,
	formatFavoriteLabel,
	readStoredFavorites,
	toggleFavoriteItem,
} from "../src/react-app/lib/favorites";
import {
	formatHighlightLabel,
	HIGHLIGHTS_STORAGE_KEY,
	MAX_EN_HIGHLIGHT_TEXT_LEN,
	MAX_EN_HIGHLIGHTS,
	readStoredHighlights,
	splitTextByHighlights,
	toggleHighlightSpans,
} from "../src/react-app/lib/highlights";
import { readJsonStorage, writeJsonStorage } from "../src/react-app/lib/storage";
import {
	normalizeVerseTimings,
	SUPERTONIC_TRACK_ATTRIBUTION,
	SUPERTONIC_TRACK_ID,
	SUPERTONIC_TRACK_LABEL,
} from "../src/shared/audio-timings";
import { isSafeAudioSrc } from "../src/shared/url";
import { installMemoryStorage, withMockFetch } from "./helpers";

describe("Reader pure logic (no DOM)", () => {
	installMemoryStorage(clearLoaderCaches);

	it("validates audio URLs, verse timings, and playback rate helpers", () => {
		for (const safe of [
			"/api/audio/krv/GEN/1",
			"/api/audio/esv/JHN/3",
			"https://cdn.example.com/krv/GEN/1.mp3",
			"https://audio.esv.org/hw/gen1.mp3",
		]) {
			expect(isSafeAudioSrc(safe)).toBe(true);
		}
		for (const unsafe of [
			"javascript:alert(1)",
			"//evil.example.com/a.mp3",
			"/data/bibles/krv/GEN.json",
			"/api/audio/../../secret",
			"/api/audio/%2e%2e/secret",
			"https://user:pass@cdn.example.com/krv.mp3",
			"https://localhost/krv.mp3",
			"http://cdn.example.com/krv.mp3",
		]) {
			expect(isSafeAudioSrc(unsafe)).toBe(false);
		}

		expect(normalizeVerseTimings("invalid")).toBeUndefined();
		expect(
			normalizeVerseTimings({ "0": 0, "01": 1.2, bad: Number.NaN, "-1": 5, "3": -2 }),
		).toBeUndefined();
		expect(normalizeVerseTimings({ "1": 1.2, "2": 6.8, bad: "x" })).toEqual({ 1: 1.2, 2: 6.8 });

		const timings = { 1: 2.3, 12: 34.5, 16: 48.2 };
		expect(resolveVerseAtTime(timings, 1.5)).toBeNull();
		expect(resolveVerseAtTime(timings, 2.1)).toBe(1);
		expect(resolveVerseAtTime(timings, 48.5)).toBe(16);
		expect(resolveTimeForVerse(timings, 17)).toBe(48.2);

		expect(parseCustomPlaybackRate("0.1")).toBe(0.1);
		expect(parseCustomPlaybackRate("0.75")).toBe(0.75);
		expect(parseCustomPlaybackRate("2.0")).toBe(2);
		expect(parseCustomPlaybackRate("0.09")).toBeNull();
		expect(parseCustomPlaybackRate("2.01")).toBeNull();
		expect(parseCustomPlaybackRate("")).toBeNull();
		expect(normalizePlaybackRate(0.05)).toBe(0.1);
		expect(normalizePlaybackRate(3)).toBe(2);
		expect(normalizePlaybackRate(Number.NaN)).toBeNull();
	});

	it("handles restricted localStorage SecurityError gracefully", () => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			get() {
				throw new Error("SecurityError: Storage is disabled");
			},
		});
		expect(readJsonStorage("any")).toBeNull();
		expect(() => writeJsonStorage("any", { ok: true })).not.toThrow();
		expect(readStoredFavorites()).toEqual([]);
		expect(readStoredHighlights()).toEqual([]);
	});

	it("validates, caps, merges, and splits favorites and highlights (ESV compliance)", () => {
		localStorage.setItem(FAVORITES_STORAGE_KEY, "not-json");
		expect(readStoredFavorites()).toEqual([]);

		localStorage.setItem(
			FAVORITES_STORAGE_KEY,
			JSON.stringify([
				{ bookNumber: 999, chapter: 1 },
				{ bookNumber: 2, chapter: 2, createdAt: 10 },
				{ bookNumber: 2, chapter: 2, createdAt: 20 },
				{
					bookNumber: 43,
					chapter: 3,
					verse: 16,
					enText: "For God so loved the world",
					koText: "하나님이 세상을 이처럼 사랑하사",
				},
			]),
		);
		const loadedFavs = readStoredFavorites();
		expect(loadedFavs).toHaveLength(2);
		expect("enText" in loadedFavs[1]).toBe(false);
		expect(loadedFavs[1]?.koText).toBe("하나님이 세상을 이처럼 사랑하사");
		expect(formatFavoriteLabel(loadedFavs[1])).toEqual({
			refEn: "John 3:16",
			refKo: "요한복음 3장 16절",
			kind: "verse",
		});
		expect(toggleFavoriteItem(loadedFavs, { bookNumber: 2, chapter: 2 })).toHaveLength(1);

		const longEnText = "A".repeat(220);
		localStorage.setItem(
			HIGHLIGHTS_STORAGE_KEY,
			JSON.stringify([
				{
					bookNumber: 1,
					chapter: 1,
					verse: 1,
					lang: "ko",
					start: 0,
					end: 3,
					text: "태초에",
					createdAt: 1,
				},
				...Array.from({ length: MAX_EN_HIGHLIGHTS + 10 }, (_, idx) => ({
					bookNumber: 19,
					chapter: 119,
					verse: idx + 1,
					lang: "en",
					start: 0,
					end: 220,
					text: longEnText,
					createdAt: idx + 2,
				})),
			]),
		);
		const cappedHl = readStoredHighlights();
		const cappedEn = cappedHl.filter((h) => h.lang === "en");
		expect(cappedHl.filter((h) => h.lang === "ko")).toHaveLength(1);
		expect(cappedEn).toHaveLength(MAX_EN_HIGHLIGHTS);
		expect(cappedEn.every((h) => h.text.length === MAX_EN_HIGHLIGHT_TEXT_LEN)).toBe(true);
		expect(cappedEn[0]?.verse).toBe(11);

		localStorage.setItem(
			HIGHLIGHTS_STORAGE_KEY,
			JSON.stringify([
				{ bookNumber: 1, chapter: 1, verse: 1, lang: "fr", start: 0, end: 4, text: "Bad" },
				{ bookNumber: 1, chapter: 1, verse: 1, lang: "en", start: 5, end: 3, text: "Bad" },
				{
					bookNumber: 1,
					chapter: 1,
					verse: 1,
					lang: "en",
					start: 0,
					end: 16,
					text: "In the beginning",
				},
			]),
		);
		const loadedHl = readStoredHighlights();
		expect(loadedHl).toHaveLength(1);
		expect(formatHighlightLabel(loadedHl[0]).langLabel).toBe("EN");

		const verseText = "In the beginning, God created the heavens and the earth.";
		const merged = toggleHighlightSpans(
			loadedHl,
			1,
			1,
			[{ verse: 1, lang: "en", start: 10, end: 21, text: "inning, God" }],
			() => verseText,
		);
		expect(merged.next[0]?.end).toBe(21);
		const split = toggleHighlightSpans(
			merged.next,
			1,
			1,
			[{ verse: 1, lang: "en", start: 7, end: 16, text: "beginning" }],
			() => verseText,
		);
		expect(splitTextByHighlights(verseText.slice(0, 21), 0, split.next)).toEqual([
			{ text: "In the ", highlightId: split.next[0]?.id },
			{ text: "beginning" },
			{ text: ", God", highlightId: split.next[1]?.id },
		]);
	});

	it("hydrates static KRV timings, retries transient 5xx, caches commentary, and rejects malformed payloads", async () => {
		let timingCalls = 0;
		let commentaryCalls = 0;
		await withMockFetch(
			(url) => {
				if (url === "/api/audio/JHN/3?lang=ko") {
					return Response.json({
						tracks: [
							{
								id: SUPERTONIC_TRACK_ID,
								label: SUPERTONIC_TRACK_LABEL,
								language: "ko",
								url: "https://cdn.example.com/JHN/3.mp3",
								isAiGenerated: true,
								attribution: SUPERTONIC_TRACK_ATTRIBUTION,
							},
						],
					});
				}
				if (url === "/api/audio/JHN/3?lang=en") {
					return Response.json({
						tracks: [
							{
								id: "esv-api:JHN:3",
								label: "ESV",
								language: "en",
								url: "https://audio.esv.org/hw/jhn3.mp3",
							},
						],
					});
				}
				if (url === "/api/audio/JHN/3") {
					return Response.json({
						tracks: [
							{
								id: SUPERTONIC_TRACK_ID,
								label: SUPERTONIC_TRACK_LABEL,
								language: "ko",
								url: "https://cdn.example.com/JHN/3.mp3",
								isAiGenerated: true,
								attribution: SUPERTONIC_TRACK_ATTRIBUTION,
							},
							{
								id: "esv-api:JHN:3",
								label: "ESV",
								language: "en",
								url: "https://audio.esv.org/hw/jhn3.mp3",
							},
						],
					});
				}
				if (url === "/data/timings/krv-supertonic/JHN.json") {
					timingCalls++;
					if (timingCalls === 1) return new Response("Timeout", { status: 503 });
					return Response.json({
						chapters: { "3": { "1": 2.345, "16": 51.789, bad: "x" } },
					});
				}
				if (url === "/api/commentary/tyndale/GEN/1") {
					commentaryCalls++;
					if (commentaryCalls === 1) {
						return Response.json({ error: "Commentary lookup failed" }, { status: 502 });
					}
					if (commentaryCalls === 2) return Response.json({ bad: true });
					return Response.json({
						entries: [{ id: "tyndale:GEN:1:1", verseStart: 1, paragraphs: ["In the beginning."] }],
					});
				}
				return new Response("Not Found", { status: 404 });
			},
			async () => {
				const firstAudio = await loadSyncedChapterAudio({ usfm: "JHN", chapter: 3 });
				expect(
					firstAudio.tracks.find((t) => t.id === SUPERTONIC_TRACK_ID)?.verseTimings,
				).toBeUndefined();
				const secondAudio = await loadSyncedChapterAudio({ usfm: "JHN", chapter: 3 });
				expect(timingCalls).toBe(2);
				expect(secondAudio.tracks.find((t) => t.id === SUPERTONIC_TRACK_ID)?.verseTimings).toEqual({
					1: 2.345,
					16: 51.789,
				});
				expect(
					secondAudio.tracks.find((t) => t.id === "esv-api:JHN:3")?.verseTimings,
				).toBeUndefined();

				const koOnlyAudio = await loadSyncedChapterAudio({
					usfm: "JHN",
					chapter: 3,
					language: "ko",
				});
				expect(koOnlyAudio.tracks.map((t) => t.language)).toEqual(["ko"]);
				expect(koOnlyAudio.tracks[0]?.verseTimings).toEqual({ 1: 2.345, 16: 51.789 });

				const enOnlyAudio = await loadSyncedChapterAudio({
					usfm: "JHN",
					chapter: 3,
					language: "en",
				});
				expect(enOnlyAudio.tracks.map((t) => t.language)).toEqual(["en"]);
				expect(enOnlyAudio.tracks[0]?.url).toBe("https://audio.esv.org/hw/jhn3.mp3");

				await expect(
					loadChapterCommentary({ commentaryId: "tyndale", usfm: "GEN", chapter: 1 }),
				).rejects.toThrow("Commentary lookup failed");
				await expect(
					loadChapterCommentary({ commentaryId: "tyndale", usfm: "GEN", chapter: 1 }),
				).rejects.toThrow("Invalid commentary response.");

				const c1 = await loadChapterCommentary({
					commentaryId: "tyndale",
					usfm: "GEN",
					chapter: 1,
				});
				const c2 = await loadChapterCommentary({
					commentaryId: "tyndale",
					usfm: "GEN",
					chapter: 1,
				});
				expect(commentaryCalls).toBe(3);
				expect(c1).toEqual(c2);
			},
		);
	});

	it("bounds ESV in-memory LRU cache to <= 400 verses and <= half of any multi-chapter book", async () => {
		const fetchCounts = new Map<string, number>();
		const makeVerses = (count: number, label: string) =>
			Array.from({ length: count }, (_, idx) => ({
				verse: idx + 1,
				text: `${label} verse ${idx + 1}`,
			}));

		await withMockFetch(
			(url) => {
				fetchCounts.set(url, (fetchCounts.get(url) ?? 0) + 1);
				const [, usfm, chStr] = url.match(/\/api\/esv\/([A-Z0-9]+)\/(\d+)/) ?? [];
				const chapter = Number.parseInt(chStr ?? "1", 10);
				if (usfm === "RUT") {
					return Response.json({
						translationId: "esv",
						bookNumber: 8,
						usfm,
						chapter,
						verses: makeVerses(20, `RUT ${chapter}`),
					});
				}
				if (usfm === "PSA" && chapter === 119) {
					return Response.json({
						translationId: "esv",
						bookNumber: 19,
						usfm,
						chapter,
						verses: makeVerses(176, "PSA 119"),
					});
				}
				if (usfm === "GEN") {
					return Response.json({
						translationId: "esv",
						bookNumber: 1,
						usfm,
						chapter,
						verses: makeVerses(150, `GEN ${chapter}`),
					});
				}
				if (usfm === "JUD") {
					return Response.json({
						translationId: "esv",
						bookNumber: 65,
						usfm,
						chapter: 1,
						verses: makeVerses(25, "JUD 1"),
					});
				}
				return new Response("Not Found", { status: 404 });
			},
			async () => {
				await loadTranslationChapter("esv", 8, 1);
				await loadTranslationChapter("esv", 8, 2);
				await loadTranslationChapter("esv", 8, 1);
				expect(fetchCounts.get("/api/esv/RUT/1")).toBe(1);

				// Ruth has 4 chapters -> cap 2 chapters -> RUT 2 evicted (LRU), RUT 1 retained
				await loadTranslationChapter("esv", 8, 3);
				expect(getEsvCacheStats()).toEqual({ chapters: 2, verses: 40 });
				await loadTranslationChapter("esv", 8, 1);
				expect(fetchCounts.get("/api/esv/RUT/1")).toBe(1);
				await loadTranslationChapter("esv", 8, 2);
				expect(fetchCounts.get("/api/esv/RUT/2")).toBe(2);

				clearLoaderCaches();
				await loadTranslationChapter("esv", 19, 119);
				await loadTranslationChapter("esv", 1, 1);
				expect(getEsvCacheStats()).toEqual({ chapters: 2, verses: 326 });

				await loadTranslationChapter("esv", 1, 2);
				expect(getEsvCacheStats().verses).toBe(300);
				expect(getEsvCacheStats().verses).toBeLessThanOrEqual(MAX_ESV_CACHED_VERSES);

				await loadTranslationChapter("esv", 65, 1);
				expect(getEsvCacheStats().verses).toBe(325);
				expect(getEsvCacheStats().verses).toBeLessThanOrEqual(MAX_ESV_CACHED_VERSES);
			},
		);
	});

	it("isolates per-caller AbortSignals on shared ESV, KRV, and commentary fetches (StrictMode & concurrent)", async () => {
		const recordedSignals: Array<{ url: string; signal: AbortSignal | undefined }> = [];
		const deferredResolvers = new Map<string, Array<() => void>>();

		function abortAwareResponse(
			url: string,
			init: RequestInit | undefined,
			makeRes: () => Response,
		) {
			const signal = init?.signal ?? undefined;
			recordedSignals.push({ url, signal });
			return new Promise<Response>((resolve, reject) => {
				if (signal?.aborted) {
					reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
					return;
				}
				const onAbort = () => {
					reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
				};
				signal?.addEventListener("abort", onAbort, { once: true });
				const deliver = () => {
					signal?.removeEventListener("abort", onAbort);
					if (signal?.aborted) onAbort();
					else resolve(makeRes());
				};
				if (url.includes("/GEN/2") || url.includes("/EXO/1")) {
					const list = deferredResolvers.get(url) ?? [];
					list.push(deliver);
					deferredResolvers.set(url, list);
				} else {
					queueMicrotask(deliver);
				}
			});
		}

		await withMockFetch(
			(url, init) => {
				if (url === "/api/esv/GEN/1" || url === "/api/esv/GEN/2") {
					return abortAwareResponse(url, init, () =>
						Response.json({
							translationId: "esv",
							bookNumber: 1,
							usfm: "GEN",
							chapter: url.endsWith("/2") ? 2 : 1,
							verses: [{ verse: 1, text: `ESV ${url}` }],
						}),
					);
				}
				if (url === "/data/bibles/krv/GEN.json") {
					return abortAwareResponse(url, init, () =>
						Response.json({
							translationId: "krv",
							bookNumber: 1,
							usfm: "GEN",
							chapters: { "1": [{ verse: 1, text: "태초에" }] },
						}),
					);
				}
				if (url === "/api/commentary/tyndale/GEN/1" || url === "/api/commentary/tyndale/EXO/1") {
					return abortAwareResponse(url, init, () =>
						Response.json({
							entries: [{ id: `tyndale:${url}:1`, verseStart: 1, paragraphs: ["Note."] }],
						}),
					);
				}
				return new Response("Not Found", { status: 404 });
			},
			async () => {
				// 1. StrictMode pattern: mount 1 starts, cleanup aborts synchronously, mount 2 immediately requests same key
				const c1 = new AbortController();
				const c2 = new AbortController();
				const esv1 = loadTranslationChapter("esv", 1, 1, c1.signal);
				c1.abort();
				const esv2 = loadTranslationChapter("esv", 1, 1, c2.signal);
				await expect(esv1).rejects.toThrow();
				expect(await esv2).toEqual([{ verse: 1, text: "ESV /api/esv/GEN/1" }]);

				const k1 = new AbortController();
				const k2 = new AbortController();
				const krv1 = loadTranslationChapter("krv", 1, 1, k1.signal);
				k1.abort();
				const krv2 = loadTranslationChapter("krv", 1, 1, k2.signal);
				await expect(krv1).rejects.toThrow();
				expect(await krv2).toEqual([{ verse: 1, text: "태초에" }]);

				const com1 = new AbortController();
				const com2 = new AbortController();
				const cm1 = loadChapterCommentary({
					commentaryId: "tyndale",
					usfm: "GEN",
					chapter: 1,
					signal: com1.signal,
				});
				com1.abort();
				const cm2 = loadChapterCommentary({
					commentaryId: "tyndale",
					usfm: "GEN",
					chapter: 1,
					signal: com2.signal,
				});
				await expect(cm1).rejects.toThrow();
				expect((await cm2).entries).toHaveLength(1);

				// 2. Concurrent callers sharing in-flight ESV & commentary: aborting one must not abort the other
				const s1 = new AbortController();
				const s2 = new AbortController();
				const sharedEsv1 = loadTranslationChapter("esv", 1, 2, s1.signal);
				const sharedEsv2 = loadTranslationChapter("esv", 1, 2, s2.signal);
				const gen2Calls = recordedSignals.filter((r) => r.url === "/api/esv/GEN/2");
				expect(gen2Calls).toHaveLength(1);
				s1.abort();
				expect(gen2Calls[0]?.signal?.aborted).toBe(false);
				for (const deliver of deferredResolvers.get("/api/esv/GEN/2") ?? []) deliver();
				await expect(sharedEsv1).rejects.toThrow();
				expect(await sharedEsv2).toEqual([{ verse: 1, text: "ESV /api/esv/GEN/2" }]);

				const cs1 = new AbortController();
				const cs2 = new AbortController();
				const sharedCom1 = loadChapterCommentary({
					commentaryId: "tyndale",
					usfm: "EXO",
					chapter: 1,
					signal: cs1.signal,
				});
				const sharedCom2 = loadChapterCommentary({
					commentaryId: "tyndale",
					usfm: "EXO",
					chapter: 1,
					signal: cs2.signal,
				});
				const exoCalls = recordedSignals.filter((r) => r.url === "/api/commentary/tyndale/EXO/1");
				expect(exoCalls).toHaveLength(1);
				cs1.abort();
				expect(exoCalls[0]?.signal?.aborted).toBe(false);
				for (const deliver of deferredResolvers.get("/api/commentary/tyndale/EXO/1") ?? []) {
					deliver();
				}
				await expect(sharedCom1).rejects.toThrow();
				expect((await sharedCom2).entries).toHaveLength(1);

				// 3. Pre-aborted signal fails immediately without hitting network or touching cache
				const preAborted = new AbortController();
				preAborted.abort();
				const countBefore = recordedSignals.length;
				await expect(loadTranslationChapter("esv", 1, 1, preAborted.signal)).rejects.toThrow();
				await expect(
					loadChapterCommentary({
						commentaryId: "tyndale",
						usfm: "GEN",
						chapter: 1,
						signal: preAborted.signal,
					}),
				).rejects.toThrow();
				expect(recordedSignals.length).toBe(countBefore);

				// 4. Aborting a warm-cache hit does not evict the cached entry
				const warmAbort = new AbortController();
				const warmPromise = loadChapterCommentary({
					commentaryId: "tyndale",
					usfm: "GEN",
					chapter: 1,
					signal: warmAbort.signal,
				});
				warmAbort.abort();
				await expect(warmPromise).rejects.toThrow();
				expect(
					(
						await loadChapterCommentary({
							commentaryId: "tyndale",
							usfm: "GEN",
							chapter: 1,
						})
					).entries,
				).toHaveLength(1);
				expect(recordedSignals.length).toBe(countBefore);
			},
		);
	});

	it("loads targeted passages for KRV and ESV, reuses chapter/passage cache, and shares ESV compliance caps", async () => {
		const fetchedUrls: string[] = [];
		await withMockFetch(
			(url) => {
				fetchedUrls.push(url);
				if (url === "/data/bibles/krv/PRO.json") {
					return Response.json({
						translationId: "krv",
						bookNumber: 20,
						usfm: "PRO",
						chapters: {
							"3": [
								{ verse: 4, text: "v4" },
								{ verse: 5, text: "너는 마음을 다하여 여호와를 의뢰하고" },
								{ verse: 6, text: "너는 범사에 그를 인정하라" },
								{ verse: 7, text: "v7" },
							],
						},
					});
				}
				if (url === "/api/esv/PRO/3/5-6") {
					return Response.json({
						translationId: "esv",
						bookNumber: 20,
						usfm: "PRO",
						chapter: 3,
						verses: [
							{ verse: 5, text: "Trust in the LORD with all your heart," },
							{ verse: 6, text: "In all your ways acknowledge him," },
						],
					});
				}
				if (url === "/api/esv/RUT/1/1") {
					return Response.json({
						translationId: "esv",
						bookNumber: 8,
						usfm: "RUT",
						chapter: 1,
						verses: [{ verse: 1, text: "RUT 1:1" }],
					});
				}
				if (url === "/api/esv/RUT/2/1") {
					return Response.json({
						translationId: "esv",
						bookNumber: 8,
						usfm: "RUT",
						chapter: 2,
						verses: [{ verse: 1, text: "RUT 2:1" }],
					});
				}
				if (url === "/api/esv/RUT/3/1") {
					return Response.json({
						translationId: "esv",
						bookNumber: 8,
						usfm: "RUT",
						chapter: 3,
						verses: [{ verse: 1, text: "RUT 3:1" }],
					});
				}
				if (url === "/api/esv/JHN/3") {
					return Response.json({
						translationId: "esv",
						bookNumber: 43,
						usfm: "JHN",
						chapter: 3,
						verses: [
							{ verse: 15, text: "JHN 3:15" },
							{ verse: 16, text: "For God so loved the world," },
						],
					});
				}
				return new Response("Not Found", { status: 404 });
			},
			async () => {
				const koRange = await loadTranslationPassage("krv", 20, 3, 5, 6);
				expect(koRange.map((v) => v.verse)).toEqual([5, 6]);

				const enRange = await loadTranslationPassage("esv", 20, 3, 5, 6);
				expect(enRange.map((v) => v.verse)).toEqual([5, 6]);
				// Contained single verse hits passage cache without extra fetch
				const enSingle = await loadTranslationPassage("esv", 20, 3, 5);
				expect(enSingle).toEqual([{ verse: 5, text: "Trust in the LORD with all your heart," }]);
				expect(fetchedUrls.filter((u) => u.startsWith("/api/esv/PRO/"))).toHaveLength(1);

				// Chapter cache also satisfies targeted passage requests without network
				await loadTranslationChapter("esv", 43, 3);
				const john16 = await loadTranslationPassage("esv", 43, 3, 16);
				expect(john16).toEqual([{ verse: 16, text: "For God so loved the world," }]);
				expect(fetchedUrls).not.toContain("/api/esv/JHN/3/16");

				// Ruth (4 chapters) caps distinct cached chapters across chapters+passages to <= 2
				clearLoaderCaches();
				await loadTranslationPassage("esv", 8, 1, 1);
				await loadTranslationPassage("esv", 8, 2, 1);
				await loadTranslationPassage("esv", 8, 1, 1);
				await loadTranslationPassage("esv", 8, 3, 1);
				expect(getEsvCacheStats()).toEqual({ chapters: 0, verses: 2 });
				await loadTranslationPassage("esv", 8, 1, 1);
				expect(fetchedUrls.filter((u) => u === "/api/esv/RUT/1/1")).toHaveLength(1);
				await loadTranslationPassage("esv", 8, 2, 1);
				expect(fetchedUrls.filter((u) => u === "/api/esv/RUT/2/1")).toHaveLength(2);
			},
		);
	});

	it("validates stored rail dimensions and resolves docked rail budgets without crowding main text", () => {
		expect(getDefaultRailWidthPx(0)).toBe(DEFAULT_FALLBACK_RAIL_WIDTH);
		expect(getDefaultRailWidthPx(1024)).toBe(216);
		expect(getDefaultRailWidthPx(1440)).toBe(230);
		expect(getDefaultRailWidthPx(1920)).toBe(250);

		expect(parseStoredRailDimension("300", DEFAULT_MIN_RAIL_WIDTH, 480)).toBeNull();
		expect(parseStoredRailDimension(Number.NaN, DEFAULT_MIN_RAIL_WIDTH, 480)).toBeNull();
		expect(parseStoredRailDimension(120, DEFAULT_MIN_RAIL_WIDTH, 480)).toBe(DEFAULT_MIN_RAIL_WIDTH);
		expect(parseStoredRailDimension(999, DEFAULT_MIN_RAIL_WIDTH, 480)).toBe(480);
		expect(parseStoredRailDimension(342.6, DEFAULT_MIN_RAIL_WIDTH, 480)).toBe(343);

		expect(computeMaxDockedRailHeight(0, DEFAULT_MIN_DICT_HEIGHT, 900)).toBe(900);
		expect(computeMaxDockedRailHeight(900, DEFAULT_MIN_DICT_HEIGHT)).toBe(764);
		expect(computeMaxDockedRailHeight(300, DEFAULT_MIN_DICT_HEIGHT)).toBe(DEFAULT_MIN_DICT_HEIGHT);

		// Plenty of room on 1440px-like budget: preserves both custom widths
		const roomy = resolveDockedRailWidths({
			audioWidth: 320,
			dictWidth: 460,
			audioDockedOpen: true,
			dictDockedOpen: true,
			budget: 866,
			defaultRailWidth: 230,
		});
		expect(roomy.audioWidth).toBe(320);
		expect(roomy.dictWidth).toBe(460);
		expect(roomy.maxAudioWidth).toBe(406);
		expect(roomy.maxDictWidth).toBe(546);

		// Tight viewport budget scales both custom widths proportionally while respecting minWidth
		const tight = resolveDockedRailWidths({
			audioWidth: 380,
			dictWidth: 520,
			audioDockedOpen: true,
			dictDockedOpen: true,
			budget: 650,
			defaultRailWidth: 216,
		});
		expect(tight.audioWidth).toBe(290);
		expect(tight.dictWidth).toBe(360);
		expect(tight.audioWidth! + tight.dictWidth!).toBeLessThanOrEqual(650);

		// Floating or minimized rail leaves its column at default width
		const audioFloating = resolveDockedRailWidths({
			audioWidth: 400,
			dictWidth: 500,
			audioDockedOpen: false,
			dictDockedOpen: true,
			budget: 800,
			defaultRailWidth: 230,
		});
		expect(audioFloating.audioWidth).toBeNull();
		expect(audioFloating.dictWidth).toBe(500);
		expect(audioFloating.maxDictWidth).toBe(570);
	});
});
