import { useEffect, useRef, useState } from "react";

import type { TranslationMeta } from "../../shared/types";
import { Bible, Search, Type } from "./Icons";
import type { StackOrder, StudyMaskMode } from "./VerseBlock";

export type ReaderTheme = "paper" | "sepia" | "dark";
export type KoreanFontStyle = "serif" | "sans";

interface TopBarProps {
	isHome?: boolean;
	selectedEn: TranslationMeta;
	selectedKo: TranslationMeta;
	stackOrder: StackOrder;
	theme: ReaderTheme;
	fontScale: number;
	koFontStyle: KoreanFontStyle;
	studyMask: StudyMaskMode;
	onGoHome: () => void;
	onFlipStackOrder: () => void;
	onOpenSearch: () => void;
	onChangeTheme: (theme: ReaderTheme) => void;
	onChangeFontScale: (scale: number) => void;
	onChangeKoFontStyle: (style: KoreanFontStyle) => void;
	onChangeStudyMask: (mode: StudyMaskMode) => void;
}

type OpenPopover = "display" | null;

export function TopBar({
	isHome = false,
	selectedEn,
	selectedKo,
	stackOrder,
	theme,
	fontScale,
	koFontStyle,
	studyMask,
	onGoHome,
	onFlipStackOrder,
	onOpenSearch,
	onChangeTheme,
	onChangeFontScale,
	onChangeKoFontStyle,
	onChangeStudyMask,
}: TopBarProps) {
	const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
	const navRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!openPopover) return;
		const handleOutside = (event: MouseEvent) => {
			if (navRef.current && !navRef.current.contains(event.target as Node)) {
				setOpenPopover(null);
			}
		};
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpenPopover(null);
		};
		document.addEventListener("mousedown", handleOutside);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handleOutside);
			document.removeEventListener("keydown", handleKey);
		};
	}, [openPopover]);

	return (
		<header className="top-bar" ref={navRef}>
			<div className="top-bar-inner">
				<div className="brand-group">
					<a
						href="#/"
						className={`brand-mark ${isHome ? "is-home" : ""}`}
						aria-label="Logos2Rhema Home"
						title="Return to Logos2Rhema Home"
						onClick={(e) => {
							e.preventDefault();
							onGoHome();
						}}
					>
						<Bible size={17} className="brand-icon" />
						<span>Logos2Rhema</span>
					</a>
					<button
						type="button"
						className="icon-btn"
						onClick={onOpenSearch}
						title="Go to book or chapter (Cmd/Ctrl+K)"
					>
						<Search size={15} />
						<span>Go to</span>
					</button>
				</div>

				<div className="top-controls">
					<span
						className="translation-badge"
						aria-label="Canonical language editions"
						title={`${selectedEn.nativeName} · ${selectedKo.nativeName}`}
					>
						{selectedEn.code} / {selectedKo.code}
					</span>

					<div className="popover-anchor">
						<button
							type="button"
							className={`icon-btn ${openPopover === "display" ? "active" : ""}`}
							onClick={() => setOpenPopover((prev) => (prev === "display" ? null : "display"))}
							aria-expanded={openPopover === "display"}
							aria-label="Reader appearance settings"
						>
							<Type size={15} />
							<span>Aa</span>
						</button>

						{openPopover === "display" && (
							<div className="popover-card">
								<div className="settings-group">
									<p className="popover-title">Theme</p>
									<div className="segmented-row">
										{(["paper", "sepia", "dark"] as const).map((mode) => (
											<button
												key={mode}
												type="button"
												className={`segmented-btn ${theme === mode ? "active" : ""}`}
												onClick={() => onChangeTheme(mode)}
											>
												{mode === "paper" ? "Paper" : mode === "sepia" ? "Sepia" : "Dark"}
											</button>
										))}
									</div>
								</div>

								<div className="settings-group">
									<p className="popover-title">Text Size</p>
									<div className="segmented-row">
										{[
											{ label: "S", val: 0.9 },
											{ label: "M", val: 1 },
											{ label: "L", val: 1.12 },
											{ label: "XL", val: 1.24 },
										].map((opt) => (
											<button
												key={opt.label}
												type="button"
												className={`segmented-btn ${fontScale === opt.val ? "active" : ""}`}
												onClick={() => onChangeFontScale(opt.val)}
											>
												{opt.label}
											</button>
										))}
									</div>
								</div>

								<div className="settings-group">
									<p className="popover-title">Korean Font</p>
									<div className="segmented-row">
										<button
											type="button"
											className={`segmented-btn ${koFontStyle === "serif" ? "active" : ""}`}
											onClick={() => onChangeKoFontStyle("serif")}
										>
											Serif (명조)
										</button>
										<button
											type="button"
											className={`segmented-btn ${koFontStyle === "sans" ? "active" : ""}`}
											onClick={() => onChangeKoFontStyle("sans")}
										>
											Sans (고딕)
										</button>
									</div>
								</div>

								<div className="settings-group">
									<p className="popover-title">Stack Order</p>
									<div
										className="segmented-row"
										role="group"
										aria-label="Flip language stack order"
									>
										<button
											type="button"
											className={`segmented-btn ${stackOrder === "en-first" ? "active" : ""}`}
											onClick={() => {
												if (stackOrder !== "en-first") onFlipStackOrder();
											}}
											aria-pressed={stackOrder === "en-first"}
										>
											EN / 한
										</button>
										<button
											type="button"
											className={`segmented-btn ${stackOrder === "ko-first" ? "active" : ""}`}
											onClick={() => {
												if (stackOrder !== "ko-first") onFlipStackOrder();
											}}
											aria-pressed={stackOrder === "ko-first"}
										>
											한 / EN
										</button>
									</div>
								</div>

								<div className="settings-group">
									<p className="popover-title">Study Mode (Hover to Reveal)</p>
									<div className="segmented-row">
										<button
											type="button"
											className={`segmented-btn ${studyMask === "none" ? "active" : ""}`}
											onClick={() => onChangeStudyMask("none")}
										>
											Both
										</button>
										<button
											type="button"
											className={`segmented-btn ${studyMask === "mask-en" ? "active" : ""}`}
											onClick={() => onChangeStudyMask("mask-en")}
										>
											Blur EN
										</button>
										<button
											type="button"
											className={`segmented-btn ${studyMask === "mask-ko" ? "active" : ""}`}
											onClick={() => onChangeStudyMask("mask-ko")}
										>
											Blur KO
										</button>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</header>
	);
}
