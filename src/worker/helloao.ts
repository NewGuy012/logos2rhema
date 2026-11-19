import type { ChapterCommentaryResponse, CommentaryEntry, CommentaryId } from "../shared/types";
import { type FetchLike, fetchWithTimeout } from "./http";

const HELLOAO_BASE = "https://bible.helloao.org/api";
const MAX_TEXT_DEPTH = 20;

interface HelloAoCommentaryPayload {
	book?: {
		introduction?: unknown;
		introductionSummary?: unknown;
	};
	chapter?: {
		number?: unknown;
		introduction?: unknown;
		content?: unknown;
	};
}

function extractPlainText(node: unknown, depth = 0): string {
	if (depth > MAX_TEXT_DEPTH) return "";
	if (typeof node === "string") return node;
	if (Array.isArray(node)) {
		return node.map((child) => extractPlainText(child, depth + 1)).join("");
	}
	if (node && typeof node === "object") {
		const record = node as Record<string, unknown>;
		if (record.lineBreak === true) return "\n";
		if (typeof record.text === "string") return record.text;
		if (Array.isArray(record.content)) {
			const inner = extractPlainText(record.content, depth + 1);
			return record.type === "paragraph" ? `${inner}\n` : inner;
		}
	}
	return "";
}

function pushLines(target: string[], raw: string): void {
	for (const line of raw.replace(/\r\n?/g, "\n").split(/\n+/)) {
		const cleaned = line.replace(/[ \t]+/g, " ").trim();
		if (cleaned) target.push(cleaned);
	}
}

function splitParagraphs(raw: unknown): string[] {
	const paragraphs: string[] = [];
	if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
		for (const item of raw) {
			pushLines(paragraphs, item);
		}
		return paragraphs;
	}
	pushLines(paragraphs, extractPlainText(raw));
	return paragraphs;
}

function parsePositiveVerse(raw: unknown): number | null {
	if (typeof raw === "number") {
		return Number.isInteger(raw) && raw >= 1 ? raw : null;
	}
	if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
		const num = Number.parseInt(raw.trim(), 10);
		return num >= 1 ? num : null;
	}
	return null;
}

function normalizeHelloAoCommentary(
	payload: HelloAoCommentaryPayload,
	commentaryId: CommentaryId,
	usfm: string,
	chapter: number,
): ChapterCommentaryResponse {
	const bookIntroduction = [
		...splitParagraphs(payload.book?.introductionSummary),
		...splitParagraphs(payload.book?.introduction),
	];
	const chapterIntroduction = splitParagraphs(payload.chapter?.introduction);

	const rawContent = Array.isArray(payload.chapter?.content) ? payload.chapter.content : [];
	const entries: CommentaryEntry[] = [];
	const usedIds = new Set<string>();
	let pendingHeading: string | undefined;

	for (const rawItem of rawContent) {
		if (!rawItem || typeof rawItem !== "object") continue;
		const item = rawItem as Record<string, unknown>;
		const itemType = item.type;

		if (itemType === "heading") {
			const headingText = splitParagraphs(item.content ?? item.text).join(" ");
			if (headingText) pendingHeading = headingText;
			continue;
		}

		if (itemType === "introduction") {
			chapterIntroduction.push(...splitParagraphs(item.content ?? item.text));
			continue;
		}

		if (itemType !== "verse" && itemType !== "verse_commentary") continue;

		const verseStart = parsePositiveVerse(item.verse_start ?? item.number);
		if (verseStart === null) continue;

		const rawEnd = parsePositiveVerse(item.verse_end);
		const verseEnd = rawEnd !== null && rawEnd > verseStart ? rawEnd : undefined;
		const paragraphs = splitParagraphs(item.content ?? item.text);
		if (paragraphs.length === 0) continue;

		let id = `${commentaryId}:${usfm}:${chapter}:${verseStart}`;
		let suffix = 2;
		while (usedIds.has(id)) {
			id = `${commentaryId}:${usfm}:${chapter}:${verseStart}-${suffix++}`;
		}
		usedIds.add(id);

		entries.push({
			id,
			verseStart,
			...(verseEnd ? { verseEnd } : {}),
			...(pendingHeading ? { heading: pendingHeading } : {}),
			paragraphs,
		});
		pendingHeading = undefined;
	}

	entries.sort((a, b) => a.verseStart - b.verseStart);

	const tyndaleRangeRe = new RegExp(`^${chapter}:(\\d+)[-–](\\d+)\\b`);
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.verseEnd !== undefined) continue;
		const nextEntry = entries[i + 1];

		if (commentaryId === "matthew-henry") {
			if (nextEntry && nextEntry.verseStart > entry.verseStart + 1) {
				entry.verseEnd = nextEntry.verseStart - 1;
			}
		} else if (commentaryId === "tyndale" && entry.paragraphs.length === 1) {
			const match = entry.paragraphs[0].match(tyndaleRangeRe);
			if (match) {
				const rangeStart = Number.parseInt(match[1], 10);
				const rangeEnd = Number.parseInt(match[2], 10);
				if (
					rangeStart === entry.verseStart &&
					rangeEnd > entry.verseStart &&
					(!nextEntry || rangeEnd < nextEntry.verseStart)
				) {
					entry.verseEnd = rangeEnd;
				}
			}
		}
	}

	return {
		...(bookIntroduction.length > 0 ? { bookIntroduction } : {}),
		...(chapterIntroduction.length > 0 ? { introduction: chapterIntroduction } : {}),
		entries,
	};
}

export async function fetchHelloAoCommentaryChapter(
	commentaryId: CommentaryId,
	usfm: string,
	chapter: number,
	fetcher: FetchLike = fetch,
): Promise<{ status: "ok" | "empty"; data: ChapterCommentaryResponse } | { status: "error" }> {
	const url = `${HELLOAO_BASE}/c/${encodeURIComponent(commentaryId)}/${encodeURIComponent(usfm)}/${chapter}.json`;

	try {
		const response = await fetchWithTimeout(fetcher, url, {
			headers: { Accept: "application/json" },
		});
		if (response.status === 404) {
			response.body?.cancel?.().catch(() => {});
			return {
				status: "empty",
				data: normalizeHelloAoCommentary({}, commentaryId, usfm, chapter),
			};
		}
		if (!response.ok) {
			response.body?.cancel?.().catch(() => {});
			return { status: "error" };
		}
		const payload = (await response.json()) as unknown;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			return { status: "error" };
		}
		return {
			status: "ok",
			data: normalizeHelloAoCommentary(
				payload as HelloAoCommentaryPayload,
				commentaryId,
				usfm,
				chapter,
			),
		};
	} catch {
		return { status: "error" };
	}
}
