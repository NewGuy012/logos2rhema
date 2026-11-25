import "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";

import { act, type ComponentProps } from "react";

import { CommentaryPanel } from "../src/react-app/components/CommentaryPanel";
import { StudyRightRail } from "../src/react-app/components/StudyRightRail";
import { analyzeKoreanChapter } from "../src/shared/korean-morphology";
import type { ChapterCommentaryResponse } from "../src/shared/types";
import {
	cleanupDom,
	fireClick,
	fireDrag,
	getButton,
	getByText,
	noop,
	render,
	setInputValue,
} from "./setup";

describe("CommentaryPanel & StudyRightRail", () => {
	afterEach(cleanupDom);
	const sampleMhData: ChapterCommentaryResponse = {
		bookIntroduction: ["An Exposition of the Gospel of John."],
		introduction: ["Christ's discourse with Nicodemus (v. 1-21)."],
		entries: [
			{
				id: "matthew-henry:JHN:3:1",
				verseStart: 1,
				verseEnd: 21,
				heading: "The New Birth",
				paragraphs: [
					"Paragraph one introducing Nicodemus.",
					"Paragraph two discussing spiritual regeneration.",
					"Paragraph three summarizing verse 16.",
					"Paragraph four hidden until expanded unless matched by keyword salvation.",
				],
			},
			{
				id: "matthew-henry:JHN:3:22",
				verseStart: 22,
				paragraphs: ["John Baptist bears final witness to Christ."],
			},
		],
	};

	const analysis = analyzeKoreanChapter([{ verse: 1, text: "태초에 하나님이" }]);

	function makeRailProps(
		overrides: Partial<ComponentProps<typeof StudyRightRail>> = {},
	): ComponentProps<typeof StudyRightRail> {
		return {
			activeTab: "dictionary",
			onChangeTab: noop,
			onMinimize: noop,
			bookEn: "John",
			bookKo: "요한복음",
			chapter: 3,
			footnotes: analysis.footnotes,
			grammarNotes: analysis.grammarNotes,
			highlightedFootnoteId: null,
			commentarySource: "matthew-henry",
			commentaryData: sampleMhData,
			commentaryLoading: false,
			commentaryError: null,
			maxVerseInChapter: 36,
			selectedVerse: 16,
			onChangeCommentarySource: noop,
			onRetryCommentary: noop,
			onJumpToVerse: noop,
			...overrides,
		};
	}

	function makePanelProps(
		overrides: Partial<ComponentProps<typeof CommentaryPanel>> = {},
	): ComponentProps<typeof CommentaryPanel> {
		return {
			bookEn: "Judges",
			chapter: 1,
			source: "tyndale",
			data: null,
			loading: false,
			error: null,
			selectedVerse: null,
			onChangeSource: noop,
			onRetry: noop,
			onJumpToVerse: noop,
			...overrides,
		};
	}

	it("switches StudyRightRail tabs, filters/expands commentary, syncs verses, and drags/snaps cleanly", () => {
		const onChangeTab = mock(() => {});
		const onChangeSource = mock(() => {});
		const onJumpToVerse = mock(() => {});
		const onMinimize = mock(() => {});

		const { container, rerender } = render(
			<StudyRightRail {...makeRailProps({ onChangeTab, onMinimize })} />,
		);

		expect(container.querySelector(".panel-title")?.textContent).toBe("Dictionary");
		expect(
			container
				.querySelector('[role="tablist"][aria-label="Study panel"]')
				?.getAttribute("aria-orientation"),
		).toBe("vertical");
		fireClick(getButton(container, "Commentary"));
		expect(onChangeTab).toHaveBeenCalledWith("commentary");

		rerender(
			<StudyRightRail
				{...makeRailProps({
					activeTab: "commentary",
					onChangeTab,
					onChangeCommentarySource: onChangeSource,
					onJumpToVerse,
					onMinimize,
				})}
			/>,
		);

		expect(container.querySelector(".panel-title")?.textContent).toBe("Commentary");
		expect(getByText(container, "Public Domain")).toBeDefined();
		expect(
			container.querySelector('[data-commentary-id="matthew-henry:JHN:3:1"]')?.className,
		).toContain("highlighted");
		expect(getButton(container, "v.1–21")).toBeDefined();
		expect(getButton(container, "v.22–36")).toBeDefined();

		// Expand / collapse long note & overview disclosures
		expect(container.textContent).not.toContain("keyword salvation");
		fireClick(getButton(container, "Read full note"));
		expect(container.textContent).toContain("keyword salvation");
		fireClick(getButton(container, "Show less"));
		expect(container.textContent).not.toContain("keyword salvation");
		fireClick(getButton(container, "Chapter Overview"));
		expect(getByText(container, "Christ's discourse with Nicodemus (v. 1-21).")).toBeDefined();
		fireClick(getButton(container, "Book Introduction"));
		expect(getByText(container, "An Exposition of the Gospel of John.")).toBeDefined();

		// Text and verse-number search
		const searchInput = container.querySelector("input[type='search']") as HTMLInputElement;
		setInputValue(searchInput, "salvation");
		expect(container.textContent).toContain("keyword salvation");
		expect(container.querySelector('[data-commentary-id="matthew-henry:JHN:3:22"]')).toBeNull();
		setInputValue(searchInput, "16");
		expect(container.querySelector('[data-commentary-id="matthew-henry:JHN:3:1"]')).not.toBeNull();
		fireClick(getButton(container, "Clear commentary search"));

		fireClick(getButton(container, "v.22–36"));
		expect(onJumpToVerse).toHaveBeenCalledWith(22);
		fireClick(getButton(container, "Tyndale"));
		expect(onChangeSource).toHaveBeenCalledWith("tyndale");
		fireClick(getButton(container, "Minimize commentary"));
		expect(onMinimize).toHaveBeenCalledTimes(1);

		// Drag only via header (not body), snap back, and disabled in sheet variant
		const panel = container.querySelector("#footnotes") as HTMLElement;
		fireDrag(container.querySelector(".right-rail-tabpanel") as Element, [50, 50], [180, 160]);
		expect(panel.className).not.toContain("floating");

		fireDrag(container.querySelector(".dict-panel-header") as Element, [50, 50], [250, 190]);
		expect(panel.className).toContain("floating");
		expect(panel.style.left).toBe("200px");
		expect(panel.style.top).toBe("140px");

		fireClick(getButton(container, "Snap commentary back to original position"));
		expect(panel.className).not.toContain("floating");

		rerender(<StudyRightRail {...makeRailProps({ variant: "sheet", onMinimize })} />);
		fireDrag(container.querySelector(".dict-panel-header") as Element, [50, 50], [220, 170]);
		expect(container.querySelector("#footnotes")?.className).not.toContain("floating");
	});

	it("handles loading, error retry, empty book, and Tyndale CC BY-SA attribution", () => {
		const onRetry = mock(() => {});
		const { container, rerender } = render(
			<CommentaryPanel {...makePanelProps({ loading: true, onRetry })} />,
		);

		expect(getByText(container, "Loading Tyndale notes...")).toBeDefined();
		const licenseLink = container.querySelector(".commentary-attribution a") as HTMLAnchorElement;
		expect(licenseLink.textContent).toBe("CC BY-SA 4.0");
		expect(licenseLink.getAttribute("href")).toBe(
			"https://creativecommons.org/licenses/by-sa/4.0/",
		);

		rerender(
			<CommentaryPanel {...makePanelProps({ error: "Commentary lookup failed", onRetry })} />,
		);
		expect(getByText(container, "Commentary lookup failed")).toBeDefined();
		fireClick(getButton(container, "Try again"));
		expect(onRetry).toHaveBeenCalledTimes(1);

		rerender(<CommentaryPanel {...makePanelProps({ data: { entries: [] }, onRetry })} />);
		expect(
			getByText(container, "No notes available in Tyndale Open Study Notes for Judges 1."),
		).toBeDefined();
	});

	it("resizes StudyRightRail width and height via bottom-left corner mouse drag, keyboard, reset button, and double-click", () => {
		const origInnerWidth = window.innerWidth;
		const origInnerHeight = window.innerHeight;
		Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
		Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
		try {
			const { container, rerender } = render(<StudyRightRail {...makeRailProps()} />);
			const panel = container.querySelector("#footnotes") as HTMLElement;

			// Dictionary exposes only bottom-left corner resize handle and no reset button initially
			expect(panel.querySelector('[data-resize-handle="bottom-right"]')).toBeNull();
			expect(panel.querySelector(".panel-reset-size-btn")).toBeNull();
			const cornerHandle = panel.querySelector('[data-resize-handle="bottom-left"]') as HTMLElement;
			expect(cornerHandle.getAttribute("role")).toBe("separator");
			expect(cornerHandle.getAttribute("aria-label")).toBe("Resize dictionary panel");

			// Dragging bottom-left corner down-left widens (230 -> 350) and increases height (320 -> 440)
			fireDrag(cornerHandle, [300, 320], [180, 440]);
			expect(panel.className).not.toContain("floating");
			expect(panel.style.width).toBe("350px");
			expect(panel.style.height).toBe("440px");
			expect(document.body.classList.contains("is-panel-resizing-nesw")).toBe(false);

			// Header reset button appears when resized and resets both width and height
			fireClick(getButton(panel, "Reset dictionary to original width and height"));
			expect(panel.style.width).toBe("");
			expect(panel.style.height).toBe("");
			expect(panel.querySelector(".panel-reset-size-btn")).toBeNull();

			// Dragging bottom-left corner up-right clamps to minWidth (200px) and minHeight (220px)
			fireDrag(cornerHandle, [180, 320], [500, 100]);
			expect(panel.style.width).toBe("200px");
			expect(panel.style.height).toBe("220px");

			// Keyboard ArrowLeft widens, ArrowDown heightens, Enter resets both
			act(() => {
				cornerHandle.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
				);
				cornerHandle.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
				);
			});
			expect(panel.style.width).toBe("216px");
			expect(panel.style.height).toBe("236px");
			act(() => {
				cornerHandle.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
				);
			});
			expect(panel.style.width).toBe("");
			expect(panel.style.height).toBe("");

			// Switching to Commentary updates labels while preserving resized dimensions
			fireDrag(cornerHandle, [300, 320], [210, 410]);
			expect(panel.style.width).toBe("320px");
			expect(panel.style.height).toBe("410px");
			rerender(<StudyRightRail {...makeRailProps({ activeTab: "commentary" })} />);
			expect(cornerHandle.getAttribute("aria-label")).toBe("Resize commentary panel");
			expect(getButton(panel, "Reset commentary to original width and height")).toBeDefined();
			expect(panel.style.width).toBe("320px");
			expect(panel.style.height).toBe("410px");

			// Floating panel keeps bottom-left corner handle, exposes both Snap Back & Reset Size, and anchors right boundary
			fireDrag(panel.querySelector(".dict-panel-header") as Element, [50, 50], [450, 170]);
			expect(panel.className).toContain("floating");
			expect(panel.style.left).toBe("400px");
			expect(panel.style.width).toBe("320px");
			expect(panel.style.height).toBe("410px");
			expect(getButton(panel, "Snap commentary back to original position")).toBeDefined();
			expect(getButton(panel, "Reset commentary to original width and height")).toBeDefined();

			const floatingCorner = panel.querySelector(
				'[data-resize-handle="bottom-left"]',
			) as HTMLElement;
			expect(floatingCorner).not.toBeNull();
			expect(panel.querySelector('[data-resize-handle="bottom-right"]')).toBeNull();

			// Drag bottom-left corner down-left by (-80, +60) -> width 320 -> 400, height 410 -> 470, left 400 -> 320
			fireDrag(floatingCorner, [400, 580], [320, 640]);
			expect(panel.style.width).toBe("400px");
			expect(panel.style.height).toBe("470px");
			expect(panel.style.left).toBe("320px");

			// Double-click resets both width and height back to default while keeping floating position
			act(() => {
				floatingCorner.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
			});
			expect(panel.style.width).toBe("");
			expect(panel.style.height).toBe("");
			expect(panel.className).toContain("floating");

			// Sheet variant disables resizing completely
			rerender(<StudyRightRail {...makeRailProps({ variant: "sheet" })} />);
			expect(container.querySelector("[data-resize-handle]")).toBeNull();
		} finally {
			Object.defineProperty(window, "innerWidth", { value: origInnerWidth, configurable: true });
			Object.defineProperty(window, "innerHeight", { value: origInnerHeight, configurable: true });
		}
	});
});
