const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
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

const ASPIRATION_BY_LEAD: Record<number, string> = {
	0: "k",
	3: "t",
	7: "p",
	12: "ch",
};

const ASPIRATION_BY_FINAL: Record<number, string> = {
	1: "k",
	7: "t",
	19: "t",
	17: "p",
	22: "ch",
};

interface RomanSyllable {
	leadIdx: number;
	vowelIdx: number;
	trailIdx: number;
	leadStr: string;
	vowelStr: string;
	trailStr: string;
}

function isKGroupFinal(idx: number): boolean {
	return idx === 1 || idx === 2 || idx === 3 || idx === 9 || idx === 24;
}

function isTGroupFinal(idx: number): boolean {
	return (
		idx === 7 || idx === 19 || idx === 20 || idx === 22 || idx === 23 || idx === 25 || idx === 27
	);
}

function isPGroupFinal(idx: number): boolean {
	return idx === 17 || idx === 18 || idx === 26;
}

function romanizeHangulRun(run: string): string {
	const syllables: RomanSyllable[] = [];
	for (let i = 0; i < run.length; i++) {
		const sIdx = run.charCodeAt(i) - HANGUL_START;
		const leadIdx = Math.floor(sIdx / 588);
		const vowelIdx = Math.floor((sIdx % 588) / 28);
		const trailIdx = sIdx % 28;
		syllables.push({
			leadIdx,
			vowelIdx,
			trailIdx,
			leadStr: ROMAN_INITIALS[leadIdx],
			vowelStr: ROMAN_VOWELS[vowelIdx],
			trailStr: ROMAN_FINALS[trailIdx],
		});
	}

	for (let i = 0; i < syllables.length - 1; i++) {
		const curr = syllables[i];
		const next = syllables[i + 1];
		if (curr.trailIdx === 0) continue;

		if (next.leadIdx === 11) {
			// Liaison into silent initial ㅇ
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
				if (next.vowelIdx === 20 && curr.trailIdx === 7) {
					next.leadStr = "j";
				} else if (next.vowelIdx === 20 && curr.trailIdx === 25) {
					next.leadStr = "ch";
				} else {
					next.leadStr = moved;
				}
			}
			continue;
		}

		// ㅎ aspiration with stops
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

		// Liquidization (ㄴ + ㄹ / ㄹ + ㄴ)
		if (
			(curr.trailIdx === 4 && next.leadIdx === 5) ||
			(curr.trailIdx === 8 && next.leadIdx === 2)
		) {
			curr.trailStr = "l";
			next.leadStr = "l";
			continue;
		}

		// Nasalization before ㄴ (2) or ㅁ (6) or ㄹ (5, when final is not ㄴ/ㄹ)
		if (next.leadIdx === 2 || next.leadIdx === 6 || next.leadIdx === 5) {
			if (isKGroupFinal(curr.trailIdx)) curr.trailStr = "ng";
			else if (isTGroupFinal(curr.trailIdx)) curr.trailStr = "n";
			else if (isPGroupFinal(curr.trailIdx)) curr.trailStr = "m";

			if (next.leadIdx === 5 && curr.trailIdx !== 8 && curr.trailIdx !== 15) {
				next.leadStr = "n";
			}
		}
	}

	return syllables.map((s) => `${s.leadStr}${s.vowelStr}${s.trailStr}`).join("-");
}

export function romanizeHangul(text: string): string {
	if (!text) return "";
	let out = "";
	let run = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (isHangulSyllable(ch)) {
			run += ch;
		} else {
			if (run) {
				out += romanizeHangulRun(run);
				run = "";
			}
			out += ch;
		}
	}
	if (run) {
		out += romanizeHangulRun(run);
	}
	return out;
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
