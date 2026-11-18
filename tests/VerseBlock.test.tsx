import { describe, expect, it, mock } from "bun:test";

import { act } from "react";

import App from "../src/react-app/App";
import { AudioControlRail } from "../src/react-app/components/AudioControlRail";
import { FloatingBottomBar } from "../src/react-app/components/FloatingBottomBar";
import { FootnotesGuide } from "../src/react-app/components/FootnotesGuide";
import { HomePage } from "../src/react-app/components/HomePage";
import { PassagePicker } from "../src/react-app/components/PassagePicker";
import { TopBar } from "../src/react-app/components/TopBar";
import { VerseBlock } from "../src/react-app/components/VerseBlock";
import {
	resolveTimeForVerse,
	resolveVerseAtTime,
	useHumanAudio,
} from "../src/react-app/hooks/useHumanAudio";
import { analyzeKoreanChapter } from "../src/shared/korean-morphology";
import { CANONICAL_BIBLES } from "../src/shared/translations";
import {
	fireClick,
	fireHover,
	getButton,
	getByText,
	render,
	renderHook,
	setInputValue,
	submitForm,
	waitUntil,
} from "./setup";

const noop = () => {};

function baseBarProps() {
	return {
		bookEn: "Genesis",
		bookKo: "창세기",
		chapter: 1,
		hasPrev: false,
		hasNext: true,
		tracks: [],
		preferredLang: "ko",
		activeTrack: null,
		isPlaying: false,
		isLoading: false,
		currentTime: 0,
		duration: 120,
		playbackRate: 1,
		errorMessage: null,
		activeEnCode: "ESV",
		activeKoCode: "개역한글",
		onPrevChapter: noop,
		onNextChapter: noop,
		onOpenPicker: noop,
		onTogglePlay: noop,
		onSeek: noop,
		onSkipBy: noop,
		onSelectTrack: noop,
		onSelectLanguage: noop,
		onChangeSpeed: noop,
	};
}

