import type { AudioTrackOption } from "../shared/types";
import type { FetchLike } from "./helloao";

const ESV_AUDIO_API_BASE = "https://api.esv.org/v3/passage/audio/";

export function formatEsvPassageQuery(
	bookEn: string,
	chapter: number,
	chaptersInBook: number,
): string {
	// Single-chapter books (Obadiah, Philemon, 2-3 John, Jude) need an explicit verse span
	// so "Jude 1" is never interpreted as verse 1 only.
	if (chaptersInBook === 1) {
		return `${bookEn} 1:1-99`;
	}
	return `${bookEn} ${chapter}`;
}

export async function resolveEsvAudioUrl(
	apiKey: string,
	options: {
		bookEn: string;
		chapter: number;
		chaptersInBook: number;
	},
	fetcher: FetchLike = fetch,
): Promise<{ url: string; directStreamResponse?: Response } | null> {
	const query = formatEsvPassageQuery(options.bookEn, options.chapter, options.chaptersInBook);
	const endpoint = `${ESV_AUDIO_API_BASE}?q=${encodeURIComponent(query)}`;

	const response = await fetcher(endpoint, {
		headers: {
			Authorization: `Token ${apiKey}`,
			Accept: "audio/mpeg, */*",
		},
		redirect: "manual",
	});

	// Crossway returns a 302 redirect to audio.esv.org with no key in the target URL.
	if (response.status >= 300 && response.status < 400) {
		const location = response.headers.get("location");
		if (!location) return null;
		const resolved = new URL(location, ESV_AUDIO_API_BASE);
		if (resolved.protocol !== "https:" || resolved.href.includes(apiKey)) {
			return null;
		}
		return { url: resolved.href };
	}

	if (response.ok) {
		// Defensive fallback if an upstream proxy already followed the redirect.
		if (
			response.url &&
			!response.url.startsWith(ESV_AUDIO_API_BASE) &&
			!response.url.includes(apiKey)
		) {
			return { url: response.url };
		}
		return { url: "", directStreamResponse: response };
	}

	return null;
}

export async function fetchEsvAudioTrack(
	apiKey: string,
	options: {
		usfm: string;
		bookEn: string;
		chapter: number;
		chaptersInBook: number;
	},
	fetcher: FetchLike = fetch,
): Promise<AudioTrackOption | null> {
	const resolved = await resolveEsvAudioUrl(apiKey, options, fetcher);
	if (!resolved) return null;

	if (!resolved.url && resolved.directStreamResponse?.body) {
		resolved.directStreamResponse.body.cancel().catch(() => {});
	}

	const trackUrl =
		resolved.url || `/api/audio/esv/${encodeURIComponent(options.usfm)}/${options.chapter}`;

	return {
		id: `esv-api:${options.usfm}:${options.chapter}`,
		label: "David Cochran Heath (ESV)",
		language: "en",
		translationId: "esv",
		url: trackUrl,
		source: "esv-api",
		note: "Official Crossway ESV audio",
	};
}
