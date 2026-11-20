import type { AlignedVerse, HighlightItem, TranslationLanguage } from "../../shared/types";
import {
	finiteTimestamp,
	formatBilingualRef,
	MAX_STORED_ITEMS,
	readStoredCollection,
	writeJsonStorage,
} from "./storage";

export const HIGHLIGHTS_STORAGE_KEY = "logos.reader.highlights.v1";
export const MAX_EN_HIGHLIGHTS = 100;
export const MAX_EN_HIGHLIGHT_TEXT_LEN = 160;
const MAX_HIGHLIGHT_TEXT_LEN = 500;
const MAX_HIGHLIGHT_OFFSET = 4000;

function maxHighlightTextLen(lang: TranslationLanguage): number {
	return lang === "en" ? MAX_EN_HIGHLIGHT_TEXT_LEN : MAX_HIGHLIGHT_TEXT_LEN;
}

function capStoredHighlights(items: readonly HighlightItem[]): HighlightItem[] {
	const normalized = items.map((item) => {
		const maxLen = maxHighlightTextLen(item.lang);
		return item.text.length > maxLen ? { ...item, text: item.text.slice(0, maxLen) } : item;
	});
	const enEntries = normalized
		.map((item, index) => ({ item, index }))
		.filter((entry) => entry.item.lang === "en");

	let filtered = normalized;
	if (enEntries.length > MAX_EN_HIGHLIGHTS) {
		enEntries.sort((a, b) => b.item.createdAt - a.item.createdAt || a.index - b.index);
		const keepIndices = new Set(enEntries.slice(0, MAX_EN_HIGHLIGHTS).map((e) => e.index));
		filtered = normalized.filter((item, idx) => item.lang !== "en" || keepIndices.has(idx));
	}

	return filtered.slice(0, MAX_STORED_ITEMS);
}

interface SelectionHighlightSpan {
	verse: number;
	lang: TranslationLanguage;
	start: number;
	end: number;
	text: string;
}

interface TextHighlightSegment {
	text: string;
	highlightId?: string;
}

function makeHighlightId(
	bookNumber: number,
	chapter: number,
	verse: number,
	lang: TranslationLanguage,
	start: number,
	end: number,
): string {
	return `${bookNumber}:${chapter}:${verse}:${lang}:${start}-${end}`;
}

export function getVerseTextForLang(verse: AlignedVerse, lang: TranslationLanguage): string {
	if (lang === "en") return verse.enText ?? "";
	return verse.tokens.length > 0 ? verse.tokens.map((t) => t.raw).join(" ") : (verse.koText ?? "");
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
	const parsed = readStoredCollection<HighlightItem>(
		HIGHLIGHTS_STORAGE_KEY,
		(rec, bookNumber, chapter) => {
			if (typeof rec.verse !== "number" || !Number.isInteger(rec.verse) || rec.verse < 1) {
				return null;
			}
			if (rec.lang !== "en" && rec.lang !== "ko") return null;
			if (
				typeof rec.start !== "number" ||
				!Number.isInteger(rec.start) ||
				rec.start < 0 ||
				typeof rec.end !== "number" ||
				!Number.isInteger(rec.end) ||
				rec.end <= rec.start ||
				rec.end > MAX_HIGHLIGHT_OFFSET
			) {
				return null;
			}
			const rawText =
				typeof rec.text === "string" ? rec.text.slice(0, maxHighlightTextLen(rec.lang)) : "";
			if (!rawText.trim()) return null;
			return {
				id: makeHighlightId(bookNumber, chapter, rec.verse, rec.lang, rec.start, rec.end),
				bookNumber,
				chapter,
				verse: rec.verse,
				lang: rec.lang,
				start: rec.start,
				end: rec.end,
				text: rawText,
				createdAt: finiteTimestamp(rec.createdAt),
			};
		},
	);
	return capStoredHighlights(parsed);
}

export function writeStoredHighlights(items: readonly HighlightItem[]): void {
	writeJsonStorage(HIGHLIGHTS_STORAGE_KEY, capStoredHighlights(items));
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

	try {
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
		const startContainer = startBeforeLine
			? lineRange.startContainer
			: selectionRange.startContainer;
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

		return end > start ? { start, end } : null;
	} catch {
		return null;
	}
}

