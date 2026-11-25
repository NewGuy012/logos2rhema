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

function createMemorizeMockFetch(options?: { onEsvRequest?: (url: string) => void }) {
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
			return makeBookResponse("krv", 1, usfm, baseChapters);
		},
		esv: (url) => {
			options?.onEsvRequest?.(url);
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

describe("Memorize Simplified UI & End-to-End Integration", () => {
	afterEach(cleanupDom);

	it("manages saved verses, keeps Starter Packs collapsed by default, renders both languages inline, and excludes flashcard/note/quiz controls", async () => {
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
			await waitUntil(() => expect(container.querySelector(".votd-ko-quote")).not.toBeNull());

			fireClick(getButton(container, "Memorize"));
			await waitUntil(() => {
				expect(window.location.hash).toBe("#/memorize");
				expect(container.querySelector("h1.memorize-eyebrow")?.textContent).toContain(
					"Scripture Memorization",
				);
			});
			expect(container.querySelector(".memorize-title")).toBeNull();

			// Appearance settings work on Memorize view and omit Reader-only Study Mode blur
			fireClick(getButton(container, "Reader appearance settings"));
			expect(container.querySelector(".settings-popover")?.textContent).not.toContain(
				"Study Mode (Hover to Reveal)",
			);
			fireClick(getButton(container, "Reader appearance settings"));

			// Starter Packs starts collapsed even when list is empty
			const packsToggle = getButton(container, "Starter Packs");
			expect(packsToggle.getAttribute("aria-expanded")).toBe("false");
			expect(container.querySelector(".memorize-packs-panel")).toBeNull();

			// None of the removed flashcard/note/read/quiz UI exists
			const pageText = container.querySelector(".memorize-container")?.textContent ?? "";
			for (const forbidden of [
				"Study Due",
				"Practice All",
				"Show Answer",
				"Peek Hint",
				"Blanks",
				"Ref Quiz",
				"Add Note",
				"Due Today",
				"Mastered",
			]) {
				expect(pageText).not.toContain(forbidden);
			}

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

			// Add single EN verse & Korean range -> both ESV and KRV display immediately inline
			setInputValue(addInput, "John 3:16");
			submitForm(addForm);
			await waitUntil(() => {
				expect(getByText(container, "Added John 3:16.")).toBeDefined();
				expect(getByText(container, "For God so loved the world,")).toBeDefined();
				expect(getByText(container, "하나님이")).toBeDefined();
			});

			// Korean dictionary hover tooltip works inline on Memorize page
			const jhnItem = container.querySelector('[data-card-id="43:3:16"]') as HTMLElement;
			const koWord = getButton(jhnItem, "하나님이");
			fireHover(koWord, true);
			expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain("God");
			fireHover(koWord, false);

			// Verse item has Korean audio button and remove button, and no Read/Note buttons
			expect(getButton(jhnItem, /Listen to Korean verse/)).toBeDefined();
			expect(getButton(jhnItem, "Remove John 3:16")).toBeDefined();
			expect(jhnItem.textContent).not.toContain("Read");
			expect(jhnItem.textContent).not.toContain("Note");

			setInputValue(addInput, "잠 3:5-6");
			submitForm(addForm);
			await waitUntil(() => {
				expect(getByText(container, "Added Proverbs 3:5–6.")).toBeDefined();
				expect(getByText(container, "잠언 3장 5–6절")).toBeDefined();
				expect(getByText(container, "Trust in the LORD with all your heart,")).toBeDefined();
				expect(getByText(container, "의뢰하고")).toBeDefined();
			});

			// Import verse bookmark (chapter bookmark ignored)
			fireClick(getButton(container, "Import 1 from Bookmarks"));
			expect(getByText(container, "Imported 1 bookmarked verse.")).toBeDefined();
			await waitUntil(() => {
				expect(getByText(container, "ESV passage JHN 3:15")).toBeDefined();
			});

			// Expand Starter Packs and add Gospel & Grace
			fireClick(packsToggle);
			expect(packsToggle.getAttribute("aria-expanded")).toBe("true");
			expect(getByText(container, "Top 20 Essential Verses")).toBeDefined();
			fireClick(getButton(container, "Add Gospel & Grace pack"));
			await waitUntil(() => {
				expect(getByText(container, "Added 5 verses from Gospel & Grace.")).toBeDefined();
				expect(container.querySelectorAll(".memorize-verse-status")).toHaveLength(0);
			});

			// Remove one verse cleanly
			fireClick(getButton(container, "Remove Proverbs 3:5–6"));
			expect(container.querySelector('[data-card-id="20:3:5-6"]')).toBeNull();

			// Verify ESV text is NEVER persisted in localStorage
			const storedRaw = localStorage.getItem(MEMORIZE_CARDS_STORAGE_KEY) ?? "";
			expect(storedRaw).toContain("43:3:16");
			expect(storedRaw).not.toContain("For God so loved");
			expect(storedRaw).not.toContain("enText");
			expect(storedRaw).not.toContain("koPreview");
		});
	});

	it("plays verse-sliced Korean audio inline, stops on verse switch or removal, respects Stack Order, and syncs Reader gutter", async () => {
		window.location.hash = "#/memorize";
		const restoreMatchMedia = mockMatchMedia(true);
		const mockAudio = installMockAudio({ emitTimeUpdateOnPlay: true });

		try {
			await withMockFetch(createMemorizeMockFetch(), async () => {
				const { container } = render(<App />);

				const addInput = container.querySelector(
					'input[aria-label="Add verse reference"]',
				) as HTMLInputElement;
				const addForm = addInput.closest("form") as HTMLFormElement;
				setInputValue(addInput, "John 3:16");
				submitForm(addForm);
				await waitUntil(() => {
					const el = container.querySelector('[data-card-id="43:3:16"]');
					expect(el).not.toBeNull();
					expect(getByText(el!, "For God so loved the world,")).toBeDefined();
				});

				setInputValue(addInput, "Proverbs 3:5-6");
				submitForm(addForm);
				await waitUntil(() => {
					const el = container.querySelector('[data-card-id="20:3:5-6"]');
					expect(el).not.toBeNull();
					expect(getByText(el!, "Trust in the LORD with all your heart,")).toBeDefined();
				});

				const jhnItem = container.querySelector('[data-card-id="43:3:16"]') as HTMLElement;
				const proItem = container.querySelector('[data-card-id="20:3:5-6"]') as HTMLElement;

				// Play Supertonic 3 audio sliced specifically to John 3:16
				fireClick(getButton(jhnItem, /Listen to Korean verse/));
				await waitUntil(() => {
					const audio = mockAudio.latest();
					expect(audio?.src).toBe("/api/audio/JHN/3?lang=ko&track=supertonic");
					expect(audio?.currentTime).toBe(18.2);
					expect(audio?.paused).toBe(false);
				});
				expect(getButton(jhnItem, /Pause Korean verse/).getAttribute("aria-pressed")).toBe("true");
				expect(getButton(proItem, /Listen to Korean verse/).getAttribute("aria-pressed")).toBe(
					"false",
				);

				// Auto-stops at next verse boundary
				act(() => {
					mockAudio.latest()!.currentTime = 24.95;
					mockAudio.emit("timeupdate");
				});
				expect(mockAudio.latest()?.paused).toBe(true);

				// Switching to another verse plays its range and spans multi-verse boundaries cleanly
				fireClick(getButton(proItem, /Listen to Korean verse/));
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

				// Toggle to Flashcard mode to focus on one verse at a time (keeps playing active verse seamlessly)
				expect(container.querySelectorAll(".memorize-verse-item")).toHaveLength(2);
				fireClick(getButton(container, "Flashcard"));
				await waitUntil(() =>
					expect(container.querySelectorAll(".memorize-verse-status")).toHaveLength(0),
				);
				expect(container.querySelectorAll(".memorize-verse-item")).toHaveLength(1);
				expect(container.querySelector('[data-card-id="20:3:5-6"]')).not.toBeNull();
				expect(container.querySelector('[data-card-id="43:3:16"]')).toBeNull();
				expect(getByText(container, "1 / 2")).toBeDefined();
				expect(getButton(container, /Pause Korean verse/).getAttribute("aria-pressed")).toBe(
					"true",
				);
				expect(mockAudio.latest()?.paused).toBe(false);

				// Going to the next verse in Flashcard mode stops the previous verse's audio
				fireClick(getButton(container, "Next"));
				await waitUntil(() => {
					expect(mockAudio.latest()?.paused).toBe(true);
					expect(getByText(container, "2 / 2")).toBeDefined();
					expect(getByText(container, "For God so loved the world,")).toBeDefined();
				});
				expect(container.querySelector('[data-card-id="20:3:5-6"]')).toBeNull();

				// Wraps cleanly and supports keyboard Left/Right arrows
				fireClick(getButton(container, "Next"));
				await waitUntil(() => {
					expect(getByText(container, "1 / 2")).toBeDefined();
					expect(getByText(container, "Trust in the LORD with all your heart,")).toBeDefined();
				});

				await act(async () => {
					window.dispatchEvent(
						new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
					);
				});
				await waitUntil(() => {
					expect(getByText(container, "2 / 2")).toBeDefined();
					expect(getByText(container, "For God so loved the world,")).toBeDefined();
				});

				await act(async () => {
					window.dispatchEvent(
						new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
					);
				});
				await waitUntil(() => {
					expect(getByText(container, "1 / 2")).toBeDefined();
					expect(getByText(container, "Trust in the LORD with all your heart,")).toBeDefined();
				});

				// Switch back to All mode
				fireClick(getButton(container, "All"));
				await waitUntil(() => {
					expect(container.querySelectorAll(".memorize-verse-item")).toHaveLength(2);
					expect(container.querySelectorAll(".memorize-verse-status")).toHaveLength(0);
				});

				// Removing the currently playing verse in All mode stops audio
				fireClick(
					getButton(
						container.querySelector('[data-card-id="20:3:5-6"]')!,
						/Listen to Korean verse/,
					),
				);
				await waitUntil(() => {
					const audio = mockAudio.latest();
					expect(audio?.src).toBe("/api/audio/PRO/3?lang=ko&track=supertonic");
					expect(audio?.paused).toBe(false);
				});
				fireClick(
					getButton(container.querySelector('[data-card-id="20:3:5-6"]')!, "Remove Proverbs 3:5–6"),
				);
				await waitUntil(() => {
					expect(container.querySelector('[data-card-id="20:3:5-6"]')).toBeNull();
					expect(mockAudio.latest()?.paused).toBe(true);
				});

				// Single remaining verse in Flashcard mode disables Previous/Next safely
				fireClick(getButton(container, "Flashcard"));
				await waitUntil(() =>
					expect(container.querySelectorAll(".memorize-verse-status")).toHaveLength(0),
				);
				expect(getByText(container, "1 / 1")).toBeDefined();
				expect(getButton(container, "Previous").disabled).toBe(true);
				expect(getButton(container, "Next").disabled).toBe(true);
				fireClick(getButton(container, "All"));
				await waitUntil(() =>
					expect(container.querySelectorAll(".memorize-verse-status")).toHaveLength(0),
				);

				// Respects TopBar Stack Order (EN / 한 <-> 한 / EN)
				const activeJhnItem = container.querySelector('[data-card-id="43:3:16"]') as HTMLElement;
				expect(activeJhnItem.querySelector(".memorize-verse-body > div p")?.className).toContain(
					"memorize-verse-en",
				);
				fireClick(getButton(container, "Reader appearance settings"));
				fireClick(getButton(container.querySelector(".settings-popover")!, "한 / EN"));
				expect(activeJhnItem.querySelector(".memorize-verse-body > div p")?.className).toContain(
					"memorize-verse-ko",
				);
				fireClick(getButton(container, "Reader appearance settings"));

				// Reader gutter sync reflects saved verses and toggles cleanly
				fireClick(getButton(container, "Read"));
				await waitUntil(() => {
					expect(window.location.hash).toBe("#/GEN/1");
				});
				// Navigate directly to John 3 via hashchange to inspect John 3:16 gutter state
				await act(async () => {
					window.location.hash = "#/JHN/3/16";
					window.dispatchEvent(new window.Event("hashchange"));
				});
				await waitUntil(() => {
					expect(
						getButton(container, "Remove verse 16 from Memorize").getAttribute("aria-pressed"),
					).toBe("true");
				});

				fireClick(getButton(container, "Add verse 15 to Memorize"));
				expect(
					getButton(container, "Remove verse 15 from Memorize").getAttribute("aria-pressed"),
				).toBe("true");

				// Return to Memorize and test Clear all
				fireClick(getButton(container, "Memorize"));
				await waitUntil(() => {
					expect(container.querySelector('[data-card-id="43:3:15"]')).not.toBeNull();
					expect(container.querySelectorAll(".memorize-verse-status")).toHaveLength(0);
				});
				fireClick(getButton(container, "Clear all saved verses"));
				expect(getByText(container, "No verses saved yet.")).toBeDefined();
			});
		} finally {
			mockAudio.restore();
			restoreMatchMedia();
		}
	});

	it("defers ESV requests via IntersectionObserver until verses enter the viewport margin", async () => {
		window.location.hash = "#/memorize";
		const esvRequests: string[] = [];
		const observedCallbacks = new Map<Element, (isIntersecting: boolean) => void>();
		const origIO = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");

		class MockIntersectionObserver {
			private callback: IntersectionObserverCallback;
			constructor(callback: IntersectionObserverCallback) {
				this.callback = callback;
			}
			observe(el: Element) {
				observedCallbacks.set(el, (isIntersecting) => {
					this.callback(
						[{ target: el, isIntersecting } as IntersectionObserverEntry],
						this as unknown as IntersectionObserver,
					);
				});
			}
			disconnect() {}
			unobserve() {}
			takeRecords() {
				return [];
			}
		}

		Object.defineProperty(globalThis, "IntersectionObserver", {
			configurable: true,
			value: MockIntersectionObserver,
		});

		try {
			localStorage.setItem(
				MEMORIZE_CARDS_STORAGE_KEY,
				JSON.stringify([{ bookNumber: 43, chapter: 3, verseStart: 16, createdAt: 1 }]),
			);

			await withMockFetch(
				createMemorizeMockFetch({ onEsvRequest: (url) => esvRequests.push(url) }),
				async () => {
					const { container } = render(<App />);

					// Korean loads immediately from bundled JSON while ESV waits for intersection
					await waitUntil(() => expect(getByText(container, "사랑하사")).toBeDefined());
					expect(esvRequests).toEqual([]);

					const itemEl = container.querySelector('[data-card-id="43:3:16"]') as Element;
					act(() => {
						observedCallbacks.get(itemEl)?.(true);
					});

					await waitUntil(() => {
						expect(esvRequests).toEqual(["/api/esv/JHN/3/16"]);
						expect(getByText(container, "For God so loved the world,")).toBeDefined();
					});
				},
			);
		} finally {
			if (origIO) Object.defineProperty(globalThis, "IntersectionObserver", origIO);
			else delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
		}
	});
});
