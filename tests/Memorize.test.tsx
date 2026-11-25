import "./dom";

import { afterEach, describe, expect, it } from "bun:test";

import { act } from "react";

import App from "../src/react-app/App";
import { MEMORIZE_CARDS_STORAGE_KEY } from "../src/react-app/lib/memorize";
import {
	cleanupDom,
	createReaderFetchHandler,
	fireClick,
	fireHover,
	getButton,
	getByText,
	installMockAudio,
	makeBookResponse,
	makeChapterResponse,
	makeSupertonicTrack,
	mockMatchMedia,
	render,
	setInputValue,
	submitForm,
	waitUntil,
	withMockFetch,
} from "./setup";

function createMemorizeMockFetch() {
	return createReaderFetchHandler({
		lexicon: {
			하나님: { gloss: "God", pos: "name" },
			세상: { gloss: "world", pos: "noun" },
		},
		krv: (url) => {
			const usfm = url.split("/").pop()?.replace(".json", "") ?? "GEN";
			const fallbackVerses = Array.from({ length: 176 }, (_, idx) => ({
				verse: idx + 1,
				text: `한국어 말씀 ${usfm} ${idx + 1}`,
			}));
			const baseChapters = Object.fromEntries(
				Array.from({ length: 150 }, (_, ch) => [String(ch + 1), fallbackVerses]),
			);
			if (url.endsWith("/JHN.json")) {
				return makeBookResponse("krv", 43, "JHN", {
					...baseChapters,
					"3": [
						{ verse: 15, text: "이는 그를 믿는 자마다" },
						{ verse: 16, text: "하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니" },
					],
				});
			}
			if (url.endsWith("/PRO.json")) {
				return makeBookResponse("krv", 20, "PRO", {
					...baseChapters,
					"3": [
						{ verse: 5, text: "너는 마음을 다하여 여호와를 의뢰하고" },
						{ verse: 6, text: "너는 범사에 그를 인정하라" },
					],
				});
			}
			if (url.endsWith("/ROM.json")) {
				return makeBookResponse("krv", 45, "ROM", {
					...baseChapters,
					"5": [{ verse: 8, text: "우리가 아직 죄인 되었을 때에" }],
					"8": [{ verse: 1, text: "그러므로 이제 그리스도 예수 안에 있는 자에게는" }],
				});
			}
			if (url.endsWith("/EPH.json")) {
				return makeBookResponse("krv", 49, "EPH", {
					...baseChapters,
					"2": [
						{ verse: 8, text: "너희가 그 은혜로 인하여" },
						{ verse: 9, text: "행위에서 난 것이 아니니" },
					],
				});
			}
			if (url.endsWith("/2CO.json")) {
				return makeBookResponse("krv", 47, "2CO", {
					...baseChapters,
					"5": [{ verse: 17, text: "그런즉 누구든지 그리스도 안에 있으면" }],
				});
			}
			if (url.endsWith("/1JN.json")) {
				return makeBookResponse("krv", 62, "1JN", {
					...baseChapters,
					"1": [{ verse: 9, text: "만일 우리가 우리 죄를 자백하면" }],
				});
			}
			return makeBookResponse("krv", 1, usfm, baseChapters);
		},
		esv: (url) => {
			if (url === "/api/esv/JHN/3/16") {
				return makeChapterResponse("esv", 43, "JHN", 3, [
					{ verse: 16, text: "For God so loved the world," },
				]);
			}
			if (url === "/api/esv/PRO/3/5-6") {
				return makeChapterResponse("esv", 20, "PRO", 3, [
					{ verse: 5, text: "Trust in the LORD with all your heart," },
					{ verse: 6, text: "In all your ways acknowledge him," },
				]);
			}
			if (url === "/api/esv/JHN/3") {
				return makeChapterResponse("esv", 43, "JHN", 3, [
					{ verse: 15, text: "that whoever believes in him may have eternal life." },
					{ verse: 16, text: "For God so loved the world," },
				]);
			}
			const match = url.match(/\/api\/esv\/([A-Z0-9]+)\/(\d+)\/(\d+)(?:-(\d+))?/);
			const ch = Number.parseInt(match?.[2] ?? "1", 10);
			const start = Number.parseInt(match?.[3] ?? "1", 10);
			const end = Number.parseInt(match?.[4] ?? String(start), 10);
			return makeChapterResponse(
				"esv",
				1,
				match?.[1] ?? "GEN",
				ch,
				Array.from({ length: end - start + 1 }, (_, i) => ({
					verse: start + i,
					text: `ESV passage ${match?.[1] ?? "GEN"} ${ch}:${start + i}`,
				})),
			);
		},
		audio: (url) => {
			if (url.startsWith("/api/audio/JHN/3")) {
				return Response.json({
					tracks: [
						makeSupertonicTrack("/api/audio/JHN/3?lang=ko&track=supertonic", {
							15: 10.0,
							16: 18.2,
							17: 25.0,
						}),
					],
				});
			}
			if (url.startsWith("/api/audio/PRO/3")) {
				return Response.json({
					tracks: [
						makeSupertonicTrack("/api/audio/PRO/3?lang=ko&track=supertonic", {
							5: 10.0,
							6: 15.0,
							7: 22.0,
						}),
					],
				});
			}
			return Response.json({ tracks: [] });
		},
	});
}

