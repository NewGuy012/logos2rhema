import type { AudioStyle, AudioTrackOption, Testament, VerseEntry } from "../shared/types";
import { type FetchLike, fetchWithTimeout, isSafeHttpsUrl } from "./http";

const BIBLE_BRAIN_BASE = "https://4.dbt.io/api";
const CATALOG_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CATALOG_CACHE_ENTRIES = 100;

export interface BibleBrainFileset {
	id: string;
	type?: string;
	set_type_code?: string;
	size?: string;
	set_size_code?: string;
	codec?: string;
	container?: string;
	segmentation_type?: "section" | "chapter" | null;
}

export interface BibleBrainBibleItem {
	abbr: string;
	name: string;
	vname?: string;
	language_iso?: string;
	iso?: string;
	filesets?: Record<string, BibleBrainFileset[]> | BibleBrainFileset[];
}

export interface BibleBrainLanguageItem {
	id: number;
	name: string;
	iso: string;
	autonym?: string | null;
	bibles?: number;
}

export interface BibleBrainPagination {
	total: number;
	count: number;
	per_page: number;
	current_page: number;
	total_pages: number;
}

interface BibleBrainVersesResponse {
	data?: Array<{
		verse_start?: number | string;
		verse_sequence?: number;
		verse_text?: string;
		path?: string;
	}>;
}

interface BibleBrainTimestampsResponse {
	data?: Array<{
		verse_start?: number | string;
		verse_sequence?: number;
		verse_end?: number | string;
		timestamp?: number | string;
	}>;
}

export interface ResolvedAudioFileset {
	filesetId: string;
	audioStyle: AudioStyle;
	bibleAbbr: string;
	bibleName: string;
}

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

const catalogCache = new Map<string, CacheEntry<BibleBrainBibleItem[]>>();

export function clearBibleBrainCache(): void {
	catalogCache.clear();
}

function getAllFilesets(item: BibleBrainBibleItem): BibleBrainFileset[] {
	if (!item.filesets) return [];
	return Array.isArray(item.filesets) ? item.filesets : Object.values(item.filesets).flat();
}

function getFilesetType(fileset: BibleBrainFileset): string {
	return fileset.type ?? fileset.set_type_code ?? "";
}

function getFilesetSize(fileset: BibleBrainFileset): string {
	return (fileset.size ?? fileset.set_size_code ?? "").toUpperCase();
}

function isDirectAudioFileset(fileset: BibleBrainFileset): boolean {
	const filesetType = getFilesetType(fileset);
	if (filesetType !== "audio" && filesetType !== "audio_drama") {
		return false;
	}
	if (fileset.id.toLowerCase().includes("opus")) {
		return false;
	}
	if (fileset.codec && fileset.codec.toLowerCase() !== "mp3") {
		return false;
	}
	return true;
}

function matchesTestament(fileset: BibleBrainFileset, testament: Testament): boolean {
	const size = getFilesetSize(fileset);
	if (size) {
		if (size === "C" || (size.includes("OT") && size.includes("NT"))) return true;
		return testament === "OT" ? size.includes("OT") : size.includes("NT");
	}
	return testament === "OT" ? /O[12C]/i.test(fileset.id) : /N[12C]/i.test(fileset.id);
}

function inferAudioStyle(fileset: BibleBrainFileset): AudioStyle {
	if (getFilesetType(fileset) === "audio_drama") return "drama";
	if (/[ON]2DA/i.test(fileset.id)) return "drama";
	return "standard";
}

export function selectAudioFilesetsForTestament(
	item: BibleBrainBibleItem,
	testament: Testament,
): ResolvedAudioFileset[] {
	const candidates = getAllFilesets(item).filter(
		(f) => isDirectAudioFileset(f) && matchesTestament(f, testament),
	);

	const deduped = new Map<string, ResolvedAudioFileset>();
	for (const fileset of candidates) {
		if (deduped.has(fileset.id)) continue;
		deduped.set(fileset.id, {
			filesetId: fileset.id,
			audioStyle: inferAudioStyle(fileset),
			bibleAbbr: item.abbr,
			bibleName: item.vname || item.name,
		});
	}

	const all = [...deduped.values()];
	const standard = all.filter((f) => f.audioStyle === "standard");
	const drama = all.filter((f) => f.audioStyle === "drama");

	// Keep standard narration primary, followed by dramatized recording if available
	return [...standard, ...drama];
}

