import type { VerseRef } from "./types";

export type MemorizePackCategory = "essential" | "testament" | "theme";

export interface MemorizeStarterPack {
	id: string;
	category: MemorizePackCategory;
	titleEn: string;
	titleKo: string;
	description: string;
	refs: readonly VerseRef[];
}

type CompactRef = readonly [
	bookNumber: number,
	chapter: number,
	verseStart: number,
	verseEnd?: number,
];

function toRefs(specs: readonly CompactRef[]): readonly VerseRef[] {
	return specs.map(([bookNumber, chapter, verseStart, verseEnd]) =>
		verseEnd !== undefined
			? { bookNumber, chapter, verseStart, verseEnd }
			: { bookNumber, chapter, verseStart },
	);
}

/**
 * Curated starter packs storing passage references only (no ESV text).
 */
export const MEMORIZE_STARTER_PACKS: readonly MemorizeStarterPack[] = [
	{
		id: "top-20",
		category: "essential",
		titleEn: "Top 20 Essential Verses",
		titleKo: "핵심 성경 암송 20구절",
		description: "Twenty foundational verses spanning Genesis to the Epistles.",
		refs: toRefs([
			[1, 1, 1],
			[6, 1, 9],
			[19, 23, 1],
			[19, 119, 105],
			[20, 3, 5, 6],
			[23, 40, 31],
			[23, 41, 10],
			[24, 29, 11],
			[40, 6, 33],
			[40, 11, 28],
			[40, 28, 19, 20],
			[43, 3, 16],
			[43, 14, 6],
			[45, 5, 8],
			[45, 8, 28],
			[45, 12, 2],
			[47, 5, 17],
			[48, 2, 20],
			[49, 2, 8, 9],
			[50, 4, 13],
		]),
	},
	{
		id: "old-testament",
		category: "testament",
		titleEn: "Old Testament Treasures",
		titleKo: "구약 핵심 말씀",
		description: "Landmark passages across the Law, History, Psalms, Proverbs, and Prophets.",
		refs: toRefs([
			[1, 1, 1],
			[5, 6, 5],
			[6, 1, 8],
			[9, 16, 7],
			[19, 1, 1, 2],
			[19, 46, 1],
			[19, 139, 14],
			[20, 4, 23],
			[23, 53, 5],
			[25, 3, 22, 23],
			[33, 6, 8],
			[35, 3, 17, 18],
		]),
	},
	{
		id: "new-testament",
		category: "testament",
		titleEn: "New Testament Pillars",
		titleKo: "신약 핵심 말씀",
		description: "Key verses from the Gospels, Acts, Epistles, and Revelation.",
		refs: toRefs([
			[40, 5, 16],
			[41, 10, 45],
			[42, 1, 37],
			[43, 1, 1],
			[43, 14, 27],
			[44, 1, 8],
			[45, 8, 38, 39],
			[46, 13, 4, 5],
			[50, 4, 6, 7],
			[58, 11, 1],
			[60, 5, 7],
			[66, 21, 4],
		]),
	},
	{
		id: "psalms-proverbs",
		category: "testament",
		titleEn: "Psalms & Proverbs",
		titleKo: "시편 · 잠언",
		description: "Poetic worship, shepherd promises, and daily wisdom.",
		refs: toRefs([
			[19, 1, 1, 2],
			[19, 19, 14],
			[19, 23, 1, 3],
			[19, 34, 8],
			[19, 51, 10],
			[19, 121, 1, 2],
			[20, 1, 7],
			[20, 3, 5, 6],
			[20, 16, 9],
			[20, 18, 10],
		]),
	},
	{
		id: "words-of-jesus",
		category: "testament",
		titleEn: "Words of Jesus",
		titleKo: "예수님의 말씀",
		description: "Direct teachings and promises of Christ across the four Gospels.",
		refs: toRefs([
			[40, 5, 8],
			[40, 6, 33],
			[40, 11, 28, 29],
			[41, 9, 23],
			[42, 6, 31],
			[43, 6, 35],
			[43, 8, 32],
			[43, 10, 10],
			[43, 13, 34],
			[43, 15, 5],
		]),
	},
	{
		id: "gospel-grace",
		category: "theme",
		titleEn: "Gospel & Grace",
		titleKo: "복음과 은혜",
		description: "Core promises of salvation, mercy, and new life in Christ.",
		refs: toRefs([
			[43, 3, 16],
			[45, 5, 8],
			[45, 8, 1],
			[49, 2, 8, 9],
			[47, 5, 17],
			[62, 1, 9],
		]),
	},
	{
		id: "peace-trust",
		category: "theme",
		titleEn: "Peace & Trust",
		titleKo: "평안과 신뢰",
		description: "Anchors for anxious days, guidance, and resting in the Lord.",
		refs: toRefs([
			[20, 3, 5, 6],
			[23, 41, 10],
			[50, 4, 6, 7],
			[19, 23, 1, 3],
			[40, 11, 28],
			[45, 8, 28],
		]),
	},
	{
		id: "wisdom-word",
		category: "theme",
		titleEn: "Wisdom & Word",
		titleKo: "지혜와 말씀",
		description: "Scripture on meditating on God's Word and walking wisely.",
		refs: toRefs([
			[19, 1, 2],
			[19, 119, 105],
			[6, 1, 8],
			[55, 3, 16],
			[59, 1, 5],
			[33, 6, 8],
		]),
	},
	{
		id: "strength-courage",
		category: "theme",
		titleEn: "Strength & Courage",
		titleKo: "능력과 담대함",
		description: "Verses for endurance, courage, and renewing strength.",
		refs: toRefs([
			[23, 40, 31],
			[50, 4, 13],
			[6, 1, 9],
			[19, 46, 1],
			[55, 1, 7],
			[48, 6, 9],
		]),
	},
	{
		id: "prayer-worship",
		category: "theme",
		titleEn: "Prayer & Worship",
		titleKo: "기도와 예배",
		description: "Invitations to seek God, give thanks, and draw near in prayer.",
		refs: toRefs([
			[13, 16, 11],
			[19, 95, 1],
			[19, 100, 5],
			[24, 33, 3],
			[40, 7, 7],
			[43, 4, 24],
			[52, 5, 16, 18],
			[58, 4, 16],
		]),
	},
	{
		id: "love-character",
		category: "theme",
		titleEn: "Love & Character",
		titleKo: "사랑과 성품",
		description: "Walking in love, humility, kindness, and the fruit of the Spirit.",
		refs: toRefs([
			[46, 13, 4, 5],
			[46, 13, 13],
			[48, 5, 22, 23],
			[49, 4, 32],
			[50, 2, 3, 4],
			[51, 3, 12],
			[62, 4, 7, 8],
			[62, 4, 19],
		]),
	},
];
