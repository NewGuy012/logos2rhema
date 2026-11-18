import type {
	AudioStyle,
	AudioTrackOption,
	Testament,
	TranslationLanguage,
	VerseEntry,
} from "../shared/types";
import type { FetchLike } from "./helloao";

const BIBLE_BRAIN_BASE = "https://4.dbt.io/api";
const CATALOG_CACHE_TTL_MS = 60 * 60 * 1000;

export interface BibleBrainFileset {
	id: string;
	type: string;
	size?: string;
	codec?: string;
	container?: string;
}

export interface BibleBrainBibleItem {
	abbr: string;
	name: string;
	vname?: string;
	language_iso?: string;
	iso?: string;
	filesets?: Record<string, BibleBrainFileset[]>;
}

export interface BibleBrainLanguageItem {
	id: number;
	name: string;
	iso: string;
	autonym?: string | null;
	bibles?: number;
}

interface BibleBrainVersesResponse {
	data?: Array<{
		verse_start?: number;
		verse_text?: string;
		path?: string;
	}>;
}

interface BibleBrainTimestampsResponse {
	data?: Array<{
		verse_start?: number | string;
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
	return Object.values(item.filesets ?? {}).flat();
}

function isDirectAudioFileset(fileset: BibleBrainFileset): boolean {
	if (fileset.type !== "audio" && fileset.type !== "audio_drama") {
		return false;
	}
	// Avoid HLS/Opus-only IDs when standard MP3 streams are available
	if (fileset.id.toLowerCase().includes("opus")) {
		return false;
	}
	if (fileset.codec && fileset.codec.toLowerCase() !== "mp3") {
		return false;
	}
	return true;
}

function matchesTestament(fileset: BibleBrainFileset, testament: Testament): boolean {
	const size = (fileset.size ?? "").toUpperCase();
	if (size === "C" || size === "OTNT" || size === "OTNTP") return true;
	if (testament === "OT") {
		if (size === "OT" || size === "OTP") return true;
		return /O[12C]/i.test(fileset.id);
	}
	if (size === "NT" || size === "NTP") return true;
	return /N[12C]/i.test(fileset.id);
}

function inferAudioStyle(fileset: BibleBrainFileset): AudioStyle {
	if (fileset.type === "audio_drama") return "drama";
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

async function fetchBiblesByLanguage(
	apiKey: string,
	langIso: string,
	fetcher: FetchLike,
): Promise<BibleBrainBibleItem[]> {
	const cacheKey = `lang:${langIso}:${apiKey.slice(-6)}`;
	const cached = catalogCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	const url = `${BIBLE_BRAIN_BASE}/bibles?language_code=${encodeURIComponent(langIso)}&v=4&key=${encodeURIComponent(apiKey)}`;
	const response = await fetcher(url, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) return [];

	const payload = (await response.json()) as { data?: BibleBrainBibleItem[] };
	const items = payload.data ?? [];
	catalogCache.set(cacheKey, {
		value: items,
		expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
	});
	return items;
}

async function fetchBibleById(
	apiKey: string,
	bibleId: string,
	fetcher: FetchLike,
): Promise<BibleBrainBibleItem | null> {
	const cacheKey = `bible:${bibleId}:${apiKey.slice(-6)}`;
	const cached = catalogCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value[0] ?? null;
	}

	const url = `${BIBLE_BRAIN_BASE}/bibles/${encodeURIComponent(bibleId)}?v=4&key=${encodeURIComponent(apiKey)}`;
	const response = await fetcher(url, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) return null;

	const payload = (await response.json()) as { data?: BibleBrainBibleItem };
	if (!payload.data) return null;
	catalogCache.set(cacheKey, {
		value: [payload.data],
		expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
	});
	return payload.data;
}

/**
 * Resolves candidate MP3 audio filesets for a canonical language Bible.
 * Used as primary audio & timestamp provider whenever BIBLE_BRAIN_API_KEY is configured.
 */
export async function resolveCanonicalAudioFilesets(
	apiKey: string,
	options: {
		language: TranslationLanguage;
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

	const langIso = options.language === "ko" ? "kor" : "eng";
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
	}

	// Canonical fileset ID fallback (e.g. ENGESVO1DA / ENGESVN2DA) if /bibles lookup wasn't populated
	return (options.fallbackFilesets ?? []).map((id) => ({
		filesetId: id,
		audioStyle: /[ON]2DA/i.test(id) ? "drama" : "standard",
		bibleAbbr: options.bibleId ?? options.language.toUpperCase(),
		bibleName: options.language === "en" ? "ESV" : "개역한글",
	}));
}

/**
 * Lists supported languages in Bible Brain for future multi-language expansion.
 */
export async function fetchBibleBrainLanguages(
	apiKey: string,
	fetcher: FetchLike = fetch,
): Promise<BibleBrainLanguageItem[]> {
	const url = `${BIBLE_BRAIN_BASE}/languages?v=4&key=${encodeURIComponent(apiKey)}`;
	const response = await fetcher(url, { headers: { Accept: "application/json" } });
	if (!response.ok) return [];
	const payload = (await response.json()) as { data?: BibleBrainLanguageItem[] };
	return payload.data ?? [];
}

/**
 * Resolves the single canonical text + audio fileset pair for any future ISO language code.
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

	for (const bible of ordered) {
		const textFileset = getAllFilesets(bible).find(
			(f) => f.type === "text_plain" || f.type === "text_format",
		);
		if (textFileset) {
			return { bible, textFilesetId: textFileset.id };
		}
	}
	return null;
}

export async function fetchBibleBrainChapterText(
	apiKey: string,
	filesetId: string,
	usfm: string,
	chapter: number,
	fetcher: FetchLike = fetch,
): Promise<VerseEntry[]> {
	const url = `${BIBLE_BRAIN_BASE}/bibles/filesets/${encodeURIComponent(filesetId)}/${encodeURIComponent(usfm)}/${chapter}?v=4&key=${encodeURIComponent(apiKey)}`;
	const response = await fetcher(url, { headers: { Accept: "application/json" } });
	if (!response.ok) return [];

	const payload = (await response.json()) as BibleBrainVersesResponse;
	return (payload.data ?? [])
		.filter((v) => typeof v.verse_start === "number" && typeof v.verse_text === "string")
		.map((v) => ({
			verse: v.verse_start as number,
			text: (v.verse_text as string).replace(/\s+/g, " ").trim(),
		}));
}

export async function fetchBibleBrainAudioTrack(
	apiKey: string,
	options: {
		filesetId: string;
		usfm: string;
		chapter: number;
		translationId: string;
		language: TranslationLanguage;
		label: string;
		audioStyle?: AudioStyle;
	},
	fetcher: FetchLike = fetch,
): Promise<AudioTrackOption | null> {
	const audioUrl = `${BIBLE_BRAIN_BASE}/bibles/filesets/${encodeURIComponent(options.filesetId)}/${encodeURIComponent(options.usfm)}/${options.chapter}?v=4&key=${encodeURIComponent(apiKey)}`;
	const tsUrl = `${BIBLE_BRAIN_BASE}/timestamps/${encodeURIComponent(options.filesetId)}/${encodeURIComponent(options.usfm)}/${options.chapter}?v=4&key=${encodeURIComponent(apiKey)}`;

	// Request audio stream URL and verse timestamps in parallel
	const [audioRes, tsRes] = await Promise.all([
		fetcher(audioUrl, { headers: { Accept: "application/json" } }),
		fetcher(tsUrl, { headers: { Accept: "application/json" } }).catch(() => null),
	]);

	if (!audioRes.ok) return null;

	const audioPayload = (await audioRes.json()) as BibleBrainVersesResponse;
	const mp3Path = audioPayload.data?.[0]?.path;
	if (!mp3Path) return null;

	let verseTimings: Record<number, number> | undefined;
	if (tsRes?.ok) {
		try {
			const tsPayload = (await tsRes.json()) as BibleBrainTimestampsResponse;
			const map: Record<number, number> = {};
			for (const row of tsPayload.data ?? []) {
				const verse =
					typeof row.verse_start === "number"
						? row.verse_start
						: Number.parseInt(String(row.verse_start ?? ""), 10);
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
