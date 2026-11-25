import { containsHangul, toInitialConsonants } from "../../shared/hangul";
import type { TranslationLanguage } from "../../shared/types";
import type { ClozeLevel } from "./memorize";

export interface ClozeSlot {
	index: number;
	raw: string;
	leadPunct: string;
	word: string;
	trailPunct: string;
	maskedText: string;
	isHidden: boolean;
}

const WORD_EDGE_RE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;

function hashSlotSeed(seed: string, slotIndex: number): number {
	let hash = 2166136261 ^ slotIndex;
	for (let i = 0; i < seed.length; i++) {
		hash ^= seed.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

export function maskEnglishWord(word: string, style: "blank" | "initial"): string {
	if (!word) return "";
	if (style === "initial") {
		if (word.length === 1) return word[0];
		return `${word[0]}${"_".repeat(Math.min(Math.max(word.length - 1, 1), 6))}`;
	}
	return "_".repeat(Math.min(Math.max(word.length, 2), 8));
}

export function maskKoreanWord(word: string, style: "blank" | "choseong"): string {
	if (!word) return "";
	if (style === "choseong") {
		return containsHangul(word) ? toInitialConsonants(word) : maskEnglishWord(word, "initial");
	}
	return "_".repeat(Math.min(Math.max(word.length, 2), 6));
}

export function buildClozeSlots(
	text: string,
	lang: TranslationLanguage,
	level: ClozeLevel,
	seed: string,
): ClozeSlot[] {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return [];

	const rawParts = normalized.split(" ");
	const parsed = rawParts.map((raw, index) => {
		const match = WORD_EDGE_RE.exec(raw);
		const leadPunct = match?.[1] ?? "";
		const word = match?.[2] ?? raw;
		const trailPunct = match?.[3] ?? "";
		return { index, raw, leadPunct, word, trailPunct };
	});

	const hideable = parsed.filter((item) => item.word.length > 0);
	const hiddenSet = new Set<number>();

	if (level === "initials") {
		for (const item of hideable) hiddenSet.add(item.index);
	} else if (hideable.length > 0) {
		const ranked = [...hideable].sort((a, b) => {
			const diff = hashSlotSeed(seed, a.index) - hashSlotSeed(seed, b.index);
			return diff !== 0 ? diff : a.index - b.index;
		});
		const hideCount = Math.min(
			hideable.length,
			Math.max(1, Math.round(hideable.length * (level / 100))),
		);
		for (let i = 0; i < hideCount; i++) {
			hiddenSet.add(ranked[i].index);
		}
	}

	return parsed.map((item) => {
		const isHidden = hiddenSet.has(item.index);
		const maskedText =
			!isHidden || !item.word
				? item.word
				: lang === "ko"
					? maskKoreanWord(item.word, level === "initials" ? "choseong" : "blank")
					: maskEnglishWord(item.word, level === "initials" ? "initial" : "blank");
		return {
			...item,
			maskedText,
			isHidden,
		};
	});
}

export function buildVerseHint(
	enText: string | null | undefined,
	koText: string | null | undefined,
): { enHint?: string; koHint?: string } {
	const formatLine = (text: string | null | undefined, lang: TranslationLanguage) => {
		if (!text) return undefined;
		const slots = buildClozeSlots(text, lang, "initials", "hint");
		if (slots.length === 0) return undefined;
		return slots.map((slot) => `${slot.leadPunct}${slot.maskedText}${slot.trailPunct}`).join(" ");
	};
	return {
		enHint: formatLine(enText, "en"),
		koHint: formatLine(koText, "ko"),
	};
}
