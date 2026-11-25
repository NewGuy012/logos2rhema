import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { BIBLE_BOOKS } from "../src/shared/books";
import { containsHangul, romanizeHangul } from "../src/shared/hangul";
import { analyzeKoreanChapter, analyzeKoreanWord } from "../src/shared/korean-morphology";
import type { BookBibleData, LexiconMap } from "../src/shared/types";

const SAMPLE_LEXICON: LexiconMap = {
	어둡다: { gloss: "to be dark", pos: "adj" },
};

describe("korean-morphology", () => {
	it("decomposes particles, honorifics, irregulars, archaic endings, and resists noisy lexicon/prototype keys", () => {
		const t1 = analyzeKoreanWord("태초에", SAMPLE_LEXICON);
		expect(t1.lemma).toBe("태초");
		expect(t1.gloss).toContain("beginning");
		expect(t1.grammarNote).toContain("에");

		const t4 = analyzeKoreanWord("창조하시니라", SAMPLE_LEXICON);
		expect(t4.lemma).toBe("창조하다");
		expect(t4.gloss).toBe("to create");
		expect(t4.grammarNote).toContain("-시니라");

		// Prioritizes biblical stem + particle over noisy exact entry & ignores Object.prototype
		expect(analyzeKoreanWord("위에", { 위에: { gloss: "hereinbefore" } }).lemma).toBe("위");
		expect(analyzeKoreanWord("toString", SAMPLE_LEXICON).matched).toBe(false);
		expect(analyzeKoreanWord("constructor", SAMPLE_LEXICON).matched).toBe(false);

		// Long punctuation runs scan linearly (no ReDoS)
		const punctWord = analyzeKoreanWord(`${"(".repeat(2000)}하나님이${")".repeat(2000)}`);
		expect(punctWord.lemma).toBe("하나님");

		const noisyLexicon: LexiconMap = {
			하: { gloss: "Below" },
			죽: { gloss: "Rice porridge" },
			함: { gloss: "box" },
			사서: { gloss: "librarian" },
			여기: { gloss: "finicky" },
			어둡다: { gloss: "to be dark", pos: "adj" },
			용사: { gloss: "hero, soldier" },
		};
		for (const [surface, lemma] of [
			["만드시니라", "만들다"],
			["지으신", "짓다"],
			["들어도", "듣다"],
			["어두운", "어둡다"],
			["다닐찌라도", "다니다"],
			["멸망치", "멸망하다"],
			["함이라", "하다"],
			["죽은", "죽다"],
			["무를", "무르다"],
			["사서", "사다"],
			["불어", "불다"],
			["물어", "묻다"],
			["세워", "세우다"],
			["가져다가", "가지다"],
			["이름이시로다", "이름"],
			["용사시니", "용사"],
			["할찌니라", "하다"],
			["말찌니라", "말다"],
			["들을찌어다", "듣다"],
			["비취라", "비취다"],
		] as const) {
			expect(analyzeKoreanWord(surface, noisyLexicon).lemma).toBe(lemma);
		}
		expect(analyzeKoreanWord("여기", noisyLexicon).gloss).toBe("here");
	});

	it("builds deduplicated chapter footnotes, KRV grammar notes, and phonetic romanization", () => {
		const analysis = analyzeKoreanChapter(
			[
				{ verse: 1, text: "태초에 하나님이 천지를 창조하시니라" },
				{ verse: 3, text: "하나님이 가라사대 빛이 있으라 하시매 들을찌어다" },
			],
			SAMPLE_LEXICON,
		);
		const godEntry = analysis.footnotes.find((f) => f.lemma === "하나님");
		expect(godEntry?.verses).toEqual([1, 3]);
		expect(godEntry?.surfaceForms).toEqual(["하나님이"]);

		const grammarIds = analysis.grammarNotes.map((g) => g.id);
		expect(grammarIds).toEqual(
			expect.arrayContaining(["krv-sinira", "krv-garasadae", "krv-mae", "krv-jini"]),
		);

		expect(romanizeHangul("하나님이")).toBe("ha-na-ni-mi");
		expect(romanizeHangul("있으라")).toBe("i-sseu-ra");
		expect(romanizeHangul("없는")).toBe("eom-neun");
		expect(romanizeHangul("성령")).toBe("seong-nyeong");
		expect(romanizeHangul("좋다")).toBe("jo-ta");
	});

	it("handles phonological allomorphy, dual-POS entries, and representative biblical disambiguations", async () => {
		const rootDir = join(import.meta.dir, "..");
		const lexicon: LexiconMap = await Bun.file(join(rootDir, "public/data/lexicon.json")).json();

		for (const [surface, expected] of [
			["마시고", "마시다"],
			["입고", "입다"],
			["입을", "입"],
			["남아", "남다"],
			["들고", "들다"],
			["들으소서", "듣다"],
			["부음을", "붓다"],
			["도와", "돕다"],
			["자와", "자"],
			["것임이니라", "것"],
			["마옵소서", "말다"],
			["선", "서다"],
			["선을", "선"],
			["제자들에게", "제자"],
			["일렀으되", "이르다"],
			["썼고", "쓰다"],
			["여시고", "열다"],
			["두려워", "두렵다"],
			["아름다와", "아름답다"],
			["무엇이관대", "무엇"],
			["지나갔음이러라", "지나가다"],
			["마른", "마르다"],
			["마르다가", "마르다"],
		] as const) {
			expect(analyzeKoreanWord(surface, lexicon).lemma).toBe(expected);
		}

		for (const [surface, glossSub] of [
			["보좌에", "throne"],
			["공의를", "righteousness"],
			["그룹들이", "cherub"],
			["장사하고", "bury"],
			["이적을", "miracle"],
			["중수하였고", "repair"],
			["중수를", "weight"],
			["에서의", "Esau"],
		] as const) {
			expect(analyzeKoreanWord(surface, lexicon).gloss).toContain(glossSub);
		}
		expect(analyzeKoreanWord("누가", lexicon).pos).toBe("pronoun");
	});

	it("validates public lexicon formatting and 66-book Bible data integrity", async () => {
		const rootDir = join(import.meta.dir, "..");
		const lexicon: LexiconMap = await Bun.file(join(rootDir, "public/data/lexicon.json")).json();

		const lexiconFailures: string[] = [];
		for (const [key, entry] of Object.entries(lexicon)) {
			const openParens = entry.gloss.match(/\(/g)?.length ?? 0;
			const closeParens = entry.gloss.match(/\)/g)?.length ?? 0;
			if (
				!containsHangul(key) ||
				entry.gloss.length < 2 ||
				entry.pos === undefined ||
				entry.gloss.includes("`") ||
				containsHangul(entry.gloss) ||
				/^\d+$/.test(entry.gloss) ||
				/\b(sth|sb|what the hell|napoo|ejaculation|petuntse|sharpbelly|heavy water|license plate|aiding the enemy)\b|\(English\)/i.test(
					entry.gloss,
				) ||
				openParens !== closeParens
			) {
				lexiconFailures.push(`${key}: ${JSON.stringify(entry)}`);
			}
		}
		expect(lexiconFailures).toEqual([]);

		async function validateBibleDir(dir: string): Promise<string[]> {
			const failures: string[] = [];
			for (const book of BIBLE_BOOKS) {
				const data = (await Bun.file(join(dir, `${book.usfm}.json`)).json()) as BookBibleData;
				for (let ch = 1; ch <= book.chapters; ch++) {
					const verses = data.chapters[String(ch)];
					if (!verses?.length) {
						failures.push(`${book.usfm} ${ch}: empty or missing`);
						continue;
					}
					for (const v of verses) {
						if (v.text.trim().length === 0) failures.push(`${book.usfm} ${ch}:${v.verse}: empty`);
					}
				}
			}
			return failures;
		}

		const localEsvDir = join(rootDir, ".cache/esv-local");
		const bibleFailures = [
			...(await validateBibleDir(join(rootDir, "public/data/bibles/krv"))),
			...((await Bun.file(join(localEsvDir, "GEN.json")).exists())
				? await validateBibleDir(localEsvDir)
				: []),
		];
		expect(bibleFailures).toEqual([]);
	});
});
