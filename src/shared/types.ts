export type Testament = "OT" | "NT";

export interface BookMeta {
	number: number;
	usfm: string;
	en: string;
	ko: string;
	enShort: string;
	koShort: string;
	chapters: number;
	testament: Testament;
}

export type TranslationLanguage = "en" | "ko";
export type TranslationSource = "bundled" | "helloao" | "bible-brain";

export interface TranslationMeta {
	id: string;
	code: string;
	name: string;
	nativeName: string;
	language: TranslationLanguage;
	source: TranslationSource;
	externalId?: string;
	hasAudio: boolean;
	audioLabel?: string;
	audioFilesetIds?: string[];
	description: string;
}

export type WordPos =
	"noun" | "verb" | "adj" | "adv" | "pronoun" | "particle" | "name" | "numeral" | "interj";

export interface LexiconEntry {
	gloss: string;
	hanja?: string;
	pos?: WordPos;
}

export type LexiconMap = Record<string, LexiconEntry>;

export interface GlossToken {
	raw: string;
	leadPunct: string;
	word: string;
	trailPunct: string;
	lemma: string;
	gloss: string;
	hanja?: string;
	pos?: WordPos;
	grammarNote?: string;
	matched: boolean;
	footnoteId?: string;
}

export interface FootnoteVocabEntry {
	id: string;
	lemma: string;
	surfaceForms: string[];
	verses: number[];
	gloss: string;
	hanja?: string;
	pos?: WordPos;
	grammarNote?: string;
}

export interface KrvGrammarNote {
	id: string;
	pattern: string;
	modern: string;
	explanation: string;
	examples: string[];
	verses: number[];
}

export interface VerseEntry {
	verse: number;
	text: string;
	heading?: string;
}

export interface BookBibleData {
	translationId: string;
	bookNumber: number;
	usfm: string;
	chapters: Record<string, VerseEntry[]>;
}

export interface AlignedVerse {
	verse: number;
	enText: string | null;
	enHeading?: string;
	koText: string | null;
	koHeading?: string;
	tokens: GlossToken[];
}

export interface AudioTrackOption {
	id: string;
	label: string;
	language: TranslationLanguage;
	translationId: string;
	url: string;
	source: "helloao" | "bible-brain" | "esv-api" | "custom";
	verseTimings?: Record<number, number>;
	note?: string;
}

export interface ChapterAudioResponse {
	bookUsfm: string;
	chapter: number;
	tracks: AudioTrackOption[];
	unavailableReason?: string;
}

export interface ParsedReference {
	bookNumber: number;
	chapter: number;
	verse?: number;
}
