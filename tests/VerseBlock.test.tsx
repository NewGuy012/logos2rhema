import { describe, expect, it, mock } from "bun:test";

import { act } from "react";

import App from "../src/react-app/App";
import { AudioControlRail } from "../src/react-app/components/AudioControlRail";
import { FavoritesList } from "../src/react-app/components/FavoritesList";
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
import {
	FAVORITES_STORAGE_KEY,
	formatFavoriteLabel,
	readStoredFavorites,
	toggleFavoriteItem,
} from "../src/react-app/lib/favorites";
import {
	formatHighlightLabel,
	HIGHLIGHTS_STORAGE_KEY,
	readStoredHighlights,
	splitTextByHighlights,
	toggleHighlightSpans,
} from "../src/react-app/lib/highlights";
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

	it("flips English/Korean verse order in VerseBlock and opens tooltip on hover or unmatched tap", async () => {
		const onToggleFavorite = mock(() => {});
		const onSelectFootnote = mock(() => {});
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
			isFavorited: false,
			enCode: "ESV",
			koCode: "개역한글",
			hasVerseTimestamps: false,
			onSelectVerse: noop,
			onToggleFavorite,
			onSelectFootnote,
		};

		const { container, rerender } = render(<VerseBlock {...verseProps} stackOrder="en-first" />);

		const favBtn = getButton(container, "Bookmark verse 1");
		expect(favBtn.getAttribute("aria-pressed")).toBe("false");
		fireClick(favBtn);
		expect(onToggleFavorite).toHaveBeenCalledTimes(1);

		rerender(<VerseBlock {...verseProps} stackOrder="en-first" isFavorited={true} />);
		const removeFavBtn = getButton(container, "Remove verse 1 from favorites");
		expect(removeFavBtn.getAttribute("aria-pressed")).toBe("true");
		expect(removeFavBtn.className).toContain("active");

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
		const spokenUtterances: Array<{ text: string; lang: string; rate: number; voice?: unknown }> =
			[];
		const cancelMock = mock(() => {});
		const koVoice = { lang: "ko-KR", localService: true, name: "Yuna" };
		const origSpeechSynth = Object.getOwnPropertyDescriptor(window, "speechSynthesis");
		const origUtterance = Object.getOwnPropertyDescriptor(window, "SpeechSynthesisUtterance");

		class MockUtterance {
			text: string;
			lang = "";
			rate = 1;
			voice: unknown = null;
			onstart: (() => void) | null = null;
			onend: (() => void) | null = null;
			onerror: (() => void) | null = null;
			constructor(text: string) {
				this.text = text;
			}
		}
		Object.defineProperty(window, "SpeechSynthesisUtterance", {
			configurable: true,
			value: MockUtterance,
		});
		Object.defineProperty(window, "speechSynthesis", {
			configurable: true,
			value: {
				cancel: cancelMock,
				getVoices: () => [koVoice],
				speak: (u: MockUtterance) => {
					spokenUtterances.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice });
					u.onstart?.();
					u.onend?.();
				},
			},
		});

		try {
			fireHover(wordBtn, true);
			const tooltip = document.body.querySelector('[role="tooltip"]') as HTMLElement | null;
			expect(tooltip?.textContent).toContain("to create");
			expect(tooltip?.textContent).toContain("[chang-jo-ha-si-ni-ra]");
			expect(tooltip?.textContent).toContain("Root: 창조하다");
			expect(tooltip?.textContent).toContain("[chang-jo-ha-da]");
			expect(tooltip?.style.transform).toBe("translate(-50%, 0)");
			expect(tooltip?.style.top).toBe("296px");

			// Hovering onto the tooltip keeps it open, and both exact inflected & root speech buttons speak ko-KR
			fireHover(wordBtn, false);
			fireHover(tooltip as HTMLElement, true);
			expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();

			fireClick(getButton(tooltip as ParentNode, "Pronounce 창조하시니라"));
			fireClick(getButton(tooltip as ParentNode, "Pronounce root 창조하다"));
			expect(cancelMock).toHaveBeenCalledTimes(2);
			expect(spokenUtterances).toEqual([
				{ text: "창조하시니라", lang: "ko-KR", rate: 0.92, voice: koVoice },
				{ text: "창조하다", lang: "ko-KR", rate: 0.92, voice: koVoice },
			]);

			fireHover(tooltip as HTMLElement, false);
			await waitUntil(() => {
				expect(document.body.querySelector('[role="tooltip"]') === null).toBe(true);
			});

			// Clicking a matched word opens/pins tooltip without navigating dictionary until "View in Dictionary" is clicked
			fireClick(wordBtn);
			expect(onSelectFootnote).not.toHaveBeenCalled();
			const clickedTooltip = document.body.querySelector('[role="tooltip"]') as HTMLElement | null;
			expect(clickedTooltip).not.toBeNull();
			fireClick(getButton(clickedTooltip as ParentNode, "View in Dictionary"));
			expect(onSelectFootnote).toHaveBeenCalledTimes(1);
			expect(onSelectFootnote).toHaveBeenCalledWith("vocab-창조하다");
			expect(document.body.querySelector('[role="tooltip"]') === null).toBe(true);
		} finally {
			if (origSpeechSynth) {
				Object.defineProperty(window, "speechSynthesis", origSpeechSynth);
			} else {
				delete (window as { speechSynthesis?: unknown }).speechSynthesis;
			}
			if (origUtterance) {
				Object.defineProperty(window, "SpeechSynthesisUtterance", origUtterance);
			} else {
				delete (window as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
			}
		}

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
		const onContinueReading = mock(() => {});
		const onTopOpenPassage = mock(() => {});
		const onTopRemoveFavorite = mock(() => {});
		const onFlip = mock(() => {});
		const onOpenSearch = mock(() => {});
		const topBar = render(
			<TopBar
				lastBookNumber={8}
				lastChapter={4}
				lastVerse={12}
				favorites={[
					{
						id: "43:3:16",
						bookNumber: 43,
						chapter: 3,
						verse: 16,
						enText: "For God so loved the world...",
						createdAt: 100,
					},
				]}
				selectedEn={CANONICAL_BIBLES.en}
				selectedKo={CANONICAL_BIBLES.ko}
				stackOrder="en-first"
				theme="paper"
				fontScale={1}
				koFontStyle="serif"
				studyMask="none"
				onGoHome={onGoHome}
				onContinueReading={onContinueReading}
				onOpenPassage={onTopOpenPassage}
				onRemoveFavorite={onTopRemoveFavorite}
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
		const appearanceBtn = getButton(topBar.container, "Reader appearance settings");
		expect(appearanceBtn.className).toContain("appearance-btn");
		expect(appearanceBtn.textContent).toBe("");
		expect(appearanceBtn.querySelector("svg") !== null).toBe(true);
		expect(topBar.container.querySelector(".flip-btn")).toBeNull();
		fireClick(topBar.container.querySelector('a[aria-label="Logos2Rhema Home"]') as Element);
		expect(onGoHome).toHaveBeenCalledTimes(1);
		fireClick(getButton(topBar.container, "Home"));
		expect(onGoHome).toHaveBeenCalledTimes(2);
		fireClick(appearanceBtn);
		fireClick(getButton(topBar.container, "EN / 한"));
		expect(onFlip).not.toHaveBeenCalled();
		fireClick(getButton(topBar.container, "한 / EN"));
		expect(onFlip).toHaveBeenCalledTimes(1);
		const searchBtn = getButton(topBar.container, "Go to");
		expect(searchBtn.className).toContain("top-search-btn");
		const controlsChildren = Array.from(
			topBar.container.querySelector(".top-controls")?.children ?? [],
		);
		const badge = topBar.container.querySelector(".translation-badge");
		expect(controlsChildren.indexOf(searchBtn)).toBe(0);
		expect(controlsChildren.indexOf(badge as Element)).toBe(1);
		fireClick(searchBtn);
		expect(onOpenSearch).toHaveBeenCalledTimes(1);
		const topContinueBtn = getButton(topBar.container, "Continue");
		expect(topContinueBtn.className).toContain("active");
		expect(topContinueBtn.getAttribute("aria-current")).toBe("page");
		expect(getButton(topBar.container, "Home").className).not.toContain("active");
		fireClick(topContinueBtn);
		expect(onContinueReading).toHaveBeenCalledTimes(1);

		const topFavoritesBtn = getButton(topBar.container, /Favorites/);
		expect(topFavoritesBtn.getAttribute("aria-expanded")).toBe("false");
		fireClick(topFavoritesBtn);
		expect(topFavoritesBtn.getAttribute("aria-expanded")).toBe("true");
		const favPopover = topBar.container.querySelector(".top-favorites-popover") as ParentNode;
		expect(favPopover).not.toBeNull();
		fireClick(getButton(favPopover, "Remove John 3:16 from favorites"));
		expect(onTopRemoveFavorite).toHaveBeenCalledWith("43:3:16");
		fireClick(getButton(favPopover, /John 3:16/));
		expect(onTopOpenPassage).toHaveBeenCalledWith(43, 3, 16);
		expect(topBar.container.querySelector(".top-favorites-popover")).toBeNull();

		const topGenresBtn = getButton(topBar.container, "Genres");
		expect(topGenresBtn.getAttribute("aria-expanded")).toBe("false");
		fireClick(topGenresBtn);
		expect(topGenresBtn.getAttribute("aria-expanded")).toBe("true");
		const genresPopover = topBar.container.querySelector(".top-genres-popover") as ParentNode;
		expect(genresPopover.querySelectorAll(".home-genre-card")).toHaveLength(10);
		fireClick(getButton(genresPopover, /Obadiah/));
		expect(onTopOpenPassage).toHaveBeenCalledWith(31, 1);
		expect(topBar.container.querySelector(".top-genres-popover")).toBeNull();

		fireClick(topGenresBtn);
		const genresPopover2 = topBar.container.querySelector(".top-genres-popover") as ParentNode;
		fireClick(getButton(genresPopover2, /Psalms/));
		expect(getByText(genresPopover2, "Psalms · 시편")).toBeDefined();
		fireClick(getButton(genresPopover2, "23"));
		expect(onTopOpenPassage).toHaveBeenCalledWith(19, 23);
		expect(topBar.container.querySelector(".top-genres-popover")).toBeNull();

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
		const continueSection = home.container.querySelector(
			'section[aria-label="Continue Where You Left Off"]',
		);
		expect(continueSection).not.toBeNull();
		expect(getByText(continueSection as ParentNode, "Continue Where You Left Off")).toBeDefined();
		expect(continueSection?.querySelector(".home-continue-label")).toBeNull();
		expect(continueSection?.querySelector(".home-continue-ref")?.textContent).toContain(
			"Ruth 4:12",
		);
		expect(continueSection?.querySelector(".home-continue-ref")?.textContent).toContain(
			"룻기 4장 12절",
		);
		const continueBtn = getButton(continueSection as ParentNode, "Continue");
		expect(continueBtn.textContent).toBe("Continue");
		fireClick(continueBtn);
		expect(onOpenPassage).toHaveBeenCalledWith(8, 4, 12);

		const favoritesSection = home.container.querySelector('section[aria-label="Favorites"]');
		expect(favoritesSection).not.toBeNull();
		const favoritesToggle = getButton(favoritesSection as ParentNode, "Favorites");
		expect(favoritesToggle.getAttribute("aria-expanded")).toBe("false");
		expect(favoritesSection?.querySelector(".home-favorites-panel")).toBeNull();
		fireClick(favoritesToggle);
		expect(favoritesToggle.getAttribute("aria-expanded")).toBe("true");
		expect(getByText(favoritesSection as ParentNode, /No favorites yet/)).toBeDefined();

		const onRemoveFavorite = mock(() => {});
		const onRemoveHighlight = mock(() => {});
		home.rerender(
			<HomePage
				lastBookNumber={8}
				lastChapter={4}
				lastVerse={12}
				selectedEn={CANONICAL_BIBLES.en}
				selectedKo={CANONICAL_BIBLES.ko}
				bibleBrainEnabled={false}
				favorites={[
					{
						id: "43:3:16",
						bookNumber: 43,
						chapter: 3,
						verse: 16,
						enText: "For God so loved the world...",
						koText: "하나님이 세상을 이처럼 사랑하사...",
						createdAt: 200,
					},
					{
						id: "2:2",
						bookNumber: 2,
						chapter: 2,
						createdAt: 100,
					},
				]}
				highlights={[
					{
						id: "1:1:1:en:7-16",
						bookNumber: 1,
						chapter: 1,
						verse: 1,
						lang: "en",
						start: 7,
						end: 16,
						text: "beginning",
						createdAt: 300,
					},
				]}
				onOpenPassage={onOpenPassage}
				onRemoveFavorite={onRemoveFavorite}
				onRemoveHighlight={onRemoveHighlight}
			/>,
		);
		expect(favoritesSection?.querySelector(".home-disclosure-count")?.textContent).toBe("3");
		expect(favoritesSection?.querySelectorAll(".home-favorite-card")).toHaveLength(3);
		expect(favoritesSection?.querySelector("mark.verse-highlight")?.textContent).toBe("beginning");
		fireClick(getButton(favoritesSection as ParentNode, /John 3:16/));
		expect(onOpenPassage).toHaveBeenCalledWith(43, 3, 16);
		fireClick(getButton(favoritesSection as ParentNode, /Exodus 2/));
		expect(onOpenPassage).toHaveBeenCalledWith(2, 2, undefined);
		fireClick(getButton(favoritesSection as ParentNode, /Genesis 1:1/));
		expect(onOpenPassage).toHaveBeenCalledWith(1, 1, 1);
		fireClick(getButton(favoritesSection as ParentNode, "Remove John 3:16 from favorites"));
		expect(onRemoveFavorite).toHaveBeenCalledWith("43:3:16");
		fireClick(getButton(favoritesSection as ParentNode, "Remove highlight from Genesis 1:1"));
		expect(onRemoveHighlight).toHaveBeenCalledWith("1:1:1:en:7-16");
		fireClick(favoritesToggle);
		expect(favoritesToggle.getAttribute("aria-expanded")).toBe("false");
		expect(favoritesSection?.querySelector(".home-favorites-panel")).toBeNull();

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
		expect(aboutSection?.querySelector(".home-about-copy")?.textContent).toBe(
			"Logos2Rhema was built first and foremost to give glory to God, strengthen Bible and language literacy, and bring the Word from the head to the heart, hence Logos to Rhema.",
		);

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
				expect(getByText(container, "Continue Where You Left Off")).toBeDefined();
			});

			fireClick(
				getButton(container.querySelector(".home-continue-section") as ParentNode, "Continue"),
			);

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

			// Words starts collapsed; clicking the Korean word opens its tooltip, then clicking "View in Dictionary" expands & highlights it
			expect(container.querySelector(".vocab-list")).toBeNull();
			fireClick(getButton(container, "올라가서"));
			expect(container.querySelector(".vocab-list")).toBeNull();
			const wordTooltip = document.body.querySelector('[role="tooltip"]') as ParentNode | null;
			expect(wordTooltip).not.toBeNull();
			fireClick(getButton(wordTooltip as ParentNode, "View in Dictionary"));
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

			// Bookmark chapter and verse, return Home, verify Favorites is collapsed by default, then open a favorited verse
			const chapterFavBtn = getButton(container, "Bookmark Genesis 1");
			expect(chapterFavBtn.getAttribute("aria-pressed")).toBe("false");
			fireClick(chapterFavBtn);
			expect(
				getButton(container, "Remove Genesis 1 from favorites").getAttribute("aria-pressed"),
			).toBe("true");

			const verse1FavBtn = getButton(container, "Bookmark verse 1");
			fireClick(verse1FavBtn);
			expect(
				getButton(container, "Remove verse 1 from favorites").getAttribute("aria-pressed"),
			).toBe("true");

			const storedFavs = JSON.parse(localStorage.getItem("logos.reader.favorites.v1") ?? "[]");
			expect(storedFavs).toHaveLength(2);

			// Selecting verse 2 updates last-read verse shown in Continue Where You Left Off on Home
			fireClick(getButton(container, "Verse 2"));
			fireClick(container.querySelector('a[aria-label="Logos2Rhema Home"]') as Element);
			expect(getByText(container, "Continue Where You Left Off")).toBeDefined();
			expect(window.location.hash).toBe("#/");

			const appFavoritesSection = container.querySelector('section[aria-label="Favorites"]');
			const appFavoritesToggle = getButton(appFavoritesSection as ParentNode, "Favorites");
			expect(appFavoritesToggle.getAttribute("aria-expanded")).toBe("false");
			expect(appFavoritesSection?.querySelector(".home-favorites-panel")).toBeNull();
			fireClick(appFavoritesToggle);
			expect(appFavoritesToggle.getAttribute("aria-expanded")).toBe("true");
			expect(appFavoritesSection?.querySelectorAll(".home-favorite-card")).toHaveLength(2);
			expect(appFavoritesSection?.textContent).toContain("In the beginning...");
			expect(appFavoritesSection?.textContent).toContain("Genesis 1");

			fireClick(getButton(appFavoritesSection as ParentNode, /Genesis 1:1/));
			await waitUntil(() => {
				expect(window.location.hash).toBe("#/GEN/1/1");
				expect(getByText(container, "In the beginning...")).toBeDefined();
			});

			// Unbookmark verse 1, select verse 2 to update last-read verse, and return home
			fireClick(getButton(container, "Remove verse 1 from favorites"));
			expect(getButton(container, "Bookmark verse 1").getAttribute("aria-pressed")).toBe("false");
			fireClick(getButton(container, "Verse 2"));
			fireClick(container.querySelector('a[aria-label="Logos2Rhema Home"]') as Element);
			expect(container.querySelector(".home-continue-ref")?.textContent).toContain("Genesis 1:2");
			expect(container.querySelector(".home-continue-ref")?.textContent).toContain(
				"창세기 1장 2절",
			);
			// TopBar Continue shortcut resumes Genesis 1:2 directly from Home
			fireClick(getButton(container.querySelector(".top-nav") as ParentNode, "Continue"));
			await waitUntil(() => {
				expect(window.location.hash).toBe("#/GEN/1/2");
				expect(getByText(container, "The earth was without form...")).toBeDefined();
			});

			// TopBar Favorites dropdown is also accessible directly from the reader
			const topNav = container.querySelector(".top-nav") as ParentNode;
			fireClick(getButton(topNav, /Favorites/));
			const readerFavPopover = container.querySelector(".top-favorites-popover") as ParentNode;
			expect(readerFavPopover?.textContent).toContain("Genesis 1");
			fireClick(getButton(readerFavPopover, /Genesis 1/));
			await waitUntil(() => {
				expect(window.location.hash).toBe("#/GEN/1");
			});

			// Select English text and trigger Cmd+H highlight + verify yellow mark, Favorites grouping, and Cmd+H toggle off
			const enLine = container.querySelector('.verse-en[data-verse="1"]') as HTMLElement;
			const enTextNode = enLine.firstChild as Text;
			const enRange = document.createRange();
			enRange.setStart(enTextNode, 7);
			enRange.setEnd(enTextNode, 16); // "beginning"
			const sel = window.getSelection();
			sel?.removeAllRanges();
			sel?.addRange(enRange);
			act(() => {
				document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
			});
			expect(container.querySelector(".selection-highlight-bar")).not.toBeNull();
			expect(getByText(container, "Highlight")).toBeDefined();

			act(() => {
				window.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "h", metaKey: true, bubbles: true }),
				);
			});
			expect(container.querySelector(".selection-highlight-bar")).toBeNull();
			expect(enLine.querySelector("mark.verse-highlight")?.textContent).toBe("beginning");
			const storedHighlights = JSON.parse(localStorage.getItem(HIGHLIGHTS_STORAGE_KEY) ?? "[]");
			expect(storedHighlights).toHaveLength(1);
			expect(storedHighlights[0].text).toBe("beginning");

			// Also highlight across Korean tokens via the floating Highlight button
			const koLine = container.querySelector('.verse-ko[data-verse="1"]') as HTMLElement;
			const koFirstText = koLine.querySelector("button")?.firstChild as Text;
			const koRange = document.createRange();
			koRange.setStart(koFirstText, 0);
			koRange.setEnd(koFirstText, koFirstText.length);
			sel?.removeAllRanges();
			sel?.addRange(koRange);
			act(() => {
				document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
			});
			fireClick(
				getButton(container.querySelector(".selection-highlight-bar") as ParentNode, "Highlight"),
			);
			expect(koLine.querySelector("mark.verse-highlight")?.textContent).toBe("보아스가");

			// Check Highlights group inside Home Favorites section
			fireClick(container.querySelector('a[aria-label="Logos2Rhema Home"]') as Element);
			const homeFavSection = container.querySelector(
				'section[aria-label="Favorites"]',
			) as ParentNode;
			fireClick(getButton(homeFavSection, "Favorites"));
			expect(getByText(homeFavSection, /Bookmarks \(1\)/)).toBeDefined();
			expect(getByText(homeFavSection, /Highlights \(2\)/)).toBeDefined();
			expect(homeFavSection.querySelectorAll("mark.verse-highlight")).toHaveLength(2);
			fireClick(getButton(homeFavSection, /Remove highlight from Genesis 1:1/));
			expect(homeFavSection.querySelectorAll("mark.verse-highlight")).toHaveLength(1);

			// Click remaining highlight to jump back to Genesis 1:1, then toggle it off with Cmd+H
			fireClick(getButton(homeFavSection, /Genesis 1:1/));
			await waitUntil(() => {
				expect(window.location.hash).toBe("#/GEN/1/1");
				expect(
					container.querySelector('.verse-en[data-verse="1"] mark.verse-highlight'),
				).not.toBeNull();
			});
			const hlMark = container.querySelector(
				'.verse-en[data-verse="1"] mark.verse-highlight',
			) as HTMLElement;
			const rmRange = document.createRange();
			rmRange.selectNodeContents(hlMark);
			sel?.removeAllRanges();
			sel?.addRange(rmRange);
			act(() => {
				window.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "h", metaKey: true, bubbles: true }),
				);
			});
			expect(container.querySelector('.verse-en[data-verse="1"] mark.verse-highlight')).toBeNull();
			fireClick(getButton(container.querySelector(".top-nav") as ParentNode, "Home"));
			expect(window.location.hash).toBe("#/");
			expect(getByText(container, "Continue Where You Left Off")).toBeDefined();
			expect(
				getButton(container.querySelector(".top-nav") as ParentNode, "Home").getAttribute(
					"aria-current",
				),
			).toBe("page");
			expect(
				getButton(container.querySelector(".top-nav") as ParentNode, "Continue").className,
			).not.toContain("active");
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
		const speedTrigger = timeRow?.querySelector(
			'button[aria-label="Playback speed"]',
		) as HTMLButtonElement;
		expect(speedTrigger).not.toBeNull();
		expect(speedTrigger.textContent).toBe("1x");
		expect(speedTrigger.getAttribute("aria-expanded")).toBe("false");

		fireClick(speedTrigger);
		expect(speedTrigger.getAttribute("aria-expanded")).toBe("true");
		const speedMenu = document.body.querySelector('.speed-menu[role="menu"]') as HTMLElement | null;
		expect(speedMenu).not.toBeNull();
		expect(
			Array.from(speedMenu?.querySelectorAll("button") ?? []).map((b) => b.textContent),
		).toEqual(["0.5x", "1x", "1.25x", "1.5x", "1.75x", "2x"]);
		fireClick(getButton(speedMenu as ParentNode, "1.25x"));
		expect(onRailChangeSpeed).toHaveBeenCalledWith(1.25);
		expect(document.body.querySelector(".speed-menu") === null).toBe(true);

		fireClick(speedTrigger);
		const speedMenu2 = document.body.querySelector('.speed-menu[role="menu"]') as ParentNode;
		fireClick(getButton(speedMenu2, "1.75x"));
		expect(onRailChangeSpeed).toHaveBeenCalledWith(1.75);
		expect(document.body.querySelector(".speed-menu") === null).toBe(true);

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

	it("validates, deduplicates, and formats stored favorites", () => {
		localStorage.clear();
		expect(readStoredFavorites()).toEqual([]);

		localStorage.setItem(FAVORITES_STORAGE_KEY, "not-json");
		expect(readStoredFavorites()).toEqual([]);

		localStorage.setItem(
			FAVORITES_STORAGE_KEY,
			JSON.stringify([
				{ bookNumber: 999, chapter: 1 },
				{ bookNumber: 2, chapter: 99 },
				{ bookNumber: 2, chapter: 2, createdAt: 10 },
				{ bookNumber: 2, chapter: 2, createdAt: 20 },
				{ bookNumber: 43, chapter: 3, verse: 16, enText: "For God so loved the world" },
			]),
		);

		const loaded = readStoredFavorites();
		expect(loaded).toHaveLength(2);
		expect(formatFavoriteLabel(loaded[0])).toEqual({
			refEn: "Exodus 2",
			refKo: "출애굽기 2장",
			kind: "chapter",
		});
		expect(formatFavoriteLabel(loaded[1])).toEqual({
			refEn: "John 3:16",
			refKo: "요한복음 3장 16절",
			kind: "verse",
		});

		const toggledOff = toggleFavoriteItem(loaded, { bookNumber: 2, chapter: 2 });
		expect(toggledOff).toHaveLength(1);
		expect(toggledOff[0]?.id).toBe("43:3:16");

		const toggledOn = toggleFavoriteItem(toggledOff, {
			bookNumber: 19,
			chapter: 23,
			verse: 1,
			enText: "The LORD is my shepherd; I shall not want.",
		});
		expect(toggledOn).toHaveLength(2);
		expect(toggledOn[0]?.id).toBe("19:23:1");
		expect(toggledOn[0]?.enText).toBe("The LORD is my shepherd; I shall not want.");
	});

	it("validates, merges, splits, and formats stored text highlights", () => {
		localStorage.clear();
		expect(readStoredHighlights()).toEqual([]);

		localStorage.setItem(HIGHLIGHTS_STORAGE_KEY, "bad-json");
		expect(readStoredHighlights()).toEqual([]);

		localStorage.setItem(
			HIGHLIGHTS_STORAGE_KEY,
			JSON.stringify([
				{ bookNumber: 999, chapter: 1, verse: 1, lang: "en", start: 0, end: 4, text: "Test" },
				{ bookNumber: 1, chapter: 1, verse: 1, lang: "fr", start: 0, end: 4, text: "Test" },
				{ bookNumber: 1, chapter: 1, verse: 1, lang: "en", start: 5, end: 3, text: "Bad" },
				{
					bookNumber: 1,
					chapter: 1,
					verse: 1,
					lang: "en",
					start: 0,
					end: 16,
					text: "In the beginning",
					createdAt: 10,
				},
			]),
		);

		const loaded = readStoredHighlights();
		expect(loaded).toHaveLength(1);
		expect(formatHighlightLabel(loaded[0])).toEqual({
			refEn: "Genesis 1:1",
			refKo: "창세기 1장 1절",
			langLabel: "EN",
		});

		const verseText = "In the beginning, God created the heavens and the earth.";
		const merged = toggleHighlightSpans(
			loaded,
			1,
			1,
			[{ verse: 1, lang: "en", start: 10, end: 21, text: "inning, God" }],
			() => verseText,
		);
		expect(merged.action).toBe("added");
		expect(merged.next).toHaveLength(1);
		expect(merged.next[0]?.start).toBe(0);
		expect(merged.next[0]?.end).toBe(21);
		expect(merged.next[0]?.text).toBe("In the beginning, God");

		const split = toggleHighlightSpans(
			merged.next,
			1,
			1,
			[{ verse: 1, lang: "en", start: 7, end: 16, text: "beginning" }],
			() => verseText,
		);
		expect(split.action).toBe("removed");
		expect(split.next).toHaveLength(2);
		expect(split.next.map((h) => [h.start, h.end])).toEqual([
			[0, 7],
			[16, 21],
		]);

		const segments = splitTextByHighlights(verseText.slice(0, 21), 0, split.next);
		expect(segments).toEqual([
			{ text: "In the ", highlightId: split.next[0]?.id },
			{ text: "beginning" },
			{ text: ", God", highlightId: split.next[1]?.id },
		]);
	});

	it("supports clearing all bookmarks, all highlights, or both", async () => {
		const sampleFav = {
			id: "1:2:2",
			bookNumber: 1,
			chapter: 2,
			verse: 2,
			enText: "And on the seventh day...",
			createdAt: 100,
		};
		const sampleHighlight = {
			id: "hl:1:2:1:en:18:36",
			bookNumber: 1,
			chapter: 2,
			verse: 1,
			lang: "en" as const,
			start: 18,
			end: 36,
			text: "heavens and the earth",
			createdAt: 200,
		};

		const onClearFavorites = mock(() => {});
		const onClearHighlights = mock(() => {});
		const list = render(
			<FavoritesList
				favorites={[sampleFav]}
				highlights={[sampleHighlight]}
				onSelectFavorite={noop}
				onClearFavorites={onClearFavorites}
				onClearHighlights={onClearHighlights}
			/>,
		);

		fireClick(getButton(list.container, "Clear all bookmarks and highlights"));
		expect(onClearFavorites).toHaveBeenCalledTimes(1);
		expect(onClearHighlights).toHaveBeenCalledTimes(1);

		fireClick(getButton(list.container, "Clear bookmarks"));
		expect(onClearFavorites).toHaveBeenCalledTimes(2);
		expect(onClearHighlights).toHaveBeenCalledTimes(1);

		fireClick(getButton(list.container, "Clear highlights"));
		expect(onClearFavorites).toHaveBeenCalledTimes(2);
		expect(onClearHighlights).toHaveBeenCalledTimes(2);

		// When only one group exists, Clear all is omitted and only that group's clear action renders
		list.rerender(
			<FavoritesList
				favorites={[sampleFav]}
				highlights={[]}
				onSelectFavorite={noop}
				onClearFavorites={onClearFavorites}
				onClearHighlights={onClearHighlights}
			/>,
		);
		expect(list.container.querySelector(".home-clear-all-btn")).toBeNull();
		expect(list.container.querySelector('[aria-label="Clear all highlights"]')).toBeNull();
		expect(getButton(list.container, "Clear bookmarks")).toBeDefined();

		list.rerender(
			<FavoritesList
				favorites={[]}
				highlights={[sampleHighlight]}
				onSelectFavorite={noop}
				onClearFavorites={onClearFavorites}
				onClearHighlights={onClearHighlights}
			/>,
		);
		expect(list.container.querySelector(".home-clear-all-btn")).toBeNull();
		expect(list.container.querySelector('[aria-label="Clear all bookmarks"]')).toBeNull();
		expect(getButton(list.container, "Clear highlights")).toBeDefined();

		// End-to-end HomePage + TopBar wiring clears state and localStorage
		localStorage.clear();
		window.location.hash = "";
		localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([sampleFav]));
		localStorage.setItem(HIGHLIGHTS_STORAGE_KEY, JSON.stringify([sampleHighlight]));
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			Response.json({
				english: CANONICAL_BIBLES.en,
				korean: CANONICAL_BIBLES.ko,
				bibleBrainEnabled: false,
				esvAudioEnabled: false,
			})) as unknown as typeof fetch;
		try {
			const app = render(<App />);
			await act(async () => {
				await Promise.resolve();
				await Promise.resolve();
			});
			// Clear highlights via TopBar dropdown first, keeping bookmark intact
			fireClick(getButton(app.container.querySelector(".top-nav") as ParentNode, /Favorites/));
			const popover = app.container.querySelector(".top-favorites-popover") as ParentNode;
			fireClick(getButton(popover, "Clear highlights"));
			expect(readStoredHighlights()).toEqual([]);
			expect(readStoredFavorites()).toHaveLength(1);

			// Then clear remaining bookmark via HomePage Favorites section
			const appFavSection = app.container.querySelector(
				'section[aria-label="Favorites"]',
			) as ParentNode;
			fireClick(getButton(appFavSection, "Favorites"));
			expect(getByText(appFavSection, /Bookmarks \(1\)/)).toBeDefined();
			fireClick(getButton(appFavSection, "Clear bookmarks"));
			expect(appFavSection.textContent).toContain("No favorites yet.");
			expect(readStoredFavorites()).toEqual([]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
