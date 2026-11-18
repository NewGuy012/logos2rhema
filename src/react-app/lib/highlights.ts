import { BIBLE_BOOKS, getBookByNumber } from "../../shared/books";
import type { AlignedVerse, HighlightItem, HighlightLanguage } from "../../shared/types";

export const HIGHLIGHTS_STORAGE_KEY = "logos.reader.highlights.v1";

export interface SelectionHighlightSpan {
	verse: number;
	lang: HighlightLanguage;
	start: number;
	end: number;
	text: string;
}

export interface TextHighlightSegment {
	text: string;
	highlightId?: string;
}

export function makeHighlightId(
	bookNumber: number,
	chapter: number,
	verse: number,
	lang: HighlightLanguage,
	start: number,
	end: number,
): string {
	return `${bookNumber}:${chapter}:${verse}:${lang}:${start}-${end}`;
}

export function getVerseTextForLang(verse: AlignedVerse, lang: HighlightLanguage): string {
	if (lang === "en") return verse.enText ?? "";
	if (verse.tokens.length > 0) {
		return verse.tokens.map((t) => t.raw).join(" ");
	}
	return verse.koText ?? "";
}

function sameLine(
	a: Pick<HighlightItem, "bookNumber" | "chapter" | "verse" | "lang">,
	b: Pick<HighlightItem, "bookNumber" | "chapter" | "verse" | "lang">,
): boolean {
	return (
		a.bookNumber === b.bookNumber &&
		a.chapter === b.chapter &&
		a.verse === b.verse &&
		a.lang === b.lang
	);
}

export function readStoredHighlights(): HighlightItem[] {
	if (typeof localStorage === "undefined") return [];
	try {
		const raw = localStorage.getItem(HIGHLIGHTS_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const seen = new Set<string>();
		const items: HighlightItem[] = [];
		for (const entry of parsed) {
			if (!entry || typeof entry !== "object") continue;
			const rec = entry as Record<string, unknown>;
			const book = typeof rec.bookNumber === "number" ? getBookByNumber(rec.bookNumber) : undefined;
			if (!book) continue;
			if (
				typeof rec.chapter !== "number" ||
				!Number.isInteger(rec.chapter) ||
				rec.chapter < 1 ||
				rec.chapter > book.chapters
			) {
				continue;
			}
			if (typeof rec.verse !== "number" || !Number.isInteger(rec.verse) || rec.verse < 1) {
				continue;
			}
			if (rec.lang !== "en" && rec.lang !== "ko") continue;
			if (
				typeof rec.start !== "number" ||
				!Number.isInteger(rec.start) ||
				rec.start < 0 ||
				typeof rec.end !== "number" ||
				!Number.isInteger(rec.end) ||
				rec.end <= rec.start
			) {
				continue;
			}
			const text = typeof rec.text === "string" ? rec.text : "";
			if (!text.trim()) continue;
			const id = makeHighlightId(book.number, rec.chapter, rec.verse, rec.lang, rec.start, rec.end);
			if (seen.has(id)) continue;
			seen.add(id);
			items.push({
				id,
				bookNumber: book.number,
				chapter: rec.chapter,
				verse: rec.verse,
				lang: rec.lang,
				start: rec.start,
				end: rec.end,
				text,
				createdAt:
					typeof rec.createdAt === "number" && Number.isFinite(rec.createdAt) ? rec.createdAt : 0,
			});
		}
		return items;
	} catch {
		return [];
	}
}

export function writeStoredHighlights(items: readonly HighlightItem[]): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(HIGHLIGHTS_STORAGE_KEY, JSON.stringify(items));
	} catch {
		// Ignore storage quota errors
	}
}

