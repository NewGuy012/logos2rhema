import type { VerseEntry } from "../shared/types";
import { formatEsvPassageQuery } from "./esv-audio";
import { cancelBody, type FetchLike, fetchWithTimeout, readJsonWithLimit } from "./http";

const ESV_HTML_API_BASE = "https://api.esv.org/v3/passage/html/";
const MAX_ESV_HTML_BYTES = 512 * 1024;

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

type TagRole = "skip" | "heading" | "verse-num" | "small-caps" | "selah" | "block" | "inline";

export type FetchEsvChapterResult =
	{ status: "ok"; verses: VerseEntry[] } | { status: "rate_limited" } | { status: "error" };

export function decodeHtmlEntities(input: string): string {
	return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
		if (entity.startsWith("#x") || entity.startsWith("#X")) {
			const codePoint = Number.parseInt(entity.slice(2), 16);
			if (
				Number.isInteger(codePoint) &&
				codePoint >= 0 &&
				codePoint <= 0x10ffff &&
				!(codePoint >= 0xd800 && codePoint <= 0xdfff)
			) {
				return String.fromCodePoint(codePoint);
			}
			return match;
		}
		if (entity.startsWith("#")) {
			const codePoint = Number.parseInt(entity.slice(1), 10);
			if (
				Number.isInteger(codePoint) &&
				codePoint >= 0 &&
				codePoint <= 0x10ffff &&
				!(codePoint >= 0xd800 && codePoint <= 0xdfff)
			) {
				return String.fromCodePoint(codePoint);
			}
			return match;
		}
		return NAMED_HTML_ENTITIES[entity.toLowerCase()] ?? match;
	});
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
	if (
		tagName === "h3" ||
		tagName === "h4" ||
		classes.has("subheading") ||
		classes.has("psalm-title") ||
		classes.has("psalm-acrostic-title") ||
		classes.has("speaker")
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

	let skipDepth = 0;
	let headingDepth = 0;
	let verseNumDepth = 0;
	let smallCapsDepth = 0;

	let pendingHeadings: string[] = [];
	let headingBuffer = "";
	let verseNumBuffer = "";
	let currentVerse: number | null = null;
	let currentVerseHeadings: string[] = [];
	let verseBuffer = "";

	const adjustDepth = (role: TagRole, delta: 1 | -1) => {
		if (role === "skip") skipDepth += delta;
		else if (role === "heading") headingDepth += delta;
		else if (role === "verse-num") verseNumDepth += delta;
		else if (role === "small-caps") smallCapsDepth += delta;
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

	const tokenRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z0-9]+)\b([^>]*)>|([^<]+)/g;
	for (const match of html.matchAll(tokenRe)) {
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

			if (!isSelfClosing) {
				stack.push({ tag: tagName, role });
				adjustDepth(role, 1);
			}

			if (skipDepth > 0) continue;

			if (role === "verse-num" && !isSelfClosing) {
				verseNumBuffer = "";
			} else if (role === "heading" && headingDepth === 1) {
				headingBuffer = "";
			} else if (
				role === "selah" &&
				currentVerse !== null &&
				verseBuffer &&
				!/\s$/.test(verseBuffer)
			) {
				verseBuffer += " ";
			} else if (role === "block") {
				if (headingDepth > 0) headingBuffer += " ";
				else if (currentVerse !== null) verseBuffer += " ";
			}
			continue;
		}

		if (VOID_HTML_TAGS.has(tagName)) continue;

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
					currentVerseHeadings = pendingHeadings;
					pendingHeadings = [];
				}
			} else if (popped.role === "heading" && headingDepth === 0) {
				const heading = normalizeText(headingBuffer);
				headingBuffer = "";
				if (heading) {
					pendingHeadings.push(heading);
				}
			} else if (popped.role === "block" && skipDepth === 0) {
				if (headingDepth > 0) headingBuffer += " ";
				else if (currentVerse !== null) verseBuffer += " ";
			}
		}
	}

	flushCurrentVerse();
	return verses;
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
	const query = formatEsvPassageQuery(options.bookEn, options.chapter, options.chaptersInBook);
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

	try {
		const response = await fetchWithTimeout(fetcher, endpoint, {
			headers: {
				Authorization: `Token ${apiKey}`,
				Accept: "application/json",
			},
			redirect: "error",
		});

		if (response.status === 429) {
			cancelBody(response);
			return { status: "rate_limited" };
		}
		if (!response.ok) {
			cancelBody(response);
			return { status: "error" };
		}

		const payload = await readJsonWithLimit(response, MAX_ESV_HTML_BYTES);
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			return { status: "error" };
		}

		const rawPassages = (payload as { passages?: unknown }).passages;
		if (!Array.isArray(rawPassages)) {
			return { status: "error" };
		}

		const html = rawPassages.filter((p): p is string => typeof p === "string").join("\n");
		const verses = parseEsvPassageHtml(html);
		if (verses.length === 0) {
			return { status: "error" };
		}

		return { status: "ok", verses };
	} catch {
		return { status: "error" };
	}
}
