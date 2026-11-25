import {
	formatVerseRefBilingual,
	MAX_PASSAGE_VERSE_SPAN,
	normalizeVerseRef,
} from "../../shared/books";
import type { MemorizeStarterPack } from "../../shared/memorize-packs";
import type {
	FavoriteItem,
	MemorizeCard,
	MemorizeLangMode,
	MemorizeStats,
	MemorizeStudyMode,
	VerseRef,
} from "../../shared/types";
import {
	finiteTimestamp,
	MAX_STORED_ITEMS,
	readJsonStorage,
	readStoredCollection,
	writeJsonStorage,
} from "./storage";

export const MEMORIZE_CARDS_STORAGE_KEY = "logos.memorize.cards.v1";
export const MEMORIZE_STATS_STORAGE_KEY = "logos.memorize.stats.v1";
export const MEMORIZE_PREFS_STORAGE_KEY = "logos.memorize.prefs.v1";
export const MAX_CARD_NOTE_LEN = 240;

export type ClozeLevel = 25 | 50 | 75 | "initials";
export type BilingualDirection = "en-to-ko" | "ko-to-en";

export interface MemorizeStudyPrefs {
	studyMode: MemorizeStudyMode;
	langMode: MemorizeLangMode;
	bilingualDir: BilingualDirection;
	clozeLevel: ClozeLevel;
}

export const DEFAULT_MEMORIZE_PREFS: MemorizeStudyPrefs = {
	studyMode: "flip",
	langMode: "both",
	bilingualDir: "en-to-ko",
	clozeLevel: 25,
};

export const DEFAULT_MEMORIZE_STATS: MemorizeStats = {
	streakDays: 0,
	lastStudiedDate: null,
	totalReviews: 0,
};

export function makeMemorizeCardId(
	bookNumber: number,
	chapter: number,
	verseStart: number,
	verseEnd?: number,
): string {
	return verseEnd !== undefined && verseEnd > verseStart
		? `${bookNumber}:${chapter}:${verseStart}-${verseEnd}`
		: `${bookNumber}:${chapter}:${verseStart}`;
}

export function truncateKoPreview(
	text: string | null | undefined,
	maxLen = 140,
): string | undefined {
	if (typeof text !== "string") return undefined;
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return undefined;
	return normalized.length <= maxLen ? normalized : `${normalized.slice(0, maxLen - 1).trimEnd()}…`;
}

function sanitizeCardNote(note: unknown): string | undefined {
	if (typeof note !== "string") return undefined;
	const normalized = note.replace(/\s+/g, " ").trim();
	if (!normalized) return undefined;
	return normalized.slice(0, MAX_CARD_NOTE_LEN);
}

function sanitizePackId(packId: unknown): string | undefined {
	return typeof packId === "string" && /^[a-z0-9-]{1,40}$/.test(packId) ? packId : undefined;
}

function toSafeCardRecord(card: MemorizeCard): MemorizeCard {
	const out: MemorizeCard = {
		id: card.id,
		bookNumber: card.bookNumber,
		chapter: card.chapter,
		verseStart: card.verseStart,
		repetitions: card.repetitions,
		intervalDays: card.intervalDays,
		easeFactor: card.easeFactor,
		dueAt: card.dueAt,
		lapses: card.lapses,
		createdAt: card.createdAt,
	};
	if (card.verseEnd !== undefined && card.verseEnd > card.verseStart) {
		out.verseEnd = card.verseEnd;
	}
	if (card.koPreview) out.koPreview = card.koPreview;
	if (card.packId) out.packId = card.packId;
	if (card.note) out.note = card.note;
	if (card.lastReviewedAt !== undefined) out.lastReviewedAt = card.lastReviewedAt;
	return out;
}

