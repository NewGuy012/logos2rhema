import type { TranslationLanguage, TranslationMeta } from "./types";

/**
 * Canonical Bible registry: strictly one version per language.
 * Additional languages can be plugged in via Bible Brain ISO + bibleId mappings.
 */
export const CANONICAL_BIBLES: Record<TranslationLanguage, TranslationMeta> = {
	en: {
		id: "esv",
		code: "ESV",
		name: "English Standard Version",
		nativeName: "English Standard Version (2001)",
		language: "en",
		languageLabel: "English",
		source: "bundled",
		bibleBrainIso: "eng",
		bibleBrainBibleId: "ENGESV",
		preferredAudioFilesets: {
			OT: ["ENGESVO1DA", "ENGESVO2DA"],
			NT: ["ENGESVN1DA", "ENGESVN2DA"],
		},
		hasAudio: false,
		description:
			"Bundled local ESV text; uses Bible Brain audio + verse timestamps when configured, or Crossway ESV audio as fallback.",
	},
	ko: {
		id: "krv",
		code: "개역한글",
		name: "Korean Revised Version (1961)",
		nativeName: "성경전서 개역한글판 (1961)",
		language: "ko",
		languageLabel: "한국어",
		source: "bundled",
		bibleBrainIso: "kor",
		bibleBrainBibleId: "KORKRV",
		hasAudio: true,
		audioLabel: "Korean Narration (Bible Brain / Wordproject)",
		description:
			"Bundled local 1961 개역한글 text synced with Korean human narration and verse timestamps when available.",
	},
};

export const BUILTIN_ENGLISH_TRANSLATIONS: readonly TranslationMeta[] = [CANONICAL_BIBLES.en];
export const BUILTIN_KOREAN_TRANSLATIONS: readonly TranslationMeta[] = [CANONICAL_BIBLES.ko];

export const ALL_BUILTIN_TRANSLATIONS: readonly TranslationMeta[] = [
	CANONICAL_BIBLES.en,
	CANONICAL_BIBLES.ko,
];

export function getCanonicalTranslation(language: TranslationLanguage): TranslationMeta {
	return CANONICAL_BIBLES[language];
}

export function getBuiltinTranslation(id: string): TranslationMeta | undefined {
	return ALL_BUILTIN_TRANSLATIONS.find((t) => t.id === id);
}
