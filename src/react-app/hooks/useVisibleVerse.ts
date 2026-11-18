import { useEffect, useRef, useState } from "react";

interface UseVisibleVerseOptions {
	enabled: boolean;
	verseNumbers: readonly number[];
	resetKey: string;
}

/**
 * Tracks the Bible verse currently resting in the upper-middle reading band of the viewport.
 */
export function useVisibleVerse({ enabled, verseNumbers, resetKey }: UseVisibleVerseOptions) {
	const [visibleVerse, setVisibleVerse] = useState<number>(1);
	const intersectingRef = useRef<Set<number>>(new Set());

	useEffect(() => {
		setVisibleVerse(verseNumbers[0] ?? 1);
		intersectingRef.current.clear();
	}, [resetKey]);

	useEffect(() => {
		if (!enabled || verseNumbers.length === 0) return;
		if (typeof document === "undefined" || typeof window === "undefined") return;

		const pickClosestVerse = () => {
			if (window.scrollY <= 36) {
				setVisibleVerse(verseNumbers[0] ?? 1);
				return;
			}

			const focalY = window.innerHeight * 0.28;
			const candidates =
				intersectingRef.current.size > 0 ? [...intersectingRef.current] : verseNumbers;

			let bestVerse = candidates[0] ?? 1;
			let bestDistance = Number.POSITIVE_INFINITY;

			for (const verseNum of candidates) {
				const el = document.getElementById(`verse-${verseNum}`);
				if (!el) continue;
				const rect = el.getBoundingClientRect();
				const center = rect.top + Math.min(rect.height, 140) * 0.35;
				const distance = Math.abs(center - focalY);
				if (distance < bestDistance) {
					bestDistance = distance;
					bestVerse = verseNum;
				}
			}

			setVisibleVerse(bestVerse);
		};

		let observer: IntersectionObserver | null = null;
		if (typeof IntersectionObserver !== "undefined") {
			observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						const rawId = entry.target.id;
						const verseNum = Number.parseInt(rawId.replace("verse-", ""), 10);
						if (Number.isNaN(verseNum)) continue;
						if (entry.isIntersecting) {
							intersectingRef.current.add(verseNum);
						} else {
							intersectingRef.current.delete(verseNum);
						}
					}
					pickClosestVerse();
				},
				{
					rootMargin: "-14% 0px -62% 0px",
					threshold: [0, 0.25, 0.6],
				},
			);

			for (const verseNum of verseNumbers) {
				const el = document.getElementById(`verse-${verseNum}`);
				if (el) observer.observe(el);
			}
		}

		const handleScroll = () => {
			if (window.scrollY <= 36) {
				setVisibleVerse(verseNumbers[0] ?? 1);
			}
		};
		window.addEventListener("scroll", handleScroll, { passive: true });

		return () => {
			observer?.disconnect();
			window.removeEventListener("scroll", handleScroll);
		};
	}, [enabled, verseNumbers]);

	return {
		visibleVerse,
		setVisibleVerse,
	};
}
