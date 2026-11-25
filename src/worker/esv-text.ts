import type { VerseEntry } from "../shared/types";
import { ESV_API_BASE, esvAuthHeaders, formatEsvPassageQuery } from "./esv-audio";
import { fetchJsonObject, type FetchLike } from "./http";

const ESV_HTML_API_BASE = `${ESV_API_BASE}/html/`;
const MAX_ESV_HTML_BYTES = 512 * 1024;
const MAX_TAG_STACK_DEPTH = 256;

const NAMED_HTML_ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	thinsp: " ",
	ensp: " ",
	emsp: " ",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	sbquo: "‚",
	bdquo: "„",
	lsaquo: "‹",
	rsaquo: "›",
	ndash: "–",
	mdash: "—",
	hellip: "…",
	copy: "©",
	reg: "®",
	trade: "™",
};

const VOID_HTML_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

const BLOCK_BOUNDARY_TAGS = new Set(["p", "div", "br", "li", "blockquote", "h1", "h2", "h3", "h4"]);

type TagRole =
	"skip" | "heading" | "speaker" | "verse-num" | "small-caps" | "selah" | "block" | "inline";

type FetchEsvChapterResult =
	{ status: "ok"; verses: VerseEntry[] } | { status: "rate_limited" } | { status: "error" };

type FetchEsvPassageResult = FetchEsvChapterResult | { status: "not_found" };

function decodeHtmlEntities(input: string): string {
	return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
		if (entity.startsWith("#")) {
			const isHex = entity[1] === "x" || entity[1] === "X";
			const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
			const isControl =
				(codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
				(codePoint >= 0x7f && codePoint <= 0x9f);
			if (
				Number.isInteger(codePoint) &&
				codePoint >= 0 &&
				codePoint <= 0x10ffff &&
				!(codePoint >= 0xd800 && codePoint <= 0xdfff) &&
				!isControl
			) {
				return String.fromCodePoint(codePoint);
			}
			return match;
		}
		const key = entity.toLowerCase();
		return Object.hasOwn(NAMED_HTML_ENTITIES, key) ? NAMED_HTML_ENTITIES[key] : match;
	});
}

function stripHtmlComments(html: string): string {
	let idx = html.indexOf("<!--");
	if (idx < 0) return html;
	let out = "";
	let cursor = 0;
	while (idx >= 0) {
		out += html.slice(cursor, idx);
		const end = html.indexOf("-->", idx + 4);
		if (end < 0) return out;
		cursor = end + 3;
		idx = html.indexOf("<!--", cursor);
	}
	return out + html.slice(cursor);
}

function extractTagClasses(attrs: string): Set<string> {
	const classMatch = attrs.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
	const raw = classMatch?.[1] ?? classMatch?.[2] ?? classMatch?.[3] ?? "";
	if (!raw) return new Set();
	return new Set(raw.trim().split(/\s+/));
}

function classifyOpenTag(tagName: string, attrs: string): TagRole {
	const classes = extractTagClasses(attrs);
	if (
		tagName === "script" ||
		tagName === "style" ||
		tagName === "audio" ||
		tagName === "object" ||
		tagName === "h2" ||
		classes.has("footnotes") ||
		classes.has("footnote") ||
		classes.has("copyright") ||
		classes.has("extra_text") ||
		classes.has("chapter-num") ||
		classes.has("audio")
	) {
		return "skip";
	}
	if ((tagName === "b" || tagName === "span") && classes.has("verse-num")) {
		return "verse-num";
	}
	if (classes.has("speaker")) {
		return "speaker";
	}
	if (
		tagName === "h3" ||
		tagName === "h4" ||
		classes.has("subheading") ||
		classes.has("psalm-title") ||
		classes.has("psalm-acrostic-title")
	) {
		return "heading";
	}
	if (classes.has("small-caps")) {
		return "small-caps";
	}
	if (classes.has("selah")) {
		return "selah";
	}
	if (BLOCK_BOUNDARY_TAGS.has(tagName) || classes.has("line") || classes.has("indent")) {
		return "block";
	}
	return "inline";
}

function normalizeText(raw: string): string {
	return raw.replace(/\s+/g, " ").trim();
}