function getSelectionRangeOffsetsInLine(
	lineEl: HTMLElement,
	selectionRange: Range,
): { start: number; end: number } | null {
	if (typeof document === "undefined") return null;
	const RangeCtor = typeof window !== "undefined" ? window.Range : undefined;
	const START_TO_START = RangeCtor?.START_TO_START ?? 0;
	const START_TO_END = RangeCtor?.START_TO_END ?? 1;
	const END_TO_END = RangeCtor?.END_TO_END ?? 2;
	const END_TO_START = RangeCtor?.END_TO_START ?? 3;

	const lineRange = document.createRange();
	lineRange.selectNodeContents(lineEl);

	if (
		selectionRange.compareBoundaryPoints(END_TO_START, lineRange) >= 0 ||
		selectionRange.compareBoundaryPoints(START_TO_END, lineRange) <= 0
	) {
		return null;
	}

	const startBeforeLine = selectionRange.compareBoundaryPoints(START_TO_START, lineRange) <= 0;
	const endAfterLine = selectionRange.compareBoundaryPoints(END_TO_END, lineRange) >= 0;

	const startContainer = startBeforeLine ? lineRange.startContainer : selectionRange.startContainer;
	const startOffset = startBeforeLine ? lineRange.startOffset : selectionRange.startOffset;
	const endContainer = endAfterLine ? lineRange.endContainer : selectionRange.endContainer;
	const endOffset = endAfterLine ? lineRange.endOffset : selectionRange.endOffset;

	const preRange = document.createRange();
	preRange.setStart(lineEl, 0);
	preRange.setEnd(startContainer, startOffset);
	const start = preRange.toString().length;

	const selectedRange = document.createRange();
	selectedRange.setStart(startContainer, startOffset);
	selectedRange.setEnd(endContainer, endOffset);
	const end = start + selectedRange.toString().length;

	if (end <= start) return null;
	return { start, end };
}

export function extractVerseSelectionSpans(
	selection: Selection | null,
	rootEl?: ParentNode | null,
): SelectionHighlightSpan[] {
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
	const range = selection.getRangeAt(0);
	const scope = rootEl ?? (typeof document !== "undefined" ? document : null);
	if (!scope) return [];

	const lineEls = Array.from(scope.querySelectorAll<HTMLElement>("[data-verse][data-lang]"));
	const spans: SelectionHighlightSpan[] = [];

	for (const lineEl of lineEls) {
		const verseNum = Number.parseInt(lineEl.dataset.verse ?? "", 10);
		const lang = lineEl.dataset.lang;
		if (Number.isNaN(verseNum) || verseNum < 1 || (lang !== "en" && lang !== "ko")) continue;

		const offsets = getSelectionRangeOffsetsInLine(lineEl, range);
		if (!offsets) continue;

		const lineText = lineEl.textContent ?? "";
		const rawSlice = lineText.slice(offsets.start, offsets.end);
		const leadingWs = rawSlice.length - rawSlice.trimStart().length;
		const trailingWs = rawSlice.length - rawSlice.trimEnd().length;
		const start = offsets.start + leadingWs;
		const end = offsets.end - trailingWs;
		if (end <= start) continue;

		spans.push({
			verse: verseNum,
			lang,
			start,
			end,
			text: lineText.slice(start, end),
		});
	}

	return spans;
}

function isRangeCovered(highlights: readonly HighlightItem[], start: number, end: number): boolean {
	if (end <= start) return false;
	const sorted = [...highlights].sort((a, b) => a.start - b.start);
	let coveredUntil = start;
	for (const h of sorted) {
		if (h.end <= coveredUntil) continue;
		if (h.start > coveredUntil) return false;
		coveredUntil = Math.max(coveredUntil, h.end);
		if (coveredUntil >= end) return true;
	}
	return coveredUntil >= end;
}

export function areSpansHighlighted(
	items: readonly HighlightItem[],
	bookNumber: number,
	chapter: number,
	spans: readonly SelectionHighlightSpan[],
): boolean {
	if (spans.length === 0) return false;
	return spans.every((span) => {
		const lineHighlights = items.filter((item) =>
			sameLine(item, { bookNumber, chapter, verse: span.verse, lang: span.lang }),
		);
		return isRangeCovered(lineHighlights, span.start, span.end);
	});
}

