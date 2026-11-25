import type { CSSProperties, ReactNode } from "react";

import { containsHangul, romanizeHangul } from "../../shared/hangul";
import type { FootnoteVocabEntry, LexiconEntry } from "../../shared/types";
import { type PanelPosition, useDraggablePanel } from "../hooks/useDraggablePanel";
import {
	DEFAULT_MAX_DICT_RAIL_WIDTH,
	DEFAULT_MAX_RAIL_HEIGHT,
	DEFAULT_MIN_DICT_HEIGHT,
	DEFAULT_MIN_RAIL_WIDTH,
	type PanelSize,
	type ResizeEdge,
	useResizablePanel,
} from "../hooks/useResizablePanel";
import { ChevronDown, ChevronRight, Loader2, Pin, RotateCcw, Search, Volume2, X } from "./Icons";

export interface SegmentedOption<T extends string | number> {
	value: T;
	label: ReactNode;
	id?: string;
	controls?: string;
	title?: string;
}

export function SegmentedControl<T extends string | number>({
	value,
	options,
	onChange,
	className = "",
	buttonClassName = "",
	role = "group",
	ariaLabel,
	ariaOrientation,
}: {
	value: T;
	options: ReadonlyArray<SegmentedOption<T>>;
	onChange: (value: T) => void;
	className?: string;
	buttonClassName?: string;
	role?: "group" | "tablist";
	ariaLabel?: string;
	ariaOrientation?: "horizontal" | "vertical";
}) {
	const isTabs = role === "tablist";
	return (
		<div
			className={`segmented-row ${className}`.trim()}
			role={ariaLabel || isTabs ? role : undefined}
			aria-label={ariaLabel}
			aria-orientation={ariaOrientation}
		>
			{options.map((opt) => {
				const active = value === opt.value;
				return (
					<button
						key={String(opt.value)}
						id={opt.id}
						type="button"
						role={isTabs ? "tab" : undefined}
						aria-selected={isTabs ? active : undefined}
						aria-pressed={!isTabs ? active : undefined}
						aria-controls={opt.controls}
						title={opt.title}
						className={`segmented-btn ${buttonClassName} ${active ? "active" : ""}`.trim()}
						onClick={() => {
							if (!active) onChange(opt.value);
						}}
					>
						{opt.label}
					</button>
				);
			})}
		</div>
	);
}

export function SpeakButton({
	label,
	title = label,
	speaking,
	className,
	size = 13,
	preventFocus = false,
	onSpeak,
}: {
	label: string;
	title?: string;
	speaking: boolean;
	className: string;
	size?: number;
	preventFocus?: boolean;
	onSpeak: () => void;
}) {
	return (
		<button
			type="button"
			className={`${className} ${speaking ? "speaking" : ""}`.trim()}
			onMouseDown={preventFocus ? (e) => e.preventDefault() : undefined}
			onPointerDown={preventFocus ? (e) => e.stopPropagation() : undefined}
			onClick={(e) => {
				if (preventFocus) e.stopPropagation();
				onSpeak();
			}}
			aria-label={label}
			title={title}
		>
			<Volume2 size={size} />
		</button>
	);
}

export interface DraggableRailProps {
	floatingPosition?: PanelPosition | null;
	onFloatingPositionChange?: (pos: PanelPosition | null) => void;
	isActiveFloating?: boolean;
	onActivateFloating?: () => void;
	railSize?: PanelSize;
	onRailSizeChange?: (size: PanelSize) => void;
	maxRailWidth?: number;
	maxRailHeight?: number;
}

