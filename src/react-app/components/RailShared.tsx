import type { ReactNode } from "react";

import { ChevronDown, ChevronRight, Search, X } from "./Icons";

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