function scoreKoreanBibleForKrv(item: BibleBrainBibleItem): number {
	const haystack = `${item.abbr} ${item.name} ${item.vname ?? ""}`.toLowerCase();
	if (haystack.includes("개역한글") || haystack.includes("krv")) return 100;
	if (haystack.includes("korean revised") && !haystack.includes("new")) return 90;
	if (haystack.includes("개역개정") || haystack.includes("nkrv")) return 40;
	return 10;
}

function setCatalogCache(cacheKey: string, items: BibleBrainBibleItem[]): void {
	if (items.length === 0) return;
	if (catalogCache.size >= MAX_CATALOG_CACHE_ENTRIES && !catalogCache.has(cacheKey)) {
		const oldestKey = catalogCache.keys().next().value;
		if (oldestKey) catalogCache.delete(oldestKey);
	}
	catalogCache.set(cacheKey, {
		value: items,
		expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
	});
}

async function fetchCatalogItems<T>(
	cacheKey: string,
	url: string,
	fetcher: FetchLike,
	extract: (payload: T) => BibleBrainBibleItem[],
): Promise<BibleBrainBibleItem[]> {
	const cached = catalogCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	const response = await fetchWithTimeout(fetcher, url, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) return [];

	const items = extract((await response.json()) as T);
	setCatalogCache(cacheKey, items);
	return items;
}

async function fetchBiblesByLanguage(
	apiKey: string,
	langIso: string,
	fetcher: FetchLike,
): Promise<BibleBrainBibleItem[]> {
	// OpenAPI /bibles defaults to limit=25; request 250 so large languages (eng, kor, spa) aren't truncated
	const url = `${BIBLE_BRAIN_BASE}/bibles?language_code=${encodeURIComponent(langIso)}&limit=250&v=4&key=${encodeURIComponent(apiKey)}`;
	return fetchCatalogItems<{ data?: BibleBrainBibleItem[] }>(
		`lang:${langIso.toLowerCase()}:${apiKey.slice(-6)}`,
		url,
		fetcher,
		(payload) => payload.data ?? [],
	);
}

async function fetchBibleById(
	apiKey: string,
	bibleId: string,
	fetcher: FetchLike,
): Promise<BibleBrainBibleItem | null> {
	const url = `${BIBLE_BRAIN_BASE}/bibles/${encodeURIComponent(bibleId)}?v=4&key=${encodeURIComponent(apiKey)}`;
	const items = await fetchCatalogItems<{ data?: BibleBrainBibleItem | BibleBrainBibleItem[] }>(
		`bible:${bibleId}:${apiKey.slice(-6)}`,
		url,
		fetcher,
		(payload) => {
			if (!payload.data) return [];
			return Array.isArray(payload.data) ? payload.data : [payload.data];
		},
	);
	return items[0] ?? null;
}

/**
 * Resolves candidate MP3 audio filesets for any language ISO code (or exact bibleId).
 */
