const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const FINALS = "ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";

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

function getLastFinalIndex(word: string): { code: number; finalIdx: number } | null {
	if (!word) return null;
	const code = word.charCodeAt(word.length - 1);
	if (code < HANGUL_START || code > HANGUL_END) return null;
	return { code, finalIdx: (code - HANGUL_START) % 28 };
}

export function hasFinalConsonant(word: string): boolean {
	const info = getLastFinalIndex(word);
	return info !== null && info.finalIdx > 0;
}

export function replaceLastFinalConsonant(word: string, finalJamo: string): string | null {
	const info = getLastFinalIndex(word);
	if (!info) return null;
	const targetFinalIdx = finalJamo === "" ? 0 : FINALS.indexOf(finalJamo) + 1;
	if (finalJamo !== "" && targetFinalIdx === 0) return null;
	return `${word.slice(0, -1)}${String.fromCharCode(info.code - info.finalIdx + targetFinalIdx)}`;
}

export function stripLastFinalConsonant(word: string): { stem: string; final: string } | null {
	const info = getLastFinalIndex(word);
	if (!info || info.finalIdx === 0) return null;
	return {
		stem: `${word.slice(0, -1)}${String.fromCharCode(info.code - info.finalIdx)}`,
		final: FINALS[info.finalIdx - 1],
	};
}