describe("Reader UI & audio hooks", () => {
	const analysis = analyzeKoreanChapter([
		{ verse: 1, text: "태초에 하나님이 천지를 창조하시니라" },
	]);
	const sampleVerse = {
		verse: 1,
		enText: "In the beginning, God created the heavens and the earth.",
		koText: "태초에 하나님이 천지를 창조하시니라",
		tokens: analysis.tokensByVerse.get(1) ?? [],
	};

	it("flips English/Korean verse order in VerseBlock and opens tooltip on hover or unmatched tap", () => {
		const verseProps = {
			verse: {
				...sampleVerse,
				tokens: [
					...sampleVerse.tokens,
					{
						raw: "낯선말",
						leadPunct: "",
						word: "낯선말",
						trailPunct: "",
						lemma: "낯선말",
						gloss: "see aligned English verse",
						matched: false,
					},
				],
			},
			studyMask: "none" as const,
			isSelected: false,
			isAudioActive: false,
			enCode: "ESV",
			koCode: "개역한글",
			hasVerseTimestamps: false,
			onSelectVerse: noop,
			onSelectFootnote: noop,
		};

		const { container, rerender } = render(<VerseBlock {...verseProps} stackOrder="en-first" />);

		const enFirst = container.querySelectorAll(".verse-lines > p");
		expect(enFirst[0]?.className).toContain("verse-en");
		expect(enFirst[1]?.className).toContain("verse-ko");

		rerender(<VerseBlock {...verseProps} stackOrder="ko-first" />);
		const koFirst = container.querySelectorAll(".verse-lines > p");
		expect(koFirst[0]?.className).toContain("verse-ko");

		const wordBtn = getButton(container, "창조하시니라");
		const origGetRect = wordBtn.getBoundingClientRect.bind(wordBtn);
		wordBtn.getBoundingClientRect = () => ({
			...origGetRect(),
			top: 260,
			bottom: 288,
			left: 200,
			right: 260,
			width: 60,
			height: 28,
		});
		fireHover(wordBtn, true);
		const tooltip = document.body.querySelector('[role="tooltip"]') as HTMLElement | null;
		expect(tooltip?.textContent).toContain("to create");
		expect(tooltip?.textContent).toContain("Root: 창조하다");
		expect(tooltip?.style.transform).toBe("translate(-50%, 0)");
		expect(tooltip?.style.top).toBe("296px");

		fireHover(wordBtn, false);
		expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

		// Clicking an unmatched word toggles its tooltip cleanly without focus-click double-flipping
		const unknownBtn = getButton(container, "낯선말");
		unknownBtn.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
		unknownBtn.dispatchEvent(new window.FocusEvent("focus", { bubbles: false }));
		fireClick(unknownBtn);
		expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(
			"see aligned English verse",
		);
	});

	it("renders FootnotesGuide with Words above Grammar and all entries by default", () => {
		const onJump = mock(() => {});
		const onMinimize = mock(() => {});
		const footnotes = [
			...analysis.footnotes,
			{
				id: "vocab-그",
				lemma: "그",
				surfaceForms: ["그"],
				verses: [1],
				gloss: "he / that / the",
				pos: "pronoun" as const,
			},
		];

		const { container, rerender } = render(
			<FootnotesGuide
				bookEn="Genesis"
				bookKo="창세기"
				chapter={1}
				footnotes={footnotes}
				grammarNotes={analysis.grammarNotes}
				highlightedFootnoteId={null}
				variant="sidebar"
				onMinimize={onMinimize}
				onJumpToVerse={onJump}
			/>,
		);

		// Key Vocab / All toggle is removed; all entries are shown under Words above Grammar
		expect(container.querySelector('[role="tablist"]')).toBeNull();
		const sections = Array.from(container.querySelectorAll(".dict-disclosure")).map((el) =>
			el.getAttribute("aria-label"),
		);
		expect(sections).toEqual(["Words", "Grammar Notes"]);

		// Both Words and Grammar start collapsed to keep the dictionary minimal
		expect(container.querySelector(".vocab-list")).toBeNull();
		expect(container.querySelector(".grammar-cards")).toBeNull();
		const wordsToggle = getButton(container, `Words (${footnotes.length})`);
		expect(container.querySelector(".panel-title")?.textContent).toBe("Dictionary");
		expect(container.querySelector(".panel-subtitle")?.textContent).toBe("Genesis 1 · 창세기 1장");
		expect(wordsToggle.getAttribute("aria-expanded")).toBe("false");

		fireClick(wordsToggle);
		expect(wordsToggle.getAttribute("aria-expanded")).toBe("true");
		expect(getByText(container, "창조하다")).toBeDefined();
		expect(getByText(container, "he / that / the")).toBeDefined();
		fireClick(getButton(container, "v.1"));
		expect(onJump).toHaveBeenCalledWith(1);

		fireClick(getButton(container, /Grammar/));
		expect(container.querySelector(".grammar-cards")).not.toBeNull();

		// Collapsing Words again, searching auto-expands it, and clicking a word clears the filter and scrolls to its translation
		fireClick(wordsToggle);
		expect(container.querySelector(".vocab-list")).toBeNull();

		const dictSearch = container.querySelector("input[type='search']") as HTMLInputElement;
		setInputValue(dictSearch, "태초");
		expect(container.querySelector(".vocab-list")).not.toBeNull();
		expect(container.querySelector('[data-footnote-id="vocab-창조하다"]')).toBeNull();

		// Collapse before testing highlighted word auto-expand
		fireClick(wordsToggle);
		expect(container.querySelector(".vocab-list")).toBeNull();

		const scrolledIds: string[] = [];
		const origScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
		window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
			if (this.dataset.footnoteId) {
				scrolledIds.push(this.dataset.footnoteId);
			}
		};

		try {
			rerender(
				<FootnotesGuide
					bookEn="Genesis"
					bookKo="창세기"
					chapter={1}
					footnotes={footnotes}
					grammarNotes={analysis.grammarNotes}
					highlightedFootnoteId="vocab-창조하다"
					highlightSeq={1}
					variant="sidebar"
					onMinimize={onMinimize}
					onJumpToVerse={onJump}
				/>,
			);

			expect(dictSearch.value).toBe("");
			expect(getByText(container, "to create")).toBeDefined();
			expect(scrolledIds.at(-1)).toBe("vocab-창조하다");

			rerender(
				<FootnotesGuide
					bookEn="Genesis"
					bookKo="창세기"
					chapter={1}
					footnotes={footnotes}
					grammarNotes={analysis.grammarNotes}
					highlightedFootnoteId="vocab-그"
					highlightSeq={2}
					variant="sidebar"
					onMinimize={onMinimize}
					onJumpToVerse={onJump}
				/>,
			);

			expect(getByText(container, "he / that / the")).toBeDefined();
			expect(scrolledIds.at(-1)).toBe("vocab-그");
		} finally {
			window.HTMLElement.prototype.scrollIntoView = origScrollIntoView;
		}

		expect(container.querySelector(".dict-close-btn")).toBeNull();
		const minimizeBtn = getButton(container, "Minimize dictionary");
		expect(minimizeBtn.getAttribute("aria-expanded")).toBe("true");
		fireClick(minimizeBtn);
		expect(onMinimize).toHaveBeenCalledTimes(1);
	});

	it("renders TopBar, HomePage, and PassagePicker navigation flows", () => {
		const onGoHome = mock(() => {});
		const onFlip = mock(() => {});
		const onOpenSearch = mock(() => {});
		const topBar = render(
			<TopBar
				selectedEn={CANONICAL_BIBLES.en}
				selectedKo={CANONICAL_BIBLES.ko}
				stackOrder="en-first"
				theme="paper"
				fontScale={1}
				koFontStyle="serif"
				studyMask="none"
				onGoHome={onGoHome}
				onFlipStackOrder={onFlip}
				onOpenSearch={onOpenSearch}
				onChangeTheme={noop}
				onChangeFontScale={noop}
				onChangeKoFontStyle={noop}
				onChangeStudyMask={noop}
			/>,
		);
		expect(getByText(topBar.container, "Logos2Rhema")).toBeDefined();
		expect(topBar.container.querySelector(".brand-icon")).not.toBeNull();
		expect(getByText(topBar.container, "ESV / 개역한글")).toBeDefined();
		expect(topBar.container.querySelector(".translation-badge")?.tagName).toBe("SPAN");
		expect(getButton(topBar.container, "Reader appearance settings").className).toContain(
			"appearance-btn",
		);
		expect(topBar.container.querySelector(".flip-btn")).toBeNull();
		fireClick(topBar.container.querySelector('a[aria-label="Logos2Rhema Home"]') as Element);
		expect(onGoHome).toHaveBeenCalledTimes(1);
		fireClick(getButton(topBar.container, "Reader appearance settings"));
		fireClick(getButton(topBar.container, "EN / 한"));
		expect(onFlip).not.toHaveBeenCalled();
		fireClick(getButton(topBar.container, "한 / EN"));
		expect(onFlip).toHaveBeenCalledTimes(1);
		fireClick(getButton(topBar.container, "Go to"));
		expect(onOpenSearch).toHaveBeenCalledTimes(1);

		const onOpenPassage = mock(() => {});
		const home = render(
			<HomePage
				lastBookNumber={8}
				lastChapter={4}
				selectedEn={CANONICAL_BIBLES.en}
				selectedKo={CANONICAL_BIBLES.ko}
				bibleBrainEnabled={true}
				onOpenPassage={onOpenPassage}
			/>,
		);
		expect(getByText(home.container, "Logos2Rhema")).toBeDefined();
		expect(home.container.querySelector(".home-title")?.textContent).toBe("Logos2Rhema");
		expect(home.container.querySelector(".home-title-ko")).toBeNull();
		expect(home.container.textContent).not.toContain("말씀");
		const heroOrder = Array.from(home.container.querySelectorAll(".home-hero > *")).map(
			(el) => el.className,
		);
		expect(heroOrder.indexOf("home-kicker")).toBeGreaterThan(heroOrder.indexOf("home-title"));
		expect(home.container.querySelector(".home-kicker")?.textContent).not.toContain(
			"ESV · 개역한글",
		);
		expect(getByText(home.container, "Bible Brain Verse-Synced Audio")).toBeDefined();
		home.rerender(
			<HomePage
				lastBookNumber={8}
				lastChapter={4}
				lastVerse={12}
				selectedEn={CANONICAL_BIBLES.en}
				selectedKo={CANONICAL_BIBLES.ko}
				bibleBrainEnabled={false}
				onOpenPassage={onOpenPassage}
			/>,
		);
		expect(getByText(home.container, "Audio Available")).toBeDefined();
		expect(home.container.textContent).not.toContain("Human Audio Ready");
		expect(home.container.querySelector(".home-continue-label")).toBeNull();
		expect(home.container.querySelector(".home-continue-ref")?.textContent).toContain("Ruth 4:12");
		expect(home.container.querySelector(".home-continue-ref")?.textContent).toContain(
			"룻기 4장 12절",
		);
		fireClick(getButton(home.container, "Continue Reading"));
		expect(onOpenPassage).toHaveBeenCalledWith(8, 4, 12);

		const genreSection = home.container.querySelector('section[aria-label="Bible Genres"]');
		expect(genreSection).not.toBeNull();
		expect(home.container.querySelector('section[aria-label="Featured Passages"]')).toBeNull();
		const genresToggle = getButton(genreSection as ParentNode, "Browse Genres");
		expect(genresToggle.getAttribute("aria-expanded")).toBe("false");
		expect(genreSection?.querySelectorAll(".home-genre-card")).toHaveLength(0);
		expect(genreSection?.querySelectorAll(".home-genre-chip")).toHaveLength(0);

		fireClick(genresToggle);
		expect(genresToggle.getAttribute("aria-expanded")).toBe("true");
		expect(genreSection?.querySelectorAll(".home-genre-card")).toHaveLength(10);
		expect(genreSection?.querySelectorAll(".home-genre-chip")).toHaveLength(66);
		fireClick(getButton(genreSection as ParentNode, /Psalms/));
		expect(getByText(genreSection as ParentNode, "Psalms · 시편")).toBeDefined();
		fireClick(getButton(genreSection as ParentNode, "23"));
		expect(onOpenPassage).toHaveBeenCalledWith(19, 23);

		fireClick(getButton(genreSection as ParentNode, "All Genres"));
		expect(genreSection?.querySelectorAll(".home-genre-card")).toHaveLength(10);
		fireClick(getButton(genreSection as ParentNode, /Psalms/));
		fireClick(genresToggle);
		expect(genresToggle.getAttribute("aria-expanded")).toBe("false");
		expect(genreSection?.querySelectorAll(".home-genre-card")).toHaveLength(0);
		fireClick(genresToggle);
		expect(genreSection?.querySelectorAll(".home-genre-card")).toHaveLength(10);

		const browseSection = home.container.querySelector('section[aria-label="Browse All Books"]');
		expect(browseSection?.querySelector('[role="tablist"]')).toBeNull();
		expect(browseSection?.querySelector(".home-search-form")).not.toBeNull();
		expect(home.container.querySelector(".home-hero .home-search-form")).toBeNull();
		expect(browseSection?.querySelector(".home-testament-divider")).not.toBeNull();
		const grids = Array.from(
			browseSection?.querySelectorAll<HTMLElement>(".books-grid-vertical") ?? [],
		);
		expect(grids).toHaveLength(2);
		expect(grids[0]?.style.getPropertyValue("--book-cols")).toBe("2");
		expect(grids[0]?.style.getPropertyValue("--book-rows")).toBe("20");
		expect(grids[1]?.style.getPropertyValue("--book-cols")).toBe("2");
		expect(grids[1]?.style.getPropertyValue("--book-rows")).toBe("14");
		expect(getByText(browseSection as ParentNode, "Genesis")).toBeDefined();
		expect(getByText(browseSection as ParentNode, "Matthew")).toBeDefined();

		expect(getButton(browseSection as ParentNode, "Go to").textContent).toBe("Go to");
		const homeInput = browseSection?.querySelector("input[type='search']") as HTMLInputElement;
		setInputValue(homeInput, "시 23");
		submitForm(homeInput.closest("form") as HTMLFormElement);
		expect(onOpenPassage).toHaveBeenCalledWith(19, 23, undefined);

		const aboutSection = home.container.querySelector('section[aria-label="About Logos2Rhema"]');
		expect(aboutSection).not.toBeNull();
		expect(getByText(aboutSection as ParentNode, "About")).toBeDefined();
		expect(aboutSection?.textContent).toContain("glory to God");
		expect(aboutSection?.textContent).toContain("head to the heart");

		const onNavigate = mock(() => {});
		const onClosePicker = mock(() => {});
		const picker = render(
			<PassagePicker
				isOpen={true}
				currentBookNumber={1}
				currentChapter={1}
				onClose={onClosePicker}
				onNavigate={onNavigate}
			/>,
		);
		const pickerInput = picker.container.querySelector("input[type='search']") as HTMLInputElement;
		expect(pickerInput.placeholder).toBe(
			"Go to passage (e.g. John 3:16, 요 3:16, 시 23, Rom 8)...",
		);
		setInputValue(pickerInput, "요 3:16");
		submitForm(pickerInput.closest("form") as HTMLFormElement);
		expect(onNavigate).toHaveBeenCalledWith(43, 3, 16);
		expect(onClosePicker).toHaveBeenCalledTimes(1);
	});

	it("opens App on HomePage, loads 3-column desktop reader, and returns Home", async () => {
		window.location.hash = "";
		localStorage.clear();
		const originalFetch = globalThis.fetch;
		const originalMatchMedia = window.matchMedia;
		window.matchMedia = ((query: string) => ({
			matches: query.includes("min-width: 1024px"),
			media: query,
			onchange: null,
			addListener: noop,
			removeListener: noop,
			addEventListener: noop,
			removeEventListener: noop,
			dispatchEvent: () => false,
		})) as typeof window.matchMedia;

		let audioLoaded = false;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/api/config")) {
				return Response.json({
					english: CANONICAL_BIBLES.en,
					korean: CANONICAL_BIBLES.ko,
					bibleBrainEnabled: false,
					esvAudioEnabled: false,
				});
			}
			if (url.includes("/data/lexicon.json")) return Response.json({});
			if (url.includes("/data/bibles/krv/")) {
				return Response.json({
					translationId: "krv",
					bookNumber: 1,
					usfm: "GEN",
					chapters: {
						"1": [
							{ verse: 1, text: "보아스가 성문에 올라가서 거기 앉았더니" },
							{ verse: 2, text: "장로 십 인을 청하여 가로되" },
						],
						"2": [{ verse: 1, text: "천지와 만물이 다 이루니라" }],
					},
				});
			}
			if (url.includes("/data/bibles/")) {
				return Response.json({
					translationId: "esv",
					bookNumber: 1,
					usfm: "GEN",
					chapters: {
						"1": [
							{ verse: 1, text: "In the beginning..." },
							{ verse: 2, text: "The earth was without form..." },
						],
						"2": [{ verse: 1, text: "Thus the heavens and the earth were finished..." }],
					},
				});
			}
			if (url.includes("/api/audio/")) {
				audioLoaded = true;
				return Response.json({ bookUsfm: "GEN", chapter: 1, tracks: [] });
			}
			return new Response("Not Found", { status: 404 });
		}) as typeof fetch;

		try {
			const { container } = render(<App />);
			await waitUntil(() => {
				expect(getByText(container, "Continue Reading")).toBeDefined();
			});

			fireClick(getButton(container, "Continue Reading"));

			await waitUntil(() => {
				expect(audioLoaded).toBe(true);
				expect(window.location.hash).toBe("#/GEN/1");
				expect(getByText(container, "In the beginning...")).toBeDefined();
				const kickerSpans = Array.from(container.querySelectorAll(".chapter-kicker span")).map(
					(el) => el.textContent,
				);
				expect(kickerSpans).toEqual(["Old Testament · ESV", "구약 · 개역한글"]);
				expect(
					container.querySelector('aside[aria-label="Audio Playback and Verse Sync"]'),
				).not.toBeNull();
				expect(
					container.querySelector('aside[aria-label="Korean Dictionary & Grammar Guide"]'),
				).not.toBeNull();
			});

			// Words starts collapsed, then clicking a word ("View in Dictionary") expands, highlights & reveals its translation
			expect(container.querySelector(".vocab-list")).toBeNull();
			fireClick(getButton(container, "올라가서"));
			const dictEntry = container.querySelector('[data-footnote-id="vocab-올라가다"]');
			expect(dictEntry).not.toBeNull();
			expect(dictEntry?.className).toContain("highlighted");
			expect(dictEntry?.textContent).toContain("to go up");

			// Minimize dictionary to move the right rail out of the way, then restore via the toggle pill
			const workspace = container.querySelector(".reader-workspace");
			expect(workspace?.className).toContain("with-right-rail");
			expect(container.querySelector(".dict-sidebar-wrap")?.className).toContain("expanded");
			fireClick(getButton(container, "Minimize dictionary"));
			expect(workspace?.className).not.toContain("with-right-rail");
			expect(workspace?.className).toContain("with-minimized-rail");
			expect(container.querySelector(".dict-sidebar-wrap")?.className).toContain("minimized");
			expect(
				container.querySelector('aside[aria-label="Korean Dictionary & Grammar Guide"]'),
			).toBeNull();
			const expandBtn = getButton(container, "Expand dictionary");
			expect(expandBtn.closest(".dict-sidebar-wrap")).not.toBeNull();
			expect(expandBtn.getAttribute("aria-expanded")).toBe("false");
			fireClick(expandBtn);
			expect(workspace?.className).toContain("with-right-rail");
			expect(container.querySelector(".dict-sidebar-wrap")?.className).toContain("expanded");
			expect(
				container.querySelector('aside[aria-label="Korean Dictionary & Grammar Guide"]'),
			).not.toBeNull();

			// Minimize audio rail to move the left rail out of the way, then restore via the toggle pill
			expect(workspace?.className).toContain("with-left-rail");
			expect(container.querySelector(".audio-rail-wrap")?.className).toContain("expanded");
			fireClick(getButton(container, "Minimize audio"));
			expect(workspace?.className).not.toContain("with-left-rail");
			expect(workspace?.className).toContain("with-minimized-left-rail");
			expect(container.querySelector(".audio-rail-wrap")?.className).toContain("minimized");
			expect(
				container.querySelector('aside[aria-label="Audio Playback and Verse Sync"]'),
			).toBeNull();
			const expandAudioBtn = getButton(container, "Expand audio");
			expect(expandAudioBtn.closest(".audio-rail-wrap")).not.toBeNull();
			expect(expandAudioBtn.getAttribute("aria-expanded")).toBe("false");
			fireClick(expandAudioBtn);
			expect(workspace?.className).toContain("with-left-rail");
			expect(container.querySelector(".audio-rail-wrap")?.className).toContain("expanded");
			expect(
				container.querySelector('aside[aria-label="Audio Playback and Verse Sync"]'),
			).not.toBeNull();

			// Header chapter navigation below titles navigates between chapters
			const headerNav = container.querySelector(".chapter-header .chapter-nav-header");
			expect(headerNav).not.toBeNull();
			expect(getButton(headerNav as ParentNode, "Previous Chapter").disabled).toBe(true);
			fireClick(getButton(headerNav as ParentNode, "Next Chapter"));
			await waitUntil(() => {
				expect(window.location.hash).toBe("#/GEN/2");
				expect(
					getByText(container, "Thus the heavens and the earth were finished..."),
				).toBeDefined();
			});
			expect(getButton(headerNav as ParentNode, "Previous Chapter").disabled).toBe(false);
			fireClick(getButton(headerNav as ParentNode, "Previous Chapter"));
			await waitUntil(() => {
				expect(window.location.hash).toBe("#/GEN/1");
				expect(getByText(container, "The earth was without form...")).toBeDefined();
			});

			// Selecting verse 2 updates last-read verse shown in Continue Reading on Home
			fireClick(getButton(container, "Verse 2"));
			fireClick(container.querySelector('a[aria-label="Logos2Rhema Home"]') as Element);
			expect(getByText(container, "Continue Reading")).toBeDefined();
			expect(window.location.hash).toBe("#/");
			expect(container.querySelector(".home-continue-ref")?.textContent).toContain("Genesis 1:2");
			expect(container.querySelector(".home-continue-ref")?.textContent).toContain(
				"창세기 1장 2절",
			);
			fireClick(getButton(container, "Continue Reading"));
			await waitUntil(() => {
				expect(window.location.hash).toBe("#/GEN/1/2");
				expect(getByText(container, "The earth was without form...")).toBeDefined();
			});
		} finally {
			globalThis.fetch = originalFetch;
			window.matchMedia = originalMatchMedia;
		}
	});

	it("renders FloatingBottomBar skip/fallback and AudioControlRail verse sync", () => {
		const onSelectLanguage = mock(() => {});
		const onSkipBy = mock((_delta: number) => {});
		const koTrack = {
			id: "helloao:krv:wordproject",
			label: "Wordproject Reader (KRV)",
			language: "ko",
			translationId: "krv",
			url: "https://audio.bible.helloao.org/api/kor_old/GEN/1/audio/wordproject.mp3",
			source: "helloao" as const,
		};

		const bar = render(
			<FloatingBottomBar
				{...baseBarProps()}
				tracks={[koTrack]}
				activeTrack={koTrack}
				dictionaryOpen={false}
				onToggleDictionary={noop}
			/>,
		);
		expect(getButton(bar.container, "Previous chapter").disabled).toBe(true);

		bar.rerender(
			<FloatingBottomBar
				{...baseBarProps()}
				hasNext={false}
				tracks={[koTrack]}
				activeTrack={koTrack}
				isPlaying={true}
				currentTime={15}
				dictionaryOpen={true}
				onToggleDictionary={noop}
				onSkipBy={onSkipBy}
			/>,
		);
		fireClick(getButton(bar.container, "Rewind 10 seconds"));
		fireClick(getButton(bar.container, "Forward 10 seconds"));
		expect(onSkipBy).toHaveBeenNthCalledWith(1, -10);
		expect(onSkipBy).toHaveBeenNthCalledWith(2, 10);

		bar.rerender(
			<FloatingBottomBar
				{...baseBarProps()}
				tracks={[koTrack]}
				preferredLang="en"
				activeTrack={null}
				dictionaryOpen={false}
				onToggleDictionary={noop}
				onSelectLanguage={onSelectLanguage}
			/>,
		);
		expect(getByText(bar.container, /No audio recording linked/)).toBeDefined();
		fireClick(getButton(bar.container, /Use 개역한글/));
		expect(onSelectLanguage).toHaveBeenCalledWith("ko");

		const standardTrack = {
			id: "bb:ENGESVN1DA",
			label: "ESV · Narration",
			language: "en",
			translationId: "esv",
			url: "https://cdn.example.com/std.mp3",
			source: "bible-brain" as const,
			audioStyle: "standard" as const,
			verseTimings: { 1: 0, 12: 34.5, 16: 48.2 },
		};
		const dramaTrack = {
			...standardTrack,
			id: "bb:ENGESVN2DA",
			label: "ESV · Drama",
			audioStyle: "drama" as const,
		};
		expect(resolveVerseAtTime(standardTrack.verseTimings, 48.5)).toBe(16);
		expect(resolveTimeForVerse(standardTrack.verseTimings, 17)).toBe(48.2);

		const onSyncToVisible = mock(() => {});
		const onSelectTrack = mock(() => {});
		const onRailSelectLanguage = mock((_lang: string) => {});
		const onRailSkip = mock((_delta: number) => {});
		const onRailChangeSpeed = mock((_rate: number) => {});
		const onRailMinimize = mock(() => {});
		const rail = render(
			<AudioControlRail
				{...baseBarProps()}
				bookEn="John"
				bookKo="요한복음"
				chapter={3}
				tracks={[standardTrack, dramaTrack]}
				preferredLang="en"
				activeTrack={standardTrack}
				isPlaying={true}
				currentTime={35}
				visibleVerse={16}
				activeVerse={12}
				autoSync={true}
				isFollowingAudio={false}
				onSelectTrack={onSelectTrack}
				onSelectLanguage={onRailSelectLanguage}
				onChangeSpeed={onRailChangeSpeed}
				onSkipBy={onRailSkip}
				onToggleAutoSync={noop}
				onSyncToVisibleVerse={onSyncToVisible}
				onFollowActiveVerse={noop}
				onMinimize={onRailMinimize}
			/>,
		);
		fireClick(getButton(rail.container, "Drama"));
		expect(onSelectTrack).toHaveBeenCalledWith(dramaTrack);
		expect(rail.container.querySelector(".rail-header-top .panel-title")?.textContent).toBe(
			"Audio",
		);
		const audioMinimizeBtn = getButton(rail.container, "Minimize audio");
		expect(audioMinimizeBtn.getAttribute("aria-expanded")).toBe("true");
		fireClick(audioMinimizeBtn);
		expect(onRailMinimize).toHaveBeenCalledTimes(1);
		expect(rail.container.querySelector(".rail-panel-header .quick-lang-toggle")).toBeNull();
		const langToggle = rail.container.querySelector(
			".rail-player .rail-lang-row .quick-lang-toggle",
		);
		expect(langToggle).not.toBeNull();
		const playerChildren = Array.from(rail.container.querySelectorAll(".rail-player > div")).map(
			(el) => el.className,
		);
		expect(playerChildren.indexOf("rail-lang-row")).toBeLessThan(
			playerChildren.indexOf("rail-scrubber"),
		);
		expect(rail.container.querySelector('button[aria-label="Previous chapter"]')).toBeNull();
		expect(rail.container.querySelector('button[aria-label="Next chapter"]')).toBeNull();
		fireClick(getButton(langToggle as ParentNode, "한"));
		expect(onRailSelectLanguage).toHaveBeenCalledWith("ko");
		expect(rail.container.querySelector(".panel-subtitle")?.textContent).toBe(
			"John 3 · 요한복음 3장",
		);
		expect(rail.container.querySelector(".rail-chapter-btn")).toBeNull();
		expect(
			rail.container.querySelector(".rail-panel-header button[title='Choose book or chapter']"),
		).toBeNull();

		const transportLabels = Array.from(
			rail.container.querySelectorAll(".rail-transport-row button"),
		).map((btn) => btn.getAttribute("aria-label"));
		expect(transportLabels).toEqual(["Rewind 10 seconds", "Pause audio", "Forward 10 seconds"]);
		const playerSections = Array.from(rail.container.querySelectorAll(".rail-player > div")).map(
			(el) => el.className,
		);
		expect(playerSections.indexOf("rail-time-row")).toBeGreaterThan(
			playerSections.indexOf("rail-transport-row"),
		);
		const timeRow = rail.container.querySelector(".rail-time-row");
		expect(timeRow?.textContent).toContain("0:35");
		expect(timeRow?.textContent).toContain("2:00");
		const speedSelect = timeRow?.querySelector(
			'select[aria-label="Playback speed"]',
		) as HTMLSelectElement;
		expect(speedSelect).not.toBeNull();
		expect(Array.from(speedSelect.options).map((o) => o.textContent)).toEqual([
			"0.5x",
			"1x",
			"1.5x",
			"2x",
		]);
		act(() => {
			speedSelect.value = "1.5";
			speedSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
		});
		expect(onRailChangeSpeed).toHaveBeenCalledWith(1.5);

		// Settings section (Verse Sync, toggle button, and info) is collapsed by default
		const settingsToggle = getButton(rail.container, "Settings");
		expect(settingsToggle.getAttribute("aria-expanded")).toBe("false");
		expect(rail.container.querySelector(".rail-sync-box")).toBeNull();

		fireClick(settingsToggle);
		expect(settingsToggle.getAttribute("aria-expanded")).toBe("true");
		expect(rail.container.querySelector(".rail-sync-box")).not.toBeNull();
		const syncSwitch = rail.container.querySelector('button[role="switch"]') as HTMLButtonElement;
		expect(syncSwitch.textContent).toBe("On");
		expect(syncSwitch.getAttribute("aria-checked")).toBe("true");
		expect(syncSwitch.disabled).toBe(false);
		expect(getByText(rail.container, "Reading v.16")).toBeDefined();
		expect(getByText(rail.container, "Playing v.12")).toBeDefined();
		fireClick(getButton(rail.container, "Play from v.16"));
		expect(onSyncToVisible).toHaveBeenCalledTimes(1);
		fireClick(getButton(rail.container, "Rewind 10 seconds"));
		fireClick(getButton(rail.container, "Forward 10 seconds"));
		expect(onRailSkip).toHaveBeenNthCalledWith(1, -10);
		expect(onRailSkip).toHaveBeenNthCalledWith(2, 10);

		rail.rerender(
			<AudioControlRail
				{...baseBarProps()}
				bookEn="John"
				bookKo="요한복음"
				chapter={3}
				tracks={[standardTrack, dramaTrack]}
				preferredLang="en"
				activeTrack={standardTrack}
				isPlaying={true}
				currentTime={35}
				visibleVerse={16}
				activeVerse={12}
				autoSync={false}
				isFollowingAudio={false}
				onToggleAutoSync={noop}
				onSyncToVisibleVerse={noop}
				onFollowActiveVerse={noop}
			/>,
		);
		expect(syncSwitch.textContent).toBe("Off");
		expect(syncSwitch.getAttribute("aria-checked")).toBe("false");
		expect(syncSwitch.disabled).toBe(false);

		rail.rerender(
			<AudioControlRail
				{...baseBarProps()}
				bookEn="Ruth"
				bookKo="룻기"
				chapter={4}
				tracks={[koTrack]}
				preferredLang="ko"
				activeTrack={koTrack}
				isPlaying={false}
				currentTime={0}
				visibleVerse={1}
				activeVerse={null}
				autoSync={true}
				isFollowingAudio={true}
				onToggleAutoSync={noop}
				onSyncToVisibleVerse={noop}
				onFollowActiveVerse={noop}
			/>,
		);
		expect(getButton(rail.container, "Play audio").textContent).toBe("Play");
		expect(syncSwitch.textContent).toBe("Off");
		expect(syncSwitch.getAttribute("aria-checked")).toBe("false");
		expect(syncSwitch.disabled).toBe(true);
		expect(rail.container.querySelector(".rail-sync-status")).toBeNull();
		expect(getByText(rail.container, "Verse sync unavailable for this audio")).toBeDefined();

		fireClick(settingsToggle);
		expect(settingsToggle.getAttribute("aria-expanded")).toBe("false");
		expect(rail.container.querySelector(".rail-sync-box")).toBeNull();
	});

	it("auto-syncs playback start to the currently visible verse", async () => {
		const originalAudio = globalThis.Audio;
		let mockCurrentTime = 0;
		const listeners = new Map<string, Array<() => void>>();

		class MockAudio {
			preload = "metadata";
			src = "";
			duration = 120;
			paused = true;
			playbackRate = 1;
			preservesPitch = true;
			get currentTime() {
				return mockCurrentTime;
			}
			set currentTime(val: number) {
				mockCurrentTime = val;
			}
			load() {}
			removeAttribute() {}
			addEventListener(type: string, fn: () => void) {
				listeners.set(type, [...(listeners.get(type) ?? []), fn]);
			}
			removeEventListener() {}
			pause() {
				this.paused = true;
			}
			play() {
				this.paused = false;
				for (const fn of listeners.get("play") ?? []) fn();
				return Promise.resolve();
			}
		}

		globalThis.Audio = MockAudio as unknown as typeof Audio;
		const koSyncedTrack = {
			id: "bb:KORKRVN1DA",
			label: "KRV · Narration",
			language: "ko",
			translationId: "krv",
			url: "https://cdn.example.com/krv.mp3",
			source: "bible-brain" as const,
			verseTimings: { 1: 0, 16: 48.2 },
		};
		try {
			const { result } = renderHook(() =>
				useHumanAudio({
					tracks: [koSyncedTrack],
					visibleVerse: 16,
					autoSync: true,
				}),
			);

			await act(async () => {
				result.current.togglePlay();
			});

			expect(mockCurrentTime).toBe(48.2);
			expect(result.current.activeVerse).toBe(16);

			act(() => {
				result.current.setPlaybackRate(1.5);
			});
			expect(result.current.playbackRate).toBe(1.5);
		} finally {
			globalThis.Audio = originalAudio;
		}
	});
});
