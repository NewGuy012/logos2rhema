const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const INITIALS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const FINALS = "ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";

const ROMAN_INITIALS = [
	"g",
	"kk",
	"n",
	"d",
	"tt",
	"r",
	"m",
	"b",
	"pp",
	"s",
	"ss",
	"",
	"j",
	"jj",
	"ch",
	"k",
	"t",
	"p",
	"h",
] as const;

const ROMAN_VOWELS = [
	"a",
	"ae",
	"ya",
	"yae",
	"eo",
	"e",
	"yeo",
	"ye",
	"o",
	"wa",
	"wae",
	"oe",
	"yo",
	"u",
	"wo",
	"we",
	"wi",
	"yu",
	"eu",
	"ui",
	"i",
] as const;

const ROMAN_FINALS = [
	"",
	"k",
	"k",
	"k",
	"n",
	"n",
	"n",
	"t",
	"l",
	"k",
	"m",
	"l",
	"l",
	"l",
	"p",
	"l",
	"m",
	"p",
	"p",
	"t",
	"t",
	"ng",
	"t",
	"t",
	"k",
	"t",
	"p",
	"t",
] as const;

const LIAISON_INITIAL_BY_FINAL: Record<number, string> = {
	1: "g",
	2: "kk",
	4: "n",
	7: "d",
	8: "r",
	16: "m",
	17: "b",
	19: "s",
	20: "ss",
	22: "j",
	23: "ch",
	24: "k",
	25: "t",
	26: "p",
};

const DOUBLE_FINAL_LIAISON: Record<number, [string, string]> = {
	3: ["k", "ss"],
	5: ["n", "j"],
	6: ["", "n"],
	9: ["l", "g"],
	10: ["l", "m"],
	11: ["l", "b"],
	12: ["l", "ss"],
	13: ["l", "t"],
	14: ["l", "p"],
	15: ["", "r"],
	18: ["p", "ss"],
};

const ASPIRATION_BY_LEAD: Record<number, string> = { 0: "k", 3: "t", 7: "p", 12: "ch" };
const ASPIRATION_BY_FINAL: Record<number, string> = { 1: "k", 7: "t", 19: "t", 17: "p", 22: "ch" };

const K_GROUP_FINALS = new Set([1, 2, 3, 9, 24]);
const T_GROUP_FINALS = new Set([7, 19, 20, 22, 23, 25, 27]);
const P_GROUP_FINALS = new Set([17, 18, 26]);

