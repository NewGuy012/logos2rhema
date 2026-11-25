import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import {
	addMemorizeCard,
	addStarterPackToDeck,
	importBookmarksToDeck,
	makeMemorizeCardId,
	MEMORIZE_CARDS_STORAGE_KEY,
	readStoredMemorizeCards,
	removeMemorizeCard,
	toggleMemorizeCard,
	writeStoredMemorizeCards,
} from "../src/react-app/lib/memorize";
import {
	BIBLE_BOOKS,
	formatVerseRefBilingual,
	getBookByNumber,
	normalizeVerseRef,
} from "../src/shared/books";
import { MEMORIZE_STARTER_PACKS } from "../src/shared/memorize-packs";
import type { BookBibleData } from "../src/shared/types";
import { getVerseOfTheDay, VERSE_OF_THE_DAY_REFS } from "../src/shared/verse-of-the-day";
import { installMemoryStorage } from "./helpers";

describe("Verse of the Day & Starter Packs data integrity", () => {
	it("validates all 366 VOTD references and all starter packs against bundled KRV JSON", async () => {
		expect(VERSE_OF_THE_DAY_REFS).toHaveLength(366);
		const rootDir = join(import.meta.dir, "..");
		const bookDataCache = new Map<number, BookBibleData>();

		async function loadBook(bookNumber: number): Promise<BookBibleData> {
			const cached = bookDataCache.get(bookNumber);
			if (cached) return cached;
			const book = getBookByNumber(bookNumber);
			expect(book).toBeDefined();
			const data = (await Bun.file(
				join(rootDir, `public/data/bibles/krv/${book!.usfm}.json`),
			).json()) as BookBibleData;
			bookDataCache.set(bookNumber, data);
			return data;
		}

		const votdIds = new Set<string>();
		for (const ref of VERSE_OF_THE_DAY_REFS) {
			const normalized = normalizeVerseRef(ref);
			expect(normalized).toEqual(ref);
			const id = makeMemorizeCardId(ref.bookNumber, ref.chapter, ref.verseStart, ref.verseEnd);
			expect(votdIds.has(id)).toBe(false);
			votdIds.add(id);

			const data = await loadBook(ref.bookNumber);
			const verses = data.chapters[String(ref.chapter)] ?? [];
			const end = ref.verseEnd ?? ref.verseStart;
			for (let v = ref.verseStart; v <= end; v++) {
				const found = verses.find((entry) => entry.verse === v);
				expect(found?.text.trim().length ?? 0).toBeGreaterThan(0);
			}
		}

		expect(MEMORIZE_STARTER_PACKS.length).toBeGreaterThanOrEqual(11);
		const packIds = new Set<string>();
		for (const pack of MEMORIZE_STARTER_PACKS) {
			expect(packIds.has(pack.id)).toBe(false);
			packIds.add(pack.id);
			expect(pack.refs.length).toBeGreaterThanOrEqual(6);

			const refsInPack = new Set<string>();
			for (const ref of pack.refs) {
				expect(normalizeVerseRef(ref)).toEqual(ref);
				const refId = makeMemorizeCardId(ref.bookNumber, ref.chapter, ref.verseStart, ref.verseEnd);
				expect(refsInPack.has(refId)).toBe(false);
				refsInPack.add(refId);

				if (pack.id === "old-testament") {
					expect(getBookByNumber(ref.bookNumber)?.testament).toBe("OT");
				} else if (pack.id === "new-testament") {
					expect(getBookByNumber(ref.bookNumber)?.testament).toBe("NT");
				}

				const data = await loadBook(ref.bookNumber);
				const verses = data.chapters[String(ref.chapter)] ?? [];
				const end = ref.verseEnd ?? ref.verseStart;
				for (let v = ref.verseStart; v <= end; v++) {
					expect(verses.some((entry) => entry.verse === v)).toBe(true);
				}
			}
		}
		expect(MEMORIZE_STARTER_PACKS.find((p) => p.id === "top-50")?.refs).toHaveLength(50);
		expect(bookDataCache.size).toBeLessThanOrEqual(BIBLE_BOOKS.length);
	});

	it("selects deterministic daily VOTD and supports prev/next browsing", () => {
		const day1 = new Date(2026, 10, 24, 9, 0, 0);
		const day2 = new Date(2026, 10, 25, 9, 0, 0);
		const leapEnd = new Date(2024, 11, 31, 12, 0, 0);

		const today = getVerseOfTheDay(day1, 0);
		const tomorrow = getVerseOfTheDay(day1, 1);
		const sameTomorrow = getVerseOfTheDay(day2, 0);

		expect(today.isToday).toBe(true);
		expect(today.displayDate).toBe("Nov 24, 2026");
		expect(tomorrow.isToday).toBe(false);
		expect(tomorrow.displayDate).toBe("Nov 25, 2026");
		expect(tomorrow.ref).toEqual(sameTomorrow.ref);
		expect(getVerseOfTheDay(leapEnd, 0).ref).toEqual(VERSE_OF_THE_DAY_REFS[365]);
	});
});