export async function resolveCanonicalAudioFilesets(
	apiKey: string,
	options: {
		language: string;
		testament: Testament;
		bibleId?: string;
		fallbackFilesets?: readonly string[];
	},
	fetcher: FetchLike = fetch,
): Promise<ResolvedAudioFileset[]> {
	if (options.bibleId) {
		const exactBible = await fetchBibleById(apiKey, options.bibleId, fetcher).catch(() => null);
		if (exactBible) {
			const matched = selectAudioFilesetsForTestament(exactBible, options.testament);
			if (matched.length > 0) return matched;
		}
	}

	const langIso =
		options.language === "ko" ? "kor" : options.language === "en" ? "eng" : options.language;
	const items = await fetchBiblesByLanguage(apiKey, langIso, fetcher).catch(() => []);

	if (options.language === "en") {
		const esvItem = items.find(
			(b) =>
				b.abbr.toUpperCase() === "ENGESV" ||
				b.abbr.toUpperCase() === "ESV" ||
				b.name.toLowerCase().includes("english standard"),
		);
		if (esvItem) {
			const matched = selectAudioFilesetsForTestament(esvItem, options.testament);
			if (matched.length > 0) return matched;
		}
	} else if (options.language === "ko") {
		const ranked = [...items].sort((a, b) => scoreKoreanBibleForKrv(b) - scoreKoreanBibleForKrv(a));
		for (const item of ranked) {
			const matched = selectAudioFilesetsForTestament(item, options.testament);
			if (matched.length > 0) return matched;
		}
	} else {
		for (const item of items) {
			const matched = selectAudioFilesetsForTestament(item, options.testament);
			if (matched.length > 0) return matched;
		}
	}

	// Canonical fileset ID fallback (e.g. ENGESVO1DA / ENGESVN2DA) if /bibles lookup wasn't populated
	return (options.fallbackFilesets ?? []).map((id) => ({
		filesetId: id,
		audioStyle: /[ON]2DA/i.test(id) ? "drama" : "standard",
		bibleAbbr: options.bibleId ?? options.language.toUpperCase(),
		bibleName: options.language === "en" ? "ESV" : options.language === "ko" ? "개역한글" : langIso,
	}));
}

/**
 * Lists supported languages in Bible Brain for multi-language expansion.
 */
export async function fetchBibleBrainLanguages(
	apiKey: string,
	options: { page?: number; limit?: number } = {},
	fetcher: FetchLike = fetch,
): Promise<{ languages: BibleBrainLanguageItem[]; pagination?: BibleBrainPagination }> {
	const page = options.page ?? 1;
	const limit = options.limit ?? 250;
	const url = `${BIBLE_BRAIN_BASE}/languages?page=${page}&limit=${limit}&v=4&key=${encodeURIComponent(apiKey)}`;
	const response = await fetchWithTimeout(fetcher, url, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) return { languages: [] };
	const payload = (await response.json()) as {
		data?: BibleBrainLanguageItem[];
		meta?: { pagination?: BibleBrainPagination };
	};
	return {
		languages: payload.data ?? [],
		pagination: payload.meta?.pagination,
	};
}

/**
 * Resolves the canonical text fileset for any ISO 639-3 language code,
 * preferring inline `text_plain` over USX/HTML `text_format` and Bibles that also carry direct audio.
 */
export async function resolveBibleBrainLanguageTextFileset(
	apiKey: string,
	langIso: string,
	preferredAbbr?: string,
	fetcher: FetchLike = fetch,
): Promise<{ bible: BibleBrainBibleItem; textFilesetId: string } | null> {
	const items = await fetchBiblesByLanguage(apiKey, langIso, fetcher);
	const ordered = preferredAbbr
		? [
				...items.filter((i) => i.abbr.toUpperCase() === preferredAbbr.toUpperCase()),
				...items.filter((i) => i.abbr.toUpperCase() !== preferredAbbr.toUpperCase()),
			]
		: items;

	const scoreTextCandidate = (bible: BibleBrainBibleItem): number => {
		const filesets = getAllFilesets(bible);
		const hasPlain = filesets.some((f) => getFilesetType(f) === "text_plain");
		const hasFormat = filesets.some((f) => getFilesetType(f) === "text_format");
		if (!hasPlain && !hasFormat) return -1;
		const hasAudio = filesets.some((f) => isDirectAudioFileset(f));
		return (hasPlain ? 10 : 1) + (hasAudio ? 5 : 0);
	};

	const ranked = ordered
		.map((bible) => ({ bible, score: scoreTextCandidate(bible) }))
		.filter((c) => c.score >= 0)
		.sort((a, b) => b.score - a.score);

	const best = ranked[0]?.bible;
	if (!best) return null;

	const filesets = getAllFilesets(best);
	const textFileset =
		filesets.find((f) => getFilesetType(f) === "text_plain") ??
		filesets.find((f) => getFilesetType(f) === "text_format");
	return textFileset ? { bible: best, textFilesetId: textFileset.id } : null;
}

