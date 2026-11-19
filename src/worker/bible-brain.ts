import type { AudioStyle, AudioTrackOption, Testament, VerseEntry } from "../shared/types";
import { fetchJson, type FetchLike, isSafeHttpsUrl } from "./http";

const BIBLE_BRAIN_BASE = "https://4.dbt.io/api";
const CATALOG_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CATALOG_CACHE_ENTRIES = 100;

interface BibleBrainFileset {
	id: string;
	type?: string;
	set_type_code?: string;
	size?: string;
	set_size_code?: string;
	codec?: string;
}

interface BibleBrainBibleItem {
	abbr: string;
	name: string;
	vname?: string;
	filesets?: Record<string, BibleBrainFileset[]> | BibleBrainFileset[];
}

interface BibleBrainLanguageItem {
	id: number;
	name: string;
	iso: string;
	autonym?: string | null;
	bibles?: number;
}

interface BibleBrainPagination {
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
		timestamp?: number | string;
	}>;
}

export interface ResolvedAudioFileset {
	filesetId: string;
	audioStyle: AudioStyle;
	bibleAbbr: string;
	bibleName: string;
}

const catalogCache = new Map<string, { value: BibleBrainBibleItem[]; expiresAt: number }>();

export function clearBibleBrainCache(): void {
	catalogCache.clear();
}

function hashCacheScope(secret: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < secret.length; i++) {
		hash ^= secret.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

function bibleBrainUrl(
	path: string,
	apiKey: string,
	params?: Record<string, string | number>,
): string {
	const search = new URLSearchParams();
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			search.set(k, String(v));
		}
	}
	search.set("v", "4");
	search.set("key", apiKey);
	return `${BIBLE_BRAIN_BASE}${path}?${search.toString()}`;
}

function parseVerseNumber(rawVerse: unknown): number | null {
	const verse =
		typeof rawVerse === "number" ? rawVerse : Number.parseInt(String(rawVerse ?? ""), 10);
	return Number.isNaN(verse) || verse < 1 ? null : verse;
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
	if (filesetType !== "audio" && filesetType !== "audio_drama") return false;
	if (fileset.id.toLowerCase().includes("opus")) return false;
	if (fileset.codec && fileset.codec.toLowerCase() !== "mp3") return false;
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
	return getFilesetType(fileset) === "audio_drama" || /[ON]2DA/i.test(fileset.id)
		? "drama"
		: "standard";
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
	return [
		...all.filter((f) => f.audioStyle === "standard"),
		...all.filter((f) => f.audioStyle === "drama"),
	];
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
): Promise<BibleBrainBibleItem[] | null> {
	const cached = catalogCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}

	const payload = await fetchJson<T>(fetcher, url);
	if (!payload) return null;

	const items = extract(payload);
	setCatalogCache(cacheKey, items);
	return items;
}

function fetchBiblesByLanguage(
	apiKey: string,
	langIso: string,
	fetcher: FetchLike,
): Promise<BibleBrainBibleItem[] | null> {
	// OpenAPI /bibles defaults to limit=25; request 250 so large languages aren't truncated.
	const url = bibleBrainUrl("/bibles", apiKey, { language_code: langIso, limit: 250 });
	return fetchCatalogItems<{ data?: BibleBrainBibleItem[] }>(
		`lang:${langIso.toLowerCase()}:${hashCacheScope(apiKey)}`,
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
	const url = bibleBrainUrl(`/bibles/${encodeURIComponent(bibleId)}`, apiKey);
	const items = await fetchCatalogItems<{ data?: BibleBrainBibleItem | BibleBrainBibleItem[] }>(
		`bible:${bibleId}:${hashCacheScope(apiKey)}`,
		url,
		fetcher,
		(payload) => (!payload.data ? [] : Array.isArray(payload.data) ? payload.data : [payload.data]),
	);
	return items?.[0] ?? null;
}

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
		const exactBible = await fetchBibleById(apiKey, options.bibleId, fetcher);
		if (exactBible) {
			const matched = selectAudioFilesetsForTestament(exactBible, options.testament);
			if (matched.length > 0) return matched;
		}
	}

	const langIso =
		options.language === "ko" ? "kor" : options.language === "en" ? "eng" : options.language;
	const items = (await fetchBiblesByLanguage(apiKey, langIso, fetcher)) ?? [];

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
	} else {
		const ordered =
			options.language === "ko"
				? [...items].sort((a, b) => scoreKoreanBibleForKrv(b) - scoreKoreanBibleForKrv(a))
				: items;
		for (const item of ordered) {
			const matched = selectAudioFilesetsForTestament(item, options.testament);
			if (matched.length > 0) return matched;
		}
	}

	return (options.fallbackFilesets ?? []).map((id) => ({
		filesetId: id,
		audioStyle: /[ON]2DA/i.test(id) ? "drama" : "standard",
		bibleAbbr: options.bibleId ?? options.language.toUpperCase(),
		bibleName: options.language === "en" ? "ESV" : options.language === "ko" ? "개역한글" : langIso,
	}));
}

