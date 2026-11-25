import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";

import {
	addMemorizeCard,
	addStarterPackToDeck,
	DEFAULT_MEMORIZE_PREFS,
	DEFAULT_MEMORIZE_STATS,
	formatMemorizeCardRef,
	importBookmarksToDeck,
	makeMemorizeCardId,
	MAX_CARD_NOTE_LEN,
	MEMORIZE_CARDS_STORAGE_KEY,
	readStoredMemorizeCards,
	readStoredMemorizePrefs,
	readStoredMemorizeStats,
	removeMemorizeCard,
	toggleMemorizeCard,
	updateMemorizeCardNote,
	writeStoredMemorizeCards,
	writeStoredMemorizePrefs,
	writeStoredMemorizeStats,
} from "../src/react-app/lib/memorize";
import { buildClozeSlots, buildVerseHint } from "../src/react-app/lib/memorize-hints";
import {
	buildStudyQueue,
	getCardMastery,
	isCardDue,
	previewReviewIntervals,
	recordStudyCompletion,
	reviewCard,
} from "../src/react-app/lib/memorize-srs";
import { BIBLE_BOOKS, getBookByNumber, normalizeVerseRef } from "../src/shared/books";
import { MEMORIZE_STARTER_PACKS } from "../src/shared/memorize-packs";
import type { BookBibleData } from "../src/shared/types";
import {
	getDayOfYearIndex,
	getLocalDateKey,
	getNextRandomVotdIndex,
	getVerseOfTheDay,
	getVerseOfTheDayByIndex,
	VERSE_OF_THE_DAY_REFS,
} from "../src/shared/verse-of-the-day";

function createMemoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		get length() {
			return store.size;
		},
		clear: () => store.clear(),
		getItem: (k: string) => store.get(k) ?? null,
		key: (i: number) => Array.from(store.keys())[i] ?? null,
		removeItem: (k: string) => {
			store.delete(k);
		},
		setItem: (k: string, v: string) => {
			store.set(k, v);
		},
	};
}

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
		expect(MEMORIZE_STARTER_PACKS.find((p) => p.id === "top-20")?.refs).toHaveLength(20);
		expect(bookDataCache.size).toBeLessThanOrEqual(BIBLE_BOOKS.length);
	});

	it("selects deterministic daily VOTD and supports prev/next/shuffle browsing", () => {
		const day1 = new Date(2026, 10, 24, 9, 0, 0);
		const day2 = new Date(2026, 10, 25, 9, 0, 0);
		const leapEnd = new Date(2024, 11, 31, 12, 0, 0);

		expect(getLocalDateKey(day1)).toBe("2026-11-24");
		expect(getDayOfYearIndex(leapEnd)).toBe(365);

		const today = getVerseOfTheDay(day1, 0);
		const tomorrow = getVerseOfTheDay(day1, 1);
		const sameTomorrow = getVerseOfTheDay(day2, 0);

		expect(today.isToday).toBe(true);
		expect(tomorrow.isToday).toBe(false);
		expect(tomorrow.dateKey).toBe("2026-11-25");
		expect(tomorrow.ref).toEqual(sameTomorrow.ref);
		expect(tomorrow.index).toBe((today.index + 1) % VERSE_OF_THE_DAY_REFS.length);

		expect(getVerseOfTheDayByIndex(-1).index).toBe(VERSE_OF_THE_DAY_REFS.length - 1);
		const nextRand = getNextRandomVotdIndex(today.index, () => 0);
		expect(nextRand).not.toBe(today.index);
	});
});

