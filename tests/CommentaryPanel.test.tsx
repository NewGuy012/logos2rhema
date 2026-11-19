import { beforeEach, describe, expect, it, mock } from "bun:test";

import { act } from "react";

import { CommentaryPanel } from "../src/react-app/components/CommentaryPanel";
import { StudyRightRail } from "../src/react-app/components/StudyRightRail";
import { clearCommentaryCache, loadChapterCommentary } from "../src/react-app/lib/bible-loader";
import { analyzeKoreanChapter } from "../src/shared/korean-morphology";
import type { ChapterCommentaryResponse } from "../src/shared/types";
import {
	fireClick,
	getButton,
	getByText,
	noop,
	render,
	setInputValue,
	withMockFetch,
} from "./setup";

describe("CommentaryPanel, StudyRightRail & Commentary Loader", () => {
	beforeEach(() => {
		clearCommentaryCache();
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

	it("renders tabbed StudyRightRail, switches tabs, filters/expands notes, and syncs verses", () => {
		const analysis = analyzeKoreanChapter([{ verse: 1, text: "태초에 하나님이" }]);
		const onChangeTab = mock(() => {});
		const onChangeSource = mock(() => {});
		const onJumpToVerse = mock(() => {});
		const onMinimize = mock(() => {});
		const onRetry = mock(() => {});

		const { container, rerender } = render(
			<StudyRightRail
				activeTab="dictionary"
				onChangeTab={onChangeTab}
				onMinimize={onMinimize}
				bookEn="John"
				bookKo="요한복음"
				chapter={3}
				footnotes={analysis.footnotes}
				grammarNotes={analysis.grammarNotes}
				highlightedFootnoteId={null}
				commentarySource="matthew-henry"
				commentaryData={sampleMhData}
				commentaryLoading={false}
				commentaryError={null}
				maxVerseInChapter={36}
				selectedVerse={16}
				onChangeCommentarySource={onChangeSource}
				onRetryCommentary={onRetry}
				onJumpToVerse={onJumpToVerse}
			/>,
		);

		expect(container.querySelector(".panel-title")?.textContent).toBe("Dictionary");
		fireClick(getButton(container, "Commentary"));
		expect(onChangeTab).toHaveBeenCalledWith("commentary");

		rerender(
			<StudyRightRail
				activeTab="commentary"
				onChangeTab={onChangeTab}
				onMinimize={onMinimize}
				bookEn="John"
				bookKo="요한복음"
				chapter={3}
				footnotes={analysis.footnotes}
				grammarNotes={analysis.grammarNotes}
				highlightedFootnoteId={null}
				commentarySource="matthew-henry"
				commentaryData={sampleMhData}
				commentaryLoading={false}
				commentaryError={null}
				maxVerseInChapter={36}
				selectedVerse={16}
				onChangeCommentarySource={onChangeSource}
				onRetryCommentary={onRetry}
				onJumpToVerse={onJumpToVerse}
			/>,
		);

		expect(container.querySelector(".panel-title")?.textContent).toBe("Commentary");
		expect(getByText(container, "Public Domain")).toBeDefined();

		// Verse 16 falls inside v.1-21 pericope, and last entry shows v.22-36
		const firstCard = container.querySelector('[data-commentary-id="matthew-henry:JHN:3:1"]');
		expect(firstCard?.className).toContain("highlighted");
		expect(getButton(container, "v.1–21")).toBeDefined();
		expect(getButton(container, "v.22–36")).toBeDefined();

		// Expand & collapse long note
		expect(container.textContent).not.toContain("keyword salvation");
		fireClick(getButton(container, "Read full note"));
		expect(container.textContent).toContain("keyword salvation");
		fireClick(getButton(container, "Show less"));
		expect(container.textContent).not.toContain("keyword salvation");

		// Collapsible introductions
		fireClick(getButton(container, "Chapter Overview"));
		expect(getByText(container, "Christ's discourse with Nicodemus (v. 1-21).")).toBeDefined();
		fireClick(getButton(container, "Book Introduction"));
		expect(getByText(container, "An Exposition of the Gospel of John.")).toBeDefined();

		// Search auto-expands matching paragraph and filters out non-matching entries
		const searchInput = container.querySelector("input[type='search']") as HTMLInputElement;
		setInputValue(searchInput, "salvation");
		expect(container.textContent).toContain("keyword salvation");
		expect(container.querySelector('[data-commentary-id="matthew-henry:JHN:3:22"]')).toBeNull();
		// Verse number search matches pericope range
		setInputValue(searchInput, "16");
		expect(container.querySelector('[data-commentary-id="matthew-henry:JHN:3:1"]')).not.toBeNull();
		expect(container.querySelector('[data-commentary-id="matthew-henry:JHN:3:22"]')).toBeNull();
		fireClick(getButton(container, "Clear commentary search"));

		// Jump to verse and switch source
		fireClick(getButton(container, "v.22–36"));
		expect(onJumpToVerse).toHaveBeenCalledWith(22);

		fireClick(getButton(container, "Tyndale"));
		expect(onChangeSource).toHaveBeenCalledWith("tyndale");

		fireClick(getButton(container, "Minimize commentary"));
		expect(onMinimize).toHaveBeenCalledTimes(1);

		// Dragging via header detaches sidebar and exposes Snap Back button; body text does not drag
		const panel = container.querySelector("#footnotes") as HTMLElement;
		const bodyProse = container.querySelector(".right-rail-tabpanel") as HTMLElement;
		act(() => {
			bodyProse.dispatchEvent(
				new window.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 50, clientY: 50 }),
			);
			window.dispatchEvent(
				new window.MouseEvent("mousemove", { bubbles: true, clientX: 180, clientY: 160 }),
			);
			window.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
		});
		expect(panel.className).not.toContain("floating");

		const header = container.querySelector(".dict-panel-header") as HTMLElement;
		act(() => {
			header.dispatchEvent(
				new window.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 50, clientY: 50 }),
			);
			window.dispatchEvent(
				new window.MouseEvent("mousemove", { bubbles: true, clientX: 250, clientY: 190 }),
			);
			window.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
		});
		expect(panel.className).toContain("floating");
		expect(panel.style.left).toBe("200px");
		expect(panel.style.top).toBe("140px");

		fireClick(getButton(container, "Snap commentary back to original position"));
		expect(panel.className).not.toContain("floating");
		expect(panel.style.left).toBe("");

		// Mobile sheet variant must remain non-draggable
		rerender(
			<StudyRightRail
				activeTab="dictionary"
				onChangeTab={onChangeTab}
				variant="sheet"
				onMinimize={onMinimize}
				bookEn="John"
				bookKo="요한복음"
				chapter={3}
				footnotes={analysis.footnotes}
				grammarNotes={analysis.grammarNotes}
				highlightedFootnoteId={null}
				commentarySource="matthew-henry"
				commentaryData={sampleMhData}
				commentaryLoading={false}
				commentaryError={null}
				maxVerseInChapter={36}
				selectedVerse={16}
				onChangeCommentarySource={onChangeSource}
				onRetryCommentary={onRetry}
				onJumpToVerse={onJumpToVerse}
			/>,
		);
		const sheetHeader = container.querySelector(".dict-panel-header") as HTMLElement;
		expect(sheetHeader.className).not.toContain("panel-drag-handle");
		act(() => {
			sheetHeader.dispatchEvent(
				new window.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 50, clientY: 50 }),
			);
			window.dispatchEvent(
				new window.MouseEvent("mousemove", { bubbles: true, clientX: 220, clientY: 170 }),
			);
			window.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
		});
		expect(container.querySelector("#footnotes")?.className).not.toContain("floating");
	});

	it("handles loading, error retry, empty book, and Tyndale CC BY-SA attribution", () => {
		const onRetry = mock(() => {});
		const { container, rerender } = render(
			<CommentaryPanel
				bookEn="Judges"
				chapter={1}
				source="tyndale"
				data={null}
				loading={true}
				error={null}
				selectedVerse={null}
				onChangeSource={noop}
				onRetry={onRetry}
				onJumpToVerse={noop}
			/>,
		);

		expect(getByText(container, "Loading Tyndale notes...")).toBeDefined();
		const licenseLink = container.querySelector(".commentary-attribution a") as HTMLAnchorElement;
		expect(licenseLink.textContent).toBe("CC BY-SA 4.0");
		expect(licenseLink.getAttribute("href")).toBe(
			"https://creativecommons.org/licenses/by-sa/4.0/",
		);

		rerender(
			<CommentaryPanel
				bookEn="Judges"
				chapter={1}
				source="tyndale"
				data={null}
				loading={false}
				error="Commentary lookup failed"
				selectedVerse={null}
				onChangeSource={noop}
				onRetry={onRetry}
				onJumpToVerse={noop}
			/>,
		);
		expect(getByText(container, "Commentary lookup failed")).toBeDefined();
		fireClick(getButton(container, "Try again"));
		expect(onRetry).toHaveBeenCalledTimes(1);

		rerender(
			<CommentaryPanel
				bookEn="Judges"
				chapter={1}
				source="tyndale"
				data={{
					entries: [],
				}}
				loading={false}
				error={null}
				selectedVerse={null}
				onChangeSource={noop}
				onRetry={onRetry}
				onJumpToVerse={noop}
			/>,
		);
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
});