describe("Memorize CRUD and storage migration", () => {
	installMemoryStorage();

	it("persists saved verses without storing ESV text and cleanly migrates legacy SRS/note records", () => {
		const now = new Date(2026, 10, 24, 15, 0, 0).getTime();
		const res1 = addMemorizeCard(
			[],
			{
				bookNumber: 43,
				chapter: 3,
				verseStart: 16,
			},
			now,
		);
		expect(res1.added).toBe(true);
		expect(res1.card?.id).toBe("43:3:16");

		// Duplicate add avoids duplicates
		const resDup = addMemorizeCard(
			res1.cards,
			{ bookNumber: 43, chapter: 3, verseStart: 16 },
			now + 5000,
		);
		expect(resDup.added).toBe(false);
		expect(resDup.cards).toHaveLength(1);

		// Toggle adds/removes cleanly
		const toggled = toggleMemorizeCard(
			res1.cards,
			{ bookNumber: 20, chapter: 3, verseStart: 5, verseEnd: 6 },
			now,
		);
		expect(toggled.added).toBe(true);
		expect(toggled.cards).toHaveLength(2);
		expect(formatVerseRefBilingual(toggled.cards[0]!)).toEqual({
			refEn: "Proverbs 3:5–6",
			refKo: "잠언 3장 5–6절",
		});

		// Writing strips extra fields like enText (ESV compliance)
		const withInjectedEsv = [
			{
				...toggled.cards[0]!,
				enText: "Trust in the LORD with all your heart",
			} as unknown as (typeof toggled.cards)[0],
		];
		writeStoredMemorizeCards(withInjectedEsv);
		const rawJson = localStorage.getItem(MEMORIZE_CARDS_STORAGE_KEY) ?? "";
		expect(rawJson).not.toContain("enText");
		expect(rawJson).not.toContain("Trust in the LORD");

		// Inject legacy SRS/note records + corrupt records and verify clean sanitization
		localStorage.setItem(
			MEMORIZE_CARDS_STORAGE_KEY,
			JSON.stringify([
				{ bookNumber: 999, chapter: 1, verseStart: 1 },
				{
					bookNumber: 43,
					chapter: 3,
					verseStart: 16,
					enText: "secret ESV",
					koPreview: "하나님이 세상을",
					note: "Old note",
					repetitions: 3,
					intervalDays: 21,
					easeFactor: 2.6,
					dueAt: now,
					lapses: 1,
					packId: "top-20",
					createdAt: now,
				},
				{ bookNumber: 43, chapter: 3, verseStart: 16 }, // duplicate
				{ bookNumber: 19, chapter: 23, verseStart: 5, verseEnd: 2 }, // reversed range
			]),
		);
		const loaded = readStoredMemorizeCards();
		expect(loaded).toEqual([
			{
				id: "43:3:16",
				bookNumber: 43,
				chapter: 3,
				verseStart: 16,
				packId: "top-20",
				createdAt: now,
			},
		]);

		const afterRemove = removeMemorizeCard(loaded, "43:3:16");
		expect(afterRemove).toHaveLength(0);
	});

	it("imports verse bookmarks (ignoring chapter-only bookmarks) and adds starter packs idempotently", () => {
		const now = 1_700_000_000_000;
		const imported = importBookmarksToDeck(
			[],
			[
				{ id: "1:1", bookNumber: 1, chapter: 1, createdAt: now },
				{
					id: "43:3:16",
					bookNumber: 43,
					chapter: 3,
					verse: 16,
					koText: "하나님이 세상을",
					createdAt: now,
				},
			],
			now,
		);
		expect(imported.addedCount).toBe(1);
		expect(imported.cards[0]?.id).toBe("43:3:16");

		const pack = MEMORIZE_STARTER_PACKS.find((p) => p.id === "gospel-grace")!;
		const packed = addStarterPackToDeck(imported.cards, pack, now);
		expect(packed.addedCount).toBe(pack.refs.length - 1);
		expect(packed.cards).toHaveLength(pack.refs.length);
	});
});