export function DraggableRailShell({
	id,
	className,
	ariaLabel,
	draggable = true,
	dockSide = "left",
	resizeLabel = "Resize panel",
	ignoreSelector,
	floatingPosition,
	onFloatingPositionChange,
	isActiveFloating = false,
	onActivateFloating,
	railSize,
	onRailSizeChange,
	minRailWidth = DEFAULT_MIN_RAIL_WIDTH,
	maxRailWidth = DEFAULT_MAX_DICT_RAIL_WIDTH,
	minRailHeight = DEFAULT_MIN_DICT_HEIGHT,
	maxRailHeight = DEFAULT_MAX_RAIL_HEIGHT,
	children,
}: DraggableRailProps & {
	id?: string;
	className: string;
	ariaLabel: string;
	draggable?: boolean;
	dockSide?: "left" | "right";
	resizeLabel?: string;
	ignoreSelector?: string;
	minRailWidth?: number;
	minRailHeight?: number;
	children: (state: {
		isFloating: boolean;
		isResized: boolean;
		resetPosition: () => void;
		resetSize: () => void;
	}) => ReactNode;
}) {
	const { panelProps, position, setPosition, isFloating, isDragging, resetPosition } =
		useDraggablePanel<HTMLElement>({
			enabled: draggable,
			position: floatingPosition,
			onPositionChange: onFloatingPositionChange,
			onActivate: onActivateFloating,
			isActive: isActiveFloating,
			ignoreSelector,
		});

	const { currentSize, isResizing, resizingEdge, getHandleProps, resetSize } =
		useResizablePanel<HTMLElement>({
			enabled: draggable,
			panelRef: panelProps.ref,
			size: railSize,
			onSizeChange: onRailSizeChange,
			minWidth: minRailWidth,
			maxWidth: maxRailWidth,
			minHeight: minRailHeight,
			maxHeight: maxRailHeight,
			isFloating,
			position,
			onPositionChange: setPosition,
			onActivate: onActivateFloating,
		});

	const isResized = currentSize.width !== null || currentSize.height !== null;
	const mergedStyle: CSSProperties | undefined =
		panelProps.style || isResized
			? {
					...panelProps.style,
					...(currentSize.width !== null ? { width: `${currentSize.width}px` } : {}),
					...(currentSize.height !== null ? { height: `${currentSize.height}px` } : {}),
				}
			: undefined;

	const resizeEdge: ResizeEdge = dockSide === "left" ? "right" : "left";
	const resizeCorner = dockSide === "left" ? "bottom-right" : "bottom-left";

	return (
		<aside
			{...panelProps}
			style={mergedStyle}
			id={id}
			className={`${className} ${isFloating ? "floating" : ""} ${isDragging ? "is-dragging" : ""} ${isResizing ? "is-resizing" : ""} ${currentSize.height !== null ? "has-custom-height" : ""}`.trim()}
			aria-label={ariaLabel}
		>
			{children({ isFloating, isResized, resetPosition, resetSize })}
			{draggable && (
				<div
					{...getHandleProps(resizeEdge, resizeLabel, resizeCorner)}
					className={`panel-resize-handle panel-resize-handle-${resizeCorner} ${resizingEdge === resizeEdge ? "active" : ""}`.trim()}
				>
					<svg
						className="panel-resize-grip"
						width="18"
						height="18"
						viewBox="0 0 20 20"
						aria-hidden="true"
					>
						<path d="M13.9 5.6A15 15 0 0 1 5.6 13.9" />
						<path d="M9.9 4.8A11 11 0 0 1 4.8 9.9" />
					</svg>
				</div>
			)}
		</aside>
	);
}

export function toggleSetItem(prev: Set<string>, id: string): Set<string> {
	const next = new Set(prev);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return next;
}

export function filterVocabEntries(
	entries: readonly FootnoteVocabEntry[],
	query: string,
): FootnoteVocabEntry[] {
	const raw = query.trim();
	if (!raw) return [...entries];
	const lower = raw.toLowerCase();
	return entries.filter(
		(entry) =>
			entry.lemma.toLowerCase().includes(lower) ||
			entry.gloss.toLowerCase().includes(lower) ||
			Boolean(entry.hanja?.includes(raw)) ||
			entry.surfaceForms.some((form) => form.toLowerCase().includes(lower)),
	);
}

export function PanelStatus({
	loading,
	loadingText,
	error,
	onRetry,
	emptyText,
}: {
	loading?: boolean;
	loadingText?: string;
	error?: string | null;
	onRetry?: () => void;
	emptyText?: string | null;
}) {
	if (loading) {
		return (
			<div className="commentary-status" role="status">
				<Loader2 size={16} className="spin" />
				<span>{loadingText}</span>
			</div>
		);
	}
	if (error) {
		return (
			<div className="commentary-status">
				<p className="commentary-status-text">{error}</p>
				{onRetry && (
					<button type="button" className="quick-inline-chip active" onClick={onRetry}>
						Try again
					</button>
				)}
			</div>
		);
	}
	if (emptyText) {
		return (
			<div className="commentary-status">
				<p className="commentary-status-text">{emptyText}</p>
			</div>
		);
	}
	return null;
}

export function PanelHeaderText({
	title,
	bookEn,
	bookKo,
	chapter,
}: {
	title: string;
	bookEn: string;
	bookKo: string;
	chapter: number;
}) {
	return (
		<div className="panel-header-text">
			<h2 className="panel-title">{title}</h2>
			<p className="panel-subtitle">
				<span className="panel-subtitle-line">
					{bookEn} {chapter}
				</span>
				<span className="panel-subtitle-line" lang="ko">
					{bookKo} {chapter}장
				</span>
			</p>
		</div>
	);
}

export function PanelSnapBackButton({
	onClick,
	ariaLabel,
}: {
	onClick: () => void;
	ariaLabel: string;
}) {
	return (
		<button
			type="button"
			className="pill-nav-btn panel-snap-btn"
			onClick={onClick}
			aria-label={ariaLabel}
			title="Snap back to original position"
		>
			<Pin size={14} />
		</button>
	);
}

export function PanelResetSizeButton({
	onClick,
	ariaLabel,
}: {
	onClick: () => void;
	ariaLabel: string;
}) {
	return (
		<button
			type="button"
			className="pill-nav-btn panel-reset-size-btn"
			onClick={onClick}
			aria-label={ariaLabel}
			title="Reset to original width and height"
		>
			<RotateCcw size={13} />
		</button>
	);
}

