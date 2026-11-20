export const SUPERTONIC_TRACK_ID = "custom:krv:supertonic";
export const SUPERTONIC_TRACK_LABEL = "개역한글 · AI 낭독 (Supertonic 3)";
export const SUPERTONIC_TRACK_ATTRIBUTION = "AI 낭독 · Supertonic 3";
export const SUPERTONIC_COMPACT_BADGE = "AI 낭독";
export const SUPERTONIC_MOBILE_BADGE = "AI 낭독 · Supertonic";
export const SUPERTONIC_LICENSE_NAME = "BigScience OpenRAIL-M";
export const SUPERTONIC_LICENSE_URL =
	"https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE";

export function hasVerseTimings(timings: Record<number, number> | undefined): boolean {
	return Boolean(timings && Object.keys(timings).length > 0);
}

export function normalizeVerseTimings(raw: unknown): Record<number, number> | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const timings: Record<number, number> = {};
	let count = 0;
	for (const [vStr, sec] of Object.entries(raw as Record<string, unknown>)) {
		if (!/^\d+$/.test(vStr)) continue;
		const vNum = Number.parseInt(vStr, 10);
		if (vNum >= 1 && typeof sec === "number" && Number.isFinite(sec) && sec >= 0) {
			timings[vNum] = sec;
			count++;
		}
	}
	return count > 0 ? timings : undefined;
}
