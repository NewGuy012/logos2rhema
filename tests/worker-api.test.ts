import { describe, expect, it } from "bun:test";

import {
	AUDIO_CACHE_CONTROL,
	SUPERTONIC_TRACK_ATTRIBUTION,
	SUPERTONIC_TRACK_ID,
	SUPERTONIC_TRACK_LABEL,
} from "../src/shared/audio-timings";
import type {
	ChapterAudioResponse,
	ChapterCommentaryResponse,
	ChapterTextResponse,
} from "../src/shared/types";
import { isSafeHttpsUrl } from "../src/shared/url";
import { parseEsvPassageHtml } from "../src/worker/esv-text";
import type { FetchLike } from "../src/worker/http";
import { readJsonWithLimit } from "../src/worker/http";
import {
	createApp,
	type R2BucketLike,
	type R2ObjectBodyLike,
	type WorkerApp,
	type WorkerBindings,
} from "../src/worker/index";

function requestApp(
	app: WorkerApp,
	path: string,
	init?: RequestInit,
	env?: WorkerBindings,
): Promise<Response> {
	return app.fetch(new Request(new URL(path, "http://localhost"), init), env);
}

function assertSecurityHeaders(res: Response) {
	expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
	expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
	expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
}

describe("Worker API & Security Boundaries", () => {
	it("serves Supertonic KRV (R2 preferred over AUDIO_BASE_URL) and Crossway ESV tracks, and blocks untrusted redirects/leaks", async () => {
		const secretKey = "esv-secret-key-123";
		const captured = {
			authHeader: null as string | null,
			query: null as string | null,
			esvCalls: 0,
		};

		const mockFetch: FetchLike = async (input, init) => {
			const url = String(input);
			if (!url.startsWith("https://api.esv.org/v3/passage/audio/")) {
				return new Response("Not Found", { status: 404 });
			}
			captured.esvCalls++;
			captured.authHeader = new Headers(init?.headers).get("Authorization");
			captured.query = new URL(url).searchParams.get("q");
			if (captured.query === "John 3") {
				return new Response(null, {
					status: 302,
					headers: { Location: "https://audio.esv.org/hw/43003001-43003036.mp3" },
				});
			}
			if (captured.query === "Jude") {
				return new Response(null, {
					status: 302,
					headers: { Location: "https://audio.esv.org/hw/65001001-65001025.mp3" },
				});
			}
			if (captured.query === "Genesis 1") {
				return new Response("ID3", {
					status: 200,
					headers: { "Content-Type": "text/html; charset=utf-8" },
				});
			}
			if (captured.query === "Genesis 2") {
				return new Response(null, {
					status: 302,
					headers: { Location: "https://evil-esv.org/spoof.mp3" },
				});
			}
			if (captured.query === "Genesis 3") {
				return new Response(null, {
					status: 302,
					headers: { Location: `https://audio.esv.org/hw/a.mp3?k=${secretKey}` },
				});
			}
			return new Response("Upstream Error", { status: 503 });
		};

		const app = createApp({ fetcher: mockFetch });
		const bucket = createMockAudioBucket({
			"JHN/3.mp3": { data: "ID3-JHN3", contentType: "audio/mpeg", httpEtag: '"jhn-3"' },
		});

		// ?lang=ko returns only Korean track and never calls api.esv.org even when ESV_API_KEY is set
		const koOnlyRes = await requestApp(app, "/api/audio/JHN/3?lang=ko", undefined, {
			AUDIO_BUCKET: bucket,
			ESV_API_KEY: secretKey,
		});
		expect(koOnlyRes.status).toBe(200);
		expect(captured.esvCalls).toBe(0);
		const koOnlyBody = (await koOnlyRes.json()) as ChapterAudioResponse;
		expect(koOnlyBody.tracks).toHaveLength(1);
		expect(koOnlyBody.tracks[0]?.language).toBe("ko");

		// ?lang=en returns only English track and skips Korean track
		const enOnlyRes = await requestApp(app, "/api/audio/JHN/3?lang=en", undefined, {
			AUDIO_BUCKET: bucket,
			ESV_API_KEY: secretKey,
		});
		expect(enOnlyRes.status).toBe(200);
		expect(captured.esvCalls).toBe(1);
		const enOnlyBody = (await enOnlyRes.json()) as ChapterAudioResponse;
		expect(enOnlyBody.tracks).toHaveLength(1);
		expect(enOnlyBody.tracks[0]?.language).toBe("en");
		expect(enOnlyBody.tracks[0]?.url).toBe("https://audio.esv.org/hw/43003001-43003036.mp3");

		// Prefers private R2 AUDIO_BUCKET over AUDIO_BASE_URL without touching R2 on metadata lookup
		const boundRes = await requestApp(app, "/api/audio/JHN/3", undefined, {
			AUDIO_BUCKET: bucket,
			AUDIO_BASE_URL: "https://cdn.example.com/krv/",
			ESV_API_KEY: secretKey,
		});
		expect(boundRes.status).toBe(200);
		assertSecurityHeaders(boundRes);
		expect(bucket.totalOps()).toBe(0);
		expect(captured.authHeader).toBe(`Token ${secretKey}`);
		const boundText = await boundRes.text();
		expect(boundText).not.toContain(secretKey);
		const boundBody = JSON.parse(boundText) as ChapterAudioResponse;
		expect(boundBody.tracks[0]).toEqual({
			id: SUPERTONIC_TRACK_ID,
			label: SUPERTONIC_TRACK_LABEL,
			language: "ko",
			url: "/api/audio/krv/JHN/3",
			isAiGenerated: true,
			attribution: SUPERTONIC_TRACK_ATTRIBUTION,
		});
		expect(boundBody.tracks[1]?.url).toBe("https://audio.esv.org/hw/43003001-43003036.mp3");

		// AUDIO_BASE_URL fallback when R2 is not bound + single-chapter ESV query
		const baseUrlRes = await requestApp(app, "/api/audio/JUD/1", undefined, {
			AUDIO_BASE_URL: "https://cdn.example.com/krv/",
			ESV_API_KEY: secretKey,
		});
		expect(captured.query).toBe("Jude");
		const baseBody = (await baseUrlRes.json()) as ChapterAudioResponse;
		expect(baseBody.tracks.find((t) => t.language === "ko")?.url).toBe(
			"https://cdn.example.com/krv/JUD/1.mp3",
		);
		expect(baseBody.tracks.find((t) => t.language === "en")?.url).toBe(
			"https://audio.esv.org/hw/65001001-65001025.mp3",
		);

		// Untrusted redirect host or secret-leaking redirect URL is dropped and not long-cached
		for (const badChapter of ["/api/audio/GEN/2", "/api/audio/GEN/3", "/api/audio/GEN/4"]) {
			const res = await requestApp(app, badChapter, undefined, { ESV_API_KEY: secretKey });
			expect(res.status).toBe(200);
			expect(res.headers.get("cache-control")).toBe("private, no-store");
			const text = await res.text();
			expect(text).not.toContain(secretKey);
			expect((JSON.parse(text) as ChapterAudioResponse).tracks).toEqual([]);
		}

		// /api/audio/esv/:usfm/:chapter: direct stream MIME coercion, trusted 302, untrusted 502, missing key 503
		const proxyStream = await requestApp(app, "/api/audio/esv/GEN/1", undefined, {
			ESV_API_KEY: secretKey,
		});
		expect(proxyStream.status).toBe(200);
		expect(proxyStream.headers.get("content-type")).toBe("audio/mpeg");
		expect(proxyStream.headers.get("content-disposition")).toBe("inline");
		assertSecurityHeaders(proxyStream);

		const proxyRedirect = await requestApp(app, "/api/audio/esv/JHN/3", undefined, {
			ESV_API_KEY: secretKey,
		});
		expect(proxyRedirect.status).toBe(302);
		expect(proxyRedirect.headers.get("location")).toBe(
			"https://audio.esv.org/hw/43003001-43003036.mp3",
		);
		assertSecurityHeaders(proxyRedirect);

		expect(
			(await requestApp(app, "/api/audio/esv/GEN/2", undefined, { ESV_API_KEY: secretKey })).status,
		).toBe(502);
		expect((await requestApp(app, "/api/audio/esv/GEN/1")).status).toBe(503);
	});

	it("enforces URL safety, chunked stream limits, strict ref parsing, HEAD/methods, and sanitized onError", async () => {
		expect(isSafeHttpsUrl("https://cdn.example.com/gen1.mp3")).toBe(true);
		for (const badUrl of [
			"https://127.0.0.1/a.mp3",
			"https://0x7f000001/a.mp3",
			"https://[::1]/a.mp3",
			"https://localhost/a.mp3",
			"https://cdn.example.com:8443/a.mp3",
			"https://cdn.example.com/\na.mp3",
		]) {
			expect(isSafeHttpsUrl(badUrl)).toBe(false);
		}
		// Forbidden substring catches percent-encoding even alongside malformed %ZZ sequences
		expect(
			isSafeHttpsUrl("https://cdn.example.com/a.mp3?k=%ZZ%61%2b%62", { forbiddenSubstring: "A+B" }),
		).toBe(false);

		// Chunked ReadableStream cap cancels reader on overflow
		let streamCancelled = false;
		const chunkedBody = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(new Uint8Array(15));
			},
			cancel() {
				streamCancelled = true;
			},
		});
		await expect(readJsonWithLimit(new Response(chunkedBody), 20)).rejects.toThrow(
			"Upstream response exceeded size limit",
		);
		expect(streamCancelled).toBe(true);

		const app = createApp({
			fetcher: async () => new Response("Down", { status: 503 }),
		});

		for (const badPath of [
			"/api/audio/GEN/999",
			"/api/audio/GEN/01",
			"/api/audio/GEN/1abc",
			"/api/audio/%E0%A4%A/1",
			"/api/audio/GEN/1?lang=fr",
			"/api/audio/GEN/1?lang=",
		]) {
			const res = await requestApp(app, badPath);
			expect(res.status).toBe(400);
			assertSecurityHeaders(res);
		}

		for (const notFound of [
			"/api/health",
			"/api/commentaries",
			"/api/languages",
			"/api/esv/GEN/1/",
			"/api/esv//1",
		]) {
			const res = await requestApp(app, notFound);
			expect(res.status).toBe(404);
			expect(res.headers.get("cache-control")).toBe("no-store");
			assertSecurityHeaders(res);
		}

		const headRes = await requestApp(app, "/api/audio/JHN/3", { method: "HEAD" });
		expect(headRes.status).toBe(200);
		expect(await headRes.text()).toBe("");
		assertSecurityHeaders(headRes);

		const badMethod = await requestApp(app, "/api/audio/GEN/1", { method: "POST" });
		expect(badMethod.status).toBe(405);
		expect(badMethod.headers.get("cache-control")).toBe("no-store");
		assertSecurityHeaders(badMethod);

		for (const blockedBase of [
			"https://127.0.0.1/krv",
			"https://cdn.example.com/krv?token=x",
			"https://cdn.example.com/krv#frag",
		]) {
			const res = await requestApp(app, "/api/audio/GEN/1", undefined, {
				AUDIO_BASE_URL: blockedBase,
			});
			expect(((await res.json()) as ChapterAudioResponse).tracks).toEqual([]);
		}

		// Unhandled error boundary returns sanitized 502 with security headers
		const errRes = await requestApp(app, "/api/audio/krv/GEN/1", undefined, {
			AUDIO_BUCKET: {
				async get() {
					throw new Error("internal-secret-stack-detail");
				},
			},
		});
		expect(errRes.status).toBe(502);
		assertSecurityHeaders(errRes);
		expect(await errRes.text()).not.toContain("internal-secret-stack-detail");
	});

	it("normalizes Tyndale & Matthew Henry commentaries, deduplicates verse IDs, caps recursion, and handles errors", async () => {
		let deepNode: Record<string, unknown> = { text: "too-deep" };
		for (let i = 0; i < 30; i++) deepNode = { content: [deepNode] };

		const mockFetch: FetchLike = async (input) => {
			const url = String(input);
			if (url === "https://bible.helloao.org/api/c/tyndale/GEN/1.json") {
				return Response.json({
					book: {
						introductionSummary: "The Book of Genesis\n\nBeginnings.",
						introduction: "Genesis introduces God's covenant.",
					},
					chapter: {
						content: [
							{ type: "verse", number: 1, content: ["1:1–2:3 Overview.", "1:1 In the beginning."] },
							{ type: "verse", number: 1, content: ["Duplicate verse 1 note."] },
							{ type: "verse", number: 1, content: ["Third verse 1 note."] },
							{ type: "verse", number: 6, content: ["1:6-8 The expanse of the sky."] },
							{
								type: "verse",
								number: 9,
								content: [{ text: "1:9 " }, { text: "Waters." }, deepNode],
							},
						],
					},
				});
			}
			if (url === "https://bible.helloao.org/api/c/matthew-henry/JHN/3.json") {
				return Response.json({
					chapter: {
						introduction: "Christ's discourse with Nicodemus.",
						content: [
							{ type: "heading", content: ["The New Birth"] },
							{ type: "verse", number: 1, content: ["Paragraph one.\nI. Paragraph two."] },
							{ type: "verse", number: 22, content: ["John Baptist's witness."] },
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
		const tyndaleRes = await requestApp(app, "/api/commentary/tyndale/gen/1");
		expect(tyndaleRes.status).toBe(200);
		expect(tyndaleRes.headers.get("cache-control")).toBe("public, max-age=86400");
		const tyndaleBody = (await tyndaleRes.json()) as ChapterCommentaryResponse;
		expect(tyndaleBody.bookIntroduction).toEqual([
			"The Book of Genesis",
			"Beginnings.",
			"Genesis introduces God's covenant.",
		]);
		expect(tyndaleBody.entries.slice(0, 3).map((e) => e.id)).toEqual([
			"tyndale:GEN:1:1",
			"tyndale:GEN:1:1-2",
			"tyndale:GEN:1:1-3",
		]);
		expect(tyndaleBody.entries[3]).toMatchObject({ verseStart: 6, verseEnd: 8 });
		expect(tyndaleBody.entries[4]?.paragraphs).toEqual(["1:9 Waters."]);

		const mhBody = (await (
			await requestApp(app, "/api/commentary/matthew-henry/JHN/3")
		).json()) as ChapterCommentaryResponse;
		expect(mhBody.introduction).toEqual(["Christ's discourse with Nicodemus."]);
		expect(mhBody.entries[0]).toMatchObject({
			heading: "The New Birth",
			verseStart: 1,
			verseEnd: 21,
			paragraphs: ["Paragraph one.", "I. Paragraph two."],
		});

		const emptyRes = await requestApp(app, "/api/commentary/tyndale/JDG/1");
		expect(emptyRes.status).toBe(200);
		expect(emptyRes.headers.get("cache-control")).toBe("public, max-age=3600");
		expect(((await emptyRes.json()) as ChapterCommentaryResponse).entries).toEqual([]);

		for (const [path, status] of [
			["/api/commentary/tyndale/EXO/1", 502],
			["/api/commentary/tyndale/LEV/1", 502],
			["/api/commentary/matthew-henry/EXO/1", 502],
			["/api/commentary/adam-clarke/GEN/1", 400],
			["/api/commentary/%E0%A4%A/GEN/1", 400],
			["/api/commentary/tyndale/GEN/999", 400],
		] as const) {
			const res = await requestApp(app, path);
			expect(res.status).toBe(status);
			assertSecurityHeaders(res);
		}
	});

	it("streams private R2 audio with range seeking, ETags, HEAD, op limits, and error boundaries", async () => {
		const bucket = createMockAudioBucket({
			"GEN/1.mp3": { data: "0123456789", contentType: "audio/mpeg", httpEtag: '"etag-gen-1"' },
			"EXO/1.mp3": { data: "AUDIO", contentType: "text/html", httpEtag: '"etag-exo-1"' },
			"LEV/1.mp3": { data: "EMPTY", omitBody: true },
		});
		const app = createApp();

		const requestR2 = async (
			path: string,
			init?: RequestInit,
			target: R2BucketLike & { resetCounts(): void } = bucket,
		) => {
			target.resetCounts();
			const res = await requestApp(app, path, init, { AUDIO_BUCKET: target });
			assertSecurityHeaders(res);
			return res;
		};

		for (const bad of [
			"/api/audio/krv/GEN/999",
			"/api/audio/krv/..%2FGEN/1",
			"/api/audio/krv/GEN/01",
		]) {
			expect((await requestR2(bad)).status).toBe(400);
			expect(bucket.totalOps()).toBe(0);
		}
		expect((await requestApp(app, "/api/audio/krv/GEN/1")).status).toBe(503);

		for (const badRange of ["bytes=abc-def", "bytes=5-2", "bytes=0-1, 2-3", "items=0-3", ""]) {
			expect(
				(await requestR2("/api/audio/krv/GEN/1", { headers: { Range: badRange } })).status,
			).toBe(400);
			expect(bucket.totalOps()).toBe(0);
		}
		expect(
			(await requestR2("/api/audio/krv/GEN/1", { headers: { Range: "bytes=-0" } })).status,
		).toBe(416);

		const fullRes = await requestR2("/api/audio/krv/gen/1");
		expect(fullRes.status).toBe(200);
		expect(await fullRes.text()).toBe("0123456789");
		expect(fullRes.headers.get("content-type")).toBe("audio/mpeg");
		expect(fullRes.headers.get("cache-control")).toBe(AUDIO_CACHE_CONTROL);
		expect(bucket.totalOps()).toBe(1);

		expect((await requestR2("/api/audio/krv/EXO/1")).headers.get("content-type")).toBe(
			"audio/mpeg",
		);
		expect((await requestR2("/api/audio/krv/LEV/1")).status).toBe(502);

		const rangeRes = await requestR2("/api/audio/krv/GEN/1", { headers: { Range: "bytes=0-3" } });
		expect(rangeRes.status).toBe(206);
		expect(await rangeRes.text()).toBe("0123");
		expect(rangeRes.headers.get("content-range")).toBe("bytes 0-3/10");

		const suffixRes = await requestR2("/api/audio/krv/GEN/1", { headers: { Range: "bytes=-4" } });
		expect(suffixRes.status).toBe(206);
		expect(await suffixRes.text()).toBe("6789");
		expect(suffixRes.headers.get("content-range")).toBe("bytes 6-9/10");

		// ETag matching (weak tag + wildcard *) cancels body stream
		for (const tag of ['W/"etag-gen-1"', "*"]) {
			const res = await requestR2("/api/audio/krv/GEN/1", { headers: { "If-None-Match": tag } });
			expect(res.status).toBe(304);
			expect(bucket.cancelledStreams).toBe(1);
		}
		expect(
			(
				await requestR2("/api/audio/krv/GEN/1", {
					headers: { "If-None-Match": `"${"a".repeat(2100)}"` },
				})
			).status,
		).toBe(200);

		// HEAD uses bucket.head (and falls back cleanly when omitHead is true)
		const headRes = await requestR2("/api/audio/krv/GEN/1", {
			method: "HEAD",
			headers: { Range: "bytes=0-3" },
		});
		expect(headRes.status).toBe(206);
		expect(headRes.headers.get("content-range")).toBe("bytes 0-3/10");
		expect(bucket.headCalls).toBe(1);
		expect(bucket.getCalls).toBe(0);

		const getOnlyBucket = createMockAudioBucket(
			{ "GEN/1.mp3": { data: "0123456789", contentType: "audio/mpeg", httpEtag: '"etag-gen-1"' } },
			{ omitHead: true },
		);
		expect(
			(await requestR2("/api/audio/krv/GEN/1", { method: "HEAD" }, getOnlyBucket)).status,
		).toBe(200);
		expect(getOnlyBucket.cancelledStreams).toBe(1);

		expect((await requestR2("/api/audio/krv/GEN/2")).status).toBe(404);
		const oobRes = await requestR2("/api/audio/krv/GEN/1", { headers: { Range: "bytes=10-" } });
		expect(oobRes.status).toBe(416);
		expect(oobRes.headers.get("content-range")).toBe("bytes */10");

		const throwingBucket = createMockAudioBucket(
			{ "GEN/1.mp3": { data: "0123456789", contentType: "audio/mpeg" } },
			{ throwOnOobRange: true },
		);
		expect(
			(
				await requestR2(
					"/api/audio/krv/GEN/1",
					{ headers: { Range: "bytes=99-120" } },
					throwingBucket,
				)
			).status,
		).toBe(416);
	});

	it("parses Crossway ESV HTML safely (narrative, Psalms, acrostics, Song, entities, comments, prototype keys)", () => {
		const cases: Array<[string, ReturnType<typeof parseEsvPassageHtml>]> = [
			[
				`<h2 class="extra_text">Genesis 1</h2><h3>The Creation</h3>
				<p><b class="verse-num">1&nbsp;</b>In the beginning. <b class="verse-num">3&nbsp;</b>&ldquo;Light&rdquo;&mdash;Day&#8217;s &constructor;<!-- ok --></p>
				<div class="footnotes"><p>[1] Ignore</p></div><p class="copyright">(ESV)</p>`,
				[
					{ verse: 1, heading: "The Creation", text: "In the beginning." },
					{ verse: 3, text: "“Light”—Day’s &constructor;" },
				],
			],
			[
				`<h3>Clean Heart</h3><h4 class="psalm-title">A Psalm of David.</h4>
				<p><span class="line"><b class="verse-num">1&nbsp;</b>Have mercy,<sup class="footnote"><a href="#f1">[1]</a></sup></span><br /><span class="line">O <span class="small-caps">Lord</span>!<span class="selah">Selah</span></span></p>`,
				[
					{
						verse: 1,
						heading: "Clean Heart — A Psalm of David.",
						text: "Have mercy, O LORD! Selah",
					},
				],
			],
			[
				`<h4 class="psalm-acrostic-title">Aleph</h4><p><b class="verse-num">1&nbsp;</b>Blessed.</p>
				<h4 class="speaker">She</h4><p><b class="verse-num">2&nbsp;</b>Let him kiss me</p>
				<h4 class="speaker">Others</h4><p>We will exult;</p>
				<p><b class="verse-num">21&nbsp;</b><b class="verse-num">22&nbsp;</b>Galilee&#x2026;&#x00;&#127;</p>`,
				[
					{ verse: 1, heading: "Aleph", text: "Blessed." },
					{ verse: 2, heading: "She", text: "Let him kiss me We will exult;" },
					{ verse: 22, text: "Galilee…&#x00;&#127;" },
				],
			],
		];
		for (const [html, expected] of cases) {
			expect(parseEsvPassageHtml(html)).toEqual(expected);
		}

		// Linear comment stripping & bounded unmatched tags (no ReDoS)
		const adversarial = `<p><b class="verse-num">1&nbsp;</b>Safe${"<!--".repeat(2000)}${"</span>".repeat(2000)}</p>`;
		expect(parseEsvPassageHtml(adversarial)).toEqual([{ verse: 1, text: "Safe" }]);
	});

	it("serves /api/esv/:usfm/:chapter with strict private no-store compliance and localEsvLoader override", async () => {
		const secretKey = "esv-text-secret-key-999";
		const captured: Array<{ url: string; auth: string | null; redirect?: RequestRedirect }> = [];

		const mockFetch: FetchLike = async (input, init) => {
			const url = String(input);
			captured.push({
				url,
				auth: new Headers(init?.headers).get("Authorization"),
				redirect: init?.redirect,
			});
			const q = new URL(url).searchParams.get("q");
			if (q === "Jude") {
				return Response.json({
					passages: [
						'<p><b class="verse-num">1&nbsp;</b>Jude, a servant.</p><p><b class="verse-num">25&nbsp;</b>to the only God.</p>',
					],
				});
			}
			if (q === "Genesis 2") return new Response("Rate Limited", { status: 429 });
			if (q === "Genesis 3") return new Response("Bad Gateway", { status: 502 });
			if (q === "Genesis 4") {
				return new Response("{}", {
					status: 200,
					headers: { "Content-Length": String(600 * 1024) },
				});
			}
			if (q === "Genesis 5") return Response.json({ passages: ["<div>No verses</div>"] });
			if (q === "Genesis 6") {
				return new Response(null, { status: 302, headers: { Location: "https://evil.example/" } });
			}
			return new Response("Not Found", { status: 404 });
		};

		const app = createApp({ fetcher: mockFetch });
		const badRef = await requestApp(app, "/api/esv/GEN/999", undefined, { ESV_API_KEY: secretKey });
		expect(badRef.status).toBe(400);
		expect(badRef.headers.get("cache-control")).toBe("private, no-store");
		assertSecurityHeaders(badRef);

		expect((await requestApp(app, "/api/esv/JUD/1")).status).toBe(503);

		const judeRes = await requestApp(app, "/api/esv/jud/1", undefined, { ESV_API_KEY: secretKey });
		expect(judeRes.status).toBe(200);
		expect(judeRes.headers.get("cache-control")).toBe("private, no-store");
		assertSecurityHeaders(judeRes);
		const judeText = await judeRes.text();
		expect(judeText).not.toContain(secretKey);
		expect(JSON.parse(judeText) as ChapterTextResponse).toEqual({
			translationId: "esv",
			bookNumber: 65,
			usfm: "JUD",
			chapter: 1,
			verses: [
				{ verse: 1, text: "Jude, a servant." },
				{ verse: 25, text: "to the only God." },
			],
		});

		const reqUrl = new URL(captured[0]?.url ?? "");
		expect(captured[0]?.auth).toBe(`Token ${secretKey}`);
		expect(captured[0]?.redirect).toBe("manual");
		expect(reqUrl.searchParams.get("q")).toBe("Jude");
		expect(reqUrl.searchParams.get("include-copyright")).toBe("false");

		const headRes = await requestApp(
			app,
			"/api/esv/JUD/1",
			{ method: "HEAD" },
			{ ESV_API_KEY: secretKey },
		);
		expect(headRes.status).toBe(200);
		expect(await headRes.text()).toBe("");

		for (const [path, status] of [
			["/api/esv/GEN/2", 429],
			["/api/esv/GEN/3", 502],
			["/api/esv/GEN/4", 502],
			["/api/esv/GEN/5", 502],
			["/api/esv/GEN/6", 502],
		] as const) {
			const res = await requestApp(app, path, undefined, { ESV_API_KEY: secretKey });
			expect(res.status).toBe(status);
			expect(res.headers.get("cache-control")).toBe("private, no-store");
		}

		// localEsvLoader short-circuits live fetch when present
		let liveCalls = 0;
		const localApp = createApp({
			fetcher: async (input, init) => {
				liveCalls++;
				return mockFetch(input, init);
			},
			localEsvLoader: async (usfm, ch) =>
				usfm === "PSA" && ch === 23 ? [{ verse: 1, text: "The LORD is my shepherd." }] : null,
		});
		const localRes = await requestApp(localApp, "/api/esv/PSA/23");
		expect(localRes.status).toBe(200);
		expect(liveCalls).toBe(0);
		expect(
			(await requestApp(localApp, "/api/esv/JUD/1", undefined, { ESV_API_KEY: secretKey })).status,
		).toBe(200);
		expect(liveCalls).toBe(1);
	});
});

interface MockAudioObjectSpec {
	data: string;
	contentType?: string;
	httpEtag?: string;
	omitBody?: boolean;
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
		totalOps: () => bucket.getCalls + bucket.headCalls,
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
			getOpts?: { range?: { offset?: number; length?: number; suffix?: number } },
		): Promise<R2ObjectBodyLike | null> {
			bucket.getCalls++;
			const spec = objects[key];
			if (!spec) return null;
			const bytes = encoder.encode(spec.data);
			const size = bytes.byteLength;
			const onCancel = () => {
				bucket.cancelledStreams++;
			};
			if (spec.omitBody) return makeMeta(spec, size);
			const range = getOpts?.range;
			if (!range) {
				return { ...makeMeta(spec, size), body: makeStream(bytes, onCancel) };
			}
			let offset = 0;
			let length = 0;
			if (range.suffix !== undefined) {
				length = size > 0 && range.suffix > 0 ? Math.min(range.suffix, size) : 0;
				offset = size - length;
			} else {
				const rawOffset = range.offset ?? 0;
				if (rawOffset >= 0 && rawOffset < size) {
					offset = rawOffset;
					length =
						range.length !== undefined
							? Math.max(0, Math.min(range.length, size - offset))
							: size - offset;
				} else if (options.throwOnOobRange) {
					throw new Error("The requested range is not satisfiable (10039)");
				} else {
					offset = rawOffset;
					length = 0;
				}
			}
			return {
				...makeMeta(spec, size),
				range: { offset, length },
				body: makeStream(bytes.subarray(offset, offset + length), onCancel),
			};
		},
	};
	return bucket;
}