function romanizeHangulRun(run: string): string {
	const syllables = Array.from(run, (ch) => {
		const sIdx = ch.charCodeAt(0) - HANGUL_START;
		const leadIdx = Math.floor(sIdx / 588);
		const vowelIdx = Math.floor((sIdx % 588) / 28);
		const trailIdx = sIdx % 28;
		return {
			leadIdx,
			vowelIdx,
			trailIdx,
			leadStr: ROMAN_INITIALS[leadIdx] as string,
			vowelStr: ROMAN_VOWELS[vowelIdx] as string,
			trailStr: ROMAN_FINALS[trailIdx] as string,
		};
	});

	for (let i = 0; i < syllables.length - 1; i++) {
		const curr = syllables[i];
		const next = syllables[i + 1];
		if (curr.trailIdx === 0) continue;

		if (next.leadIdx === 11) {
			if (curr.trailIdx === 21) continue;
			if (curr.trailIdx === 27) {
				curr.trailStr = "";
				continue;
			}
			const doublePair = DOUBLE_FINAL_LIAISON[curr.trailIdx];
			if (doublePair) {
				curr.trailStr = doublePair[0];
				next.leadStr = doublePair[1];
				continue;
			}
			const moved = LIAISON_INITIAL_BY_FINAL[curr.trailIdx];
			if (moved) {
				curr.trailStr = "";
				next.leadStr =
					next.vowelIdx === 20 && curr.trailIdx === 7
						? "j"
						: next.vowelIdx === 20 && curr.trailIdx === 25
							? "ch"
							: moved;
			}
			continue;
		}

		if (
			(curr.trailIdx === 27 || curr.trailIdx === 6 || curr.trailIdx === 15) &&
			next.leadIdx in ASPIRATION_BY_LEAD
		) {
			curr.trailStr = curr.trailIdx === 6 ? "n" : curr.trailIdx === 15 ? "l" : "";
			next.leadStr = ASPIRATION_BY_LEAD[next.leadIdx];
			continue;
		}
		if (next.leadIdx === 18 && curr.trailIdx in ASPIRATION_BY_FINAL) {
			curr.trailStr = "";
			next.leadStr = ASPIRATION_BY_FINAL[curr.trailIdx];
			continue;
		}

		if (
			(curr.trailIdx === 4 && next.leadIdx === 5) ||
			(curr.trailIdx === 8 && next.leadIdx === 2)
		) {
			curr.trailStr = "l";
			next.leadStr = "l";
			continue;
		}

		if (next.leadIdx === 2 || next.leadIdx === 6 || next.leadIdx === 5) {
			if (K_GROUP_FINALS.has(curr.trailIdx)) curr.trailStr = "ng";
			else if (T_GROUP_FINALS.has(curr.trailIdx)) curr.trailStr = "n";
			else if (P_GROUP_FINALS.has(curr.trailIdx)) curr.trailStr = "m";

			if (next.leadIdx === 5 && curr.trailIdx !== 8 && curr.trailIdx !== 15) {
				next.leadStr = "n";
			}
		}
	}

	return syllables.map((s) => `${s.leadStr}${s.vowelStr}${s.trailStr}`).join("-");
}

export function romanizeHangul(text: string): string {
	return text ? text.replace(/[\uAC00-\uD7A3]+/g, romanizeHangulRun) : "";
}

export function containsHangul(text: string): boolean {
	return /[\uAC00-\uD7A3]/.test(text);
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

export function endsWithOpenAEoVowel(word: string): boolean {
	const info = getLastFinalIndex(word);
	if (!info || info.finalIdx !== 0) return false;
	const jung = Math.floor((info.code - HANGUL_START) / 28) % 21;
	// Open vowels ㅏ (0), ㅐ (1), ㅓ (4), ㅔ (5) drop redundant -아/-어 in connectives.
	return jung === 0 || jung === 1 || jung === 4 || jung === 5;
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

export function getFirstInitialConsonant(word: string): string | null {
	if (!word) return null;
	const code = word.charCodeAt(0);
	if (code < HANGUL_START || code > HANGUL_END) return null;
	return INITIALS[Math.floor((code - HANGUL_START) / 588)];
}

/** True when the first syllable starts with silent ㅇ + vowel ㅗ (e.g. 오, 옵). */
export function startsWithOpenOVowel(word: string): boolean {
	if (!word) return false;
	const code = word.charCodeAt(0);
	if (code < HANGUL_START || code > HANGUL_END) return false;
	const sIdx = code - HANGUL_START;
	return Math.floor(sIdx / 588) === 11 && Math.floor((sIdx % 588) / 28) === 8;
}

/**
 * Restores an ㅡ-irregular syllable whose vowel dropped before -아/-어/-았/-었
 * (e.g. 따라 -> 따르, 써 -> 쓰, 썼 -> 쓰, 기뻐 -> 기쁘).
 */
export function restoreEuIrregularStem(word: string): string | null {
	const info = getLastFinalIndex(word);
	if (!info || (info.finalIdx !== 0 && info.finalIdx !== 20)) return null;
	const sIdx = info.code - HANGUL_START;
	const leadIdx = Math.floor(sIdx / 588);
	const vowelIdx = Math.floor((sIdx % 588) / 28);
	// ㅏ (0) or ㅓ (4) -> ㅡ (18)
	if (vowelIdx !== 0 && vowelIdx !== 4) return null;
	return `${word.slice(0, -1)}${String.fromCharCode(HANGUL_START + leadIdx * 588 + 18 * 28)}`;
}