export function toggleHighlightSpans(
	items: readonly HighlightItem[],
	bookNumber: number,
	chapter: number,
	spans: readonly SelectionHighlightSpan[],
	getVerseText: (verse: number, lang: HighlightLanguage) => string,
): { next: HighlightItem[]; action: "added" | "removed" | "noop" } {
	if (spans.length === 0) return { next: [...items], action: "noop" };

	if (areSpansHighlighted(items, bookNumber, chapter, spans)) {
		let next = [...items];
		for (const span of spans) {
			const updated: HighlightItem[] = [];
			const verseText = getVerseText(span.verse, span.lang);
			for (const item of next) {
				if (
					!sameLine(item, { bookNumber, chapter, verse: span.verse, lang: span.lang }) ||
					item.end <= span.start ||
					item.start >= span.end
				) {
					updated.push(item);
					continue;
				}
				if (item.start < span.start) {
					const leftText = verseText
						? verseText.slice(item.start, span.start)
						: item.text.slice(0, span.start - item.start);
					if (leftText.trim()) {
						updated.push({
							...item,
							id: makeHighlightId(
								bookNumber,
								chapter,
								span.verse,
								span.lang,
								item.start,
								span.start,
							),
							end: span.start,
							text: leftText,
						});
					}
				}
				if (item.end > span.end) {
					const rightText = verseText
						? verseText.slice(span.end, item.end)
						: item.text.slice(span.end - item.start);
					if (rightText.trim()) {
						updated.push({
							...item,
							id: makeHighlightId(bookNumber, chapter, span.verse, span.lang, span.end, item.end),
							start: span.end,
							text: rightText,
						});
					}
				}
			}
			next = updated;
		}
		return { next, action: "removed" };
	}

	const now = Date.now();
	let next = [...items];
	const added: HighlightItem[] = [];

	for (const span of spans) {
		const target = { bookNumber, chapter, verse: span.verse, lang: span.lang };
		const overlapping = next.filter(
			(item) => sameLine(item, target) && item.start <= span.end && item.end >= span.start,
		);
		const remaining = next.filter(
			(item) => !(sameLine(item, target) && item.start <= span.end && item.end >= span.start),
		);
		const mergedStart = Math.min(span.start, ...overlapping.map((h) => h.start));
		const mergedEnd = Math.max(span.end, ...overlapping.map((h) => h.end));
		const verseText = getVerseText(span.verse, span.lang);
		const mergedText = verseText ? verseText.slice(mergedStart, mergedEnd) : span.text;

		added.push({
			id: makeHighlightId(bookNumber, chapter, span.verse, span.lang, mergedStart, mergedEnd),
			bookNumber,
			chapter,
			verse: span.verse,
			lang: span.lang,
			start: mergedStart,
			end: mergedEnd,
			text: mergedText,
			createdAt: now,
		});
		next = remaining;
	}

	return { next: [...added, ...next], action: "added" };
}

export function splitTextByHighlights(
	text: string,
	baseOffset: number,
	highlights: readonly HighlightItem[],
): TextHighlightSegment[] {
	if (!text) return [];
	if (highlights.length === 0) return [{ text }];

	const segEnd = baseOffset + text.length;
	const segments: TextHighlightSegment[] = [];
	let cursor = baseOffset;

	for (const h of highlights) {
		if (h.end <= cursor) continue;
		if (h.start >= segEnd) break;

		const overlapStart = Math.max(cursor, h.start);
		const overlapEnd = Math.min(segEnd, h.end);

		if (overlapStart > cursor) {
			segments.push({ text: text.slice(cursor - baseOffset, overlapStart - baseOffset) });
		}
		if (overlapEnd > overlapStart) {
			segments.push({
				text: text.slice(overlapStart - baseOffset, overlapEnd - baseOffset),
				highlightId: h.id,
			});
		}
		cursor = overlapEnd;
	}

	if (cursor < segEnd) {
		segments.push({ text: text.slice(cursor - baseOffset) });
	}
	return segments;
}

export function formatHighlightLabel(item: HighlightItem): {
	refEn: string;
	refKo: string;
	langLabel: string;
} {
	const book = getBookByNumber(item.bookNumber) ?? BIBLE_BOOKS[0];
	return {
		refEn: `${book.en} ${item.chapter}:${item.verse}`,
		refKo: `${book.ko} ${item.chapter}장 ${item.verse}절`,
		langLabel: item.lang === "ko" ? "한" : "EN",
	};
}
