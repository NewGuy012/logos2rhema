import "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";

import { act } from "react";

import App from "../src/react-app/App";
import { HomePage } from "../src/react-app/components/HomePage";
import { SUPERTONIC_COMPACT_BADGE, SUPERTONIC_TRACK_LABEL } from "../src/shared/audio-timings";
import { BIBLICAL_GLOSSARY, KRV_GRAMMAR_RULES } from "../src/shared/biblical-glossary";
import { formatVerseRefBilingual, getBookByNumber } from "../src/shared/books";
import { getVerseOfTheDay, getVerseOfTheDayByIndex } from "../src/shared/verse-of-the-day";
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
	afterEach(cleanupDom);
	it("browses chapter audio, plays synced audio, switches passages/languages, and opens reader", async () => {
		const mockAudio = installMockAudio({ emitTimeUpdateOnPlay: true });
		const onOpenPassage = mock(() => {});
		const fetchedUrls: string[] = [];

		try {
			await withMockFetch(
				(url) => {
					fetchedUrls.push(url);
					if (url.startsWith("/api/audio/")) {
						const parsed = new URL(url, "https://app.local");
						const lang = parsed.searchParams.get("lang");
						const refPath = parsed.pathname.replace("/api/audio/", "");
						const tracks = [];
						if (!lang || lang === "ko") {
							tracks.push(makeSupertonicTrack(`/api/audio/krv/${refPath}.mp3`));
						}
						if (!lang || lang === "en") {
							tracks.push({
								id: "esv-audio",
								label: "ESV Audio",
								language: "en" as const,
								url: `/api/audio/esv/${refPath}`,
							});
						}
						return Response.json({ tracks });
					}
					if (url.includes("/data/timings/krv-supertonic/")) {
						return Response.json({
							chapters: { "1": { "1": 0, "2": 8 }, "23": { "1": 0, "2": 5 } },
						});
					}
					return new Response(null, { status: 404 });
				},
				async () => {
					const { container } = render(
						<HomePage lastBookNumber={1} lastChapter={1} onOpenPassage={onOpenPassage} />,
					);
					const browse = container.querySelector('section[aria-label="Browse"]') as ParentNode;
					fireClick(getButton(browse, "Browse"));

					fireClick(getButton(browse, "Audio"));
					await waitUntil(() => {
						expect(getByText(browse, "Genesis 1")).toBeDefined();
						expect(getByText(browse, SUPERTONIC_COMPACT_BADGE)).toBeDefined();
						expect(getByText(browse, "Verse-synced")).toBeDefined();
						expect(browse.querySelector(".home-audio-track-label")?.textContent).toBe(
							SUPERTONIC_TRACK_LABEL,
						);
					});
					expect(fetchedUrls).toContain("/api/audio/GEN/1?lang=ko");
					expect(fetchedUrls).not.toContain("/api/audio/GEN/1?lang=en");
					expect(fetchedUrls).not.toContain("/api/audio/GEN/1");

					fireClick(getButton(browse, "Play audio"));
					await waitUntil(() => {
						expect(getButton(browse, "Pause audio")).toBeDefined();
						expect(getButton(browse, /Playing v\.1/)).toBeDefined();
					});

					fireClick(getButton(browse, "EN"));
					await waitUntil(() => {
						expect(fetchedUrls).toContain("/api/audio/GEN/1?lang=en");
						expect(getByText(browse, "ESV Audio")).toBeDefined();
					});
					expect(browse.querySelector(".home-audio-eyebrow")?.textContent).not.toContain(
						SUPERTONIC_COMPACT_BADGE,
					);
					expect(mockAudio.latest()?.src).toBe("/api/audio/esv/GEN/1");
					expect(mockAudio.latest()?.playCalls).toBeGreaterThan(0);

					// Switching back to 한 and EN on the same chapter reuses cached tracks without re-fetching
					fireClick(getButton(browse, "한"));
					fireClick(getButton(browse, "EN"));
					expect(fetchedUrls.filter((u) => u === "/api/audio/GEN/1?lang=en")).toHaveLength(1);

					const bookSelect = browse.querySelector(
						'select[aria-label="Select book"]',
					) as HTMLSelectElement;
					const chapterSelect = browse.querySelector(
						'select[aria-label="Select chapter"]',
					) as HTMLSelectElement;
					setSelectValue(bookSelect, "19");
					await waitUntil(() => expect(fetchedUrls).toContain("/api/audio/PSA/1"));
					setSelectValue(chapterSelect, "23");
					fireClick(getButton(browse, "한"));
					await waitUntil(() => {
						expect(getByText(browse, "Psalms 23")).toBeDefined();
						expect(getByText(browse, "Verse-synced")).toBeDefined();
					});

					fireClick(getButton(browse, "Open in Reader"));
					expect(onOpenPassage).toHaveBeenCalledWith(19, 23, undefined);
				},
			);
		} finally {
			mockAudio.restore();
		}
	});

	it("browses commentary, retries errors, filters notes, switches sources, and opens reader on commentary tab", async () => {
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
						entries: [
							{
								id: "matthew-henry:PSA:23:1",
								verseStart: 1,
								verseEnd: 6,
								heading: "The Lord Is My Shepherd",
								paragraphs: ["Grace and goodness follow the believer."],
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
				const browse = container.querySelector('section[aria-label="Browse"]') as ParentNode;
				fireClick(getButton(browse, "Browse"));
				fireClick(getButton(browse, "Commentary"));
				await waitUntil(() => expect(getByText(browse, "Upstream unavailable")).toBeDefined());

				fireClick(getButton(browse, "Try again"));
				await waitUntil(() => expect(getByText(browse, /God created the heavens/)).toBeDefined());

				const searchInput = browse.querySelector("input[type='search']") as HTMLInputElement;
				setInputValue(searchInput, "v.3");
				expect(browse.querySelector('[data-commentary-id="tyndale:GEN:1:1"]')).toBeNull();
				expect(browse.querySelector('[data-commentary-id="tyndale:GEN:1:3"]')).not.toBeNull();
				fireClick(getButton(browse, "Clear commentary search"));

				fireClick(getButton(browse, "Matthew Henry"));
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

				setSelectValue(browse.querySelector('select[aria-label="Select book"]')!, "19");
				setSelectValue(browse.querySelector('select[aria-label="Select chapter"]')!, "23");
				await waitUntil(() => expect(getByText(browse, "The Lord Is My Shepherd")).toBeDefined());

				fireClick(getButton(browse, "v.1–6"));
				expect(onOpenPassage).toHaveBeenCalledWith(19, 23, 1, { rightRailTab: "commentary" });
				fireClick(getButton(browse, "Open in Reader"));
				expect(onOpenPassage).toHaveBeenCalledWith(19, 23, undefined, {
					rightRailTab: "commentary",
				});
			},
		);
	});

	it("browses dictionary glossary, lexicon search, chapter vocab, KRV grammar, and App commentary jump", async () => {
		const onOpenPassage = mock(() => {});
		const restoreMatchMedia = mockMatchMedia(true);

		try {
			await withMockFetch(
				createReaderFetchHandler({
					lexicon: {
						평안: { gloss: "peace / well-being", hanja: "平安", pos: "noun" },
						찬송가: { gloss: "hymnal / hymn", pos: "noun" },
					},
					esv: () =>
						makeChapterResponse("esv", 1, "GEN", 1, [{ verse: 1, text: "In the beginning." }]),
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
					const { container } = render(
						<HomePage lastBookNumber={1} lastChapter={1} onOpenPassage={onOpenPassage} />,
					);
					const browse = container.querySelector('section[aria-label="Browse"]') as ParentNode;
					fireClick(getButton(browse, "Browse"));
					fireClick(getButton(browse, "Dictionary"));

					const expectedCount = (Object.keys(BIBLICAL_GLOSSARY).length + 1).toLocaleString();
					await waitUntil(() => expect(getByText(browse, `${expectedCount} words`)).toBeDefined());

					const dictSearch = browse.querySelector("input[type='search']") as HTMLInputElement;
					setInputValue(dictSearch, "taecho");
					expect(getByText(browse, "태초")).toBeDefined();
					setInputValue(dictSearch, "hymnal");
					expect(getByText(browse, "찬송가")).toBeDefined();
					fireClick(getButton(browse, "Clear dictionary search"));

					fireClick(getButton(browse, "Verbs"));
					expect(getByText(browse, "창조하다")).toBeDefined();
					expect(browse.textContent).not.toContain("찬송가");

					fireClick(getButton(browse, "By Chapter"));
					await waitUntil(() => expect(getByText(browse, "Genesis 1 Words")).toBeDefined());
					fireClick(getButton(browse, "v.1"));
					expect(onOpenPassage).toHaveBeenCalledWith(1, 1, 1, { rightRailTab: "dictionary" });

					fireClick(getButton(browse, "KRV Grammar"));
					expect(getByText(browse, KRV_GRAMMAR_RULES[0].pattern)).toBeDefined();

					// App integration: jumping from HomePage Commentary opens Reader on Commentary tab
					const app = render(<App />);
					const appBrowse = app.container.querySelector(
						'section[aria-label="Browse"]',
					) as ParentNode;
					fireClick(getButton(appBrowse, "Browse"));
					fireClick(getButton(appBrowse, "Commentary"));
					await waitUntil(() =>
						expect(getByText(appBrowse, "Genesis 1:1 commentary note.")).toBeDefined(),
					);
					fireClick(getButton(appBrowse, "Open in Reader"));
					await waitUntil(() => {
						expect(window.location.hash).toBe("#/GEN/1");
						expect(app.container.querySelector("#footnotes .panel-title")?.textContent).toBe(
							"Commentary",
						);
						expect(getByText(app.container, "Genesis 1:1 commentary note.")).toBeDefined();
					});
				},
			);
		} finally {
			restoreMatchMedia();
		}
	});

	it("renders Verse of the Day in hero with browse controls, Korean tooltips, ESV fallback retry, and Psalm 1:2 in footer", async () => {
		const today = getVerseOfTheDay();
		const yesterday = getVerseOfTheDay(new Date(), -1);
		const nextDay = getVerseOfTheDay(new Date(), 1);
		const todayBook = getBookByNumber(today.ref.bookNumber)!;
		const yesterdayBook = getBookByNumber(yesterday.ref.bookNumber)!;
		const nextBook = getBookByNumber(nextDay.ref.bookNumber)!;

		const onOpenPassage = mock(() => {});
		const onToggleMemorizeVerse = mock(() => {});
		const onToggleFavoriteVerse = mock(() => {});
		const onOpenMemorize = mock(() => {});

		let failTodayEsv = true;
		const copiedTexts: string[] = [];
		const origClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (text: string) => {
					copiedTexts.push(text);
				},
			},
		});

		try {
			await withMockFetch(
				createReaderFetchHandler({
					lexicon: {
						하나님: { gloss: "God", pos: "name" },
					},
					krv: (url) => {
						for (const ref of [today.ref, yesterday.ref, nextDay.ref]) {
							const book = getBookByNumber(ref.bookNumber)!;
							if (url.endsWith(`/${book.usfm}.json`)) {
								const end = ref.verseEnd ?? ref.verseStart;
								const verses = [];
								for (let v = ref.verseStart; v <= end; v++) {
									verses.push({
										verse: v,
										text:
											ref === today.ref
												? `하나님이 ${book.ko} ${ref.chapter}:${v}`
												: `${book.ko} ${ref.chapter}:${v}`,
									});
								}
								return makeBookResponse("krv", book.number, book.usfm, {
									[String(ref.chapter)]: verses,
								});
							}
						}
						// Shuffled fallback for any other book
						const usfm = url.split("/").pop()?.replace(".json", "") ?? "GEN";
						const match = getVerseOfTheDayByIndex(0);
						const allVerses = Array.from({ length: 176 }, (__, vi) => ({
							verse: vi + 1,
							text: `한국어 본문 ${usfm} ${vi + 1}`,
						}));
						return makeBookResponse("krv", match.ref.bookNumber, usfm, {
							...Object.fromEntries(
								Array.from({ length: 150 }, (_, idx) => [String(idx + 1), allVerses]),
							),
						});
					},
					esv: (url) => {
						if (url.startsWith(`/api/esv/${todayBook.usfm}/${today.ref.chapter}/`)) {
							if (failTodayEsv) {
								failTodayEsv = false;
								return Response.json({ error: "Rate limited" }, { status: 429 });
							}
							return makeChapterResponse(
								"esv",
								todayBook.number,
								todayBook.usfm,
								today.ref.chapter,
								[{ verse: today.ref.verseStart, text: "Today ESV verse text." }],
							);
						}
						if (url.startsWith(`/api/esv/${yesterdayBook.usfm}/${yesterday.ref.chapter}/`)) {
							return makeChapterResponse(
								"esv",
								yesterdayBook.number,
								yesterdayBook.usfm,
								yesterday.ref.chapter,
								[{ verse: yesterday.ref.verseStart, text: "Yesterday ESV verse text." }],
							);
						}
						if (url.startsWith(`/api/esv/${nextBook.usfm}/${nextDay.ref.chapter}/`)) {
							return makeChapterResponse(
								"esv",
								nextBook.number,
								nextBook.usfm,
								nextDay.ref.chapter,
								[{ verse: nextDay.ref.verseStart, text: "Tomorrow ESV verse text." }],
							);
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
								text: "Shuffled ESV.",
							})),
						);
					},
				}),
				async () => {
					const { container } = render(
						<HomePage
							lastBookNumber={1}
							lastChapter={1}
							memorizeTotalCount={4}
							memorizeDueCount={2}
							memorizeStreakDays={3}
							onOpenMemorize={onOpenMemorize}
							onToggleMemorizeVerse={onToggleMemorizeVerse}
							onToggleFavoriteVerse={onToggleFavoriteVerse}
							onOpenPassage={onOpenPassage}
						/>,
					);

					const votd = container.querySelector(".votd-card") as HTMLElement;
					expect(votd).not.toBeNull();
					expect(getByText(votd, "Verse of the Day")).toBeDefined();
					expect(getByText(votd, formatVerseRefBilingual(today.ref).refEn)).toBeDefined();

					// Hero no longer holds Psalm 1:2 unless today happens to be Psalm 1:2; footer always holds Psalm 1:2
					const footer = container.querySelector("footer.copyright-footer") as HTMLElement;
					expect(footer.querySelector(".footer-motto-verse")?.textContent).toContain("Psalm 1:2");

					await waitUntil(() => {
						expect(getByText(votd, "하나님이")).toBeDefined();
						expect(getByText(votd, "English (ESV) unavailable")).toBeDefined();
					});

					// Retry loads ESV cleanly
					fireClick(getButton(votd, "Retry"));
					await waitUntil(() => expect(getByText(votd, /Today ESV verse text\./)).toBeDefined());

					// Hover Korean token shows dictionary tooltip right on Home
					const koWord = getButton(votd, "하나님이");
					fireHover(koWord, true);
					expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain("God");
					fireHover(koWord, false);

					// Copy, Memorize, Bookmark, Read actions
					fireClick(getButton(votd, "Copy verse"));
					await waitUntil(() => {
						expect(copiedTexts).toHaveLength(1);
						expect(getByText(votd, "Copied")).toBeDefined();
					});
					expect(copiedTexts[0]).toContain("Today ESV verse text.");

					fireClick(getButton(votd, "Memorize"));
					expect(onToggleMemorizeVerse).toHaveBeenCalledTimes(1);

					fireClick(getButton(votd, /Bookmark/));
					expect(onToggleFavoriteVerse).toHaveBeenCalledTimes(1);

					fireClick(getButton(votd, "Read"));
					expect(onOpenPassage).toHaveBeenCalledWith(
						today.ref.bookNumber,
						today.ref.chapter,
						today.ref.verseStart,
					);

					// Browse Previous / Next / Today / Shuffle
					fireClick(getButton(votd, "Previous verse"));
					await waitUntil(() =>
						expect(getByText(votd, formatVerseRefBilingual(yesterday.ref).refEn)).toBeDefined(),
					);
					expect(getButton(votd, "Today")).toBeDefined();

					fireClick(getButton(votd, "Next verse"));
					fireClick(getButton(votd, "Next verse"));
					await waitUntil(() =>
						expect(getByText(votd, formatVerseRefBilingual(nextDay.ref).refEn)).toBeDefined(),
					);

					fireClick(getButton(votd, "Today"));
					expect(getByText(votd, formatVerseRefBilingual(today.ref).refEn)).toBeDefined();

					fireClick(getButton(votd, "Shuffle verse"));
					expect(getByText(votd, "Curated Verse")).toBeDefined();
					await waitUntil(() => {
						expect(getByText(votd, /한국어 본문/)).toBeDefined();
						expect(getByText(votd, /Shuffled ESV\./)).toBeDefined();
					});

					// Home Memorize summary card triggers navigation
					expect(getByText(container, /2 due for review/)).toBeDefined();
					expect(getByText(container, /3d streak/)).toBeDefined();
					fireClick(getButton(container, "Study Now"));
					expect(onOpenMemorize).toHaveBeenCalledTimes(1);
				},
			);
		} finally {
			if (origClipboard) Object.defineProperty(navigator, "clipboard", origClipboard);
			else delete (navigator as { clipboard?: unknown }).clipboard;
		}
	});
});
