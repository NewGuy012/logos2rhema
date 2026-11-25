import { useCallback, useEffect, useMemo, useState } from "react";

import { CANONICAL_BIBLES } from "../../shared/translations";
import type { AlignedVerse, LexiconMap, VerseEntry, VerseRef } from "../../shared/types";
import { alignChapterVerses, loadLexicon, loadTranslationPassage } from "../lib/bible-loader";

export function useBilingualPassage({
	passageRef,
	lexicon: externalLexicon,
	enabled = true,
	loadEn = true,
}: {
	passageRef: VerseRef | null;
	lexicon?: LexiconMap;
	enabled?: boolean;
	loadEn?: boolean;
}) {
	const [internalLexicon, setInternalLexicon] = useState<LexiconMap>({});
	const [enVerses, setEnVerses] = useState<VerseEntry[]>([]);
	const [koVerses, setKoVerses] = useState<VerseEntry[]>([]);
	const [koLoading, setKoLoading] = useState(false);
	const [enLoading, setEnLoading] = useState(false);
	const [koError, setKoError] = useState<string | null>(null);
	const [enError, setEnError] = useState<string | null>(null);
	const [koRetrySeq, setKoRetrySeq] = useState(0);
	const [enRetrySeq, setEnRetrySeq] = useState(0);

	useEffect(() => {
		if (!enabled || externalLexicon !== undefined) return;
		let cancelled = false;
		loadLexicon()
			.then((lex) => {
				if (!cancelled) setInternalLexicon(lex);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [enabled, externalLexicon]);

	const activeLexicon = externalLexicon ?? internalLexicon;

	const bookNumber = passageRef?.bookNumber ?? 0;
	const chapter = passageRef?.chapter ?? 0;
	const verseStart = passageRef?.verseStart ?? 0;
	const verseEnd = passageRef?.verseEnd ?? verseStart;
	const isValidRef = enabled && bookNumber >= 1 && chapter >= 1 && verseStart >= 1;

	useEffect(() => {
		if (!isValidRef) {
			setKoVerses([]);
			setKoLoading(false);
			setKoError(null);
			return;
		}

		const controller = new AbortController();
		setKoVerses([]);
		setKoLoading(true);
		setKoError(null);

		loadTranslationPassage(
			CANONICAL_BIBLES.ko.id,
			bookNumber,
			chapter,
			verseStart,
			verseEnd,
			controller.signal,
		)
			.then((verses) => {
				if (controller.signal.aborted) return;
				setKoVerses(verses);
				setKoLoading(false);
			})
			.catch((err) => {
				if (controller.signal.aborted) return;
				setKoError(err instanceof Error ? err.message : "Could not load Korean text.");
				setKoLoading(false);
			});

		return () => controller.abort();
	}, [isValidRef, bookNumber, chapter, verseStart, verseEnd, koRetrySeq]);

	useEffect(() => {
		if (!isValidRef || !loadEn) {
			setEnVerses([]);
			setEnLoading(false);
			setEnError(null);
			return;
		}

		const controller = new AbortController();
		setEnVerses([]);
		setEnLoading(true);
		setEnError(null);

		loadTranslationPassage(
			CANONICAL_BIBLES.en.id,
			bookNumber,
			chapter,
			verseStart,
			verseEnd,
			controller.signal,
		)
			.then((verses) => {
				if (controller.signal.aborted) return;
				setEnVerses(verses);
				setEnLoading(false);
			})
			.catch((err) => {
				if (controller.signal.aborted) return;
				setEnError(err instanceof Error ? err.message : "English (ESV) unavailable.");
				setEnLoading(false);
			});

		return () => controller.abort();
	}, [isValidRef, loadEn, bookNumber, chapter, verseStart, verseEnd, enRetrySeq]);

	const { aligned } = useMemo(
		() => alignChapterVerses(enVerses, koVerses, activeLexicon),
		[enVerses, koVerses, activeLexicon],
	);

	const retry = useCallback(() => {
		if (koError || koVerses.length === 0) setKoRetrySeq((s) => s + 1);
		if (loadEn && (enError || enVerses.length === 0)) setEnRetrySeq((s) => s + 1);
	}, [koError, koVerses.length, loadEn, enError, enVerses.length]);

	const combinedEn = useMemo(
		() =>
			aligned
				.map((v) => v.enText)
				.filter((t): t is string => Boolean(t))
				.join(" "),
		[aligned],
	);
	const combinedKo = useMemo(
		() =>
			aligned
				.map((v) => v.koText)
				.filter((t): t is string => Boolean(t))
				.join(" "),
		[aligned],
	);

	return {
		aligned: aligned as AlignedVerse[],
		combinedEn,
		combinedKo,
		koLoading,
		enLoading,
		koError,
		enError,
		retry,
	};
}
