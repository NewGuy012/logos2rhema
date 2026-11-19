import type { TranslationLanguage, TranslationMeta } from "./types";

/**
 * Canonical Bible registry: strictly one bundled edition per language.
 */
export const CANONICAL_BIBLES: Record<TranslationLanguage, TranslationMeta> = {
	en: {
		id: "esv",
		code: "ESV",
		name: "English Standard Version",
		nativeName: "English Standard Version (2001)",
		language: "en",
		bibleBrainBibleId: "ENGESV",
		preferredAudioFilesets: {
			OT: ["ENGESVO1DA", "ENGESVO2DA"],
			NT: ["ENGESVN1DA", "ENGESVN2DA"],
		},
		hasAudio: false,
	},
	ko: {
		id: "krv",
		code: "개역한글",
		name: "Korean Revised Version (1961)",
		nativeName: "성경전서 개역한글판 (1961)",
		language: "ko",
		bibleBrainBibleId: "KORKRV",
		hasAudio: true,
		audioLabel: "Korean Narration (Bible Brain / Wordproject)",
	},
};
