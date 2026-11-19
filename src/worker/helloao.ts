import type { AudioTrackOption, TranslationLanguage } from "../shared/types";
import { fetchJson, type FetchLike, isSafeHttpsUrl } from "./http";

const HELLOAO_BASE = "https://bible.helloao.org/api";

interface HelloAoAudioPayload {
	thisChapterAudioLinks?: Record<string, string>;
	thisChapterAudioTimings?: Record<string, Record<string, number>>;
}

function formatReaderName(readerKey: string): string {
	return readerKey === "wordproject"
		? "Wordproject Reader"
		: readerKey.charAt(0).toUpperCase() + readerKey.slice(1);
}

export function extractHelloAoAudioTracks(
	payload: HelloAoAudioPayload,
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
		if (!url || !isSafeHttpsUrl(url)) continue;
		const rawTimings = timingsByReader[readerKey];
		let verseTimings: Record<number, number> | undefined;
		if (rawTimings && Object.keys(rawTimings).length > 0) {
			verseTimings = {};
			for (const [vStr, sec] of Object.entries(rawTimings)) {
				const vNum = Number.parseInt(vStr, 10);
				if (!Number.isNaN(vNum) && vNum >= 1 && typeof sec === "number" && Number.isFinite(sec)) {
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
			audioStyle: "standard",
			verseTimings,
			note: options.note,
		});
	}

	return tracks;
}

export function fetchHelloAoChapter(
	externalTranslationId: string,
	usfm: string,
	chapter: number,
	fetcher: FetchLike = fetch,
): Promise<HelloAoAudioPayload | null> {
	const url = `${HELLOAO_BASE}/${encodeURIComponent(externalTranslationId)}/${encodeURIComponent(usfm)}/${chapter}.json`;
	return fetchJson<HelloAoAudioPayload>(fetcher, url);
}
