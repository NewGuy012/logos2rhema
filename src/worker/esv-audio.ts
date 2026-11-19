import type { AudioTrackOption } from "../shared/types";
import { type FetchLike, fetchWithTimeout, isSafeHttpsUrl } from "./http";

const ESV_AUDIO_API_BASE = "https://api.esv.org/v3/passage/audio/";

function formatEsvPassageQuery(bookEn: string, chapter: number, chaptersInBook: number): string {
	// Single-chapter books need an explicit span so "Jude 1" isn't treated as verse 1 only.
	return chaptersInBook === 1 ? `${bookEn} 1:1-99` : `${bookEn} ${chapter}`;
}

function isSafeEsvUrl(url: string, apiKey: string): boolean {
	return isSafeHttpsUrl(url, {
		allowedHostSuffix: ".esv.org",
		forbiddenSubstring: apiKey,
	});
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

	const response = await fetchWithTimeout(fetcher, endpoint, {
		headers: {
			Authorization: `Token ${apiKey}`,
			Accept: "audio/mpeg, */*",
		},
		redirect: "manual",
	});

	if (response.status >= 300 && response.status < 400) {
		response.body?.cancel?.().catch(() => {});
		const location = response.headers.get("location");
		if (!location) return null;
		try {
			const resolved = new URL(location, ESV_AUDIO_API_BASE);
			return isSafeEsvUrl(resolved.href, apiKey) ? { url: resolved.href } : null;
		} catch {
			return null;
		}
	}

	if (response.ok) {
		if (
			response.url &&
			!response.url.startsWith(ESV_AUDIO_API_BASE) &&
			isSafeEsvUrl(response.url, apiKey)
		) {
			response.body?.cancel?.().catch(() => {});
			return { url: response.url };
		}
		return { url: "", directStreamResponse: response };
	}

	response.body?.cancel?.().catch(() => {});
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

	return {
		id: `esv-api:${options.usfm}:${options.chapter}`,
		label: "David Cochran Heath (ESV)",
		language: "en",
		translationId: "esv",
		url: resolved.url || `/api/audio/esv/${encodeURIComponent(options.usfm)}/${options.chapter}`,
		source: "esv-api",
		note: "Official Crossway ESV audio",
	};
}
