import { describe, expect, it } from "bun:test";

import { normalizeVerseTimings, SUPERTONIC_TRACK_ID } from "../src/shared/audio-timings";
import type { ChapterAudioResponse, ChapterCommentaryResponse } from "../src/shared/types";
import { isSafeHttpsUrl } from "../src/shared/url";
import type { FetchLike } from "../src/worker/http";
import { createApp, type R2BucketLike, type R2ObjectBodyLike } from "../src/worker/index";

function assertSecurityHeaders(res: Response) {
	expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
	expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
	expect(res.headers.get("x-content-type-options")).toBe("nosniff");
}

describe("Worker API & Security Boundaries", () => {
	it("validates AUDIO_BASE_URL and serves Supertonic KRV and Crossway ESV tracks when configured", async () => {
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
			id: SUPERTONIC_TRACK_ID,
			label: "개역한글",
			language: "ko",
			url: "https://cdn.example.com/krv/JHN/3.mp3",
		});
		expect(enTrack?.url).toBe("https://audio.esv.org/hw/43003001-43003036.mp3");
	});

	it("handles single-chapter ESV queries and proxies direct ESV audio streams safely", async () => {
		const secretKey = "esv-super-secret-token-123";
		const captured = { authHeader: null as string | null, query: null as string | null };

		const mockFetch: FetchLike = async (input, init) => {
			const url = String(input);
			if (url.startsWith("https://api.esv.org/v3/passage/audio/")) {
				captured.authHeader = new Headers(init?.headers).get("Authorization");
				captured.query = new URL(url).searchParams.get("q");
				if (captured.query === "Jude 1:1-99") {
					return new Response(null, {
						status: 302,
						headers: { Location: "https://audio.esv.org/hw/65001001-65001025.mp3" },
					});
				}
				return new Response("ID3", {
					status: 200,
					headers: { "Content-Type": "text/html; charset=utf-8" },
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
		expect(audioBody.tracks.find((t) => t.language === "ko")).toBeUndefined();
		expect(audioBody.tracks.find((t) => t.language === "en")?.url).toBe(
			"https://audio.esv.org/hw/65001001-65001025.mp3",
		);

		const proxyRes = await app.request("/api/audio/esv/GEN/1", undefined, {
			ESV_API_KEY: secretKey,
		});
		expect(proxyRes.status).toBe(200);
		expect(proxyRes.headers.get("content-type")).toBe("audio/mpeg");
		expect(proxyRes.headers.get("content-disposition")).toBe("inline");
	});

	it("validates chapter refs, removed endpoints, HEAD/methods, SSRF/control URLs, and error headers", async () => {
		const mockFetch: FetchLike = async () => new Response("Upstream Down", { status: 503 });

		expect(isSafeHttpsUrl("https://cdn.example.com/gen1.mp3")).toBe(true);
		expect(isSafeHttpsUrl("https://127.0.0.1/gen1.mp3")).toBe(false);
		expect(isSafeHttpsUrl("https://0x7f000001/gen1.mp3")).toBe(false);
		expect(isSafeHttpsUrl("https://[::1]/gen1.mp3")).toBe(false);
		expect(isSafeHttpsUrl("https://localhost/gen1.mp3")).toBe(false);
		expect(isSafeHttpsUrl("https://cdn.example.com:8443/gen1.mp3")).toBe(false);
		expect(isSafeHttpsUrl("https://cdn.example.com/\ngen1.mp3")).toBe(false);
		expect(
			isSafeHttpsUrl("https://cdn.example.com/a.mp3?k=a%2Bb", { forbiddenSubstring: "a+b" }),
		).toBe(false);
		expect(
			isSafeHttpsUrl("https://cdn.example.com/a.mp3?k=%61%2b%62", { forbiddenSubstring: "A+B" }),
		).toBe(false);

		const app = createApp({ fetcher: mockFetch });
		expect((await app.request("/api/audio/GEN/999")).status).toBe(400);
		expect((await app.request("/api/audio/GEN/1abc")).status).toBe(400);
		expect((await app.request("/api/health")).status).toBe(404);
		expect((await app.request("/api/commentaries")).status).toBe(404);
		expect((await app.request("/api/languages")).status).toBe(404);

		const headRes = await app.request("/api/audio/JHN/3", { method: "HEAD" });
		expect(headRes.status).toBe(200);
		expect(await headRes.text()).toBe("");
		expect(headRes.headers.get("x-content-type-options")).toBe("nosniff");
		expect(headRes.headers.get("strict-transport-security")).toBe(
			"max-age=31536000; includeSubDomains",
		);

		const badMethod = await app.request("/api/audio/GEN/1", { method: "POST" });
		expect(badMethod.status).toBe(405);
		expect(badMethod.headers.get("cache-control")).toBe("no-store");
		expect(badMethod.headers.get("x-content-type-options")).toBe("nosniff");
		expect(badMethod.headers.get("content-security-policy")).toContain("default-src 'none'");

		const ssrfAudioRes = await app.request("/api/audio/GEN/1", undefined, {
			AUDIO_BASE_URL: "https://127.0.0.1/krv",
		});
		expect(ssrfAudioRes.status).toBe(200);
		expect(((await ssrfAudioRes.json()) as ChapterAudioResponse).tracks).toEqual([]);
	});

	it("normalizes Tyndale & Matthew Henry commentaries, caps deep recursion, and handles 404/400/502", async () => {
		let deepNode: Record<string, unknown> = { text: "too-deep" };
		for (let i = 0; i < 30; i++) {
			deepNode = { content: [deepNode] };
		}

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
								content: [{ text: "1:9 " }, { text: "God gathered the waters." }, deepNode],
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
			if (url === "https://bible.helloao.org/api/c/tyndale/EXO/1.json") {
				return Response.json(["unexpected-array"]);
			}
			if (url === "https://bible.helloao.org/api/c/tyndale/LEV/1.json") {
				return new Response("{}", {
					status: 200,
					headers: { "Content-Length": String(3 * 1024 * 1024) },
				});
			}
			return new Response("Upstream Error", { status: 503 });
		};

		const app = createApp({ fetcher: mockFetch });

		const tyndaleRes = await app.request("/api/commentary/tyndale/gen/1");
		expect(tyndaleRes.status).toBe(200);
		expect(tyndaleRes.headers.get("cache-control")).toBe("public, max-age=86400");
		const tyndaleBody = (await tyndaleRes.json()) as ChapterCommentaryResponse;
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
		expect(((await emptyRes.json()) as ChapterCommentaryResponse).entries).toEqual([]);

		expect((await app.request("/api/commentary/tyndale/EXO/1")).status).toBe(502);
		expect((await app.request("/api/commentary/tyndale/LEV/1")).status).toBe(502);
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

	it("enables KRV audio via private AUDIO_BUCKET binding and prefers it over AUDIO_BASE_URL", async () => {
		const bucket = createMockAudioBucket({
			"JHN/3.mp3": { data: "ID3-JHN3", contentType: "audio/mpeg", httpEtag: '"jhn-3"' },
		});
		const app = createApp();

		const boundTrackRes = await app.request("/api/audio/JHN/3", undefined, {
			AUDIO_BUCKET: bucket,
			AUDIO_BASE_URL: "https://cdn.example.com/krv/",
		});
		expect(boundTrackRes.status).toBe(200);
		expect((await boundTrackRes.json()) as ChapterAudioResponse).toEqual({
			tracks: [
				{
					id: SUPERTONIC_TRACK_ID,
					label: "개역한글",
					language: "ko",
					url: "/api/audio/krv/JHN/3",
				},
			],
		});

		expect(bucket.getCalls).toBe(0);
		expect(bucket.headCalls).toBe(0);

		const fallbackTrackRes = await app.request("/api/audio/JHN/3", undefined, {
			AUDIO_BASE_URL: "https://cdn.example.com/krv/",
		});
		expect(fallbackTrackRes.status).toBe(200);
		expect((await fallbackTrackRes.json()) as ChapterAudioResponse).toEqual({
			tracks: [
				{
					id: SUPERTONIC_TRACK_ID,
					label: "개역한글",
					language: "ko",
					url: "https://cdn.example.com/krv/JHN/3.mp3",
				},
			],
		});
	});

	it("streams private R2 audio with range seeking, ETags, HEAD, strict op limits, and error boundaries", async () => {
		const bucket = createMockAudioBucket({
			"GEN/1.mp3": { data: "0123456789", contentType: "audio/mpeg", httpEtag: '"etag-gen-1"' },
			"EXO/1.mp3": { data: "AUDIO", contentType: "text/html", httpEtag: '"etag-exo-1"' },
		});
		const app = createApp();

		bucket.resetCounts();
		const badRef = await app.request("/api/audio/krv/GEN/999", undefined, { AUDIO_BUCKET: bucket });
		expect(badRef.status).toBe(400);
		assertSecurityHeaders(badRef);
		expect(bucket.totalOps()).toBe(0);

		const traversalRef = await app.request("/api/audio/krv/..%2FGEN/1", undefined, {
			AUDIO_BUCKET: bucket,
		});
		expect(traversalRef.status).toBe(400);
		expect(bucket.totalOps()).toBe(0);

		const nonNumericChapter = await app.request("/api/audio/krv/GEN/1abc", undefined, {
			AUDIO_BUCKET: bucket,
		});
		expect(nonNumericChapter.status).toBe(400);
		expect(bucket.totalOps()).toBe(0);

		const unboundRes = await app.request("/api/audio/krv/GEN/1");
		expect(unboundRes.status).toBe(503);
		assertSecurityHeaders(unboundRes);

		for (const malformed of [
			"bytes=abc-def",
			"bytes=5-2",
			"bytes=0-1, 2-3",
			"items=0-3",
			"bytes=-",
			"",
		]) {
			bucket.resetCounts();
			const res = await app.request(
				"/api/audio/krv/GEN/1",
				{ headers: { Range: malformed } },
				{ AUDIO_BUCKET: bucket },
			);
			expect(res.status).toBe(400);
			assertSecurityHeaders(res);
			expect(bucket.totalOps()).toBe(0);
		}

		bucket.resetCounts();
		const zeroSuffixRes = await app.request(
			"/api/audio/krv/GEN/1",
			{ headers: { Range: "bytes=-0" } },
			{ AUDIO_BUCKET: bucket },
		);
		expect(zeroSuffixRes.status).toBe(416);
		assertSecurityHeaders(zeroSuffixRes);
		expect(bucket.totalOps()).toBe(0);

		bucket.resetCounts();
		const fullRes = await app.request("/api/audio/krv/gen/1", undefined, { AUDIO_BUCKET: bucket });
		expect(fullRes.status).toBe(200);
		expect(await fullRes.text()).toBe("0123456789");
		expect(fullRes.headers.get("content-type")).toBe("audio/mpeg");
		expect(fullRes.headers.get("content-length")).toBe("10");
		expect(fullRes.headers.get("accept-ranges")).toBe("bytes");
		expect(fullRes.headers.get("content-disposition")).toBe("inline");
		expect(fullRes.headers.get("etag")).toBe('"etag-gen-1"');
		expect(fullRes.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		assertSecurityHeaders(fullRes);
		expect(bucket.getCalls).toBe(1);
		expect(bucket.totalOps()).toBe(1);

		bucket.resetCounts();
		const mimeRes = await app.request("/api/audio/krv/EXO/1", undefined, { AUDIO_BUCKET: bucket });
		expect(mimeRes.status).toBe(200);
		expect(mimeRes.headers.get("content-type")).toBe("audio/mpeg");
		expect(bucket.totalOps()).toBe(1);

		bucket.resetCounts();
		const rangeRes = await app.request(
			"/api/audio/krv/GEN/1",
			{ headers: { Range: "bytes=0-3" } },
			{ AUDIO_BUCKET: bucket },
		);
		expect(rangeRes.status).toBe(206);
		expect(await rangeRes.text()).toBe("0123");
		expect(rangeRes.headers.get("content-range")).toBe("bytes 0-3/10");
		expect(rangeRes.headers.get("content-length")).toBe("4");
		expect(rangeRes.headers.get("accept-ranges")).toBe("bytes");
		expect(rangeRes.headers.get("etag")).toBe('"etag-gen-1"');
		assertSecurityHeaders(rangeRes);
		expect(bucket.getCalls).toBe(1);
		expect(bucket.totalOps()).toBe(1);

		bucket.resetCounts();
		const suffixRes = await app.request(
			"/api/audio/krv/GEN/1",
			{ headers: { Range: "bytes=-4" } },
			{ AUDIO_BUCKET: bucket },
		);
		expect(suffixRes.status).toBe(206);
		expect(await suffixRes.text()).toBe("6789");
		expect(suffixRes.headers.get("content-range")).toBe("bytes 6-9/10");
		expect(suffixRes.headers.get("content-length")).toBe("4");
		expect(bucket.getCalls).toBe(1);
		expect(bucket.totalOps()).toBe(1);

		bucket.resetCounts();
		const notModifiedRes = await app.request(
			"/api/audio/krv/GEN/1",
			{ headers: { "If-None-Match": 'W/"etag-gen-1"' } },
			{ AUDIO_BUCKET: bucket },
		);
		expect(notModifiedRes.status).toBe(304);
		expect(await notModifiedRes.text()).toBe("");
		expect(notModifiedRes.headers.get("etag")).toBe('"etag-gen-1"');
		expect(notModifiedRes.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		assertSecurityHeaders(notModifiedRes);
		expect(bucket.cancelledStreams).toBe(1);
		expect(bucket.totalOps()).toBe(1);

		bucket.resetCounts();
		const headRes = await app.request(
			"/api/audio/krv/GEN/1",
			{ method: "HEAD" },
			{ AUDIO_BUCKET: bucket },
		);
		expect(headRes.status).toBe(200);
		expect(await headRes.text()).toBe("");
		expect(headRes.headers.get("content-length")).toBe("10");
		expect(headRes.headers.get("content-type")).toBe("audio/mpeg");
		expect(headRes.headers.get("accept-ranges")).toBe("bytes");
		expect(headRes.headers.get("etag")).toBe('"etag-gen-1"');
		assertSecurityHeaders(headRes);
		expect(bucket.headCalls).toBe(1);
		expect(bucket.getCalls).toBe(0);

		bucket.resetCounts();
		const headRangeRes = await app.request(
			"/api/audio/krv/GEN/1",
			{ method: "HEAD", headers: { Range: "bytes=0-3" } },
			{ AUDIO_BUCKET: bucket },
		);
		expect(headRangeRes.status).toBe(206);
		expect(await headRangeRes.text()).toBe("");
		expect(headRangeRes.headers.get("content-range")).toBe("bytes 0-3/10");
		expect(headRangeRes.headers.get("content-length")).toBe("4");
		expect(bucket.headCalls).toBe(1);
		expect(bucket.getCalls).toBe(0);

		const getOnlyBucket = createMockAudioBucket(
			{ "GEN/1.mp3": { data: "0123456789", contentType: "audio/mpeg", httpEtag: '"etag-gen-1"' } },
			{ omitHead: true },
		);
		const headFallbackRes = await app.request(
			"/api/audio/krv/GEN/1",
			{ method: "HEAD" },
			{ AUDIO_BUCKET: getOnlyBucket },
		);
		expect(headFallbackRes.status).toBe(200);
		expect(await headFallbackRes.text()).toBe("");
		expect(headFallbackRes.headers.get("content-length")).toBe("10");
		expect(getOnlyBucket.getCalls).toBe(1);
		expect(getOnlyBucket.cancelledStreams).toBe(1);

		bucket.resetCounts();
		const missingRes = await app.request("/api/audio/krv/GEN/2", undefined, {
			AUDIO_BUCKET: bucket,
		});
		expect(missingRes.status).toBe(404);
		expect(missingRes.headers.get("cache-control")).toBe("no-store");
		assertSecurityHeaders(missingRes);
		expect(bucket.totalOps()).toBe(1);

		bucket.resetCounts();
		const oobRes = await app.request(
			"/api/audio/krv/GEN/1",
			{ headers: { Range: "bytes=10-" } },
			{ AUDIO_BUCKET: bucket },
		);
		expect(oobRes.status).toBe(416);
		expect(await oobRes.text()).toBe("");
		expect(oobRes.headers.get("content-range")).toBe("bytes */10");
		assertSecurityHeaders(oobRes);
		expect(bucket.cancelledStreams).toBe(1);
		expect(bucket.totalOps()).toBe(1);

		// Handles R2 runtime 10039 InvalidRange exceptions as 416.
		const throwingBucket = createMockAudioBucket(
			{ "GEN/1.mp3": { data: "0123456789", contentType: "audio/mpeg", httpEtag: '"etag-gen-1"' } },
			{ throwOnOobRange: true },
		);
		const r2ThrowRes = await app.request(
			"/api/audio/krv/GEN/1",
			{ headers: { Range: "bytes=99-120" } },
			{ AUDIO_BUCKET: throwingBucket },
		);
		expect(r2ThrowRes.status).toBe(416);
		assertSecurityHeaders(r2ThrowRes);
		expect(throwingBucket.totalOps()).toBe(1);
	});
});

interface MockAudioObjectSpec {
	data: string;
	contentType?: string;
	httpEtag?: string;
}

function createMockAudioBucket(
	objects: Record<string, MockAudioObjectSpec>,
	options: { omitHead?: boolean; throwOnOobRange?: boolean } = {},
): R2BucketLike & {
	getCalls: number;
	headCalls: number;
	cancelledStreams: number;
	totalOps(): number;
	resetCounts(): void;
} {
	const encoder = new TextEncoder();

	const makeMeta = (spec: MockAudioObjectSpec, size: number) => ({
		size,
		httpEtag: spec.httpEtag,
		httpMetadata: spec.contentType ? { contentType: spec.contentType } : undefined,
	});

	const makeStream = (bytes: Uint8Array, onCancel: () => void) =>
		new ReadableStream<Uint8Array>({
			pull(controller) {
				if (bytes.byteLength > 0) controller.enqueue(bytes);
				controller.close();
			},
			cancel: onCancel,
		});

	const bucket = {
		getCalls: 0,
		headCalls: 0,
		cancelledStreams: 0,
		totalOps() {
			return bucket.getCalls + bucket.headCalls;
		},
		resetCounts() {
			bucket.getCalls = 0;
			bucket.headCalls = 0;
			bucket.cancelledStreams = 0;
		},
		head: options.omitHead
			? undefined
			: async (key: string): Promise<R2ObjectBodyLike | null> => {
					bucket.headCalls++;
					const spec = objects[key];
					return spec ? makeMeta(spec, encoder.encode(spec.data).byteLength) : null;
				},
		async get(
			key: string,
			getOptions?: {
				range?:
					| { offset: number; length?: number }
					| { offset?: number; length: number }
					| { suffix: number };
			},
		): Promise<R2ObjectBodyLike | null> {
			bucket.getCalls++;
			const spec = objects[key];
			if (!spec) return null;
			const bytes = encoder.encode(spec.data);
			const size = bytes.byteLength;
			const meta = makeMeta(spec, size);
			const onCancel = () => {
				bucket.cancelledStreams++;
			};

			const range = getOptions?.range;
			if (!range) {
				return { ...meta, body: makeStream(bytes, onCancel) };
			}

			let offset = 0;
			let length = 0;
			if ("suffix" in range && range.suffix !== undefined) {
				length = Math.min(range.suffix, size);
				offset = size - length;
			} else {
				const rawOffset = "offset" in range && range.offset !== undefined ? range.offset : 0;
				if (rawOffset >= size && options.throwOnOobRange) {
					throw new Error("get: The requested range is not satisfiable (10039)");
				}
				if (rawOffset >= size) {
					return { ...meta, range: { offset: 0, length: size }, body: makeStream(bytes, onCancel) };
				}
				offset = rawOffset;
				const maxLen = Math.max(0, size - offset);
				length =
					"length" in range && range.length !== undefined
						? Math.max(0, Math.min(range.length, maxLen))
						: maxLen;
			}

			return {
				...meta,
				range: { offset, length },
				body: makeStream(
					length > 0 ? bytes.slice(offset, offset + length) : new Uint8Array(0),
					onCancel,
				),
			};
		},
	};

	return bucket;
}
