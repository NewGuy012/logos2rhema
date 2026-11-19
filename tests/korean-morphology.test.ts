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
				{ verse: 3, text: "하나님이 가라사대 빛이 있으라 하시매 들을찌어다" },
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
		expect(grammarIds).toContain("krv-jini");
	});

	it("romanizes Korean words with liaison, nasalization, and aspiration", () => {
		expect(romanizeHangul("여자에게")).toBe("yeo-ja-e-ge");
		expect(romanizeHangul("여자")).toBe("yeo-ja");
		expect(romanizeHangul("하나님이")).toBe("ha-na-ni-mi");
		expect(romanizeHangul("창조하시니라")).toBe("chang-jo-ha-si-ni-ra");
		expect(romanizeHangul("있으라")).toBe("i-sseu-ra");
		expect(romanizeHangul("없는")).toBe("eom-neun");
		expect(romanizeHangul("성령")).toBe("seong-nyeong");
		expect(romanizeHangul("좋다")).toBe("jo-ta");
	});

	it("ignores Object.prototype keys during glossary and lexicon lookup", () => {
		expect(analyzeKoreanWord("toString", SAMPLE_LEXICON).matched).toBe(false);
		expect(analyzeKoreanWord("constructor", SAMPLE_LEXICON).matched).toBe(false);
	});

	it("prevents noun-verb collisions and resolves KRV vowel contractions and copulas", () => {
		const extraLex: LexiconMap = {
			용사: { gloss: "hero, soldier" },
			절다: { gloss: "to hobble, limp" },
			달다: { gloss: "to be sweet" },
			몰다: { gloss: "to drive" },
			떨다: { gloss: "to tremble" },
		};
		expect(analyzeKoreanWord("불어", extraLex).lemma).toBe("불다");
		expect(analyzeKoreanWord("물어", extraLex).lemma).toBe("묻다");
		expect(analyzeKoreanWord("두어", extraLex).lemma).toBe("두다");
		expect(analyzeKoreanWord("내어", extraLex).lemma).toBe("내다");
		expect(analyzeKoreanWord("내려", extraLex).lemma).toBe("내리다");
		expect(analyzeKoreanWord("피하여", extraLex).lemma).toBe("피하다");
		expect(analyzeKoreanWord("속한", extraLex).lemma).toBe("속하다");
		expect(analyzeKoreanWord("강하신", extraLex).lemma).toBe("강하다");
		expect(analyzeKoreanWord("귀하여", extraLex).lemma).toBe("귀하다");
		expect(analyzeKoreanWord("주니라", extraLex).lemma).toBe("주다");
		expect(analyzeKoreanWord("전에는", extraLex).lemma).toBe("전");
		expect(analyzeKoreanWord("단을", extraLex).lemma).toBe("단");
		expect(analyzeKoreanWord("혼이", extraLex).lemma).toBe("혼");
		expect(analyzeKoreanWord("둘이", extraLex).lemma).toBe("둘");
		expect(analyzeKoreanWord("모은", extraLex).lemma).toBe("모으다");
		expect(analyzeKoreanWord("떠나", extraLex).lemma).toBe("떠나다");
		expect(analyzeKoreanWord("들어가", extraLex).lemma).toBe("들어가다");
		expect(analyzeKoreanWord("지켜", extraLex).lemma).toBe("지키다");
		expect(analyzeKoreanWord("돌이켜", extraLex).lemma).toBe("돌이키다");
		expect(analyzeKoreanWord("세워", extraLex).lemma).toBe("세우다");
		expect(analyzeKoreanWord("가져다가", extraLex).lemma).toBe("가지다");
		expect(analyzeKoreanWord("잠겼나이다", extraLex).lemma).toBe("잠기다");
		expect(analyzeKoreanWord("이름이시로다", extraLex).lemma).toBe("이름");
		expect(analyzeKoreanWord("용사시니", extraLex).lemma).toBe("용사");
		expect(analyzeKoreanWord("할찌니라", extraLex).lemma).toBe("하다");
		expect(analyzeKoreanWord("말찌니라", extraLex).lemma).toBe("말다");
		expect(analyzeKoreanWord("들을찌어다", extraLex).lemma).toBe("듣다");
		expect(analyzeKoreanWord("하였도다", extraLex).lemma).toBe("하다");
		expect(analyzeKoreanWord("가자", extraLex).lemma).toBe("가다");
		expect(analyzeKoreanWord("안식하시니라", extraLex).lemma).toBe("안식하다");
		expect(analyzeKoreanWord("비취라", extraLex).lemma).toBe("비취다");
	});

	it("handles phonological allomorphy, KRV archaic endings, irregulars, and multi-source biblical senses", async () => {
		const rootDir = join(import.meta.dir, "..");
		const lexicon: LexiconMap = await Bun.file(join(rootDir, "public/data/lexicon.json")).json();

		// Regular-before-irregular & phonological triggers (prevents 마시고 -> 말다, 들고 -> 듣다, 남아 -> 나다, 자와 -> 잡다)
		const expectedLemmas: ReadonlyArray<readonly [string, string]> = [
			["마시고", "마시다"],
			["마시지", "마시다"],
			["마시는", "마시다"],
			["마실", "마시다"],
			["드리라", "드리다"],
			["드릴", "드리다"],
			["버리라", "버리다"],
			["보이는", "보이다"],
			["이기는", "이기다"],
			["그치니라", "그치다"],
			["거두는", "거두다"],
			["기울이라", "기울이다"],
			["입은", "입다"],
			["입고", "입다"],
			["입지", "입다"],
			["입을", "입"],
			["남은", "남다"],
			["남아", "남다"],
			["삼아", "삼다"],
			["참아", "참다"],
			["들고", "들다"],
			["들으라", "듣다"],
			["들으소서", "듣다"],
			["물고", "물다"],
			["부음을", "붓다"],
			["돌아", "돌다"],
			["살아", "살다"],
			["달아", "달다"],
			["도와", "돕다"],
			["나와", "나"],
			["자와", "자"],
			["이와", "이"],
			["자니라", "자"],
			["자나", "자"],
			["자여", "자"],
			["것이라", "것"],
			["것임이니라", "것"],
			["것인즉", "것"],
			["함이라", "하다"],
			["한지라", "하다"],
			["하셨도다", "하다"],
			["하셨음이라", "하다"],
			["할꼬", "하다"],
			["하고자", "하다"],
			["마옵소서", "말다"],
			["계신", "계시다"],
			["젊은", "젊다"],
			["섰는", "서다"],
			["선", "서다"],
			["선을", "선"],
			["가서", "가다"],
			["가는", "가다"],
			["사는", "살다"],
			["오는", "오다"],
			["제자들에게", "제자"],
			["성읍들에", "성읍"],
			["하나님이시라", "하나님"],
			["여호와께로", "여호와"],
			["일렀으되", "이르다"],
			["이른즉", "이르다"],
			["따라서", "따르다"],
			["모아", "모으다"],
			["썼고", "쓰다"],
			["싸서", "싸다"],
			["여시고", "열다"],
			["앎이라", "알다"],
			["아니라", "아니다"],
			["두려워", "두렵다"],
			["아름다와", "아름답다"],
			["무엇이관대", "무엇"],
			["찬송할찌로다", "찬송하다"],
			["같으니이다", "같다"],
			["있으리이까", "있다"],
			["딸이더라", "딸"],
			["무엇인지", "무엇"],
			["지나갔음이러라", "지나가다"],
			["마른", "마르다"],
			["마르다가", "마르다"],
			["악인의", "악인"],
			["나귀의", "나귀"],
			["갈고", "갈다"],
			["맞고", "맞다"],
			["일월", "일월"],
		];
		for (const [surface, expected] of expectedLemmas) {
			expect(analyzeKoreanWord(surface, lexicon).lemma).toBe(expected);
		}

		// Biblical disambiguations against secular homographs
		expect(analyzeKoreanWord("보좌에", lexicon).gloss).toContain("throne");
		expect(analyzeKoreanWord("우편에", lexicon).gloss).toContain("right");
		expect(analyzeKoreanWord("소제와", lexicon).gloss).toContain("grain offering");
		expect(analyzeKoreanWord("공의를", lexicon).gloss).toContain("righteousness");
		expect(analyzeKoreanWord("허물을", lexicon).gloss).toContain("transgression");
		expect(analyzeKoreanWord("그룹들이", lexicon).gloss).toContain("cherub");
		expect(analyzeKoreanWord("제비를", lexicon).gloss).toContain("lot");
		expect(analyzeKoreanWord("교회의", lexicon).gloss).toContain("church");
		expect(analyzeKoreanWord("장사하고", lexicon).gloss).toContain("bury");
		expect(analyzeKoreanWord("수양의", lexicon).gloss).toContain("ram");
		expect(analyzeKoreanWord("이적을", lexicon).gloss).toContain("miracle");
		expect(analyzeKoreanWord("지체가", lexicon).gloss).toContain("member");
		expect(analyzeKoreanWord("하수를", lexicon).gloss).toContain("river");
		expect(analyzeKoreanWord("중수하였고", lexicon).gloss).toContain("repair");
		expect(analyzeKoreanWord("중수를", lexicon).gloss).toContain("weight");
		expect(analyzeKoreanWord("수금을", lexicon).gloss).toContain("lyre");
		expect(analyzeKoreanWord("자색", lexicon).gloss).toContain("purple");
		expect(analyzeKoreanWord("사정을", lexicon).gloss).toContain("circumstances");
		expect(analyzeKoreanWord("외식하는", lexicon).gloss).toContain("hypocritical");
		expect(analyzeKoreanWord("투기하는", lexicon).gloss).toContain("envy");
		expect(analyzeKoreanWord("배부를", lexicon).gloss).toContain("full");
		expect(analyzeKoreanWord("곡하는", lexicon).gloss).toContain("wail");
		expect(analyzeKoreanWord("에서의", lexicon).gloss).toBe("Esau");
		expect(analyzeKoreanWord("예후가", lexicon).gloss).toBe("Jehu");
		expect(analyzeKoreanWord("아사가", lexicon).gloss).toBe("Asa");
		expect(analyzeKoreanWord("수산에", lexicon).gloss).toBe("Susa");
		expect(analyzeKoreanWord("시바가", lexicon).gloss).toBe("Ziba");
		expect(analyzeKoreanWord("누가", lexicon).pos).toBe("pronoun");
	});

	it("validates public lexicon formatting and 66-book Bible data integrity", async () => {
		const rootDir = join(import.meta.dir, "..");
		const lexicon: LexiconMap = await Bun.file(join(rootDir, "public/data/lexicon.json")).json();

		for (const [key, entry] of Object.entries(lexicon)) {
			expect(containsHangul(key)).toBe(true);
			expect(entry.gloss.length).toBeGreaterThanOrEqual(2);
			expect(entry.pos).toBeDefined();
			expect(entry.gloss.includes("`")).toBe(false);
			expect(containsHangul(entry.gloss)).toBe(false);
			expect(/^\d+$/.test(entry.gloss)).toBe(false);
			expect(
				/\b(sth|sb|what the hell|napoo|ejaculation|petuntse|sharpbelly|heavy water|license plate|aiding the enemy)\b|\(English\)/i.test(
					entry.gloss,
				),
			).toBe(false);
			expect(entry.gloss.match(/\(/g)?.length ?? 0).toBe(entry.gloss.match(/\)/g)?.length ?? 0);
		}

		for (const book of BIBLE_BOOKS) {
			const [esv, krv] = (await Promise.all([
				Bun.file(join(rootDir, "public/data/bibles/esv", `${book.usfm}.json`)).json(),
				Bun.file(join(rootDir, "public/data/bibles/krv", `${book.usfm}.json`)).json(),
			])) as [BookBibleData, BookBibleData];

			for (let ch = 1; ch <= book.chapters; ch++) {
				const esvVerses = esv.chapters[String(ch)];
				const krvVerses = krv.chapters[String(ch)];
				expect(esvVerses?.length ?? 0).toBeGreaterThan(0);
				expect(krvVerses?.length ?? 0).toBeGreaterThan(0);
				for (const v of esvVerses) expect(v.text.trim().length).toBeGreaterThan(0);
				for (const v of krvVerses) expect(v.text.trim().length).toBeGreaterThan(0);
			}
		}
	});
});
