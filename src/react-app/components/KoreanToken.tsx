import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { romanizeHangul } from "../../shared/hangul";
import type { GlossToken, HighlightItem } from "../../shared/types";
import { useKoreanSpeech } from "../hooks/useKoreanSpeech";
import { type AnchorPos, anchorPosStyle, useAnchoredPopover } from "../hooks/usePopover";
import { renderHighlightedText } from "./HighlightText";
import { SpeakButton } from "./RailShared";

interface KoreanTokenProps {
	token: GlossToken;
	tokenOffset?: number;
	highlights?: readonly HighlightItem[];
	tooltipEnabled?: boolean;
	onSelectFootnote?: (footnoteId: string) => void;
}

function KoreanTokenTooltip({
	token,
	pos,
	buttonRef,
	tooltipRef,
	onMouseEnter,
	onMouseLeave,
	onSelectFootnote,
}: {
	token: GlossToken;
	pos: AnchorPos;
	buttonRef: RefObject<HTMLButtonElement | null>;
	tooltipRef: RefObject<HTMLDivElement | null>;
	onMouseEnter: () => void;
	onMouseLeave: () => void;
	onSelectFootnote?: (footnoteId: string) => void;
}) {
	const {
		speakingKey: speakingTarget,
		speechErrorKey,
		speak: handleSpeak,
	} = useKoreanSpeech<"word" | "lemma">();
	const wordRomanized = useMemo(() => romanizeHangul(token.word), [token.word]);
	const lemmaRomanized = useMemo(
		() => (token.lemma && token.lemma !== token.word ? romanizeHangul(token.lemma) : ""),
		[token.lemma, token.word],
	);

	return createPortal(
		<div
			ref={tooltipRef}
			role="tooltip"
			className={`ko-tooltip ${pos.placeBelow ? "place-below" : "place-above"}`}
			style={anchorPosStyle(pos)}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
			onBlur={(e) => {
				const nextFocused = e.relatedTarget as Node | null;
				if (
					nextFocused &&
					(nextFocused === buttonRef.current || tooltipRef.current?.contains(nextFocused))
				) {
					return;
				}
				onMouseLeave();
			}}
		>
			<div className="ko-tooltip-head">
				<div className="ko-tooltip-title-group">
					<span className="ko-tooltip-word" lang="ko">
						{token.word}
						{token.hanja ? ` (${token.hanja})` : ""}
					</span>
					<SpeakButton
						label={`Pronounce ${token.word}`}
						className="ko-tooltip-speak-btn"
						speaking={speakingTarget === "word"}
						preventFocus={true}
						onSpeak={() => handleSpeak(token.word, "word")}
					/>
				</div>
				{token.pos && <span className="ko-tooltip-pos">{token.pos}</span>}
			</div>
			{wordRomanized && <div className="ko-tooltip-phonetics">[{wordRomanized}]</div>}
			<div className="ko-tooltip-gloss">{token.gloss}</div>
			{(token.lemma !== token.word || token.grammarNote) && (
				<div className="ko-tooltip-meta">
					{token.lemma !== token.word && (
						<span className="ko-tooltip-root">
							<span>
								Root: <span lang="ko">{token.lemma}</span>
							</span>
							{lemmaRomanized && (
								<span className="ko-tooltip-root-phonetics"> [{lemmaRomanized}]</span>
							)}
							<SpeakButton
								label={`Pronounce root ${token.lemma}`}
								title={`Pronounce root (${token.lemma})`}
								className="ko-tooltip-speak-btn ko-tooltip-speak-btn-sm"
								size={11}
								speaking={speakingTarget === "lemma"}
								preventFocus={true}
								onSpeak={() => handleSpeak(token.lemma, "lemma")}
							/>
						</span>
					)}
					{token.lemma !== token.word && token.grammarNote && <span> · </span>}
					{token.grammarNote && <span>{token.grammarNote}</span>}
				</div>
			)}
			{speechErrorKey !== null && (
				<div className="ko-tooltip-speech-note">Korean voice unavailable in this browser.</div>
			)}
			{token.footnoteId && onSelectFootnote && (
				<div className="ko-tooltip-hint">Click to view in dictionary</div>
			)}
		</div>,
		document.body,
	);
}

export function KoreanToken({
	token,
	tokenOffset = 0,
	highlights = [],
	tooltipEnabled = true,
	onSelectFootnote,
}: KoreanTokenProps) {
	const pointerDownRef = useRef(false);
	const closeTimerRef = useRef<number | null>(null);
	const [open, setOpen] = useState(false);

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

	useEffect(() => {
		if (!tooltipEnabled) {
			cancelClose();
			setOpen(false);
		}
	}, [tooltipEnabled, cancelClose]);

	const dismiss = useCallback(() => {
		cancelClose();
		setOpen(false);
	}, [cancelClose]);

	const isTooltipOpen = tooltipEnabled && open;

	const {
		triggerRef: buttonRef,
		menuRef: tooltipRef,
		pos,
		updatePosition,
	} = useAnchoredPopover(isTooltipOpen, {
		minSpace: 170,
		halfWidth: 145,
		gap: 8,
		onDismiss: dismiss,
		onScroll: true,
	});

	useEffect(() => {
		if (isTooltipOpen) updatePosition();
	}, [isTooltipOpen, updatePosition]);

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
				className={`ko-word-btn ${token.matched ? "has-gloss" : ""} ${isTooltipOpen ? "active" : ""}`}
				onMouseEnter={() => {
					if (!tooltipEnabled) return;
					cancelClose();
					updatePosition();
					setOpen(true);
				}}
				onMouseLeave={scheduleClose}
				onPointerDown={() => {
					pointerDownRef.current = true;
				}}
				onFocus={() => {
					if (!tooltipEnabled) return;
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
					if (token.footnoteId && onSelectFootnote) {
						onSelectFootnote(token.footnoteId);
					} else if (tooltipEnabled) {
						cancelClose();
						updatePosition();
						setOpen((prev) => !prev);
					}
				}}
			>
				{renderHighlightedText(token.word, wordOffset, highlights)}
			</button>
			{renderHighlightedText(token.trailPunct, trailOffset, highlights)}
			{isTooltipOpen && pos && typeof document !== "undefined" && (
				<KoreanTokenTooltip
					token={token}
					pos={pos}
					buttonRef={buttonRef}
					tooltipRef={tooltipRef}
					onMouseEnter={cancelClose}
					onMouseLeave={scheduleClose}
					onSelectFootnote={onSelectFootnote}
				/>
			)}
		</span>
	);
}
