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

export interface TranslationMeta {
	id: string;
	code: string;
	name: string;
	nativeName: string;
	language: TranslationLanguage;
	hasAudio: boolean;
	audioLabel?: string;
}

type WordPos =
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
	language: TranslationLanguage | (string & {});
	translationId: string;
	url: string;
	source: "esv-api" | "custom" | "helloao";
	verseTimings?: Record<number, number>;
	note?: string;
}

export interface BookAudioTimingsData {
	translationId: string;
	audioSource: string;
	usfm: string;
	chapters: Record<string, Record<string, number>>;
}

export interface ChapterAudioResponse {
	bookUsfm: string;
	chapter: number;
	tracks: AudioTrackOption[];
}

export interface ReaderConfigResponse {
	english: TranslationMeta;
	korean: TranslationMeta;
	krvSyncedAudioEnabled: boolean;
	esvAudioEnabled: boolean;
}

export type CommentaryId = "tyndale" | "matthew-henry";
export type RightRailTab = "dictionary" | "commentary";

export interface CommentaryMeta {
	id: CommentaryId;
	name: string;
	shortName: string;
	description: string;
	license: string;
	licenseUrl: string;
	website: string;
	attribution: string;
}

export interface CommentaryEntry {
	id: string;
	verseStart: number;
	verseEnd?: number;
	heading?: string;
	paragraphs: string[];
}

export interface ChapterCommentaryResponse {
	commentary: CommentaryMeta;
	bookUsfm: string;
	chapter: number;
	bookIntroduction?: string[];
	introduction?: string[];
	entries: CommentaryEntry[];
}

export interface ParsedReference {
	bookNumber: number;
	chapter: number;
	verse?: number;
}

export interface FavoriteItem {
	id: string;
	bookNumber: number;
	chapter: number;
	verse?: number;
	enText?: string;
	koText?: string;
	createdAt: number;
}

export interface HighlightItem {
	id: string;
	bookNumber: number;
	chapter: number;
	verse: number;
	lang: TranslationLanguage;
	start: number;
	end: number;
	text: string;
	createdAt: number;
}
