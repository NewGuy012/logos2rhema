import type {
	MemorizeCard,
	MemorizeMastery,
	MemorizeRating,
	MemorizeStats,
} from "../../shared/types";
import { getLocalDateKey, getShiftedLocalDate } from "../../shared/verse-of-the-day";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EASE_FACTOR = 1.3;
const MAX_EASE_FACTOR = 3.0;

function roundEase(value: number): number {
	return Math.round(value * 100) / 100;
}

function startOfLocalDay(timestamp: number, addDays = 0): number {
	const d = new Date(timestamp);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + addDays).getTime();
}

export function computeNextSchedule(
	card: MemorizeCard,
	rating: MemorizeRating,
	now = Date.now(),
): {
	repetitions: number;
	intervalDays: number;
	easeFactor: number;
	dueAt: number;
	lapses: number;
} {
	if (rating === "again") {
		return {
			repetitions: 0,
			intervalDays: 0,
			easeFactor: Math.max(MIN_EASE_FACTOR, roundEase(card.easeFactor - 0.2)),
			dueAt: now + TEN_MINUTES_MS,
			lapses: card.lapses + 1,
		};
	}

	let repetitions = card.repetitions;
	let intervalDays = card.intervalDays;
	let easeFactor = card.easeFactor;

	if (rating === "hard") {
		if (repetitions === 0) {
			repetitions = 1;
			intervalDays = 1;
		} else if (repetitions === 1) {
			repetitions = 2;
			intervalDays = Math.max(2, Math.round(intervalDays * 1.2));
		} else {
			repetitions += 1;
			intervalDays = Math.max(intervalDays + 1, Math.round(intervalDays * 1.2));
		}
		easeFactor = Math.max(MIN_EASE_FACTOR, roundEase(easeFactor - 0.15));
	} else if (rating === "good") {
		if (repetitions === 0) {
			intervalDays = 1;
		} else if (repetitions === 1) {
			intervalDays = 3;
		} else {
			intervalDays = Math.max(intervalDays + 1, Math.round(intervalDays * easeFactor));
		}
		repetitions += 1;
	} else {
		// "easy"
		if (repetitions === 0) {
			intervalDays = 4;
		} else if (repetitions === 1) {
			intervalDays = 7;
		} else {
			intervalDays = Math.max(intervalDays + 2, Math.round(intervalDays * easeFactor * 1.3));
		}
		repetitions += 1;
		easeFactor = Math.min(MAX_EASE_FACTOR, roundEase(easeFactor + 0.15));
	}

	return {
		repetitions,
		intervalDays,
		easeFactor,
		dueAt: startOfLocalDay(now, intervalDays),
		lapses: card.lapses,
	};
}

export function reviewCard(
	card: MemorizeCard,
	rating: MemorizeRating,
	now = Date.now(),
): MemorizeCard {
	const next = computeNextSchedule(card, rating, now);
	return {
		...card,
		...next,
		lastReviewedAt: now,
	};
}

export function formatIntervalLabel(intervalDays: number, rating: MemorizeRating): string {
	if (rating === "again" || intervalDays <= 0) return "<10m";
	if (intervalDays < 30) return `${intervalDays}d`;
	if (intervalDays < 365) return `${Math.round(intervalDays / 30)}mo`;
	const years = (intervalDays / 365).toFixed(1).replace(/\.0$/, "");
	return `${years}y`;
}

export function previewReviewIntervals(
	card: MemorizeCard,
	now = Date.now(),
): Record<MemorizeRating, string> {
	return {
		again: formatIntervalLabel(computeNextSchedule(card, "again", now).intervalDays, "again"),
		hard: formatIntervalLabel(computeNextSchedule(card, "hard", now).intervalDays, "hard"),
		good: formatIntervalLabel(computeNextSchedule(card, "good", now).intervalDays, "good"),
		easy: formatIntervalLabel(computeNextSchedule(card, "easy", now).intervalDays, "easy"),
	};
}

export function getCardMastery(card: MemorizeCard): MemorizeMastery {
	if (card.lastReviewedAt === undefined && card.repetitions === 0) return "new";
	if (card.intervalDays >= 21 && card.repetitions >= 3) return "mastered";
	if (card.repetitions >= 2 && card.intervalDays >= 3) return "reviewing";
	return "learning";
}

export function isCardDue(card: MemorizeCard, now = Date.now()): boolean {
	return card.dueAt <= now;
}

export function formatDueStatusLabel(card: MemorizeCard, now = Date.now()): string {
	if (card.lastReviewedAt === undefined && card.repetitions === 0) return "New";
	if (card.dueAt <= now) return "Due now";
	const diffDays = Math.max(1, Math.ceil((card.dueAt - now) / DAY_MS));
	if (diffDays === 1) return "Due tomorrow";
	if (diffDays < 30) return `In ${diffDays}d`;
	return `In ${Math.round(diffDays / 30)}mo`;
}

export function buildStudyQueue(
	cards: readonly MemorizeCard[],
	options: {
		mode: "due" | "all";
		masteryFilter?: MemorizeMastery | "all";
		shuffle?: boolean;
		random?: () => number;
	},
	now = Date.now(),
): MemorizeCard[] {
	let selected = cards.filter((card) => {
		if (options.mode === "due" && !isCardDue(card, now)) return false;
		if (options.masteryFilter && options.masteryFilter !== "all") {
			return getCardMastery(card) === options.masteryFilter;
		}
		return true;
	});

	if (options.shuffle) {
		const rng = options.random ?? Math.random;
		selected = [...selected];
		for (let i = selected.length - 1; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1));
			[selected[i], selected[j]] = [selected[j], selected[i]];
		}
		return selected;
	}

	return [...selected].sort((a, b) => a.dueAt - b.dueAt || b.createdAt - a.createdAt);
}

export function recordStudyCompletion(
	stats: MemorizeStats,
	reviewedCount: number,
	now = Date.now(),
): MemorizeStats {
	if (reviewedCount <= 0) return stats;
	const todayDate = new Date(now);
	const todayKey = getLocalDateKey(todayDate);
	const yesterdayKey = getLocalDateKey(getShiftedLocalDate(todayDate, -1));

	let streakDays = stats.streakDays;
	if (stats.lastStudiedDate === todayKey) {
		streakDays = Math.max(1, streakDays);
	} else if (stats.lastStudiedDate === yesterdayKey) {
		streakDays = Math.max(1, streakDays + 1);
	} else {
		streakDays = 1;
	}

	return {
		streakDays,
		lastStudiedDate: todayKey,
		totalReviews: stats.totalReviews + reviewedCount,
	};
}