describe("Memorize CRUD, SRS scheduling, and progressive hints", () => {
	const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

	beforeEach(() => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: createMemoryStorage(),
		});
	});

	afterEach(() => {
		if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
		else delete (globalThis as { localStorage?: unknown }).localStorage;
	});

	it("persists flashcards without ever storing ESV text, and sanitizes corrupt storage", () => {
		const now = new Date(2026, 10, 24, 15, 0, 0).getTime();
		const res1 = addMemorizeCard(
			[],
			{
				bookNumber: 43,
				chapter: 3,
				verseStart: 16,
				koPreview: "하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니",
				note: "  Core gospel promise  ",
			},
			now,
		);
		expect(res1.added).toBe(true);
		expect(res1.card?.id).toBe("43:3:16");
		expect(res1.card?.note).toBe("Core gospel promise");

		// Duplicate add preserves progress and avoids duplicates
		const reviewed = reviewCard(res1.card!, "good", now);
		const resDup = addMemorizeCard(
			[reviewed],
			{ bookNumber: 43, chapter: 3, verseStart: 16 },
			now + 5000,
		);
		expect(resDup.added).toBe(false);
		expect(resDup.cards[0]?.repetitions).toBe(1);

		// Toggle adds/removes cleanly
		const toggled = toggleMemorizeCard(
			res1.cards,
			{ bookNumber: 20, chapter: 3, verseStart: 5, verseEnd: 6 },
			now,
		);
		expect(toggled.added).toBe(true);
		expect(toggled.cards).toHaveLength(2);
		expect(formatMemorizeCardRef(toggled.cards[0]!)).toEqual({
			refEn: "Proverbs 3:5–6",
			refKo: "잠언 3장 5–6절",
		});

		const updatedNote = updateMemorizeCardNote(
			toggled.cards,
			"43:3:16",
			"x".repeat(MAX_CARD_NOTE_LEN + 50),
		);
		expect(updatedNote.find((c) => c.id === "43:3:16")?.note?.length).toBe(MAX_CARD_NOTE_LEN);

		// Writing strips extra fields like enText (ESV compliance)
		const withInjectedEsv = [
			{
				...updatedNote[0]!,
				enText: "For God so loved the world",
			} as unknown as (typeof updatedNote)[0],
		];
		writeStoredMemorizeCards(withInjectedEsv);
		const rawJson = localStorage.getItem(MEMORIZE_CARDS_STORAGE_KEY) ?? "";
		expect(rawJson).not.toContain("enText");
		expect(rawJson).not.toContain("For God so loved");

		// Inject corrupt storage records and verify clean sanitization
		localStorage.setItem(
			MEMORIZE_CARDS_STORAGE_KEY,
			JSON.stringify([
				{ bookNumber: 999, chapter: 1, verseStart: 1 },
				{ bookNumber: 43, chapter: 3, verseStart: 16, enText: "secret ESV", note: "Keep" },
				{ bookNumber: 43, chapter: 3, verseStart: 16 }, // duplicate
				{ bookNumber: 19, chapter: 23, verseStart: 5, verseEnd: 2 }, // reversed range
			]),
		);
		const loaded = readStoredMemorizeCards();
		expect(loaded).toHaveLength(1);
		expect(loaded[0]?.id).toBe("43:3:16");
		expect((loaded[0] as unknown as Record<string, unknown>).enText).toBeUndefined();

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

		const pack = MEMORIZE_STARTER_PACKS[0]!; // Gospel & Grace includes JHN 3:16 + 5 more
		const packed = addStarterPackToDeck(imported.cards, pack, undefined, now);
		expect(packed.addedCount).toBe(pack.refs.length - 1);
		expect(packed.cards).toHaveLength(pack.refs.length);
	});

	it("schedules SM-2 intervals, mastery transitions, queues, and daily streaks", () => {
		const mondayNight = new Date(2026, 10, 23, 22, 30, 0).getTime();
		const tuesdayMorning = new Date(2026, 10, 24, 7, 0, 0).getTime();

		const { card } = addMemorizeCard(
			[],
			{ bookNumber: 43, chapter: 3, verseStart: 16 },
			mondayNight,
		);
		const initial = card!;
		expect(getCardMastery(initial)).toBe("new");
		expect(isCardDue(initial, mondayNight)).toBe(true);
		expect(previewReviewIntervals(initial, mondayNight)).toEqual({
			again: "<10m",
			hard: "1d",
			good: "1d",
			easy: "4d",
		});

		// Good on Monday night -> due Tuesday 00:00 (so due Tuesday morning at 7am!)
		const rep1 = reviewCard(initial, "good", mondayNight);
		expect(rep1.repetitions).toBe(1);
		expect(rep1.intervalDays).toBe(1);
		expect(getCardMastery(rep1)).toBe("learning");
		expect(isCardDue(rep1, mondayNight + 60_000)).toBe(false);
		expect(isCardDue(rep1, tuesdayMorning)).toBe(true);

		const rep2 = reviewCard(rep1, "good", tuesdayMorning);
		expect(rep2.intervalDays).toBe(3);
		expect(getCardMastery(rep2)).toBe("reviewing");

		const rep3 = reviewCard(rep2, "easy", tuesdayMorning + 3 * 86_400_000);
		expect(rep3.intervalDays).toBeGreaterThanOrEqual(8);

		const rep4 = reviewCard(rep3, "easy", tuesdayMorning + 12 * 86_400_000);
		expect(rep4.intervalDays).toBeGreaterThanOrEqual(21);
		expect(getCardMastery(rep4)).toBe("mastered");

		// Again resets repetitions & increments lapses
		const lapsed = reviewCard(rep4, "again", tuesdayMorning + 40 * 86_400_000);
		expect(lapsed.repetitions).toBe(0);
		expect(lapsed.lapses).toBe(1);
		expect(getCardMastery(lapsed)).toBe("learning");

		// Queue builds due-only vs all
		const queueDue = buildStudyQueue([rep2, initial], { mode: "due" }, mondayNight);
		expect(queueDue.map((c) => c.id)).toEqual(["43:3:16"]);
		const queueAll = buildStudyQueue([rep2, initial], { mode: "all" }, mondayNight);
		expect(queueAll).toHaveLength(2);

		// Streak tracking across local days
		let stats = DEFAULT_MEMORIZE_STATS;
		stats = recordStudyCompletion(stats, 3, mondayNight);
		expect(stats).toEqual({ streakDays: 1, lastStudiedDate: "2026-11-23", totalReviews: 3 });
		stats = recordStudyCompletion(stats, 2, tuesdayMorning);
		expect(stats).toEqual({ streakDays: 2, lastStudiedDate: "2026-11-24", totalReviews: 5 });
		// Same day doesn't increment streak again
		stats = recordStudyCompletion(stats, 1, tuesdayMorning + 3_600_000);
		expect(stats).toEqual({ streakDays: 2, lastStudiedDate: "2026-11-24", totalReviews: 6 });
		// Missed a day resets streak to 1
		const thursday = new Date(2026, 10, 26, 10, 0, 0).getTime();
		stats = recordStudyCompletion(stats, 1, thursday);
		expect(stats).toEqual({ streakDays: 1, lastStudiedDate: "2026-11-26", totalReviews: 7 });

		// Stats & prefs roundtrip
		writeStoredMemorizeStats(stats);
		expect(readStoredMemorizeStats()).toEqual(stats);
		const customPrefs = {
			...DEFAULT_MEMORIZE_PREFS,
			studyMode: "cloze" as const,
			clozeLevel: 50 as const,
		};
		writeStoredMemorizePrefs(customPrefs);
		expect(readStoredMemorizePrefs()).toEqual(customPrefs);
	});

	it("builds deterministic progressive cloze masks and Korean choseong hints", () => {
		const en = '"For God so loved the world!"';
		const ko = "하나님이 세상을 이처럼 사랑하사!";

		const c25 = buildClozeSlots(en, "en", 25, "43:3:16");
		const c50 = buildClozeSlots(en, "en", 50, "43:3:16");
		const c75 = buildClozeSlots(en, "en", 75, "43:3:16");
		const hidden25 = c25.filter((s) => s.isHidden).map((s) => s.index);
		const hidden50 = c50.filter((s) => s.isHidden).map((s) => s.index);
		const hidden75 = c75.filter((s) => s.isHidden).map((s) => s.index);

		expect(hidden25.length).toBeGreaterThanOrEqual(1);
		expect(hidden50.length).toBeGreaterThan(hidden25.length);
		expect(hidden75.length).toBeGreaterThan(hidden50.length);
		for (const idx of hidden25) expect(hidden50).toContain(idx);
		for (const idx of hidden50) expect(hidden75).toContain(idx);
		expect(c25[0]?.leadPunct).toBe('"');
		expect(c25[c25.length - 1]?.trailPunct).toBe('!"');

		const koInitials = buildClozeSlots(ko, "ko", "initials", "43:3:16");
		expect(koInitials.map((s) => `${s.leadPunct}${s.maskedText}${s.trailPunct}`).join(" ")).toBe(
			"ㅎㄴㄴㅇ ㅅㅅㅇ ㅇㅊㄹ ㅅㄹㅎㅅ!",
		);

		const hint = buildVerseHint("For God so loved", "하나님이 세상을");
		expect(hint.enHint).toBe("F__ G__ s_ l____");
		expect(hint.koHint).toBe("ㅎㄴㄴㅇ ㅅㅅㅇ");
	});
});
