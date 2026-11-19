import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { romanizeHangul } from "../../shared/hangul";
import type { GlossToken, HighlightItem } from "../../shared/types";
import { useKoreanSpeech } from "../hooks/useKoreanSpeech";
import { type AnchorPos, computeAnchorPos, useDismissListeners } from "../hooks/usePopover";
import { renderHighlightedText } from "./HighlightText";
import { ArrowRight, Volume2 } from "./Icons";

interface KoreanTokenProps {
	token: GlossToken;
	tokenOffset?: number;
	highlights?: readonly HighlightItem[];
	onSelectFootnote?: (footnoteId: string) => void;
}

export function KoreanToken({
	token,
	tokenOffset = 0,
	highlights = [],
	onSelectFootnote,
}: KoreanTokenProps) {
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	const tooltipRef = useRef<HTMLDivElement | null>(null);
	const pointerDownRef = useRef(false);
	const closeTimerRef = useRef<number | null>(null);
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<AnchorPos | null>(null);
	const {
		speakingKey: speakingTarget,
		speechErrorKey,
		speak: handleSpeak,
		clearSpeechError,
	} = useKoreanSpeech<"word" | "lemma">();
	const speechError = speechErrorKey !== null;

	const wordRomanized = useMemo(() => romanizeHangul(token.word), [token.word]);
	const lemmaRomanized = useMemo(
		() => (token.lemma && token.lemma !== token.word ? romanizeHangul(token.lemma) : ""),
		[token.lemma, token.word],
	);

	const cancelClose = useCallback(() => {
		if (closeTimerRef.current !== null) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	}, []);

	const scheduleClose = useCallback(() => {
		cancelClose();
		closeTimerRef.current = window.setTimeout(() => {
			closeTimerRef.current = null;
			setOpen(false);
		}, 150);
	}, [cancelClose]);

	useEffect(() => () => cancelClose(), [cancelClose]);

	const updatePosition = useCallback(() => {
		if (!buttonRef.current) return;
		setPos(
			computeAnchorPos(buttonRef.current.getBoundingClientRect(), {
				minSpace: 170,
				halfWidth: 145,
				gap: 8,
			}),
		);
	}, []);

	const dismiss = useCallback(() => {
		cancelClose();
		setOpen(false);
	}, [cancelClose]);

	useEffect(() => {
		if (open) updatePosition();
		else clearSpeechError();
	}, [open, updatePosition, clearSpeechError]);

	useDismissListeners(open, {
		refs: [buttonRef, tooltipRef],
		onDismiss: dismiss,
		onScroll: true,
	});

	if (!token.word || !token.gloss) {
		return <span>{renderHighlightedText(token.raw, tokenOffset, highlights)}</span>;
	}

	const wordOffset = tokenOffset + token.leadPunct.length;
	const trailOffset = wordOffset + token.word.length;

	return (
		<span className="ko-token-wrap">
			{renderHighlightedText(token.leadPunct, tokenOffset, highlights)}
			<button
				ref={buttonRef}
				type="button"
				className={`ko-word-btn ${token.matched ? "has-gloss" : ""} ${open ? "active" : ""}`}
				onMouseEnter={() => {
					cancelClose();
					updatePosition();
					setOpen(true);
				}}
				onMouseLeave={scheduleClose}
				onPointerDown={() => {
					pointerDownRef.current = true;
				}}
				onFocus={() => {
					cancelClose();
					if (pointerDownRef.current) return;
					updatePosition();
					setOpen(true);
				}}
				onBlur={(e) => {
					pointerDownRef.current = false;
					const nextFocused = e.relatedTarget as Node | null;
					if (nextFocused && tooltipRef.current?.contains(nextFocused)) return;
					scheduleClose();
				}}
				onClick={() => {
					pointerDownRef.current = false;
					const selection = typeof window !== "undefined" ? window.getSelection() : null;
					if (
						selection &&
						!selection.isCollapsed &&
						buttonRef.current &&
						typeof selection.containsNode === "function" &&
						selection.containsNode(buttonRef.current, true)
					) {
						return;
					}
					cancelClose();
					updatePosition();
					setOpen((prev) => !prev);
				}}
				aria-label={`${token.word}: ${token.gloss}`}
			>
				{renderHighlightedText(token.word, wordOffset, highlights)}
			</button>
			{renderHighlightedText(token.trailPunct, trailOffset, highlights)}
			{open &&
				pos &&
				typeof document !== "undefined" &&
				createPortal(
					<div
						ref={tooltipRef}
						role="tooltip"
						className={`ko-tooltip ${pos.placeBelow ? "place-below" : "place-above"}`}
						style={{
							left: `${pos.left}px`,
							top: `${pos.top}px`,
							transform: pos.placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
						}}
						onMouseEnter={cancelClose}
						onMouseLeave={scheduleClose}
						onBlur={(e) => {
							const nextFocused = e.relatedTarget as Node | null;
							if (
								nextFocused &&
								(nextFocused === buttonRef.current || tooltipRef.current?.contains(nextFocused))
							) {
								return;
							}
							scheduleClose();
						}}
					>
						<div className="ko-tooltip-head">
							<div className="ko-tooltip-title-group">
								<span className="ko-tooltip-word">
									{token.word}
									{token.hanja ? ` (${token.hanja})` : ""}
								</span>
								<button
									type="button"
									className={`ko-tooltip-speak-btn ${speakingTarget === "word" ? "speaking" : ""}`.trim()}
									onMouseDown={(e) => e.preventDefault()}
									onPointerDown={(e) => e.stopPropagation()}
									onClick={(e) => {
										e.stopPropagation();
										handleSpeak(token.word, "word");
									}}
									aria-label={`Pronounce ${token.word}`}
									title={`Pronounce ${token.word}`}
								>
									<Volume2 size={13} />
								</button>
							</div>
							{token.pos && <span className="ko-tooltip-pos">{token.pos}</span>}
						</div>
						{wordRomanized && <div className="ko-tooltip-phonetics">[{wordRomanized}]</div>}
						<div className="ko-tooltip-gloss">{token.gloss}</div>
						{(token.lemma !== token.word || token.grammarNote) && (
							<div className="ko-tooltip-meta">
								{token.lemma !== token.word && (
									<span className="ko-tooltip-root">
										<span>Root: {token.lemma}</span>
										{lemmaRomanized && (
											<span className="ko-tooltip-root-phonetics"> [{lemmaRomanized}]</span>
										)}
										<button
											type="button"
											className={`ko-tooltip-speak-btn ko-tooltip-speak-btn-sm ${speakingTarget === "lemma" ? "speaking" : ""}`.trim()}
											onMouseDown={(e) => e.preventDefault()}
											onPointerDown={(e) => e.stopPropagation()}
											onClick={(e) => {
												e.stopPropagation();
												handleSpeak(token.lemma, "lemma");
											}}
											aria-label={`Pronounce root ${token.lemma}`}
											title={`Pronounce root (${token.lemma})`}
										>
											<Volume2 size={11} />
										</button>
									</span>
								)}
								{token.lemma !== token.word && token.grammarNote && <span> · </span>}
								{token.grammarNote && <span>{token.grammarNote}</span>}
							</div>
						)}
						{speechError && (
							<div className="ko-tooltip-speech-note">
								Korean voice unavailable in this browser.
							</div>
						)}
						{token.footnoteId && onSelectFootnote && (
							<button
								type="button"
								className="ko-tooltip-hint-btn"
								onMouseDown={(e) => e.preventDefault()}
								onPointerDown={(e) => e.stopPropagation()}
								onClick={(e) => {
									e.stopPropagation();
									cancelClose();
									onSelectFootnote(token.footnoteId!);
								}}
							>
								<span>View in Dictionary</span>
								<ArrowRight size={12} />
							</button>
						)}
					</div>,
					document.body,
				)}
		</span>
	);
}