export async function fetchBibleBrainChapterText(
	apiKey: string,
	filesetId: string,
	usfm: string,
	chapter: number,
	fetcher: FetchLike = fetch,
): Promise<VerseEntry[]> {
	const url = `${BIBLE_BRAIN_BASE}/bibles/filesets/${encodeURIComponent(filesetId)}/${encodeURIComponent(usfm)}/${chapter}?v=4&key=${encodeURIComponent(apiKey)}`;
	const response = await fetchWithTimeout(fetcher, url, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) return [];

	const payload = (await response.json()) as BibleBrainVersesResponse;
	const entries: VerseEntry[] = [];
	for (const row of payload.data ?? []) {
		if (typeof row.verse_text !== "string") continue;
		const rawVerse = row.verse_sequence ?? row.verse_start;
		const verse =
			typeof rawVerse === "number" ? rawVerse : Number.parseInt(String(rawVerse ?? ""), 10);
		if (Number.isNaN(verse) || verse < 1) continue;
		entries.push({
			verse,
			text: row.verse_text.replace(/\s+/g, " ").trim(),
		});
	}
	return entries;
}

export async function fetchBibleBrainAudioTrack(
	apiKey: string,
	options: {
		filesetId: string;
		usfm: string;
		chapter: number;
		translationId: string;
		language: string;
		label: string;
		audioStyle?: AudioStyle;
	},
	fetcher: FetchLike = fetch,
): Promise<AudioTrackOption | null> {
	const audioUrl = `${BIBLE_BRAIN_BASE}/bibles/filesets/${encodeURIComponent(options.filesetId)}/${encodeURIComponent(options.usfm)}/${options.chapter}?v=4&key=${encodeURIComponent(apiKey)}`;
	const tsUrl = `${BIBLE_BRAIN_BASE}/timestamps/${encodeURIComponent(options.filesetId)}/${encodeURIComponent(options.usfm)}/${options.chapter}?v=4&key=${encodeURIComponent(apiKey)}`;

	// Request audio stream URL and verse timestamps in parallel
	const [audioRes, tsRes] = await Promise.all([
		fetchWithTimeout(fetcher, audioUrl, { headers: { Accept: "application/json" } }),
		fetchWithTimeout(fetcher, tsUrl, { headers: { Accept: "application/json" } }).catch(() => null),
	]);

	if (!audioRes.ok) return null;

	const audioPayload = (await audioRes.json()) as BibleBrainVersesResponse;
	const mp3Path = audioPayload.data?.[0]?.path;
	if (
		!mp3Path ||
		!isSafeHttpsUrl(mp3Path, { forbiddenSubstring: apiKey }) ||
		/\.m3u8(\?|$)/i.test(mp3Path)
	) {
		return null;
	}

	let verseTimings: Record<number, number> | undefined;
	if (tsRes?.ok) {
		try {
			const tsPayload = (await tsRes.json()) as BibleBrainTimestampsResponse;
			const map: Record<number, number> = {};
			for (const row of tsPayload.data ?? []) {
				const rawVerse = row.verse_sequence ?? row.verse_start;
				const verse =
					typeof rawVerse === "number" ? rawVerse : Number.parseInt(String(rawVerse ?? ""), 10);
				const sec =
					typeof row.timestamp === "number"
						? row.timestamp
						: Number.parseFloat(String(row.timestamp ?? ""));
				if (!Number.isNaN(verse) && verse >= 1 && !Number.isNaN(sec) && sec >= 0) {
					map[verse] = map[verse] === undefined ? sec : Math.min(map[verse], sec);
				}
			}
			if (Object.keys(map).length > 0) {
				verseTimings = map;
			}
		} catch {
			// Timestamps are optional; playback still works without them.
		}
	}

	return {
		id: `bb:${options.filesetId}`,
		label: options.label,
		language: options.language,
		translationId: options.translationId,
		url: mp3Path,
		source: "bible-brain",
		audioStyle: options.audioStyle,
		filesetId: options.filesetId,
		verseTimings,
		note: verseTimings ? "Verse-synced via Bible Brain" : "Bible Brain human narration",
	};
}
