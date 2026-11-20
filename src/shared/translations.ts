import type { TranslationLanguage, TranslationMeta } from "./types";

/** Canonical Bible editions (one per language). */
export const CANONICAL_BIBLES: Record<TranslationLanguage, TranslationMeta> = {
	en: {
		id: "esv",
		code: "ESV",
		nativeName: "ESV® Bible (English Standard Version®)",
	},
	ko: {
		id: "krv",
		code: "개역한글",
		nativeName: "성경전서 개역한글판 (1961)",
	},
};