export function parseEsvPassageHtml(html: string): VerseEntry[] {
	const verses: VerseEntry[] = [];
	const stack: Array<{ tag: string; role: TagRole }> = [];
	const openTagCounts = new Map<string, number>();

	let skipDepth = 0;
	let headingDepth = 0;
	let verseNumDepth = 0;
	let smallCapsDepth = 0;

	let pendingHeadings: Array<{ text: string; isSpeaker: boolean }> = [];
	let headingBuffer = "";
	let verseNumBuffer = "";
	let currentVerse: number | null = null;
	let currentVerseHeadings: string[] = [];
	let verseBuffer = "";

	const adjustDepth = (role: TagRole, delta: 1 | -1) => {
		if (role === "skip") skipDepth += delta;
		else if (role === "heading" || role === "speaker") headingDepth += delta;
		else if (role === "verse-num") verseNumDepth += delta;
		else if (role === "small-caps") smallCapsDepth += delta;
	};

	const appendBlockSpace = () => {
		if (headingDepth > 0) headingBuffer += " ";
		else if (currentVerse !== null) verseBuffer += " ";
	};

	const flushCurrentVerse = () => {
		if (currentVerse === null) return;
		const text = normalizeText(verseBuffer);
		if (text) {
			const heading =
				currentVerseHeadings.length > 0 ? currentVerseHeadings.join(" — ") : undefined;
			const last = verses[verses.length - 1];
			if (last && last.verse === currentVerse) {
				last.text = normalizeText(`${last.text} ${text}`);
				if (!last.heading && heading) last.heading = heading;
			} else {
				verses.push(
					heading ? { verse: currentVerse, text, heading } : { verse: currentVerse, text },
				);
			}
		}
		currentVerse = null;
		currentVerseHeadings = [];
		verseBuffer = "";
	};

	const cleanedHtml = stripHtmlComments(html);
	const tokenRe = /<(\/?)([a-zA-Z0-9]+)\b([^>]*)>|([^<]+)/g;
	for (const match of cleanedHtml.matchAll(tokenRe)) {
		const textChunk = match[4];
		if (textChunk !== undefined) {
			if (skipDepth > 0) continue;
			let decoded = decodeHtmlEntities(textChunk);
			if (smallCapsDepth > 0) {
				decoded = decoded.toUpperCase();
			}
			if (verseNumDepth > 0) {
				verseNumBuffer += decoded;
			} else if (headingDepth > 0) {
				headingBuffer += decoded;
			} else if (currentVerse !== null) {
				verseBuffer += decoded;
			}
			continue;
		}

		const isClosing = match[1] === "/";
		const tagName = (match[2] ?? "").toLowerCase();
		if (!tagName) continue;
		const rawAttrs = match[3] ?? "";

		if (!isClosing) {
			const isSelfClosing = VOID_HTML_TAGS.has(tagName) || rawAttrs.trimEnd().endsWith("/");
			const role = classifyOpenTag(tagName, rawAttrs);

			if (!isSelfClosing && stack.length < MAX_TAG_STACK_DEPTH) {
				stack.push({ tag: tagName, role });
				openTagCounts.set(tagName, (openTagCounts.get(tagName) ?? 0) + 1);
				adjustDepth(role, 1);
			}

			if (skipDepth > 0) continue;

			if (role === "verse-num" && !isSelfClosing) {
				verseNumBuffer = "";
			} else if ((role === "heading" || role === "speaker") && headingDepth === 1) {
				headingBuffer = "";
			} else if (
				role === "selah" &&
				currentVerse !== null &&
				verseBuffer &&
				!/\s$/.test(verseBuffer)
			) {
				verseBuffer += " ";
			} else if (role === "block") {
				appendBlockSpace();
			}
			continue;
		}

		if (VOID_HTML_TAGS.has(tagName) || (openTagCounts.get(tagName) ?? 0) === 0) continue;

		// Pop back to matching open tag (defensive against malformed/unclosed inline HTML)
		let popIdx = -1;
		for (let i = stack.length - 1; i >= 0; i--) {
			if (stack[i].tag === tagName) {
				popIdx = i;
				break;
			}
		}
		if (popIdx < 0) continue;

		while (stack.length > popIdx) {
			const popped = stack.pop();
			if (!popped) break;
			openTagCounts.set(popped.tag, Math.max(0, (openTagCounts.get(popped.tag) ?? 1) - 1));
			const wasSkip = skipDepth > 0;
			adjustDepth(popped.role, -1);

			if (wasSkip && popped.role !== "skip") continue;

			if (popped.role === "verse-num" && verseNumDepth === 0) {
				const numMatch = verseNumBuffer.trim().match(/^(?:\d+:)?(\d+)/);
				const nextVerseNum = numMatch ? Number.parseInt(numMatch[1], 10) : Number.NaN;
				verseNumBuffer = "";
				if (Number.isInteger(nextVerseNum) && nextVerseNum >= 1) {
					flushCurrentVerse();
					currentVerse = nextVerseNum;
					currentVerseHeadings = pendingHeadings.map((h) => h.text);
					pendingHeadings = [];
				}
			} else if ((popped.role === "heading" || popped.role === "speaker") && headingDepth === 0) {
				const heading = normalizeText(headingBuffer);
				headingBuffer = "";
				if (heading) {
					const isSpeaker = popped.role === "speaker";
					if (isSpeaker && pendingHeadings[pendingHeadings.length - 1]?.isSpeaker) {
						pendingHeadings[pendingHeadings.length - 1] = { text: heading, isSpeaker: true };
					} else {
						pendingHeadings.push({ text: heading, isSpeaker });
					}
				}
			} else if (popped.role === "block" && skipDepth === 0) {
				appendBlockSpace();
			}
		}
	}

	flushCurrentVerse();
	return verses;
}

