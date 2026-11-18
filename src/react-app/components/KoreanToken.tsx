import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GlossToken } from "../../shared/types";

interface KoreanTokenProps {
	token: GlossToken;
	onSelectFootnote?: (footnoteId: string) => void;
}

interface TooltipPos {
	left: number;
	top: number;
	placeBelow: boolean;
}

export function KoreanToken({ token, onSelectFootnote }: KoreanTokenProps) {
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<TooltipPos | null>(null);

	const updatePosition = useCallback(() => {
		const el = buttonRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const placeBelow = rect.top < 120;
		const centerX = rect.left + rect.width / 2;
		const clampedLeft = Math.max(140, Math.min(window.innerWidth - 140, centerX));
		setPos({
			left: clampedLeft,
			top: placeBelow ? rect.bottom + 8 : rect.top - 8,
			placeBelow,
		});
	}, []);

	useEffect(() => {
		if (!open) return;
		updatePosition();
		const handleScroll = () => setOpen(false);
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, [open, updatePosition]);

	if (!token.word || !token.gloss) {
		return <span>{token.raw}</span>;
	}

	return (
		<span className="ko-token-wrap">
			{token.leadPunct}
			<button
				ref={buttonRef}
				type="button"
				className={`ko-word-btn ${token.matched ? "has-gloss" : ""} ${open ? "active" : ""}`}
				onMouseEnter={() => {
					updatePosition();
					setOpen(true);
				}}
				onMouseLeave={() => setOpen(false)}
				onFocus={() => {
					updatePosition();
					setOpen(true);
				}}
				onBlur={() => setOpen(false)}
				onClick={() => {
					if (token.footnoteId && onSelectFootnote) {
						onSelectFootnote(token.footnoteId);
					} else {
						updatePosition();
						setOpen((prev) => !prev);
					}
				}}
				aria-label={`${token.word}: ${token.gloss}`}
			>
				{token.word}
			</button>
			{token.trailPunct}
			{open &&
				pos &&
				typeof document !== "undefined" &&
				createPortal(
					<div
						role="tooltip"
						className="ko-tooltip"
						style={{
							left: `${pos.left}px`,
							top: `${pos.top}px`,
							transform: pos.placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
						}}
					>
						<div className="ko-tooltip-head">
							<span className="ko-tooltip-word">
								{token.word}
								{token.hanja ? ` (${token.hanja})` : ""}
							</span>
							{token.pos && <span className="ko-tooltip-pos">{token.pos}</span>}
						</div>
						<div className="ko-tooltip-gloss">{token.gloss}</div>
						{(token.lemma !== token.word || token.grammarNote) && (
							<div className="ko-tooltip-meta">
								{token.lemma !== token.word && <span>Root: {token.lemma}</span>}
								{token.lemma !== token.word && token.grammarNote && <span> · </span>}
								{token.grammarNote && <span>{token.grammarNote}</span>}
							</div>
						)}
						{token.footnoteId && (
							<div className="ko-tooltip-hint">Click to view in footnotes ↓</div>
						)}
					</div>,
					document.body,
				)}
		</span>
	);
}