describe("Memorize Flashcards UI & End-to-End Integration", () => {
	afterEach(cleanupDom);

	it("manages deck (add EN/KO refs, reject invalid verse, import bookmarks, starter packs, notes) without storing ESV", async () => {
		localStorage.setItem(
			"logos.reader.favorites.v1",
			JSON.stringify([
				{
					id: "43:3:15",
					bookNumber: 43,
					chapter: 3,
					verse: 15,
					koText: "믿는 자마다",
					createdAt: 1,
				},
				{ id: "1:1", bookNumber: 1, chapter: 1, createdAt: 1 }, // chapter-only bookmark ignored
			]),
		);

		await withMockFetch(createMemorizeMockFetch(), async () => {
			const { container } = render(<App />);
			// Wait for initial Home VOTD fetches before navigating
			await waitUntil(() => expect(container.querySelector(".votd-ko-quote")).not.toBeNull());

			fireClick(getButton(container, "Memorize"));
			await waitUntil(() => {
				expect(window.location.hash).toBe("#/memorize");
				expect(getByText(container, "Memorize Deck")).toBeDefined();
			});

			// Appearance settings work on Memorize view and omit Reader-only Study Mode blur
			fireClick(getButton(container, "Reader appearance settings"));
			expect(container.querySelector(".settings-popover")?.textContent).not.toContain(
				"Study Mode (Hover to Reveal)",
			);
			fireClick(getButton(container, "Reader appearance settings"));

			const addInput = container.querySelector(
				'input[aria-label="Add verse reference"]',
			) as HTMLInputElement;
			const addForm = addInput.closest("form") as HTMLFormElement;

			// Reject invalid format and nonexistent verse in chapter
			setInputValue(addInput, "John 3");
			submitForm(addForm);
			expect(getByText(container, /Enter a verse or range/)).toBeDefined();

			setInputValue(addInput, "John 3:99");
			submitForm(addForm);
			await waitUntil(() =>
				expect(getByText(container, "Verse not found in John 3.")).toBeDefined(),
			);

			// Add single EN verse & Korean range
			setInputValue(addInput, "John 3:16");
			submitForm(addForm);
			await waitUntil(() =>
				expect(getByText(container, "Added John 3:16 to your deck.")).toBeDefined(),
			);

			setInputValue(addInput, "잠 3:5-6");
			submitForm(addForm);
			await waitUntil(() =>
				expect(getByText(container, "Added Proverbs 3:5–6 to your deck.")).toBeDefined(),
			);
			expect(getByText(container, "잠언 3장 5–6절")).toBeDefined();

			// Import verse bookmark (chapter bookmark ignored)
			fireClick(getButton(container, "Import 1 from Bookmarks"));
			expect(getByText(container, "Imported 1 bookmarked verse into your deck.")).toBeDefined();

			// Edit personal note on John 3:16
			fireClick(getButton(container, "Edit note for John 3:16"));
			const noteInput = container.querySelector(
				'input[aria-label="Edit note for John 3:16"]',
			) as HTMLInputElement;
			setInputValue(noteInput, "Gospel summary");
			submitForm(noteInput.closest("form") as HTMLFormElement);
			expect(getByText(container, "Gospel summary")).toBeDefined();

			// Starter Packs starts expanded when deck was initially empty; filter categories, inspect Top 20, and add Gospel & Grace
			expect(getByText(container, "Top 20 Essential Verses")).toBeDefined();
			expect(getByText(container, "11 packs")).toBeDefined();

			fireClick(getButton(container, "Essentials"));
			expect(getByText(container, "1 pack")).toBeDefined();
			fireClick(getButton(container, "+16 more"));
			expect(getByText(container, /Phil 4:13/)).toBeDefined();

			fireClick(getButton(container, "Testaments"));
			expect(getByText(container, "Old Testament Treasures")).toBeDefined();
			expect(getByText(container, "New Testament Pillars")).toBeDefined();

			fireClick(getButton(container, "Themes"));
			fireClick(getButton(container, "Add Gospel & Grace pack"));
			await waitUntil(() =>
				expect(getByText(container, "Added 5 verses from Gospel & Grace.")).toBeDefined(),
			);

			// Filter & search deck
			const filterInput = container.querySelector(
				'input[aria-label="Filter saved flashcards"]',
			) as HTMLInputElement;
			setInputValue(filterInput, "Proverbs");
			expect(container.querySelectorAll(".memorize-deck-card")).toHaveLength(1);
			setInputValue(filterInput, "");

			// Verify ESV text is NEVER persisted in localStorage
			const storedRaw = localStorage.getItem(MEMORIZE_CARDS_STORAGE_KEY) ?? "";
			expect(storedRaw).toContain("43:3:16");
			expect(storedRaw).toContain("하나님이 세상을");
			expect(storedRaw).not.toContain("For God so loved");
			expect(storedRaw).not.toContain("enText");
		});
	});

	it("runs flashcard sessions across Flip, Ref Quiz, Bilingual Bridge, and Blanks with SM-2 re-queue, keyboard shortcuts, and Reader gutter sync", async () => {
		window.location.hash = "#/memorize";
		const restoreMatchMedia = mockMatchMedia(true);
		const mockAudio = installMockAudio({ emitTimeUpdateOnPlay: true });

		try {
			await withMockFetch(createMemorizeMockFetch(), async () => {
				const { container } = render(<App />);

				// Add two cards: John 3:16 and Proverbs 3:5-6
				const addInput = container.querySelector(
					'input[aria-label="Add verse reference"]',
				) as HTMLInputElement;
				const addForm = addInput.closest("form") as HTMLFormElement;
				setInputValue(addInput, "John 3:16");
				submitForm(addForm);
				await waitUntil(() =>
					expect(container.querySelector('[data-card-id="43:3:16"]')).not.toBeNull(),
				);

				setInputValue(addInput, "Proverbs 3:5-6");
				submitForm(addForm);
				await waitUntil(() =>
					expect(container.querySelector('[data-card-id="20:3:5-6"]')).not.toBeNull(),
				);

				fireClick(getButton(container, "Study Due (2)"));
				await waitUntil(() => {
					expect(getByText(container, "1 / 2")).toBeDefined();
					expect(getByText(container, "John 3:16")).toBeDefined();
				});

				// Play Supertonic 3 audio sliced specifically to John 3:16
				fireClick(getButton(container, /Listen to Korean verse/));
				await waitUntil(() => {
					const audio = mockAudio.latest();
					expect(audio?.src).toBe("/api/audio/JHN/3?lang=ko&track=supertonic");
					expect(audio?.currentTime).toBe(18.2);
					expect(audio?.paused).toBe(false);
				});
				act(() => {
					mockAudio.latest()!.currentTime = 24.95;
					mockAudio.emit("timeupdate");
				});
				expect(mockAudio.latest()?.paused).toBe(true);

				// 1. Classic Flip: Peek Hint shows first-letter + Korean choseong hints, Space reveals, Korean tooltip works
				fireClick(getButton(container, "Peek Hint"));
				await waitUntil(() => {
					const hintText = container.querySelector(".flashcard-hint-box")?.textContent ?? "";
					expect(hintText).toContain("ㅎㄴㄴㅇ");
					expect(hintText).toContain("F__");
				});

				await act(async () => {
					window.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
				});
				await waitUntil(() => expect(getButton(container, /Again/)).toBeDefined());

				const koWord = getButton(container.querySelector(".flashcard-card")!, "하나님이");
				fireHover(koWord, true);
				expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain("God");
				fireHover(koWord, false);

				// 2. Test Ref Quiz, Bilingual Bridge, and Progressive Blanks modes on the active card
				fireClick(getButton(container, "Ref Quiz"));
				expect(getByText(container, "Recall the book, chapter, and verse:")).toBeDefined();
				expect(getByText(container, "For God so loved the world,")).toBeDefined();

				fireClick(getButton(container, "EN ↔ 한"));
				expect(getByText(container, "Translate / recall the Korean (개역한글):")).toBeDefined();
				fireClick(getButton(container, "한 → EN"));
				expect(getByText(container, "Translate / recall the English (ESV):")).toBeDefined();

				fireClick(getButton(container, "Blanks"));
				expect(getByText(container, "Tap any blank to peek one word")).toBeDefined();
				fireClick(getButton(container, "Initials / 초성"));
				const clozeBtns = container.querySelectorAll(".cloze-blank-btn");
				expect(clozeBtns.length).toBeGreaterThan(0);
				expect(container.querySelector(".flashcard-verse-ko")?.textContent).toContain("ㅎㄴㄴㅇ");
				fireClick(clozeBtns[0]!);
				expect(clozeBtns[0]!.classList.contains("peeked")).toBe(true);

				// Reveal & press '1' (Again) -> re-queues card in session (2 -> 3 total slots)
				fireClick(getButton(container, "Reveal All"));
				await act(async () => {
					window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "1", bubbles: true }));
					await new Promise((r) => setTimeout(r, 15));
				});
				expect(getByText(container, "2 / 3")).toBeDefined();

				// Switch back to Flip, finish Proverbs 3:5-6 and re-queued John 3:16 with '3' (Good)
				fireClick(getButton(container, "Flip"));
				expect(getByText(container, "Proverbs 3:5–6")).toBeDefined();
				fireClick(getButton(container, /Listen to Korean verse/));
				await waitUntil(() => {
					const audio = mockAudio.latest();
					expect(audio?.src).toBe("/api/audio/PRO/3?lang=ko&track=supertonic");
					expect(audio?.currentTime).toBe(10.0);
					expect(audio?.paused).toBe(false);
				});
				act(() => {
					mockAudio.latest()!.currentTime = 15.5;
					mockAudio.emit("timeupdate");
				});
				expect(mockAudio.latest()?.paused).toBe(false);
				act(() => {
					mockAudio.latest()!.currentTime = 21.95;
					mockAudio.emit("timeupdate");
				});
				expect(mockAudio.latest()?.paused).toBe(true);
				fireClick(getButton(container, "Show Answer"));
				await waitUntil(() => {
					expect(getByText(container, "Trust in the LORD with all your heart,")).toBeDefined();
					expect(getByText(container, "의뢰하고")).toBeDefined();
				});
				await act(async () => {
					window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "3", bubbles: true }));
					await new Promise((r) => setTimeout(r, 15));
				});

				expect(getByText(container, "3 / 3")).toBeDefined();
				expect(getByText(container, "John 3:16")).toBeDefined();
				fireClick(getButton(container, "Show Answer"));
				await waitUntil(() => {
					expect(getByText(container, "For God so loved the world,")).toBeDefined();
					expect(getByText(container, "사랑하사")).toBeDefined();
				});
				await act(async () => {
					window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "3", bubbles: true }));
				});

				// Session complete summary shows streak and ratings
				await waitUntil(() => expect(getByText(container, "Session Complete")).toBeDefined());
				expect(getByText(container, /Reviewed 2 verses \(3 responses\)/)).toBeDefined();
				expect(getByText(container, /1 day streak/)).toBeDefined();

				fireClick(getButton(container, "Back to Deck"));
				await waitUntil(() => expect(getByText(container, "Study Due (0)")).toBeDefined());

				// Reader gutter sync: open John 3:16 in Reader and verify memorize toggle reflects active state
				const jhnCard = container.querySelector('[data-card-id="43:3:16"]') as ParentNode;
				fireClick(getButton(jhnCard, "Open John 3:16 in Reader"));
				await waitUntil(() => {
					expect(window.location.hash).toBe("#/JHN/3/16");
					expect(
						getButton(container, "Remove verse 16 from memorize deck").getAttribute("aria-pressed"),
					).toBe("true");
				});

				// Toggle verse 15 into Memorize deck directly from Reader gutter
				fireClick(getButton(container, "Add verse 15 to memorize deck"));
				expect(
					getButton(container, "Remove verse 15 from memorize deck").getAttribute("aria-pressed"),
				).toBe("true");
			});
		} finally {
			mockAudio.restore();
			restoreMatchMedia();
		}
	});
});