export async function fetchBibleBrainLanguages(
	apiKey: string,
	options: { page?: number; limit?: number } = {},
	fetcher: FetchLike = fetch,
): Promise<{ languages: BibleBrainLanguageItem[]; pagination?: BibleBrainPagination } | null> {
	const url = bibleBrainUrl("/languages", apiKey, {
		page: options.page ?? 1,
		limit: options.limit ?? 250,
	});
	const payload = await fetchJson<{
		data?: BibleBrainLanguageItem[];
		meta?: { pagination?: BibleBrainPagination };
	}>(fetcher, url);
	if (!payload) return null;
	return {
		languages: payload.data ?? [],
		pagination: payload.meta?.pagination,
	};
}

export async function resolveBibleBrainLanguageTextFileset(
	apiKey: string,
	langIso: string,
	preferredAbbr?: string,
	fetcher: FetchLike = fetch,
): Promise<
	| { status: "ok"; bible: BibleBrainBibleItem; textFilesetId: string }
	| { status: "not_found" | "error" }
> {
	const items = await fetchBiblesByLanguage(apiKey, langIso, fetcher);
	if (!items) return { status: "error" };

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
		return (hasPlain ? 10 : 1) + (filesets.some(isDirectAudioFileset) ? 5 : 0);
	};

	const best = ordered
		.map((bible) => ({ bible, score: scoreTextCandidate(bible) }))
		.filter((c) => c.score >= 0)
		.sort((a, b) => b.score - a.score)[0]?.bible;
	if (!best) return { status: "not_found" };

	const filesets = getAllFilesets(best);
	const textFileset =
		filesets.find((f) => getFilesetType(f) === "text_plain") ??
		filesets.find((f) => getFilesetType(f) === "text_format");
	return textFileset
		? { status: "ok", bible: best, textFilesetId: textFileset.id }
		: { status: "not_found" };
}

export async function fetchBibleBrainChapterText(
	apiKey: string,
	filesetId: string,
	usfm: string,
	chapter: number,
	fetcher: FetchLike = fetch,
): Promise<VerseEntry[] | null> {
	const url = bibleBrainUrl(
		`/bibles/filesets/${encodeURIComponent(filesetId)}/${encodeURIComponent(usfm)}/${chapter}`,
		apiKey,
	);
	const payload = await fetchJson<BibleBrainVersesResponse>(fetcher, url);
	if (!payload) return null;

	const entries: VerseEntry[] = [];
	for (const row of payload.data ?? []) {
		if (typeof row.verse_text !== "string") continue;
		const verse = parseVerseNumber(row.verse_sequence ?? row.verse_start);
		if (verse === null) continue;
		entries.push({ verse, text: row.verse_text.replace(/\s+/g, " ").trim() });
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
	const segment = `${encodeURIComponent(options.filesetId)}/${encodeURIComponent(options.usfm)}/${options.chapter}`;
	const [audioPayload, tsPayload] = await Promise.all([
		fetchJson<BibleBrainVersesResponse>(
			fetcher,
			bibleBrainUrl(`/bibles/filesets/${segment}`, apiKey),
		),
		fetchJson<BibleBrainTimestampsResponse>(
			fetcher,
			bibleBrainUrl(`/timestamps/${segment}`, apiKey),
		),
	]);

	const mp3Path = audioPayload?.data?.[0]?.path;
	if (
		!mp3Path ||
		!isSafeHttpsUrl(mp3Path, { forbiddenSubstring: apiKey }) ||
		/\.m3u8(\?|$)/i.test(mp3Path)
	) {
		return null;
	}

	let verseTimings: Record<number, number> | undefined;
	if (tsPayload?.data) {
		const map: Record<number, number> = {};
		for (const row of tsPayload.data) {
			const verse = parseVerseNumber(row.verse_sequence ?? row.verse_start);
			const sec =
				typeof row.timestamp === "number"
					? row.timestamp
					: Number.parseFloat(String(row.timestamp ?? ""));
			if (verse !== null && Number.isFinite(sec) && sec >= 0) {
				map[verse] = map[verse] === undefined ? sec : Math.min(map[verse], sec);
			}
		}
		if (Object.keys(map).length > 0) {
			verseTimings = map;
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
