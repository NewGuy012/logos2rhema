import { describe, expect, it } from "bun:test";

import { analyzeKoreanChapter, analyzeKoreanWord } from "../src/shared/korean-morphology";
import type { LexiconMap } from "../src/shared/types";

const SAMPLE_LEXICON: LexiconMap = {
	어둡다: { gloss: "to be dark", pos: "adj" },
};

describe("korean-morphology", () => {
	it("decomposes Genesis 1:1 words with particles and honorific endings", () => {
		const t1 = analyzeKoreanWord("태초에", SAMPLE_LEXICON);
		expect(t1.lemma).toBe("태초");
		expect(t1.gloss).toContain("beginning");
		expect(t1.grammarNote).toContain("에");

		const t2 = analyzeKoreanWord("하나님이", SAMPLE_LEXICON);
		expect(t2.lemma).toBe("하나님");
		expect(t2.gloss).toBe("God");
		expect(t2.grammarNote).toContain("subject marker");

		const t4 = analyzeKoreanWord("창조하시니라", SAMPLE_LEXICON);
		expect(t4.lemma).toBe("창조하다");
		expect(t4.gloss).toBe("to create");
		expect(t4.grammarNote).toContain("-시니라");
	});

	it("prioritizes biblical stem + particle over noisy exact lexicon entries", () => {
		const trickyLexicon: LexiconMap = {
			위에: { gloss: "hereinbefore" },
		};
		const token = analyzeKoreanWord("위에", trickyLexicon);
		expect(token.lemma).toBe("위");
		expect(token.gloss).toContain("above");
		expect(token.grammarNote).toContain("에");
	});

	it("handles irregular stems and archaic KRV endings", () => {
		expect(analyzeKoreanWord("만드시니라").lemma).toBe("만들다");
		expect(analyzeKoreanWord("지으신").lemma).toBe("짓다");
		expect(analyzeKoreanWord("들어도").lemma).toBe("듣다");
		expect(analyzeKoreanWord("아나이다").lemma).toBe("알다");
		expect(analyzeKoreanWord("다닐찌라도").lemma).toBe("다니다");
		expect(analyzeKoreanWord("멸망치").lemma).toBe("멸망하다");
		expect(analyzeKoreanWord("갈까").lemma).toBe("가다");
		expect(analyzeKoreanWord("얻게").lemma).toBe("얻다");
		expect(analyzeKoreanWord("어두운", SAMPLE_LEXICON).lemma).toBe("어둡다");
	});

	it("avoids 1-syllable and homograph false positives across Ruth 4, Psalm 23, and Gospels", () => {
		const noisyLexicon: LexiconMap = {
			하: { gloss: "Below, underneath" },
			죽: { gloss: "Rice porridge" },
			무: { gloss: "Radish" },
			함: { gloss: "box for clothes or stuff" },
			누: { gloss: "sack" },
			모: { gloss: "corner, angle" },
			고하: { gloss: "worth, quality" },
			행하: { gloss: "giving gifts or money to the workers" },
			사라: { gloss: "sarah" },
			사서: { gloss: "librarian" },
			자라: { gloss: "softshell" },
			여기: { gloss: "finicky in a bad way" },
		};

		expect(analyzeKoreanWord("하는", noisyLexicon).lemma).toBe("하다");
		expect(analyzeKoreanWord("함이라", noisyLexicon).lemma).toBe("하다");
		expect(analyzeKoreanWord("행하는", noisyLexicon).lemma).toBe("행하다");
		expect(analyzeKoreanWord("죽은", noisyLexicon).lemma).toBe("죽다");
		expect(analyzeKoreanWord("무를", noisyLexicon).lemma).toBe("무르다");
		expect(analyzeKoreanWord("누이시며", noisyLexicon).lemma).toBe("누이다");
		expect(analyzeKoreanWord("모이고", noisyLexicon).lemma).toBe("모이다");
		expect(analyzeKoreanWord("사라고", noisyLexicon).lemma).toBe("사다");
		expect(analyzeKoreanWord("사서", noisyLexicon).lemma).toBe("사다");
		expect(analyzeKoreanWord("고하여", noisyLexicon).lemma).toBe("고하다");
		expect(analyzeKoreanWord("취하라", noisyLexicon).lemma).toBe("취하다");
		expect(analyzeKoreanWord("여기", noisyLexicon).gloss).toBe("here");
		expect(analyzeKoreanWord("성문에", noisyLexicon).gloss).toBe("city gate");
		expect(analyzeKoreanWord("기업을", noisyLexicon).gloss).toContain("inheritance");
		expect(analyzeKoreanWord("지방에서", noisyLexicon).gloss).toContain("region");
		expect(analyzeKoreanWord("상을", noisyLexicon).lemma).toBe("상");
		expect(analyzeKoreanWord("아기를", noisyLexicon).lemma).toBe("아기");
		expect(analyzeKoreanWord("나지", noisyLexicon).lemma).toBe("나다");
	});

	it("builds deduplicated chapter footnotes and KRV grammar notes", () => {
		const analysis = analyzeKoreanChapter(
			[
				{ verse: 1, text: "태초에 하나님이 천지를 창조하시니라" },
				{ verse: 3, text: "하나님이 가라사대 빛이 있으라 하시매" },
			],
			SAMPLE_LEXICON,
		);

		const godEntry = analysis.footnotes.find((f) => f.lemma === "하나님");
		expect(godEntry).toBeDefined();
		expect(godEntry?.verses).toEqual([1, 3]);
		expect(godEntry?.surfaceForms).toEqual(["하나님이"]);

		const grammarIds = analysis.grammarNotes.map((g) => g.id);
		expect(grammarIds).toContain("krv-sinira");
		expect(grammarIds).toContain("krv-garasadae");
		expect(grammarIds).toContain("krv-mae");
	});
});
