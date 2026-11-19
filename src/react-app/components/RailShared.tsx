import type { ReactNode } from "react";

import { containsHangul, romanizeHangul } from "../../shared/hangul";
import type { LexiconEntry } from "../../shared/types";
import { ChevronDown, ChevronRight, Pin, Search, Volume2, X } from "./Icons";

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
