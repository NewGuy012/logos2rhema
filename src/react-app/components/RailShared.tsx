import type { ReactNode } from "react";

import { containsHangul, romanizeHangul } from "../../shared/hangul";
import type { FootnoteVocabEntry, LexiconEntry } from "../../shared/types";
import { ChevronDown, ChevronRight, Loader2, Pin, Search, Volume2, X } from "./Icons";

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
			<div className="commentary-status commentary-error">
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
					<button
						type="button"
						className={`vocab-speak-btn ${isSpeaking ? "speaking" : ""}`.trim()}
						onClick={onSpeak}
						aria-label={`Pronounce ${lemma}`}
						title={`Pronounce ${lemma}`}
					>
						<Volume2 size={13} />
					</button>
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
