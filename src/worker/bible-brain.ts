import type {
	AudioTrackOption,
	TranslationLanguage,
	TranslationMeta,
	VerseEntry,
} from "../shared/types";
import type { FetchLike } from "./helloao";

const BIBLE_BRAIN_BASE = "https://4.dbt.io/api";

interface BibleBrainFileset {
	id: string;
	type: string;
	size?: string;
}

interface BibleBrainBibleItem {
	abbr: string;
	name: string;
	vname?: string;
	language_iso: string;
	filesets?: Record<string, BibleBrainFileset[]>;
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
		timestamp?: number | string;
	}>;
}

function getAllFilesets(item: BibleBrainBibleItem): BibleBrainFileset[] {
	const groups = Object.values(item.filesets ?? {});
	return groups.flat();
}

export async function listBibleBrainTranslations(
	apiKey: string,
	language: TranslationLanguage,
	fetcher: FetchLike = fetch,
): Promise<TranslationMeta[]> {
	const langIso = language === "ko" ? "kor" : "eng";
	const url = `${BIBLE_BRAIN_BASE}/bibles?language_code=${langIso}&v=4&key=${encodeURIComponent(apiKey)}`;
	const response = await fetcher(url, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) return [];

	const payload = (await response.json()) as { data?: BibleBrainBibleItem[] };
	const items = payload.data ?? [];
	const translations: TranslationMeta[] = [];

	for (const item of items) {
		const filesets = getAllFilesets(item);
		const textFileset = filesets.find((f) => f.type === "text_plain" || f.type === "text_format");
		const audioFilesets = filesets
			.filter((f) => f.type === "audio" || f.type === "audio_drama")
			.map((f) => f.id);

		if (!textFileset && audioFilesets.length === 0) continue;

		const primaryId = textFileset?.id ?? audioFilesets[0];
		translations.push({
			id: `bb:${primaryId}`,
			code: item.abbr,
			name: item.name,
			nativeName: item.vname || item.name,
			language,
			source: "bible-brain",
			externalId: textFileset?.id,
			hasAudio: audioFilesets.length > 0,
			audioLabel: audioFilesets.length > 0 ? "Bible Brain Human Narration" : undefined,
			audioFilesetIds: audioFilesets,
			description: `Synced via Bible Brain API (${item.abbr}).`,
		});
	}

	return translations;
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
	},
	fetcher: FetchLike = fetch,
): Promise<AudioTrackOption | null> {
	const audioUrl = `${BIBLE_BRAIN_BASE}/bibles/filesets/${encodeURIComponent(options.filesetId)}/${encodeURIComponent(options.usfm)}/${options.chapter}?v=4&key=${encodeURIComponent(apiKey)}`;
	const audioRes = await fetcher(audioUrl, { headers: { Accept: "application/json" } });
	if (!audioRes.ok) return null;

	const audioPayload = (await audioRes.json()) as BibleBrainVersesResponse;
	const mp3Path = audioPayload.data?.[0]?.path;
	if (!mp3Path) return null;

	// Fetch verse-level timestamps when available
	let verseTimings: Record<number, number> | undefined;
	try {
		const tsUrl = `${BIBLE_BRAIN_BASE}/timestamps/${encodeURIComponent(options.filesetId)}/${encodeURIComponent(options.usfm)}/${options.chapter}?v=4&key=${encodeURIComponent(apiKey)}`;
		const tsRes = await fetcher(tsUrl, { headers: { Accept: "application/json" } });
		if (tsRes.ok) {
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
				if (!Number.isNaN(verse) && !Number.isNaN(sec)) {
					map[verse] = sec;
				}
			}
			if (Object.keys(map).length > 0) {
				verseTimings = map;
			}
		}
	} catch {
		// Timestamps are optional; playback still works smoothly without them.
	}

	return {
		id: `bb:${options.filesetId}`,
		label: options.label,
		language: options.language,
		translationId: options.translationId,
		url: mp3Path,
		source: "bible-brain",
		verseTimings,
	};
}