export function readStoredMemorizeCards(): MemorizeCard[] {
	return readStoredCollection<MemorizeCard>(
		MEMORIZE_CARDS_STORAGE_KEY,
		(rec, bookNumber, chapter) => {
			if (typeof rec.verseStart !== "number") return null;
			const verseEnd = typeof rec.verseEnd === "number" ? rec.verseEnd : undefined;
			const ref = normalizeVerseRef(
				{ bookNumber, chapter, verseStart: rec.verseStart, verseEnd },
				MAX_PASSAGE_VERSE_SPAN,
			);
			if (!ref) return null;

			const repetitions =
				typeof rec.repetitions === "number" &&
				Number.isInteger(rec.repetitions) &&
				rec.repetitions >= 0
					? rec.repetitions
					: 0;
			const intervalDays =
				typeof rec.intervalDays === "number" &&
				Number.isFinite(rec.intervalDays) &&
				rec.intervalDays >= 0
					? rec.intervalDays
					: 0;
			const easeFactor =
				typeof rec.easeFactor === "number" &&
				Number.isFinite(rec.easeFactor) &&
				rec.easeFactor >= 1.3 &&
				rec.easeFactor <= 3.5
					? rec.easeFactor
					: 2.5;
			const lapses =
				typeof rec.lapses === "number" && Number.isInteger(rec.lapses) && rec.lapses >= 0
					? rec.lapses
					: 0;
			const createdAt = finiteTimestamp(rec.createdAt);
			const dueAt =
				typeof rec.dueAt === "number" && Number.isFinite(rec.dueAt) && rec.dueAt >= 0
					? rec.dueAt
					: createdAt;
			const lastReviewedAt =
				typeof rec.lastReviewedAt === "number" &&
				Number.isFinite(rec.lastReviewedAt) &&
				rec.lastReviewedAt > 0
					? rec.lastReviewedAt
					: undefined;

			return toSafeCardRecord({
				id: makeMemorizeCardId(ref.bookNumber, ref.chapter, ref.verseStart, ref.verseEnd),
				...ref,
				koPreview: truncateKoPreview(typeof rec.koPreview === "string" ? rec.koPreview : undefined),
				packId: sanitizePackId(rec.packId),
				note: sanitizeCardNote(rec.note),
				repetitions,
				intervalDays,
				easeFactor,
				dueAt,
				lastReviewedAt,
				lapses,
				createdAt,
			});
		},
	);
}

export function writeStoredMemorizeCards(cards: readonly MemorizeCard[]): void {
	writeJsonStorage(
		MEMORIZE_CARDS_STORAGE_KEY,
		cards.slice(0, MAX_STORED_ITEMS).map(toSafeCardRecord),
	);
}

export function readStoredMemorizeStats(): MemorizeStats {
	const raw = readJsonStorage(MEMORIZE_STATS_STORAGE_KEY);
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_MEMORIZE_STATS;
	const rec = raw as Record<string, unknown>;
	const streakDays =
		typeof rec.streakDays === "number" && Number.isInteger(rec.streakDays) && rec.streakDays >= 0
			? rec.streakDays
			: 0;
	const lastStudiedDate =
		typeof rec.lastStudiedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.lastStudiedDate)
			? rec.lastStudiedDate
			: null;
	const totalReviews =
		typeof rec.totalReviews === "number" &&
		Number.isInteger(rec.totalReviews) &&
		rec.totalReviews >= 0
			? rec.totalReviews
			: 0;
	return { streakDays, lastStudiedDate, totalReviews };
}

export function writeStoredMemorizeStats(stats: MemorizeStats): void {
	writeJsonStorage(MEMORIZE_STATS_STORAGE_KEY, stats);
}

export function readStoredMemorizePrefs(): MemorizeStudyPrefs {
	const raw = readJsonStorage(MEMORIZE_PREFS_STORAGE_KEY);
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_MEMORIZE_PREFS;
	const rec = raw as Record<string, unknown>;
	const studyMode =
		rec.studyMode === "flip" ||
		rec.studyMode === "reverse" ||
		rec.studyMode === "bilingual" ||
		rec.studyMode === "cloze"
			? rec.studyMode
			: DEFAULT_MEMORIZE_PREFS.studyMode;
	const langMode =
		rec.langMode === "both" || rec.langMode === "en" || rec.langMode === "ko"
			? rec.langMode
			: DEFAULT_MEMORIZE_PREFS.langMode;
	const bilingualDir =
		rec.bilingualDir === "en-to-ko" || rec.bilingualDir === "ko-to-en"
			? rec.bilingualDir
			: DEFAULT_MEMORIZE_PREFS.bilingualDir;
	const clozeLevel =
		rec.clozeLevel === 25 ||
		rec.clozeLevel === 50 ||
		rec.clozeLevel === 75 ||
		rec.clozeLevel === "initials"
			? rec.clozeLevel
			: DEFAULT_MEMORIZE_PREFS.clozeLevel;
	return { studyMode, langMode, bilingualDir, clozeLevel };
}

export function writeStoredMemorizePrefs(prefs: MemorizeStudyPrefs): void {
	writeJsonStorage(MEMORIZE_PREFS_STORAGE_KEY, prefs);
}

