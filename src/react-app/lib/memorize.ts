import {
	formatVerseRefBilingual,
	MAX_PASSAGE_VERSE_SPAN,
	normalizeVerseRef,
} from "../../shared/books";
import type { MemorizeStarterPack } from "../../shared/memorize-packs";
import type { FavoriteItem, MemorizeCard, VerseRef } from "../../shared/types";
import {
	finiteTimestamp,
	MAX_STORED_ITEMS,
	readStoredCollection,
	writeJsonStorage,
} from "./storage";

export const MEMORIZE_CARDS_STORAGE_KEY = "logos.memorize.cards.v1";

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

function sanitizePackId(packId: unknown): string | undefined {
	return typeof packId === "string" && /^[a-z0-9-]{1,40}$/.test(packId) ? packId : undefined;
}

function toSafeCardRecord(card: MemorizeCard): MemorizeCard {
	const out: MemorizeCard = {
		id: card.id,
		bookNumber: card.bookNumber,
		chapter: card.chapter,
		verseStart: card.verseStart,
		createdAt: card.createdAt,
	};
	if (card.verseEnd !== undefined && card.verseEnd > card.verseStart) {
		out.verseEnd = card.verseEnd;
	}
	if (card.packId) out.packId = card.packId;
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

			return toSafeCardRecord({
				id: makeMemorizeCardId(ref.bookNumber, ref.chapter, ref.verseStart, ref.verseEnd),
				...ref,
				packId: sanitizePackId(rec.packId),
				createdAt: finiteTimestamp(rec.createdAt),
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

export function createMemorizeCard(
	input: VerseRef & { packId?: string },
	now = Date.now(),
): MemorizeCard | null {
	const ref = normalizeVerseRef(input, MAX_PASSAGE_VERSE_SPAN);
	if (!ref) return null;
	return toSafeCardRecord({
		id: makeMemorizeCardId(ref.bookNumber, ref.chapter, ref.verseStart, ref.verseEnd),
		...ref,
		packId: sanitizePackId(input.packId),
		createdAt: now,
	});
}

export function addMemorizeCard(
	cards: readonly MemorizeCard[],
	input: VerseRef & { packId?: string },
	now = Date.now(),
): { cards: MemorizeCard[]; added: boolean; card: MemorizeCard | null } {
	const candidate = createMemorizeCard(input, now);
	if (!candidate) return { cards: [...cards], added: false, card: null };
	const existing = cards.find((c) => c.id === candidate.id);
	if (existing) {
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
	input: VerseRef & { packId?: string },
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

export function addStarterPackToDeck(
	cards: readonly MemorizeCard[],
	pack: MemorizeStarterPack,
	now = Date.now(),
): { cards: MemorizeCard[]; addedCount: number } {
	let next = [...cards];
	let addedCount = 0;
	for (let i = pack.refs.length - 1; i >= 0; i--) {
		const ref = pack.refs[i];
		const res = addMemorizeCard(next, { ...ref, packId: pack.id }, now);
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