export function extractVerseSelectionSpans(
	selection: Selection | null,
	rootEl?: ParentNode | null,
): SelectionHighlightSpan[] {
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
	const range = selection.getRangeAt(0);
	const scope = rootEl ?? (typeof document !== "undefined" ? document : null);
	if (!scope) return [];

	const spans: SelectionHighlightSpan[] = [];
	for (const lineEl of scope.querySelectorAll<HTMLElement>("[data-verse][data-lang]")) {
		const verseNum = Number.parseInt(lineEl.dataset.verse ?? "", 10);
		const lang = lineEl.dataset.lang;
		if (Number.isNaN(verseNum) || verseNum < 1 || (lang !== "en" && lang !== "ko")) continue;

		const offsets = getSelectionRangeOffsetsInLine(lineEl, range);
		if (!offsets) continue;

		const lineText = lineEl.textContent ?? "";
		const rawSlice = lineText.slice(offsets.start, offsets.end);
		const start = offsets.start + (rawSlice.length - rawSlice.trimStart().length);
		const end = offsets.end - (rawSlice.length - rawSlice.trimEnd().length);
		if (end <= start) continue;

		spans.push({
			verse: verseNum,
			lang,
			start,
			end,
			text: lineText.slice(start, end).slice(0, maxHighlightTextLen(lang)),
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
	return spans.every((span) =>
		isRangeCovered(
			items.filter((item) =>
				sameLine(item, { bookNumber, chapter, verse: span.verse, lang: span.lang }),
			),
			span.start,
			span.end,
		),
	);
}

export function toggleHighlightSpans(
	items: readonly HighlightItem[],
	bookNumber: number,
	chapter: number,
	spans: readonly SelectionHighlightSpan[],
	getVerseText: (verse: number, lang: TranslationLanguage) => string,
): { next: HighlightItem[]; action: "added" | "removed" | "noop" } {
	if (spans.length === 0) return { next: [...items], action: "noop" };

	if (areSpansHighlighted(items, bookNumber, chapter, spans)) {
		let next = [...items];
		for (const span of spans) {
			const updated: HighlightItem[] = [];
			const verseText = getVerseText(span.verse, span.lang);
			const target = { bookNumber, chapter, verse: span.verse, lang: span.lang };
			for (const item of next) {
				if (!sameLine(item, target) || item.end <= span.start || item.start >= span.end) {
					updated.push(item);
					continue;
				}
				const pushSlice = (sliceStart: number, sliceEnd: number, sliceText: string) => {
					if (!sliceText.trim()) return;
					updated.push({
						...item,
						id: makeHighlightId(bookNumber, chapter, span.verse, span.lang, sliceStart, sliceEnd),
						start: sliceStart,
						end: sliceEnd,
						text: sliceText.slice(0, maxHighlightTextLen(span.lang)),
					});
				};
				if (item.start < span.start) {
					pushSlice(
						item.start,
						span.start,
						verseText
							? verseText.slice(item.start, span.start)
							: item.text.slice(0, span.start - item.start),
					);
				}
				if (item.end > span.end) {
					pushSlice(
						span.end,
						item.end,
						verseText
							? verseText.slice(span.end, item.end)
							: item.text.slice(span.end - item.start),
					);
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
		const overlapping: HighlightItem[] = [];
		const remaining: HighlightItem[] = [];
		for (const item of next) {
			if (sameLine(item, target) && item.start <= span.end && item.end >= span.start) {
				overlapping.push(item);
			} else {
				remaining.push(item);
			}
		}
		const mergedStart = Math.min(span.start, ...overlapping.map((h) => h.start));
		const mergedEnd = Math.max(span.end, ...overlapping.map((h) => h.end));
		const verseText = getVerseText(span.verse, span.lang);
		const mergedText = (verseText ? verseText.slice(mergedStart, mergedEnd) : span.text).slice(
			0,
			maxHighlightTextLen(span.lang),
		);

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

	return { next: capStoredHighlights([...added, ...next]), action: "added" };
}

export function splitTextByHighlights(
	text: string,
	baseOffset: number,
	highlights: readonly HighlightItem[],
): TextHighlightSegment[] {
	if (!text) return [];
	if (highlights.length === 0) return [{ text }];

	const ordered =
		highlights.length > 1 ? [...highlights].sort((a, b) => a.start - b.start) : highlights;
	const segEnd = baseOffset + text.length;
	const segments: TextHighlightSegment[] = [];
	let cursor = baseOffset;

	for (const h of ordered) {
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
	return {
		...formatBilingualRef(item.bookNumber, item.chapter, item.verse),
		langLabel: item.lang === "ko" ? "한" : "EN",
	};
}
