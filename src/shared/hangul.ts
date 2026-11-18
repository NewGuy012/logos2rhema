const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

const INITIALS = [
	"ㄱ",
	"ㄲ",
	"ㄴ",
	"ㄷ",
	"ㄸ",
	"ㄹ",
	"ㅁ",
	"ㅂ",
	"ㅃ",
	"ㅅ",
	"ㅆ",
	"ㅇ",
	"ㅈ",
	"ㅉ",
	"ㅊ",
	"ㅋ",
	"ㅌ",
	"ㅍ",
	"ㅎ",
] as const;

const MEDIALS = [
	"ㅏ",
	"ㅐ",
	"ㅑ",
	"ㅒ",
	"ㅓ",
	"ㅔ",
	"ㅕ",
	"ㅖ",
	"ㅗ",
	"ㅘ",
	"ㅙ",
	"ㅚ",
	"ㅛ",
	"ㅜ",
	"ㅝ",
	"ㅞ",
	"ㅟ",
	"ㅠ",
	"ㅡ",
	"ㅢ",
	"ㅣ",
] as const;

const FINALS = [
	"",
	"ㄱ",
	"ㄲ",
	"ㄳ",
	"ㄴ",
	"ㄵ",
	"ㄶ",
	"ㄷ",
	"ㄹ",
	"ㄺ",
	"ㄻ",
	"ㄼ",
	"ㄽ",
	"ㄾ",
	"ㄿ",
	"ㅀ",
	"ㅁ",
	"ㅂ",
	"ㅄ",
	"ㅅ",
	"ㅆ",
	"ㅇ",
	"ㅈ",
	"ㅊ",
	"ㅋ",
	"ㅌ",
	"ㅍ",
	"ㅎ",
] as const;

export interface HangulJamo {
	initial: string;
	medial: string;
	final: string;
	initialIdx: number;
	medialIdx: number;
	finalIdx: number;
}

export function isHangulSyllable(char: string): boolean {
	if (!char) return false;
	const code = char.charCodeAt(0);
	return code >= HANGUL_START && code <= HANGUL_END;
}

export function containsHangul(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code >= HANGUL_START && code <= HANGUL_END) return true;
	}
	return false;
}

export function decomposeSyllable(char: string): HangulJamo | null {
	if (!isHangulSyllable(char)) return null;
	const offset = char.charCodeAt(0) - HANGUL_START;
	const finalIdx = offset % 28;
	const medialIdx = ((offset - finalIdx) / 28) % 21;
	const initialIdx = Math.floor((offset - finalIdx) / 28 / 21);
	return {
		initial: INITIALS[initialIdx],
		medial: MEDIALS[medialIdx],
		final: FINALS[finalIdx],
		initialIdx,
		medialIdx,
		finalIdx,
	};
}

export function composeSyllable(initialIdx: number, medialIdx: number, finalIdx: number): string {
	return String.fromCharCode(HANGUL_START + (initialIdx * 21 + medialIdx) * 28 + finalIdx);
}

export function hasFinalConsonant(word: string): boolean {
	if (!word) return false;
	const last = word[word.length - 1];
	const jamo = decomposeSyllable(last);
	return jamo !== null && jamo.finalIdx > 0;
}

export function getFinalConsonant(word: string): string {
	if (!word) return "";
	const jamo = decomposeSyllable(word[word.length - 1]);
	return jamo ? jamo.final : "";
}

export function replaceLastFinalConsonant(word: string, finalJamo: string): string | null {
	if (!word) return null;
	const last = word[word.length - 1];
	const jamo = decomposeSyllable(last);
	if (!jamo) return null;
	const targetFinalIdx = FINALS.indexOf(finalJamo as (typeof FINALS)[number]);
	if (targetFinalIdx < 0) return null;
	return `${word.slice(0, -1)}${composeSyllable(jamo.initialIdx, jamo.medialIdx, targetFinalIdx)}`;
}

export function stripLastFinalConsonant(word: string): { stem: string; final: string } | null {
	if (!word) return null;
	const jamo = decomposeSyllable(word[word.length - 1]);
	if (!jamo || jamo.finalIdx === 0) return null;
	return {
		stem: `${word.slice(0, -1)}${composeSyllable(jamo.initialIdx, jamo.medialIdx, 0)}`,
		final: jamo.final,
	};
}
