import { beforeEach, describe, expect, it, mock } from "bun:test";
import { join } from "node:path";

import type { ComponentProps } from "react";

import { CommentaryPanel } from "../src/react-app/components/CommentaryPanel";
import { StudyRightRail } from "../src/react-app/components/StudyRightRail";
import { clearLoaderCaches, loadChapterCommentary } from "../src/react-app/lib/bible-loader";
import { analyzeKoreanChapter } from "../src/shared/korean-morphology";
import type { ChapterCommentaryResponse } from "../src/shared/types";
import {
	fireClick,
	fireDrag,
	getButton,
	getByText,
	noop,
	render,
	setInputValue,
	withMockFetch,
} from "./setup";

describe("CommentaryPanel, StudyRightRail & Commentary Loader", () => {
	beforeEach(() => {
		clearLoaderCaches();
	});

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
					"Paragraph one introducing Nicodemus and his visit by night.",
					"Paragraph two discussing spiritual regeneration.",
					"Paragraph three summarizing verse 16 and God's love for the world.",
					"Paragraph four hidden until expanded unless matched by search keyword salvation.",
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

	it("renders tabbed StudyRightRail, switches tabs, filters/expands notes, and syncs verses", () => {
		const onChangeTab = mock(() => {});
		const onChangeSource = mock(() => {});
		const onJumpToVerse = mock(() => {});
		const onMinimize = mock(() => {});

		const { container, rerender } = render(
			<StudyRightRail {...makeRailProps({ onChangeTab, onMinimize })} />,
		);

		expect(container.querySelector(".panel-title")?.textContent).toBe("Dictionary");
		const subtitleLines = Array.from(
			container.querySelectorAll(".panel-subtitle .panel-subtitle-line"),
		).map((el) => el.textContent);
		expect(subtitleLines).toEqual(["John 3", "요한복음 3장"]);
		const tablist = container.querySelector('[role="tablist"][aria-label="Study panel"]');
		expect(tablist?.getAttribute("aria-orientation")).toBe("vertical");
		fireClick(getButton(container, "Commentary"));
		expect(onChangeTab).toHaveBeenCalledWith("commentary");

		const commentaryProps = makeRailProps({
			activeTab: "commentary",
			onChangeTab,
			onChangeCommentarySource: onChangeSource,
			onJumpToVerse,
			onMinimize,
		});
		rerender(<StudyRightRail {...commentaryProps} />);

		expect(container.querySelector(".panel-title")?.textContent).toBe("Commentary");
		expect(getByText(container, "Public Domain")).toBeDefined();

		const firstCard = container.querySelector('[data-commentary-id="matthew-henry:JHN:3:1"]');
		expect(firstCard?.className).toContain("highlighted");
		expect(getButton(container, "v.1–21")).toBeDefined();
		expect(getButton(container, "v.22–36")).toBeDefined();

		expect(container.textContent).not.toContain("keyword salvation");
		fireClick(getButton(container, "Read full note"));
		expect(container.textContent).toContain("keyword salvation");
		fireClick(getButton(container, "Show less"));
		expect(container.textContent).not.toContain("keyword salvation");

		fireClick(getButton(container, "Chapter Overview"));
		expect(getByText(container, "Christ's discourse with Nicodemus (v. 1-21).")).toBeDefined();
		fireClick(getButton(container, "Book Introduction"));
		expect(getByText(container, "An Exposition of the Gospel of John.")).toBeDefined();

		const searchInput = container.querySelector("input[type='search']") as HTMLInputElement;
		setInputValue(searchInput, "salvation");
		expect(container.textContent).toContain("keyword salvation");
		expect(container.querySelector('[data-commentary-id="matthew-henry:JHN:3:22"]')).toBeNull();
		setInputValue(searchInput, "16");
		expect(container.querySelector('[data-commentary-id="matthew-henry:JHN:3:1"]')).not.toBeNull();
		expect(container.querySelector('[data-commentary-id="matthew-henry:JHN:3:22"]')).toBeNull();
		fireClick(getButton(container, "Clear commentary search"));

		fireClick(getButton(container, "v.22–36"));
		expect(onJumpToVerse).toHaveBeenCalledWith(22);

		fireClick(getButton(container, "Tyndale"));
		expect(onChangeSource).toHaveBeenCalledWith("tyndale");

		fireClick(getButton(container, "Minimize commentary"));
		expect(onMinimize).toHaveBeenCalledTimes(1);

		const panel = container.querySelector("#footnotes") as HTMLElement;
		fireDrag(container.querySelector(".right-rail-tabpanel") as Element, [50, 50], [180, 160]);
		expect(panel.className).not.toContain("floating");

		fireDrag(container.querySelector(".dict-panel-header") as Element, [50, 50], [250, 190]);
		expect(panel.className).toContain("floating");
		expect(panel.style.left).toBe("200px");
		expect(panel.style.top).toBe("140px");

		fireClick(getButton(container, "Snap commentary back to original position"));
		expect(panel.className).not.toContain("floating");
		expect(panel.style.left).toBe("");

		rerender(<StudyRightRail {...makeRailProps({ variant: "sheet", onMinimize })} />);
		const sheetHeader = container.querySelector(".dict-panel-header") as HTMLElement;
		expect(sheetHeader.className).not.toContain("panel-drag-handle");
		fireDrag(sheetHeader, [50, 50], [220, 170]);
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

	it("caches commentary fetches and evicts failures so retries succeed", async () => {
		let callCount = 0;
		await withMockFetch(
			() => {
				callCount++;
				if (callCount === 1) {
					return Response.json({ error: "Commentary lookup failed" }, { status: 502 });
				}
				return Response.json({
					entries: [
						{
							id: "tyndale:GEN:1:1",
							verseStart: 1,
							paragraphs: ["1:1 In the beginning."],
						},
					],
				});
			},
			async () => {
				await expect(
					loadChapterCommentary({ commentaryId: "tyndale", usfm: "GEN", chapter: 1 }),
				).rejects.toThrow("Commentary lookup failed");

				const first = await loadChapterCommentary({
					commentaryId: "tyndale",
					usfm: "GEN",
					chapter: 1,
				});
				const second = await loadChapterCommentary({
					commentaryId: "tyndale",
					usfm: "GEN",
					chapter: 1,
				});
				expect(callCount).toBe(2);
				expect(first).toEqual(second);
			},
		);
	});

	it("lays out the StudyRightRail dictionary/commentary toggle vertically in CSS", async () => {
		const css = await Bun.file(join(import.meta.dir, "../src/react-app/index.css")).text();
		const style = document.createElement("style");
		style.textContent = css;
		document.head.appendChild(style);

		try {
			const { container } = render(<StudyRightRail {...makeRailProps()} />);
			const tablist = container.querySelector(
				'[role="tablist"][aria-label="Study panel"]',
			) as HTMLElement;
			expect(tablist.getAttribute("aria-orientation")).toBe("vertical");

			const computed = window.getComputedStyle(tablist);
			expect(computed.display).toBe("grid");
			expect(computed.gridAutoFlow).toBe("row");
			expect(computed.gridTemplateColumns).toBe("minmax(0, 1fr)");
			expect(computed.gridAutoRows).toBe("minmax(0, 1fr)");
		} finally {
			style.remove();
		}
	});
});
