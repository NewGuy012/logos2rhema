import type { AudioTrackOption } from "../shared/types";
import { isSafeHttpsUrl } from "../shared/url";
import { cancelBody, fetchHeadersWithTimeout, type FetchLike } from "./http";

export const ESV_API_BASE = "https://api.esv.org/v3/passage";
const ESV_AUDIO_API_BASE = `${ESV_API_BASE}/audio/`;

export function esvAuthHeaders(apiKey: string, accept: string): Record<string, string> {
	return { Authorization: `Token ${apiKey}`, Accept: accept };
}

export function formatEsvPassageQuery(
	bookEn: string,
	chapter: number,
	chaptersInBook: number,
): string {
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

	let response: Response;
	try {
		response = await fetchHeadersWithTimeout(fetcher, endpoint, {
			headers: esvAuthHeaders(apiKey, "audio/mpeg, */*"),
			redirect: "manual",
		});
	} catch {
		return null;
	}

	if (response.status >= 300 && response.status < 400) {
		cancelBody(response);
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
		if (response.url && !response.url.startsWith(ESV_AUDIO_API_BASE)) {
			cancelBody(response);
			return isSafeEsvUrl(response.url, apiKey) ? { url: response.url } : null;
		}
		return { url: "", directStreamResponse: response };
	}

	cancelBody(response);
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

	if (!resolved.url) {
		cancelBody(resolved.directStreamResponse);
	}

	return {
		id: `esv-api:${options.usfm}:${options.chapter}`,
		label: "David Cochran Heath (ESV)",
		language: "en",
		url: resolved.url || `/api/audio/esv/${encodeURIComponent(options.usfm)}/${options.chapter}`,
	};
}
