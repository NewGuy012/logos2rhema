import type { TranslationMeta } from "./types";

export const BUILTIN_ENGLISH_TRANSLATIONS: readonly TranslationMeta[] = [
	{
		id: "esv",
		code: "ESV",
		name: "English Standard Version",
		nativeName: "English Standard Version (2001)",
		language: "en",
		source: "bundled",
		hasAudio: false,
		description:
			"Bundled local ESV text; pairs with Korean audio by default or Bible Brain audio if configured.",
	},
	{
		id: "bsb",
		code: "BSB",
		name: "Berean Standard Bible",
		nativeName: "Berean Standard Bible",
		language: "en",
		source: "helloao",
		externalId: "BSB",
		hasAudio: true,
		audioLabel: "Human Narrators (David, Hays, Souer)",
		description: "Modern literal English translation with 3 zero-key human audio recordings.",
	},
	{
		id: "kjv",
		code: "KJV",
		name: "King James Version",
		nativeName: "King James (Authorized) Version",
		language: "en",
		source: "helloao",
		externalId: "eng_kjv",
		hasAudio: true,
		audioLabel: "Human Recording (Wordproject)",
		description: "Classic English translation with zero-key human audio recording.",
	},
	{
		id: "web",
		code: "WEB",
		name: "World English Bible",
		nativeName: "World English Bible",
		language: "en",
		source: "helloao",
		externalId: "ENGWEBP",
		hasAudio: false,
		description: "Public-domain modern English translation.",
	},
	{
		id: "asv",
		code: "ASV",
		name: "American Standard Version",
		nativeName: "American Standard Version (1901)",
		language: "en",
		source: "helloao",
		externalId: "eng_asv",
		hasAudio: false,
		description: "Literal classic English translation.",
	},
];

export const BUILTIN_KOREAN_TRANSLATIONS: readonly TranslationMeta[] = [
	{
		id: "krv",
		code: "개역한글",
		name: "Korean Revised Version (1961)",
		nativeName: "성경전서 개역한글판 (KRV)",
		language: "ko",
		source: "bundled",
		hasAudio: true,
		audioLabel: "Korean Audio (Wordproject / Custom KRV)",
		description:
			"Public-domain 1961 개역한글 text bundled locally, synced with Korean human narration.",
	},
	{
		id: "kor_old",
		code: "한글1910",
		name: "Korean Bible (1910 / Wordproject)",
		nativeName: "한국어 성경 (1910)",
		language: "ko",
		source: "helloao",
		externalId: "kor_old",
		hasAudio: true,
		audioLabel: "Human Recording (Wordproject)",
		description: "Public-domain Korean Bible via HelloAO with directly matched chapter MP3 audio.",
	},
];

export const ALL_BUILTIN_TRANSLATIONS: readonly TranslationMeta[] = [
	...BUILTIN_ENGLISH_TRANSLATIONS,
	...BUILTIN_KOREAN_TRANSLATIONS,
];

export function getBuiltinTranslation(id: string): TranslationMeta | undefined {
	return ALL_BUILTIN_TRANSLATIONS.find((t) => t.id === id);
}
