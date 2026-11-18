import type { ReactNode } from "react";

import type { HighlightItem } from "../../shared/types";
import { splitTextByHighlights } from "../lib/highlights";

export function renderHighlightedText(
	text: string,
	baseOffset: number,
	highlights: readonly HighlightItem[],
): ReactNode {
	if (!text) return null;
	if (highlights.length === 0) return text;

	const segments = splitTextByHighlights(text, baseOffset, highlights);
	if (segments.length === 1 && !segments[0].highlightId) {
		return text;
	}

	return segments.map((seg, idx) =>
		seg.highlightId ? (
			<mark
				key={`${seg.highlightId}-${baseOffset}-${idx}`}
				className="verse-highlight"
				data-highlight-id={seg.highlightId}
			>
				{seg.text}
			</mark>
		) : (
			seg.text
		),
	);
}
