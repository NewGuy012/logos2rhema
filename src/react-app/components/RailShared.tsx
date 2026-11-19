import type { ReactNode } from "react";

import { ChevronDown, ChevronRight, Pin, Search, X } from "./Icons";

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
