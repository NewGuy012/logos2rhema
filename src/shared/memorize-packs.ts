import type { VerseRef } from "./types";

export interface MemorizeStarterPack {
	id: string;
	titleEn: string;
	titleKo: string;
	description: string;
	refs: readonly VerseRef[];
}

/**
 * Curated starter packs storing passage references only (no ESV text).
 */
export const MEMORIZE_STARTER_PACKS: readonly MemorizeStarterPack[] = [
	{
		id: "gospel-grace",
		titleEn: "Gospel & Grace",
		titleKo: "복음과 은혜",
		description: "Core promises of salvation, mercy, and new life in Christ.",
		refs: [
			{ bookNumber: 43, chapter: 3, verseStart: 16 },
			{ bookNumber: 45, chapter: 5, verseStart: 8 },
			{ bookNumber: 45, chapter: 8, verseStart: 1 },
			{ bookNumber: 49, chapter: 2, verseStart: 8, verseEnd: 9 },
			{ bookNumber: 47, chapter: 5, verseStart: 17 },
			{ bookNumber: 62, chapter: 1, verseStart: 9 },
		],
	},
	{
		id: "peace-trust",
		titleEn: "Peace & Trust",
		titleKo: "평안과 신뢰",
		description: "Anchors for anxious days, guidance, and resting in the Lord.",
		refs: [
			{ bookNumber: 20, chapter: 3, verseStart: 5, verseEnd: 6 },
			{ bookNumber: 23, chapter: 41, verseStart: 10 },
			{ bookNumber: 50, chapter: 4, verseStart: 6, verseEnd: 7 },
			{ bookNumber: 19, chapter: 23, verseStart: 1, verseEnd: 3 },
			{ bookNumber: 40, chapter: 11, verseStart: 28 },
			{ bookNumber: 45, chapter: 8, verseStart: 28 },
		],
	},
	{
		id: "wisdom-word",
		titleEn: "Wisdom & Word",
		titleKo: "지혜와 말씀",
		description: "Scripture on meditating on God's Word and walking wisely.",
		refs: [
			{ bookNumber: 19, chapter: 1, verseStart: 2 },
			{ bookNumber: 19, chapter: 119, verseStart: 105 },
			{ bookNumber: 6, chapter: 1, verseStart: 8 },
			{ bookNumber: 55, chapter: 3, verseStart: 16 },
			{ bookNumber: 59, chapter: 1, verseStart: 5 },
			{ bookNumber: 33, chapter: 6, verseStart: 8 },
		],
	},
	{
		id: "strength-courage",
		titleEn: "Strength & Courage",
		titleKo: "능력과 담대함",
		description: "Verses for endurance, courage, and renewing strength.",
		refs: [
			{ bookNumber: 23, chapter: 40, verseStart: 31 },
			{ bookNumber: 50, chapter: 4, verseStart: 13 },
			{ bookNumber: 6, chapter: 1, verseStart: 9 },
			{ bookNumber: 19, chapter: 46, verseStart: 1 },
			{ bookNumber: 55, chapter: 1, verseStart: 7 },
			{ bookNumber: 48, chapter: 6, verseStart: 9 },
		],
	},
];
