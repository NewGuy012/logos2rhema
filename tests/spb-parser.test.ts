import { describe, expect, it } from "bun:test";

import {
	extractPsalmSuperscription,
	normalizeSpbText,
	parseSpbContent,
} from "../scripts/spb-parser";
import {
	BIBLE_BOOKS,
	BIBLE_GENRES,
	findBookByQuery,
	formatVerseRefBilingual,
	getAdjacentChapter,
	parsePassageReference,
	parseVerseRangeReference,
} from "../src/shared/books";

describe("spb-parser", () => {
	it("normalizes SoftProjector trailing-hyphen em-dashes", () => {
		expect(
			normalizeSpbText("God made the two great lights- the greater light to rule the day"),
		).toBe("God made the two great lights—the greater light to rule the day");
	});

	it("extracts Psalm superscriptions cleanly into heading", () => {
		const res = extractPsalmSuperscription(
			19,
			1,
			"A PSALM OF DAVID.The LORD is my shepherd; I shall not want.",
		);
		expect(res.heading).toBe("A Psalm of David");
		expect(res.text).toBe("The LORD is my shepherd; I shall not want.");

		const shortRes = extractPsalmSuperscription(
			19,
			1,
			"OF DAVID.To you, O LORD, I lift up my soul.",
		);
		expect(shortRes.heading).toBe("Of David");
	});

	it("preserves non-Psalm verse 1 text untouched", () => {
		const res = extractPsalmSuperscription(
			1,
			1,
			"In the beginning, God created the heavens and the earth.",
		);
		expect(res.heading).toBeUndefined();
		expect(res.text).toBe("In the beginning, God created the heavens and the earth.");
	});

	it("parses SPB header and verses by explicit verse number", () => {
		const sample = [
			"##spDataVersion:\t1",
			"##Title:\tEnglish Standard Version (2001)",
			"##Abbreviation:\tESV",
			"43\tJohn\t21",
			"-----",
			"B043C005V003\t43\t5\t3\tIn these lay a multitude of invalids- blind, lame, and paralyzed.",
			"B043C005V005\t43\t5\t5\tOne man was there who had been an invalid for thirty-eight years.",
		].join("\n");

		const parsed = parseSpbContent(sample, "esv");
		expect(parsed.abbreviation).toBe("ESV");
		const john = parsed.books.get(43);
		expect(john?.usfm).toBe("JHN");
		expect(john?.chapters["5"]).toEqual([
			{
				verse: 3,
				text: "In these lay a multitude of invalids—blind, lame, and paralyzed.",
			},
			{
				verse: 5,
				text: "One man was there who had been an invalid for thirty-eight years.",
			},
		]);
	});
});

describe("books & passage reference parser", () => {
	it("parses English and Korean passage references", () => {
		expect(parsePassageReference("John 3:16")).toEqual({
			bookNumber: 43,
			chapter: 3,
			verse: 16,
		});
		expect(parsePassageReference("요 3:16")).toEqual({
			bookNumber: 43,
			chapter: 3,
			verse: 16,
		});
		expect(parsePassageReference("창세기 1장")).toEqual({
			bookNumber: 1,
			chapter: 1,
			verse: undefined,
		});
		expect(parsePassageReference("창세기 1장 1절")).toEqual({
			bookNumber: 1,
			chapter: 1,
			verse: 1,
		});
		expect(parsePassageReference("Ps 23")).toEqual({
			bookNumber: 19,
			chapter: 23,
			verse: undefined,
		});
		expect(findBookByQuery("1Cor")?.usfm).toBe("1CO");
		expect(findBookByQuery("toString")).toBeUndefined();
	});

	it("parses and formats single-verse and bounded verse-range references in EN and KO", () => {
		expect(parseVerseRangeReference("John 3:16")).toEqual({
			bookNumber: 43,
			chapter: 3,
			verseStart: 16,
		});
		expect(parseVerseRangeReference("Proverbs 3:5-6")).toEqual({
			bookNumber: 20,
			chapter: 3,
			verseStart: 5,
			verseEnd: 6,
		});
		expect(parseVerseRangeReference("잠 3장 5–6절")).toEqual({
			bookNumber: 20,
			chapter: 3,
			verseStart: 5,
			verseEnd: 6,
		});
		expect(parseVerseRangeReference("시 23:1~3")).toEqual({
			bookNumber: 19,
			chapter: 23,
			verseStart: 1,
			verseEnd: 3,
		});
		expect(parseVerseRangeReference("Jude 24-25")).toEqual({
			bookNumber: 65,
			chapter: 1,
			verseStart: 24,
			verseEnd: 25,
		});
		expect(parseVerseRangeReference("John 3:16-16")).toEqual({
			bookNumber: 43,
			chapter: 3,
			verseStart: 16,
		});

		expect(
			formatVerseRefBilingual({ bookNumber: 20, chapter: 3, verseStart: 5, verseEnd: 6 }),
		).toEqual({
			refEn: "Proverbs 3:5–6",
			refKo: "잠언 3장 5–6절",
		});

		// Rejects chapter-only, reversed ranges, out-of-range chapters, and spans > 10 verses
		expect(parseVerseRangeReference("John 3")).toBeNull();
		expect(parseVerseRangeReference("John 99:1")).toBeNull();
		expect(parseVerseRangeReference("John 3:16-14")).toBeNull();
		expect(parseVerseRangeReference("Ps 119:1-12")).toBeNull();
	});

	it("computes adjacent chapters across book boundaries", () => {
		expect(getAdjacentChapter(1, 1, -1)).toBeNull();
		expect(getAdjacentChapter(1, 50, 1)).toEqual({ bookNumber: 2, chapter: 1 });
		expect(getAdjacentChapter(2, 1, -1)).toEqual({ bookNumber: 1, chapter: 50 });
		expect(getAdjacentChapter(66, 22, 1)).toBeNull();
	});

	it("categorizes all 66 Bible books into genres without duplicates or gaps", () => {
		const groupedNumbers = BIBLE_GENRES.flatMap((g) => g.bookNumbers);
		expect(groupedNumbers).toHaveLength(BIBLE_BOOKS.length);
		expect(new Set(groupedNumbers).size).toBe(66);
		expect(groupedNumbers).toEqual(BIBLE_BOOKS.map((b) => b.number));
	});
});
