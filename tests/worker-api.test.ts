import { describe, expect, it } from "bun:test";

import { normalizeVerseTimings, SUPERTONIC_TRACK_ID } from "../src/shared/audio-timings";
import type {
	ChapterAudioResponse,
	ChapterCommentaryResponse,
	ChapterTextResponse,
} from "../src/shared/types";
import { isSafeHttpsUrl } from "../src/shared/url";
import { parseEsvPassageHtml } from "../src/worker/esv-text";
import type { FetchLike } from "../src/worker/http";
import { readJsonWithLimit } from "../src/worker/http";
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
		const malformedRes = await app.request("/api/audio/%E0%A4%A/1");
		expect(malformedRes.status).toBe(400);
		assertSecurityHeaders(malformedRes);

		const notFoundRes = await app.request("/api/health");
		expect(notFoundRes.status).toBe(404);
		expect(notFoundRes.headers.get("cache-control")).toBe("no-store");
		assertSecurityHeaders(notFoundRes);
		expect((await app.request("/api/commentaries")).status).toBe(404);
		expect((await app.request("/api/languages")).status).toBe(404);

		await expect(
			readJsonWithLimit(
				{ headers: new Headers(), text: async () => "😀".repeat(8) } as Response,
				20,
			),
		).rejects.toThrow("Upstream response exceeded size limit");

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
		expect(emptyRes.headers.get("cache-control")).toBe("public, max-age=3600");
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

		const requestR2 = async (
			path: string,
			init?: RequestInit,
			targetBucket: R2BucketLike & { resetCounts(): void } = bucket,
		) => {
			targetBucket.resetCounts();
			const res = await app.request(path, init, { AUDIO_BUCKET: targetBucket });
			assertSecurityHeaders(res);
			return res;
		};

		const badRef = await requestR2("/api/audio/krv/GEN/999");
		expect(badRef.status).toBe(400);
		expect(bucket.totalOps()).toBe(0);

		const traversalRef = await requestR2("/api/audio/krv/..%2FGEN/1");
		expect(traversalRef.status).toBe(400);
		expect(bucket.totalOps()).toBe(0);

		const nonNumericChapter = await requestR2("/api/audio/krv/GEN/1abc");
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
			const res = await requestR2("/api/audio/krv/GEN/1", { headers: { Range: malformed } });
			expect(res.status).toBe(400);
			expect(bucket.totalOps()).toBe(0);
		}

		const zeroSuffixRes = await requestR2("/api/audio/krv/GEN/1", {
			headers: { Range: "bytes=-0" },
		});
		expect(zeroSuffixRes.status).toBe(416);
		expect(bucket.totalOps()).toBe(0);

		const fullRes = await requestR2("/api/audio/krv/gen/1");
		expect(fullRes.status).toBe(200);
		expect(await fullRes.text()).toBe("0123456789");
		expect(fullRes.headers.get("content-type")).toBe("audio/mpeg");
		expect(fullRes.headers.get("content-length")).toBe("10");
		expect(fullRes.headers.get("accept-ranges")).toBe("bytes");
		expect(fullRes.headers.get("content-disposition")).toBe("inline");
		expect(fullRes.headers.get("etag")).toBe('"etag-gen-1"');
		expect(fullRes.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		expect(bucket.getCalls).toBe(1);
		expect(bucket.totalOps()).toBe(1);

		const mimeRes = await requestR2("/api/audio/krv/EXO/1");
		expect(mimeRes.status).toBe(200);
		expect(mimeRes.headers.get("content-type")).toBe("audio/mpeg");
		expect(bucket.totalOps()).toBe(1);

		const rangeRes = await requestR2("/api/audio/krv/GEN/1", { headers: { Range: "bytes=0-3" } });
		expect(rangeRes.status).toBe(206);
		expect(await rangeRes.text()).toBe("0123");
		expect(rangeRes.headers.get("content-range")).toBe("bytes 0-3/10");
		expect(rangeRes.headers.get("content-length")).toBe("4");
		expect(rangeRes.headers.get("accept-ranges")).toBe("bytes");
		expect(rangeRes.headers.get("etag")).toBe('"etag-gen-1"');
		expect(bucket.getCalls).toBe(1);
		expect(bucket.totalOps()).toBe(1);

		const suffixRes = await requestR2("/api/audio/krv/GEN/1", { headers: { Range: "bytes=-4" } });
		expect(suffixRes.status).toBe(206);
		expect(await suffixRes.text()).toBe("6789");
		expect(suffixRes.headers.get("content-range")).toBe("bytes 6-9/10");
		expect(suffixRes.headers.get("content-length")).toBe("4");
		expect(bucket.getCalls).toBe(1);
		expect(bucket.totalOps()).toBe(1);

		const notModifiedRes = await requestR2("/api/audio/krv/GEN/1", {
			headers: { "If-None-Match": 'W/"etag-gen-1"' },
		});
		expect(notModifiedRes.status).toBe(304);
		expect(await notModifiedRes.text()).toBe("");
		expect(notModifiedRes.headers.get("etag")).toBe('"etag-gen-1"');
		expect(notModifiedRes.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		expect(bucket.cancelledStreams).toBe(1);
		expect(bucket.totalOps()).toBe(1);

		const headRes = await requestR2("/api/audio/krv/GEN/1", { method: "HEAD" });
		expect(headRes.status).toBe(200);
		expect(await headRes.text()).toBe("");
		expect(headRes.headers.get("content-length")).toBe("10");
		expect(headRes.headers.get("content-type")).toBe("audio/mpeg");
		expect(headRes.headers.get("accept-ranges")).toBe("bytes");
		expect(headRes.headers.get("etag")).toBe('"etag-gen-1"');
		expect(bucket.headCalls).toBe(1);
		expect(bucket.getCalls).toBe(0);

		const headRangeRes = await requestR2("/api/audio/krv/GEN/1", {
			method: "HEAD",
			headers: { Range: "bytes=0-3" },
		});
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
		const headFallbackRes = await requestR2(
			"/api/audio/krv/GEN/1",
			{ method: "HEAD" },
			getOnlyBucket,
		);
		expect(headFallbackRes.status).toBe(200);
		expect(await headFallbackRes.text()).toBe("");
		expect(headFallbackRes.headers.get("content-length")).toBe("10");
		expect(getOnlyBucket.getCalls).toBe(1);
		expect(getOnlyBucket.cancelledStreams).toBe(1);

		const missingRes = await requestR2("/api/audio/krv/GEN/2");
		expect(missingRes.status).toBe(404);
		expect(missingRes.headers.get("cache-control")).toBe("no-store");
		expect(bucket.totalOps()).toBe(1);

		const oobRes = await requestR2("/api/audio/krv/GEN/1", { headers: { Range: "bytes=10-" } });
		expect(oobRes.status).toBe(416);
		expect(await oobRes.text()).toBe("");
		expect(oobRes.headers.get("content-range")).toBe("bytes */10");
		expect(bucket.cancelledStreams).toBe(1);
		expect(bucket.totalOps()).toBe(1);

		// Handles R2 runtime 10039 InvalidRange exceptions as 416.
		const throwingBucket = createMockAudioBucket(
			{ "GEN/1.mp3": { data: "0123456789", contentType: "audio/mpeg", httpEtag: '"etag-gen-1"' } },
			{ throwOnOobRange: true },
		);
		const r2ThrowRes = await requestR2(
			"/api/audio/krv/GEN/1",
			{ headers: { Range: "bytes=99-120" } },
			throwingBucket,
		);
		expect(r2ThrowRes.status).toBe(416);
		expect(throwingBucket.totalOps()).toBe(1);
	});

	it("parses Crossway ESV HTML passages across narrative, Psalms, omitted verses, and entities", () => {
		const genHtml = `
			<h2 class="extra_text">Genesis 1</h2>
			<h3>The Creation of the World</h3>
			<p id="p01001001_07-1"><b class="verse-num" id="v01001001-1">1&nbsp;</b>In the beginning, God created the heavens and the earth. <b class="verse-num" id="v01001003-1">3&nbsp;</b>And God said, &ldquo;Let there be light,&rdquo; and there was light.&mdash;Day&nbsp;1&#8217;s work.</p>
			<div class="footnotes"><h3>Footnotes</h3><p>[1] Ignore footnote text</p></div>
			<p class="copyright">(ESV)</p>
		`;
		expect(parseEsvPassageHtml(genHtml)).toEqual([
			{
				verse: 1,
				heading: "The Creation of the World",
				text: "In the beginning, God created the heavens and the earth.",
			},
			{
				verse: 3,
				text: "And God said, “Let there be light,” and there was light.—Day 1’s work.",
			},
		]);

		const psa51Html = `
			<h3>Create in Me a Clean Heart, O God</h3>
			<h4 class="psalm-title">To the choirmaster. A Psalm of David, when Nathan the prophet went to him, after he had gone in to Bathsheba.</h4>
			<p class="block-indent"><span class="line"><b class="verse-num">1&nbsp;</b>Have mercy on me, O God,<sup class="footnote"><a href="#f1">[1]</a></sup></span><br /><span class="line">according to your steadfast love;</span></p>
			<p class="block-indent"><span class="line"><b class="verse-num">2&nbsp;</b>Wash me thoroughly from my iniquity,<span class="selah">Selah</span></span></p>
		`;
		expect(parseEsvPassageHtml(psa51Html)).toEqual([
			{
				verse: 1,
				heading:
					"Create in Me a Clean Heart, O God — To the choirmaster. A Psalm of David, when Nathan the prophet went to him, after he had gone in to Bathsheba.",
				text: "Have mercy on me, O God, according to your steadfast love;",
			},
			{
				verse: 2,
				text: "Wash me thoroughly from my iniquity, Selah",
			},
		]);

		const psa119Html = `
			<h4 class="psalm-acrostic-title">Aleph</h4>
			<p class="block-indent"><span class="line"><b class="verse-num">1&nbsp;</b>Blessed are those whose way is blameless,</span><br /><span class="line">who walk in the law of the <span class="small-caps">Lord</span>!</span></p>
			<h4 class="psalm-acrostic-title">Beth</h4>
			<p class="block-indent"><span class="line"><b class="verse-num">9&nbsp;</b>How can a young man keep his way pure?</span></p>
		`;
		expect(parseEsvPassageHtml(psa119Html)).toEqual([
			{
				verse: 1,
				heading: "Aleph",
				text: "Blessed are those whose way is blameless, who walk in the law of the LORD!",
			},
			{
				verse: 9,
				heading: "Beth",
				text: "How can a young man keep his way pure?",
			},
		]);

		const mat17Html = `
			<p><b class="verse-num">20&nbsp;</b><span class="woc">He said to them, &ldquo;Because of your little faith.&rdquo;</span> <b class="verse-num">21&nbsp;</b><b class="verse-num">22&nbsp;</b>As they were gathering in Galilee&#x2026;</p>
		`;
		expect(parseEsvPassageHtml(mat17Html)).toEqual([
			{ verse: 20, text: "He said to them, “Because of your little faith.”" },
			{ verse: 22, text: "As they were gathering in Galilee…" },
		]);

		const sng1Html = `
			<h3>The Bride Confesses Her Love</h3>
			<h4 class="speaker">She</h4>
			<p class="block-indent"><span class="line"><b class="verse-num">2&nbsp;</b>Let him kiss me</span></p>
			<h4 class="speaker">Others</h4>
			<p class="block-indent"><span class="line">We will exult and rejoice in you;</span></p>
			<h4 class="speaker">She</h4>
			<p class="block-indent"><span class="line"><b class="verse-num">5&nbsp;</b>I am very dark, but lovely,</span></p>
		`;
		expect(parseEsvPassageHtml(sng1Html)).toEqual([
			{
				verse: 2,
				heading: "The Bride Confesses Her Love — She",
				text: "Let him kiss me We will exult and rejoice in you;",
			},
			{
				verse: 5,
				heading: "She",
				text: "I am very dark, but lovely,",
			},
		]);
	});

	it("serves /api/esv/:usfm/:chapter via Crossway HTML API and localEsvLoader with strict compliance headers", async () => {
		const secretKey = "esv-text-secret-key-999";
		const capturedRequests: Array<{ url: string; auth: string | null }> = [];

		const mockFetch: FetchLike = async (input, init) => {
			const url = String(input);
			capturedRequests.push({
				url,
				auth: new Headers(init?.headers).get("Authorization"),
			});
			const parsedUrl = new URL(url);
			const q = parsedUrl.searchParams.get("q");
			if (q === "Jude 1:1-99") {
				return Response.json({
					passages: [
						'<p><b class="verse-num">1&nbsp;</b>Jude, a servant of Jesus Christ.</p><p><b class="verse-num">25&nbsp;</b>to the only God, our Savior.</p>',
					],
				});
			}
			if (q === "Genesis 2") {
				return new Response("Too Many Requests", { status: 429 });
			}
			if (q === "Genesis 3") {
				return new Response("Bad Gateway", { status: 502 });
			}
			if (q === "Genesis 4") {
				return new Response("{}", {
					status: 200,
					headers: { "Content-Length": String(600 * 1024) },
				});
			}
			if (q === "Genesis 5") {
				return Response.json({ passages: ["<div>No verse numbers here</div>"] });
			}
			return new Response("Not Found", { status: 404 });
		};

		const app = createApp({ fetcher: mockFetch });

		// Validation & missing key
		const badRef = await app.request("/api/esv/GEN/999", undefined, { ESV_API_KEY: secretKey });
		expect(badRef.status).toBe(400);
		expect(badRef.headers.get("cache-control")).toBe("private, no-store");
		assertSecurityHeaders(badRef);

		const missingKey = await app.request("/api/esv/JUD/1");
		expect(missingKey.status).toBe(503);
		expect(missingKey.headers.get("cache-control")).toBe("private, no-store");
		assertSecurityHeaders(missingKey);

		// Single-chapter book query + required Crossway params + private no-store + no key leakage
		const judeRes = await app.request("/api/esv/jud/1", undefined, { ESV_API_KEY: secretKey });
		expect(judeRes.status).toBe(200);
		expect(judeRes.headers.get("cache-control")).toBe("private, no-store");
		assertSecurityHeaders(judeRes);
		const judeText = await judeRes.text();
		expect(judeText).not.toContain(secretKey);
		const judeBody = JSON.parse(judeText) as ChapterTextResponse;
		expect(judeBody).toEqual({
			translationId: "esv",
			bookNumber: 65,
			usfm: "JUD",
			chapter: 1,
			verses: [
				{ verse: 1, text: "Jude, a servant of Jesus Christ." },
				{ verse: 25, text: "to the only God, our Savior." },
			],
		});

		const reqUrl = new URL(capturedRequests[0]?.url ?? "");
		expect(capturedRequests[0]?.auth).toBe(`Token ${secretKey}`);
		expect(reqUrl.origin + reqUrl.pathname).toBe("https://api.esv.org/v3/passage/html/");
		expect(reqUrl.searchParams.get("q")).toBe("Jude 1:1-99");
		expect(reqUrl.searchParams.get("include-headings")).toBe("true");
		expect(reqUrl.searchParams.get("include-subheadings")).toBe("true");
		expect(reqUrl.searchParams.get("include-copyright")).toBe("false");
		expect(reqUrl.searchParams.get("include-footnotes")).toBe("false");

		// HEAD strips body
		const headRes = await app.request(
			"/api/esv/JUD/1",
			{ method: "HEAD" },
			{ ESV_API_KEY: secretKey },
		);
		expect(headRes.status).toBe(200);
		expect(headRes.headers.get("cache-control")).toBe("private, no-store");
		expect(await headRes.text()).toBe("");

		// 429 rate limit vs 502 upstream errors & 512 KB cap
		const rateLimited = await app.request("/api/esv/GEN/2", undefined, { ESV_API_KEY: secretKey });
		expect(rateLimited.status).toBe(429);
		expect(rateLimited.headers.get("cache-control")).toBe("private, no-store");

		const upstreamErr = await app.request("/api/esv/GEN/3", undefined, { ESV_API_KEY: secretKey });
		expect(upstreamErr.status).toBe(502);
		expect(upstreamErr.headers.get("cache-control")).toBe("private, no-store");

		const tooBig = await app.request("/api/esv/GEN/4", undefined, { ESV_API_KEY: secretKey });
		expect(tooBig.status).toBe(502);

		const emptyHtml = await app.request("/api/esv/GEN/5", undefined, { ESV_API_KEY: secretKey });
		expect(emptyHtml.status).toBe(502);

		// localEsvLoader overrides live fetch when present and returns null fallback cleanly
		let liveCallsWithLocal = 0;
		const localApp = createApp({
			fetcher: async (input, init) => {
				liveCallsWithLocal++;
				return mockFetch(input, init);
			},
			localEsvLoader: async (usfm, chapter) =>
				usfm === "PSA" && chapter === 23
					? [{ verse: 1, heading: "A Psalm of David", text: "The LORD is my shepherd." }]
					: null,
		});
		const localRes = await localApp.request("/api/esv/PSA/23");
		expect(localRes.status).toBe(200);
		expect(localRes.headers.get("cache-control")).toBe("private, no-store");
		expect(liveCallsWithLocal).toBe(0);
		expect(((await localRes.json()) as ChapterTextResponse).verses).toEqual([
			{ verse: 1, heading: "A Psalm of David", text: "The LORD is my shepherd." },
		]);

		const fallbackRes = await localApp.request("/api/esv/JUD/1", undefined, {
			ESV_API_KEY: secretKey,
		});
		expect(fallbackRes.status).toBe(200);
		expect(liveCallsWithLocal).toBe(1);
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
