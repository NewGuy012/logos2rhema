import { useCallback, useEffect, useMemo, useState } from "react";

import { CANONICAL_BIBLES } from "../../shared/translations";
import type { AlignedVerse, LexiconMap, VerseEntry, VerseRef } from "../../shared/types";
import { alignChapterVerses, loadLexicon, loadTranslationPassage } from "../lib/bible-loader";

function usePassageSide({
	translationId,
	shouldLoad,
	bookNumber,
	chapter,
	verseStart,
	verseEnd,
	fallbackError,
}: {
	translationId: string;
	shouldLoad: boolean;
	bookNumber: number;
	chapter: number;
	verseStart: number;
	verseEnd: number;
	fallbackError: string;
}) {
	const [verses, setVerses] = useState<VerseEntry[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [retrySeq, setRetrySeq] = useState(0);

	useEffect(() => {
		if (!shouldLoad) {
			setVerses([]);
			setLoading(false);
			setError(null);
			return;
		}
		const controller = new AbortController();
		setVerses([]);
		setLoading(true);
		setError(null);

		loadTranslationPassage(
			translationId,
			bookNumber,
			chapter,
			verseStart,
			verseEnd,
			controller.signal,
		)
			.then((loaded) => {
				if (controller.signal.aborted) return;
				setVerses(loaded);
				setLoading(false);
			})
			.catch((err) => {
				if (controller.signal.aborted) return;
				setError(err instanceof Error ? err.message : fallbackError);
				setLoading(false);
			});

		return () => controller.abort();
	}, [
		translationId,
		shouldLoad,
		bookNumber,
		chapter,
		verseStart,
		verseEnd,
		fallbackError,
		retrySeq,
	]);

	const triggerRetry = useCallback(() => setRetrySeq((s) => s + 1), []);
	return { verses, loading, error, triggerRetry };
}

export function useBilingualPassage({
	passageRef,
	lexicon: externalLexicon,
	loadEn = true,
}: {
	passageRef: VerseRef | null;
	lexicon?: LexiconMap;
	loadEn?: boolean;
}) {
	const [internalLexicon, setInternalLexicon] = useState<LexiconMap>({});

	useEffect(() => {
		if (externalLexicon !== undefined) return;
		let cancelled = false;
		loadLexicon()
			.then((lex) => {
				if (!cancelled) setInternalLexicon(lex);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [externalLexicon]);

	const activeLexicon = externalLexicon ?? internalLexicon;

	const bookNumber = passageRef?.bookNumber ?? 0;
	const chapter = passageRef?.chapter ?? 0;
	const verseStart = passageRef?.verseStart ?? 0;
	const verseEnd = passageRef?.verseEnd ?? verseStart;
	const isValidRef = bookNumber >= 1 && chapter >= 1 && verseStart >= 1;

	const {
		verses: koVerses,
		loading: koLoading,
		error: koError,
		triggerRetry: retryKo,
	} = usePassageSide({
		translationId: CANONICAL_BIBLES.ko.id,
		shouldLoad: isValidRef,
		bookNumber,
		chapter,
		verseStart,
		verseEnd,
		fallbackError: "Could not load Korean text.",
	});

	const {
		verses: enVerses,
		loading: enLoading,
		error: enError,
		triggerRetry: retryEn,
	} = usePassageSide({
		translationId: CANONICAL_BIBLES.en.id,
		shouldLoad: isValidRef && loadEn,
		bookNumber,
		chapter,
		verseStart,
		verseEnd,
		fallbackError: "English (ESV) unavailable.",
	});

	const { aligned } = useMemo(
		() => alignChapterVerses(enVerses, koVerses, activeLexicon),
		[enVerses, koVerses, activeLexicon],
	);

	const retry = useCallback(() => {
		if (koError || koVerses.length === 0) retryKo();
		if (loadEn && (enError || enVerses.length === 0)) retryEn();
	}, [koError, koVerses.length, retryKo, loadEn, enError, enVerses.length, retryEn]);

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
		combinedKo,
		koLoading,
		enLoading,
		koError,
		enError,
		retry,
	};
}