export function createMemorizeCard(
	input: VerseRef & {
		koPreview?: string | null;
		packId?: string;
		note?: string;
	},
	now = Date.now(),
): MemorizeCard | null {
	const ref = normalizeVerseRef(input, MAX_PASSAGE_VERSE_SPAN);
	if (!ref) return null;
	return toSafeCardRecord({
		id: makeMemorizeCardId(ref.bookNumber, ref.chapter, ref.verseStart, ref.verseEnd),
		...ref,
		koPreview: truncateKoPreview(input.koPreview),
		packId: sanitizePackId(input.packId),
		note: sanitizeCardNote(input.note),
		repetitions: 0,
		intervalDays: 0,
		easeFactor: 2.5,
		dueAt: now,
		lapses: 0,
		createdAt: now,
	});
}

export function addMemorizeCard(
	cards: readonly MemorizeCard[],
	input: VerseRef & {
		koPreview?: string | null;
		packId?: string;
		note?: string;
	},
	now = Date.now(),
): { cards: MemorizeCard[]; added: boolean; card: MemorizeCard | null } {
	const candidate = createMemorizeCard(input, now);
	if (!candidate) return { cards: [...cards], added: false, card: null };
	const existing = cards.find((c) => c.id === candidate.id);
	if (existing) {
		if (!existing.koPreview && candidate.koPreview) {
			const updated = toSafeCardRecord({ ...existing, koPreview: candidate.koPreview });
			return {
				cards: cards.map((c) => (c.id === existing.id ? updated : c)),
				added: false,
				card: updated,
			};
		}
		return { cards: [...cards], added: false, card: existing };
	}
	return {
		cards: [candidate, ...cards].slice(0, MAX_STORED_ITEMS),
		added: true,
		card: candidate,
	};
}

export function removeMemorizeCard(cards: readonly MemorizeCard[], id: string): MemorizeCard[] {
	return cards.filter((c) => c.id !== id);
}

export function toggleMemorizeCard(
	cards: readonly MemorizeCard[],
	input: VerseRef & { koPreview?: string | null; packId?: string },
	now = Date.now(),
): { cards: MemorizeCard[]; added: boolean } {
	const ref = normalizeVerseRef(input, MAX_PASSAGE_VERSE_SPAN);
	if (!ref) return { cards: [...cards], added: false };
	const id = makeMemorizeCardId(ref.bookNumber, ref.chapter, ref.verseStart, ref.verseEnd);
	if (cards.some((c) => c.id === id)) {
		return { cards: removeMemorizeCard(cards, id), added: false };
	}
	const result = addMemorizeCard(cards, input, now);
	return { cards: result.cards, added: result.added };
}

export function updateMemorizeCardNote(
	cards: readonly MemorizeCard[],
	id: string,
	note: string,
): MemorizeCard[] {
	const cleaned = sanitizeCardNote(note);
	return cards.map((c) => {
		if (c.id !== id) return c;
		const next = { ...c };
		if (cleaned) next.note = cleaned;
		else delete next.note;
		return toSafeCardRecord(next);
	});
}

export function addStarterPackToDeck(
	cards: readonly MemorizeCard[],
	pack: MemorizeStarterPack,
	getKoPreview?: (ref: VerseRef) => string | undefined,
	now = Date.now(),
): { cards: MemorizeCard[]; addedCount: number } {
	let next = [...cards];
	let addedCount = 0;
	for (let i = pack.refs.length - 1; i >= 0; i--) {
		const ref = pack.refs[i];
		const res = addMemorizeCard(
			next,
			{
				...ref,
				packId: pack.id,
				koPreview: getKoPreview?.(ref),
			},
			now,
		);
		next = res.cards;
		if (res.added) addedCount++;
	}
	return { cards: next, addedCount };
}

export function importBookmarksToDeck(
	cards: readonly MemorizeCard[],
	favorites: readonly FavoriteItem[],
	now = Date.now(),
): { cards: MemorizeCard[]; addedCount: number } {
	let next = [...cards];
	let addedCount = 0;
	for (let i = favorites.length - 1; i >= 0; i--) {
		const fav = favorites[i];
		if (fav.verse === undefined) continue;
		const res = addMemorizeCard(
			next,
			{
				bookNumber: fav.bookNumber,
				chapter: fav.chapter,
				verseStart: fav.verse,
				koPreview: fav.koText,
			},
			now,
		);
		next = res.cards;
		if (res.added) addedCount++;
	}
	return { cards: next, addedCount };
}

export function formatMemorizeCardRef(ref: VerseRef): { refEn: string; refKo: string } {
	return formatVerseRefBilingual(ref);
}