async function fetchEsvHtmlVerses(
	apiKey: string,
	options: {
		bookEn: string;
		chapter: number;
		chaptersInBook: number;
		verseStart?: number;
		verseEnd?: number;
	},
	fetcher: FetchLike = fetch,
): Promise<FetchEsvPassageResult> {
	const query = formatEsvPassageQuery(
		options.bookEn,
		options.chapter,
		options.chaptersInBook,
		options.verseStart,
		options.verseEnd,
	);
	const params = new URLSearchParams({
		q: query,
		"include-passage-references": "false",
		"include-verse-numbers": "true",
		"include-first-verse-numbers": "true",
		"include-chapter-numbers": "false",
		"include-footnotes": "false",
		"include-footnote-body": "false",
		"include-headings": "true",
		"include-subheadings": "true",
		"include-short-copyright": "false",
		"include-copyright": "false",
		"include-audio-link": "false",
		"include-selahs": "true",
	});
	const endpoint = `${ESV_HTML_API_BASE}?${params.toString()}`;
	const res = await fetchJsonObject(fetcher, endpoint, {
		headers: esvAuthHeaders(apiKey, "application/json"),
		maxBytes: MAX_ESV_HTML_BYTES,
	});
	if (res.status === "rate_limited") return { status: "rate_limited" };
	if (res.status !== "ok") return { status: "error" };

	const rawPassages = res.data.passages;
	if (!Array.isArray(rawPassages)) return { status: "error" };

	const strings = rawPassages.filter((p): p is string => typeof p === "string");
	if (options.verseStart !== undefined && strings.every((p) => !p.trim())) {
		return { status: "not_found" };
	}

	const html = strings.join("\n");
	const parsed = parseEsvPassageHtml(html);
	if (options.verseStart === undefined) {
		return parsed.length > 0 ? { status: "ok", verses: parsed } : { status: "error" };
	}

	const start = options.verseStart;
	const end = options.verseEnd ?? start;
	const filtered = parsed.filter((v) => v.verse >= start && v.verse <= end);
	if (filtered.length > 0) return { status: "ok", verses: filtered };
	return parsed.length > 0 ? { status: "not_found" } : { status: "error" };
}

export async function fetchEsvChapterVerses(
	apiKey: string,
	options: {
		bookEn: string;
		chapter: number;
		chaptersInBook: number;
	},
	fetcher: FetchLike = fetch,
): Promise<FetchEsvChapterResult> {
	const result = await fetchEsvHtmlVerses(apiKey, options, fetcher);
	return result.status === "not_found" ? { status: "error" } : result;
}

export function fetchEsvPassageVerses(
	apiKey: string,
	options: {
		bookEn: string;
		chapter: number;
		chaptersInBook: number;
		verseStart: number;
		verseEnd?: number;
	},
	fetcher: FetchLike = fetch,
): Promise<FetchEsvPassageResult> {
	return fetchEsvHtmlVerses(apiKey, options, fetcher);
}
