import { beforeEach, describe, expect, it, mock } from "bun:test";
import { join } from "node:path";

import { act } from "react";

import App from "../src/react-app/App";
import { HomePage } from "../src/react-app/components/HomePage";
import { clearLoaderCaches } from "../src/react-app/lib/bible-loader";
import { SUPERTONIC_COMPACT_BADGE, SUPERTONIC_TRACK_LABEL } from "../src/shared/audio-timings";
import { BIBLICAL_GLOSSARY, KRV_GRAMMAR_RULES } from "../src/shared/biblical-glossary";
import {
	assertLegalFooter,
	createReaderFetchHandler,
	fireClick,
	flushAsync,
	getButton,
	getByText,
	installMockAudio,
	makeBookResponse,
	makeChapterResponse,
	makeSupertonicTrack,
	mockMatchMedia,
	render,
	setInputValue,
	waitUntil,
	withMockFetch,
} from "./setup";

function setSelectValue(select: HTMLSelectElement, value: string): void {
	act(() => {
		select.value = value;
		select.dispatchEvent(new window.Event("change", { bubbles: true }));
	});
}

describe("HomePage Browse Sections (Audio, Commentary, Dictionary)", () => {
	beforeEach(() => {
		clearLoaderCaches();
		window.location.hash = "";
		localStorage.clear();
	});

	it("browses chapter audio, plays synced audio, switches passages, and opens reader", async () => {
		const mockAudio = installMockAudio({ emitTimeUpdateOnPlay: true });
		const onOpenPassage = mock(() => {});
		const fetchedUrls: string[] = [];

		try {
			await withMockFetch(
				(url) => {
					fetchedUrls.push(url);
					if (url.startsWith("/api/audio/")) {
						return Response.json({
							tracks: [
								makeSupertonicTrack(`${url.replace("/api/audio/", "/api/audio/krv/")}.mp3`),
								{
									id: "esv-audio",
									label: "ESV Audio",
									language: "en",
									url: `${url.replace("/api/audio/", "/api/audio/esv/")}`,
								},
							],
						});
					}
					if (url.includes("/data/timings/krv-supertonic/")) {
						return Response.json({
							chapters: {
								"1": { "1": 0, "2": 8 },
								"23": { "1": 0, "2": 5 },
							},
						});
					}
					return new Response(null, { status: 404 });
				},
				async () => {
					const { container } = render(
						<HomePage lastBookNumber={1} lastChapter={1} onOpenPassage={onOpenPassage} />,
					);

					const featuredVerse = container.querySelector(".home-hero .home-featured-verse");
					expect(featuredVerse?.textContent).toContain(
						"but his delight is in the law of the Lord, and on his law he meditates day and night.",
					);
					expect(featuredVerse?.querySelector("button, a")).toBeNull();
					const featuredVerseRef = featuredVerse?.querySelector(
						".home-featured-verse-ref",
					) as HTMLElement;
					const featuredVerseKo = featuredVerseRef.querySelector(
						".home-featured-verse-ko",
					) as HTMLElement;
					expect(featuredVerseRef.textContent).toContain("Psalm 1:2");
					expect(featuredVerseKo.textContent).toContain("· 시편 1:2");
					fireClick(featuredVerseRef);
					expect(onOpenPassage).not.toHaveBeenCalled();

					const css = await Bun.file(join(import.meta.dir, "../src/react-app/index.css")).text();
					const style = document.createElement("style");
					style.textContent = css;
					document.head.appendChild(style);
					try {
						const enSpan = featuredVerseRef.firstElementChild as HTMLElement;
						const koColor = window.getComputedStyle(featuredVerseKo).color;
						expect(koColor).toBeTruthy();
						expect(koColor).toBe(window.getComputedStyle(enSpan).color);
					} finally {
						style.remove();
					}

					expect(container.querySelector(".home-features .home-section-title")?.textContent).toBe(
						"Features",
					);
					const heroItems = Array.from(container.querySelectorAll(".home-subtitle li")).map(
						(el) => el.textContent,
					);
					expect(heroItems).toEqual([
						"Read ESV and 개역한글 side-by-side",
						"Hover any Korean word for instant dictionary and grammar notes",
						"Listen along verse by verse",
					]);

					assertLegalFooter(container);

					const browseSection = container.querySelector(
						'section[aria-label="Browse"]',
					) as ParentNode;
					const tabLabels = Array.from(
						browseSection.querySelectorAll(
							'[role="tablist"][aria-label="Browse sections"] [role="tab"]',
						),
					).map((el) => el.textContent);
					expect(tabLabels).toEqual(["Scripture", "Genres", "Audio", "Dictionary", "Commentary"]);

					fireClick(getButton(browseSection, "Audio"));
					await flushAsync();
					await waitUntil(() => {
						expect(getByText(browseSection, "Genesis 1")).toBeDefined();
						expect(getByText(browseSection, SUPERTONIC_COMPACT_BADGE)).toBeDefined();
						expect(getByText(browseSection, "Verse-synced")).toBeDefined();
						expect(browseSection.querySelector(".home-audio-track-label")?.textContent).toBe(
							SUPERTONIC_TRACK_LABEL,
						);
						expect(getButton(browseSection, "Play audio").getAttribute("title")).toBe(
							SUPERTONIC_TRACK_LABEL,
						);
					});
					expect(fetchedUrls).toContain("/api/audio/GEN/1");

					fireClick(getButton(browseSection, "Play audio"));
					await flushAsync();
					await waitUntil(() => {
						expect(getButton(browseSection, "Pause audio")).toBeDefined();
						expect(getButton(browseSection, /Playing v\.1/)).toBeDefined();
					});

					fireClick(getButton(browseSection, "Playback speed"));
					const speedMenu = document.body.querySelector('.speed-menu[role="menu"]') as ParentNode;
					const speedInput = speedMenu.querySelector(
						'input[aria-label="Custom playback speed (0.1 to 2.0)"]',
					) as HTMLInputElement;
					setInputValue(speedInput, "0.75");
					fireClick(getButton(speedMenu, "Apply"));
					expect(getButton(browseSection, "Playback speed").textContent).toContain("0.75x");

					fireClick(getButton(browseSection, "EN"));
					expect(getByText(browseSection, "ESV Audio")).toBeDefined();
					expect(browseSection.querySelector(".home-audio-eyebrow")?.textContent).not.toContain(
						SUPERTONIC_COMPACT_BADGE,
					);

					expect(browseSection.querySelector("input[type='search']")).toBeNull();
					expect(browseSection.querySelector(".books-grid")).toBeNull();
					expect(browseSection.querySelector(".chapters-grid")).toBeNull();

					const bookSelect = browseSection.querySelector(
						'select[aria-label="Select book"]',
					) as HTMLSelectElement;
					const chapterSelect = browseSection.querySelector(
						'select[aria-label="Select chapter"]',
					) as HTMLSelectElement;
					expect(bookSelect.value).toBe("1");
					expect(chapterSelect.value).toBe("1");

					setSelectValue(chapterSelect, "2");
					await flushAsync();
					await waitUntil(() => {
						expect(getByText(browseSection, "Genesis 2")).toBeDefined();
						expect(fetchedUrls).toContain("/api/audio/GEN/2");
					});

					fireClick(getButton(browseSection, "Next chapter"));
					await flushAsync();
					await waitUntil(() => {
						expect(getByText(browseSection, "Genesis 3")).toBeDefined();
						expect(chapterSelect.value).toBe("3");
						expect(fetchedUrls).toContain("/api/audio/GEN/3");
					});

					setSelectValue(bookSelect, "19");
					await flushAsync();
					await waitUntil(() => {
						expect(getByText(browseSection, "Psalms 1")).toBeDefined();
						expect(chapterSelect.value).toBe("1");
						expect(chapterSelect.options.length).toBe(150);
						expect(fetchedUrls).toContain("/api/audio/PSA/1");
					});

					setSelectValue(chapterSelect, "23");
					await flushAsync();
					fireClick(getButton(browseSection, "한"));
					await waitUntil(() => {
						expect(getByText(browseSection, "Psalms 23")).toBeDefined();
						expect(getByText(browseSection, "Verse-synced")).toBeDefined();
						expect(fetchedUrls).toContain("/api/audio/PSA/23");
					});

					fireClick(getButton(browseSection, "Open in Reader"));
					expect(onOpenPassage).toHaveBeenCalledWith(19, 23, undefined);
				},
			);
		} finally {
			mockAudio.restore();
		}
	});

	it("browses commentary, switches sources/passages, filters notes, retries errors, and jumps to reader", async () => {
		const onOpenPassage = mock(() => {});
		const onChangeSource = mock(() => {});
		let failFirst = true;

		await withMockFetch(
			(url) => {
				if (url === "/api/commentary/tyndale/GEN/1") {
					if (failFirst) {
						failFirst = false;
						return Response.json({ error: "Upstream unavailable" }, { status: 502 });
					}
					return Response.json({
						bookIntroduction: ["Genesis introduces creation and covenant."],
						entries: [
							{
								id: "tyndale:GEN:1:1",
								verseStart: 1,
								paragraphs: ["God created the heavens and the earth out of nothing."],
							},
							{
								id: "tyndale:GEN:1:3",
								verseStart: 3,
								paragraphs: ["God spoke light into existence."],
							},
						],
					});
				}
				if (url === "/api/commentary/matthew-henry/PSA/23") {
					return Response.json({
						introduction: ["David's shepherd psalm of trust."],
						entries: [
							{
								id: "matthew-henry:PSA:23:1",
								verseStart: 1,
								verseEnd: 6,
								heading: "The Lord Is My Shepherd",
								paragraphs: ["Grace and goodness follow the believer all their days."],
							},
						],
					});
				}
				return Response.json({ entries: [] });
			},
			async () => {
				const { container, rerender } = render(
					<HomePage
						lastBookNumber={1}
						lastChapter={1}
						commentarySource="tyndale"
						onChangeCommentarySource={onChangeSource}
						onOpenPassage={onOpenPassage}
					/>,
				);

				const browseSection = container.querySelector('section[aria-label="Browse"]') as ParentNode;
				fireClick(getButton(browseSection, "Commentary"));

				await waitUntil(() => {
					expect(getByText(browseSection, "Upstream unavailable")).toBeDefined();
				});
				fireClick(getButton(browseSection, "Try again"));

				await waitUntil(() => {
					expect(getByText(browseSection, /God created the heavens/)).toBeDefined();
				});

				const searchInput = browseSection.querySelector("input[type='search']") as HTMLInputElement;
				setInputValue(searchInput, "v.3");
				expect(browseSection.querySelector('[data-commentary-id="tyndale:GEN:1:1"]')).toBeNull();
				expect(
					browseSection.querySelector('[data-commentary-id="tyndale:GEN:1:3"]'),
				).not.toBeNull();
				fireClick(getButton(browseSection, "Clear commentary search"));

				fireClick(getButton(browseSection, "Matthew Henry"));
				expect(onChangeSource).toHaveBeenCalledWith("matthew-henry");

				rerender(
					<HomePage
						lastBookNumber={1}
						lastChapter={1}
						commentarySource="matthew-henry"
						onChangeCommentarySource={onChangeSource}
						onOpenPassage={onOpenPassage}
					/>,
				);

				const bookSelect = browseSection.querySelector(
					'select[aria-label="Select book"]',
				) as HTMLSelectElement;
				setSelectValue(bookSelect, "19");
				const chapterSelect = browseSection.querySelector(
					'select[aria-label="Select chapter"]',
				) as HTMLSelectElement;
				setSelectValue(chapterSelect, "23");

				await waitUntil(() => {
					expect(getByText(browseSection, "The Lord Is My Shepherd")).toBeDefined();
				});

				fireClick(getButton(browseSection, "v.1–6"));
				expect(onOpenPassage).toHaveBeenCalledWith(19, 23, 1, { rightRailTab: "commentary" });

				fireClick(getButton(browseSection, "Open in Reader"));
				expect(onOpenPassage).toHaveBeenCalledWith(19, 23, undefined, {
					rightRailTab: "commentary",
				});
			},
		);
	});

	it("browses dictionary glossary, lexicon search, chapter vocabulary, and KRV grammar", async () => {
		const onOpenPassage = mock(() => {});

		await withMockFetch(
			createReaderFetchHandler({
				lexicon: {
					평안: { gloss: "peace / well-being", hanja: "平安", pos: "noun" },
					찬송가: { gloss: "hymnal / hymn", pos: "noun" },
				},
				krv: () =>
					makeBookResponse("krv", 1, "GEN", {
						"1": [{ verse: 1, text: "태초에 하나님이 천지를 창조하시니라" }],
					}),
			}),
			async () => {
				const { container } = render(
					<HomePage lastBookNumber={1} lastChapter={1} onOpenPassage={onOpenPassage} />,
				);

				const browseSection = container.querySelector('section[aria-label="Browse"]') as ParentNode;
				fireClick(getButton(browseSection, "Dictionary"));

				const expectedCount = Object.keys(BIBLICAL_GLOSSARY).length + 1;
				const expectedFormatted = expectedCount.toLocaleString();

				await waitUntil(() => {
					expect(getByText(browseSection, `${expectedFormatted} words`)).toBeDefined();
				});

				const dictSearch = browseSection.querySelector("input[type='search']") as HTMLInputElement;
				setInputValue(dictSearch, "평안");
				expect(getByText(browseSection, "평안")).toBeDefined();
				expect(getByText(browseSection, "peace / well-being")).toBeDefined();

				setInputValue(dictSearch, "taecho");
				expect(getByText(browseSection, "태초")).toBeDefined();
				expect(getByText(browseSection, "the beginning")).toBeDefined();

				setInputValue(dictSearch, "hymnal");
				expect(getByText(browseSection, "찬송가")).toBeDefined();
				fireClick(getButton(browseSection, "Clear dictionary search"));

				fireClick(getButton(browseSection, "Show more"));
				expect(getByText(browseSection, `Showing 120 of ${expectedFormatted}`)).toBeDefined();

				fireClick(getButton(browseSection, "Verbs"));
				expect(getByText(browseSection, "창조하다")).toBeDefined();
				expect(browseSection.textContent).not.toContain("찬송가");
				fireClick(getButton(browseSection, "All"));

				fireClick(getButton(browseSection, "By Chapter"));
				await waitUntil(() => {
					expect(getByText(browseSection, "Genesis 1 Words")).toBeDefined();
					expect(getByText(browseSection, "태초")).toBeDefined();
				});

				fireClick(getButton(browseSection, "v.1"));
				expect(onOpenPassage).toHaveBeenCalledWith(1, 1, 1, { rightRailTab: "dictionary" });

				fireClick(getButton(browseSection, "KRV Grammar"));
				expect(getByText(browseSection, KRV_GRAMMAR_RULES[0].pattern)).toBeDefined();
				expect(
					getByText(browseSection, KRV_GRAMMAR_RULES[KRV_GRAMMAR_RULES.length - 1].pattern),
				).toBeDefined();
			},
		);
	});

	it("opens reader on the commentary tab when jumping from HomePage Commentary browse", async () => {
		const restoreMatchMedia = mockMatchMedia(true);

		try {
			await withMockFetch(
				createReaderFetchHandler({
					esv: () =>
						makeChapterResponse("esv", 1, "GEN", 1, [
							{ verse: 1, text: "In the beginning, God created." },
						]),
					krv: () =>
						makeBookResponse("krv", 1, "GEN", {
							"1": [{ verse: 1, text: "태초에 하나님이 천지를 창조하시니라" }],
						}),
					commentary: () =>
						Response.json({
							entries: [
								{
									id: "tyndale:GEN:1:1",
									verseStart: 1,
									paragraphs: ["Genesis 1:1 commentary note."],
								},
							],
						}),
				}),
				async () => {
					const { container } = render(<App />);
					const browseSection = container.querySelector(
						'section[aria-label="Browse"]',
					) as ParentNode;
					fireClick(getButton(browseSection, "Commentary"));

					await waitUntil(() => {
						expect(getByText(browseSection, "Genesis 1:1 commentary note.")).toBeDefined();
					});

					fireClick(getButton(browseSection, "Open in Reader"));

					await waitUntil(() => {
						expect(window.location.hash).toBe("#/GEN/1");
						expect(container.querySelector("#footnotes .panel-title")?.textContent).toBe(
							"Commentary",
						);
						expect(getByText(container, "Genesis 1:1 commentary note.")).toBeDefined();
					});
				},
			);
		} finally {
			restoreMatchMedia();
		}
	});
});
