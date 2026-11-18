import type { AudioTrackOption, TranslationLanguage, VerseEntry } from "../shared/types";

const HELLOAO_BASE = "https://bible.helloao.org/api";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface HelloAoContentText {
	text?: string;
	noteId?: number;
	lineBreak?: boolean;
}

export type HelloAoContentPiece = string | HelloAoContentText;

export interface HelloAoChapterNode {
	type: "heading" | "line_break" | "verse" | "hebrew_subtitle";
	number?: number;
	content?: HelloAoContentPiece[];
}

export interface HelloAoChapterPayload {
	translation?: {
		id: string;
		name: string;
		shortName: string;
	};
	chapter?: {
		number: number;
		content: HelloAoChapterNode[];
	};
	thisChapterAudioLinks?: Record<string, string>;
	thisChapterAudioTimings?: Record<string, Record<string, number>>;
}

function flattenContentPieces(pieces: HelloAoContentPiece[] = []): string {
	const chunks: string[] = [];
	for (const piece of pieces) {
		if (typeof piece === "string") {
			chunks.push(piece);
		} else if (piece && typeof piece === "object") {
			if (typeof piece.text === "string") {
				chunks.push(piece.text);
			} else if (piece.lineBreak) {
				chunks.push(" ");
			}
		}
	}
	return chunks
		.join(" ")
		.replace(/\s+([,.;:!?])/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

export function parseHelloAoVerses(payload: HelloAoChapterPayload): VerseEntry[] {
	const nodes = payload.chapter?.content ?? [];
	const verses: VerseEntry[] = [];
	let pendingHeading: string | undefined;

	for (const node of nodes) {
		if (node.type === "heading" || node.type === "hebrew_subtitle") {
			const headingText = flattenContentPieces(node.content);
			if (headingText) {
				pendingHeading = pendingHeading ? `${pendingHeading} — ${headingText}` : headingText;
			}
			continue;
		}

		if (node.type === "verse" && typeof node.number === "number") {
			const text = flattenContentPieces(node.content);
			if (!text) continue;
			const entry: VerseEntry = pendingHeading
				? { verse: node.number, text, heading: pendingHeading }
				: { verse: node.number, text };
			verses.push(entry);
			pendingHeading = undefined;
		}
	}

	return verses;
}

function formatReaderName(readerKey: string): string {
	if (readerKey === "wordproject") return "Wordproject Reader";
	return readerKey.charAt(0).toUpperCase() + readerKey.slice(1);
}

export function extractHelloAoAudioTracks(
	payload: HelloAoChapterPayload,
	options: {
		translationId: string;
		language: TranslationLanguage;
		note?: string;
	},
): AudioTrackOption[] {
	const links = payload.thisChapterAudioLinks ?? {};
	const timingsByReader = payload.thisChapterAudioTimings ?? {};
	const tracks: AudioTrackOption[] = [];

	for (const [readerKey, url] of Object.entries(links)) {
		if (!url) continue;
		const rawTimings = timingsByReader[readerKey];
		let verseTimings: Record<number, number> | undefined;
		if (rawTimings && Object.keys(rawTimings).length > 0) {
			verseTimings = {};
			for (const [vStr, sec] of Object.entries(rawTimings)) {
				const vNum = Number.parseInt(vStr, 10);
				if (!Number.isNaN(vNum) && typeof sec === "number") {
					verseTimings[vNum] = sec;
				}
			}
		}

		tracks.push({
			id: `helloao:${options.translationId}:${readerKey}`,
			label: `${formatReaderName(readerKey)} (${options.translationId.toUpperCase()})`,
			language: options.language,
			translationId: options.translationId,
			url,
			source: "helloao",
			verseTimings,
			note: options.note,
		});
	}

	return tracks;
}

export async function fetchHelloAoChapter(
	externalTranslationId: string,
	usfm: string,
	chapter: number,
	fetcher: FetchLike = fetch,
): Promise<HelloAoChapterPayload | null> {
	const url = `${HELLOAO_BASE}/${encodeURIComponent(externalTranslationId)}/${encodeURIComponent(usfm)}/${chapter}.json`;
	const response = await fetcher(url, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		return null;
	}
	return (await response.json()) as HelloAoChapterPayload;
}