export function PanelHeaderUtilityActions({
	align,
	isFloating,
	isResized,
	onResetPosition,
	onResetSize,
	snapAriaLabel,
	resetSizeAriaLabel,
}: {
	align: "start" | "end";
	isFloating: boolean;
	isResized: boolean;
	onResetPosition: () => void;
	onResetSize: () => void;
	snapAriaLabel: string;
	resetSizeAriaLabel: string;
}) {
	if (!isFloating && !isResized) return <span aria-hidden="true" />;
	const snapBtn = isFloating ? (
		<PanelSnapBackButton key="snap" onClick={onResetPosition} ariaLabel={snapAriaLabel} />
	) : null;
	const resetBtn = isResized ? (
		<PanelResetSizeButton key="size" onClick={onResetSize} ariaLabel={resetSizeAriaLabel} />
	) : null;
	return (
		<div className={`panel-header-actions panel-header-actions-${align}`}>
			{align === "start" ? (
				<>
					{snapBtn}
					{resetBtn}
				</>
			) : (
				<>
					{resetBtn}
					{snapBtn}
				</>
			)}
		</div>
	);
}

export function PanelSearchInput({
	value,
	onChange,
	placeholder,
	ariaLabel,
	clearAriaLabel,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	ariaLabel: string;
	clearAriaLabel: string;
}) {
	return (
		<div className="dict-search-wrap">
			<Search size={13} className="dict-search-icon" />
			<input
				type="search"
				className={`footnote-search ${value ? "has-value" : ""}`.trim()}
				placeholder={placeholder}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				aria-label={ariaLabel}
			/>
			{value && (
				<button
					type="button"
					className="dict-search-clear"
					onClick={() => onChange("")}
					aria-label={clearAriaLabel}
					title={clearAriaLabel}
				>
					<X size={12} />
				</button>
			)}
		</div>
	);
}

export function PanelDisclosure({
	label,
	ariaLabel = label,
	open,
	onToggle,
	children,
}: {
	label: string;
	ariaLabel?: string;
	open: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	return (
		<section className={`dict-disclosure ${open ? "open" : ""}`.trim()} aria-label={ariaLabel}>
			<button type="button" className="dict-disclosure-btn" aria-expanded={open} onClick={onToggle}>
				<span>{label}</span>
				{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
			</button>
			{open && children}
		</section>
	);
}

export function VocabEntryBody({
	lemma,
	hanja,
	pos,
	gloss,
	romanized,
	surfaceForms,
	grammarNote,
	isSpeaking,
	hasSpeechError,
	onSpeak,
	metaPrefix,
	metaSuffix,
	children,
}: {
	lemma: string;
	hanja?: string;
	pos?: LexiconEntry["pos"];
	gloss: string;
	romanized?: string;
	surfaceForms?: readonly string[];
	grammarNote?: string;
	isSpeaking: boolean;
	hasSpeechError: boolean;
	onSpeak: () => void;
	metaPrefix?: ReactNode;
	metaSuffix?: ReactNode;
	children?: ReactNode;
}) {
	const phonetic = romanized ?? (containsHangul(lemma) ? romanizeHangul(lemma) : "");
	const hasVariants = Boolean(surfaceForms?.some((form) => form !== lemma));

	return (
		<>
			<div className="vocab-head-row">
				<div className="vocab-lemma-group">
					<div className="vocab-lemma" lang="ko">
						{lemma}
						{hanja && <span className="vocab-hanja">{hanja}</span>}
					</div>
					<SpeakButton
						label={`Pronounce ${lemma}`}
						className="vocab-speak-btn"
						speaking={isSpeaking}
						onSpeak={onSpeak}
					/>
				</div>
				<div className="vocab-head-meta">
					{metaPrefix}
					{pos && <span className="vocab-pos">{pos}</span>}
					{metaSuffix}
				</div>
			</div>

			{phonetic && <div className="vocab-phonetics">[{phonetic}]</div>}
			<div className="vocab-gloss">{gloss}</div>
			{(grammarNote || hasVariants) && (
				<div className="vocab-forms">
					{hasVariants && surfaceForms && <span>{surfaceForms.join(", ")}</span>}
					{hasVariants && grammarNote && <span> · </span>}
					{grammarNote && <span>{grammarNote}</span>}
				</div>
			)}
			{children}
			{hasSpeechError && (
				<div className="vocab-speech-note">Korean voice unavailable in this browser.</div>
			)}
		</>
	);
}

export function GrammarRuleCard({
	pattern,
	modernText,
	explanation,
	children,
}: {
	pattern: string;
	modernText: string;
	explanation: string;
	children?: ReactNode;
}) {
	return (
		<div className="grammar-card">
			<div className="grammar-pattern">{pattern}</div>
			<div className="grammar-modern">{modernText}</div>
			<p className="grammar-desc">{explanation}</p>
			{children}
		</div>
	);
}
