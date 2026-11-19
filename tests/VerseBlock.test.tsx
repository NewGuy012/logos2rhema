import { describe, expect, it, mock } from "bun:test";

import { act, type ComponentProps } from "react";

import App from "../src/react-app/App";
import { AudioControlRail } from "../src/react-app/components/AudioControlRail";
import { FavoritesList } from "../src/react-app/components/FavoritesList";
import { FloatingBottomBar } from "../src/react-app/components/FloatingBottomBar";
import { HomePage } from "../src/react-app/components/HomePage";
import { PassagePicker } from "../src/react-app/components/PassagePicker";
import { StudyRightRail } from "../src/react-app/components/StudyRightRail";
import { TopBar } from "../src/react-app/components/TopBar";
import { VerseBlock } from "../src/react-app/components/VerseBlock";
import {
	resolveTimeForVerse,
	resolveVerseAtTime,
	useHumanAudio,
} from "../src/react-app/hooks/useHumanAudio";
import { clearLoaderCaches, loadSyncedChapterAudio } from "../src/react-app/lib/bible-loader";
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
import { SUPERTONIC_TRACK_ID } from "../src/shared/audio-timings";
import { analyzeKoreanChapter } from "../src/shared/korean-morphology";
import {
	fireClick,
	fireDrag,
	fireHover,
	flushAsync,
	getButton,
	getByText,
	installMockAudio,
	mockMatchMedia,
	noop,
	render,
	renderHook,
	setInputValue,
	submitForm,
	waitUntil,
	withMockFetch,
} from "./setup";

function setupMockKoreanSpeech() {
	const spoken: Array<{ text: string; lang: string; rate: number; voice?: unknown }> = [];
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
				spoken.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice });
				u.onstart?.();
				u.onend?.();
			},
		},
	});

	return {
		spoken,
		cancelMock,
		koVoice,
		restore: () => {
			if (origSpeechSynth) Object.defineProperty(window, "speechSynthesis", origSpeechSynth);
			else delete (window as { speechSynthesis?: unknown }).speechSynthesis;
			if (origUtterance) Object.defineProperty(window, "SpeechSynthesisUtterance", origUtterance);
			else delete (window as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
		},
	};
}

function selectTextRange(node: Node, start: number, end: number) {
	const range = document.createRange();
	range.setStart(node, start);
	range.setEnd(node, end);
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
	return sel;
}

function makeBookResponse(
	translationId: string,
	bookNumber: number,
	usfm: string,
	chapters: Record<string, Array<{ verse: number; text: string }>>,
) {
	return Response.json({ translationId, bookNumber, usfm, chapters });
}

function baseBarProps() {
	return {
		bookEn: "Genesis",
		bookKo: "창세기",
		chapter: 1,
		hasPrev: false,
		hasNext: true,
		tracks: [],
		preferredLang: "ko" as const,
		activeTrack: null,
		isPlaying: false,
		isLoading: false,
		currentTime: 0,
		duration: 120,
		playbackRate: 1,
		errorMessage: null,
		onPrevChapter: noop,
		onNextChapter: noop,
		onOpenPicker: noop,
		onTogglePlay: noop,
		onSeek: noop,
		onSkipBy: noop,
		onSelectLanguage: noop,
		onChangeSpeed: noop,
	};
}

function makeTopBarProps(
	overrides: Partial<ComponentProps<typeof TopBar>> = {},
): ComponentProps<typeof TopBar> {
	return {
		lastBookNumber: 8,
		lastChapter: 4,
		lastVerse: 12,
		stackOrder: "en-first",
		theme: "paper",
		fontScale: 1,
		enFontStyle: "newsreader",
		koFontStyle: "serif",
		studyMask: "none",
		onGoHome: noop,
		onContinueReading: noop,
		onOpenPassage: noop,
		onChangeStackOrder: noop,
		onOpenSearch: noop,
		onChangeTheme: noop,
		onChangeFontScale: noop,
		onChangeEnFontStyle: noop,
		onChangeKoFontStyle: noop,
		onChangeStudyMask: noop,
		...overrides,
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

	function makeVerseProps(
		overrides: Partial<ComponentProps<typeof VerseBlock>> = {},
	): ComponentProps<typeof VerseBlock> {
		return {
			verse: sampleVerse,
			stackOrder: "en-first",
			studyMask: "none",
			isSelected: false,
			isAudioActive: false,
			isFavorited: false,
			hasVerseTimestamps: false,
			onSelectVerse: noop,
			onToggleFavorite: noop,
			onSelectFootnote: noop,
			...overrides,
		};
	}

	it("flips verse order, toggles verse bookmark, and handles Korean tooltip hover/click/speech", async () => {
		const onToggleFavorite = mock(() => {});
		const onSelectFootnote = mock(() => {});
		const verseProps = makeVerseProps({
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
			onToggleFavorite,
			onSelectFootnote,
		});

		const { container, rerender } = render(<VerseBlock {...verseProps} />);
		fireClick(getButton(container, "Bookmark verse 1"));
		expect(onToggleFavorite).toHaveBeenCalledTimes(1);

		rerender(<VerseBlock {...verseProps} stackOrder="ko-first" isFavorited={true} />);
		expect(getButton(container, "Remove verse 1 from favorites").getAttribute("aria-pressed")).toBe(
			"true",
		);
		expect(container.querySelectorAll(".verse-lines > p")[0]?.className).toContain("verse-ko");

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
		const { spoken, cancelMock, koVoice, restore } = setupMockKoreanSpeech();

		try {
			fireHover(wordBtn, true);
			const tooltip = document.body.querySelector('[role="tooltip"]') as HTMLElement | null;
			expect(tooltip?.textContent).toContain("to create");
			expect(tooltip?.textContent).toContain("[chang-jo-ha-si-ni-ra]");
			expect(tooltip?.textContent).toContain("Root: 창조하다");
			expect(tooltip?.textContent).toContain("Click to view in dictionary");

			fireHover(wordBtn, false);
			fireHover(tooltip as HTMLElement, true);
			fireClick(getButton(tooltip as ParentNode, "Pronounce 창조하시니라"));
			fireClick(getButton(tooltip as ParentNode, "Pronounce root 창조하다"));
			expect(cancelMock).toHaveBeenCalledTimes(2);
			expect(spoken).toEqual([
				{ text: "창조하시니라", lang: "ko-KR", rate: 0.92, voice: koVoice },
				{ text: "창조하다", lang: "ko-KR", rate: 0.92, voice: koVoice },
			]);

			fireHover(tooltip as HTMLElement, false);
			await waitUntil(() => {
				expect(document.body.querySelector('[role="tooltip"]') === null).toBe(true);
			});

			fireClick(wordBtn);
			expect(onSelectFootnote).toHaveBeenCalledTimes(1);
			expect(onSelectFootnote).toHaveBeenCalledWith("vocab-창조하다");
		} finally {
			restore();
		}

		const unknownBtn = getButton(container, "낯선말");
		unknownBtn.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
		unknownBtn.dispatchEvent(new window.FocusEvent("focus", { bubbles: false }));
		fireClick(unknownBtn);
		expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(
			"see aligned English verse",
		);
		act(() => {
			document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		});
		expect(document.body.querySelector('[role="tooltip"]') === null).toBe(true);
	});

	it("selects verse when clicking container or whitespace while ignoring buttons, tooltips, and text selections", () => {
		const onSelectVerse = mock((_verseNum: number) => {});
		const onToggleFavorite = mock(() => {});
		const verseWithHeading = {
			...sampleVerse,
			heading: "The Creation of the World",
		};
		const { container } = render(
			<div>
				<VerseBlock
					{...makeVerseProps({
						verse: verseWithHeading,
						onSelectVerse,
						onToggleFavorite,
					})}
				/>
				<VerseBlock
					{...makeVerseProps({
						verse: { ...sampleVerse, verse: 2 },
						onSelectVerse,
						onToggleFavorite,
					})}
				/>
			</div>,
		);

		const verse1 = container.querySelector("#verse-1") as HTMLElement;
		const verse2 = container.querySelector("#verse-2") as HTMLElement;

		// Clicking verse number button triggers onSelectVerse once (no double-fire from container)
		fireClick(getButton(verse1, "Verse 1"));
		expect(onSelectVerse).toHaveBeenCalledTimes(1);
		expect(onSelectVerse).toHaveBeenLastCalledWith(1);

		// Clicking container whitespace, gutter, lines wrapper, English line, Korean line whitespace, and heading selects verse
		const clickableAreas = [
			verse1,
			verse1.querySelector(".verse-gutter"),
			verse1.querySelector(".verse-lines"),
			verse1.querySelector(".verse-en"),
			verse1.querySelector(".verse-ko"),
			verse1.querySelector(".verse-heading"),
		];
		for (const el of clickableAreas) {
			expect(el).not.toBeNull();
			fireClick(el as Element);
		}
		expect(onSelectVerse).toHaveBeenCalledTimes(1 + clickableAreas.length);

		// Clicking bookmark button or Korean word button or open portaled tooltip must NOT select verse
		const callsBeforeIgnored = onSelectVerse.mock.calls.length;
		fireClick(getButton(verse1, "Bookmark verse 1"));
		expect(onToggleFavorite).toHaveBeenCalledTimes(1);

		const koBtn = getButton(verse1, "창조하시니라");
		fireClick(koBtn);
		fireHover(koBtn, true);
		const tooltipGloss = document.body.querySelector(
			'[role="tooltip"] .ko-tooltip-gloss',
		) as HTMLElement;
		expect(tooltipGloss).not.toBeNull();
		fireClick(tooltipGloss);
		expect(onSelectVerse).toHaveBeenCalledTimes(callsBeforeIgnored);
		fireHover(koBtn, false);

		// Drag-selecting text in verse 1 suppresses verse selection click on verse 1,
		// while a selection in verse 1 does not block clicking verse 2
		const enLine = verse1.querySelector(".verse-en") as HTMLElement;
		const sel = selectTextRange(enLine.firstChild as Text, 7, 16);
		try {
			fireClick(enLine);
			expect(onSelectVerse).toHaveBeenCalledTimes(callsBeforeIgnored);

			fireClick(verse2.querySelector(".verse-en") as Element);
			expect(onSelectVerse).toHaveBeenCalledTimes(callsBeforeIgnored + 1);
			expect(onSelectVerse).toHaveBeenLastCalledWith(2);
		} finally {
			sel?.removeAllRanges();
		}
	});

	it("renders FootnotesGuide disclosures, pronunciation, search, and scroll highlight", () => {
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
			{
				id: "vocab-여호와",
				lemma: "여호와",
				surfaceForms: ["여호와", "여호와께"],
				verses: [4, 5, 7, 8, 10],
				gloss: "the LORD (Yahweh)",
				pos: "name" as const,
			},
		];

		const baseRailProps = {
			activeTab: "dictionary" as const,
			onChangeTab: noop,
			onMinimize,
			bookEn: "Genesis",
			bookKo: "창세기",
			chapter: 1,
			footnotes,
			grammarNotes: analysis.grammarNotes,
			commentarySource: "tyndale" as const,
			commentaryData: null,
			commentaryLoading: false,
			commentaryError: null,
			selectedVerse: null,
			onChangeCommentarySource: noop,
			onRetryCommentary: noop,
			onJumpToVerse: onJump,
		};

		const { container, rerender } = render(
			<StudyRightRail {...baseRailProps} highlightedFootnoteId={null} />,
		);

		expect(container.querySelector(".vocab-list")).toBeNull();
		expect(container.querySelector(".grammar-cards")).toBeNull();
		const wordsToggle = getButton(container, `Words (${footnotes.length})`);
		fireClick(wordsToggle);
		expect(getByText(container, "[chang-jo-ha-da]")).toBeDefined();
		expect(
			container.querySelector('[data-footnote-id="vocab-창조하다"] .vocab-pos')?.textContent,
		).toBe("verb");
		expect(
			container.querySelector('[data-footnote-id="vocab-여호와"] .vocab-pos')?.textContent,
		).toBe("name");

		const { spoken, restore } = setupMockKoreanSpeech();
		try {
			fireClick(getButton(container, "Pronounce 창조하다"));
			expect(spoken[0]?.text).toBe("창조하다");
			delete (window as { speechSynthesis?: unknown }).speechSynthesis;
			fireClick(getButton(container, "Pronounce 그"));
			expect(
				container.querySelector('[data-footnote-id="vocab-그"] .vocab-speech-note')?.textContent,
			).toBe("Korean voice unavailable in this browser.");
		} finally {
			restore();
		}

		fireClick(getButton(container, "v.1"));
		expect(onJump).toHaveBeenCalledWith(1);

		const multiRow = container.querySelector('[data-footnote-id="vocab-여호와"]') as ParentNode;
		expect(multiRow.querySelectorAll(".verse-ref-chip")).toHaveLength(1);
		const verseTrigger = getButton(multiRow, "여호와 verses: v.4 and 4 more");
		expect(verseTrigger.textContent).toContain("v.4+4");
		fireClick(verseTrigger);
		const verseMenu = document.body.querySelector(".verse-ref-menu") as ParentNode;
		expect(verseMenu).not.toBeNull();
		expect(verseMenu.querySelectorAll(".verse-ref-menu-item")).toHaveLength(5);
		fireClick(getButton(verseMenu, "v.8"));
		expect(onJump).toHaveBeenCalledWith(8);
		expect(document.body.querySelector(".verse-ref-menu")).toBeNull();

		fireClick(verseTrigger);
		expect(document.body.querySelector(".verse-ref-menu")).not.toBeNull();
		act(() => {
			document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		});
		expect(document.body.querySelector(".verse-ref-menu")).toBeNull();

		const grammarToggle = getButton(container, /Grammar/);
		fireClick(grammarToggle);
		const grammarCards = container.querySelector(".grammar-cards");
		const vocabList = container.querySelector(".vocab-list");
		expect(grammarCards).not.toBeNull();
		expect(container.querySelector(".dict-panel-scroll")?.className).toContain("both-open");
		expect(vocabList?.contains(wordsToggle)).toBe(false);
		expect(grammarCards?.contains(grammarToggle)).toBe(false);
		expect(wordsToggle.closest(".dict-disclosure")?.className).toContain("open");
		expect(grammarToggle.closest(".dict-disclosure")?.className).toContain("open");

		fireClick(wordsToggle);
		const dictSearch = container.querySelector("input[type='search']") as HTMLInputElement;
		setInputValue(dictSearch, "태초");
		expect(container.querySelector('[data-footnote-id="vocab-창조하다"]')).toBeNull();
		fireClick(wordsToggle);

		const scrolledIds: string[] = [];
		const origScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
		window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
			if (this.dataset.footnoteId) scrolledIds.push(this.dataset.footnoteId);
		};
		try {
			rerender(
				<StudyRightRail
					{...baseRailProps}
					highlightedFootnoteId="vocab-창조하다"
					highlightSeq={1}
				/>,
			);
			expect(dictSearch.value).toBe("");
			expect(scrolledIds.at(-1)).toBe("vocab-창조하다");
		} finally {
			window.HTMLElement.prototype.scrollIntoView = origScrollIntoView;
		}

		fireClick(getButton(container, "Minimize dictionary"));
		expect(onMinimize).toHaveBeenCalledTimes(1);
	});

	it("renders TopBar, HomePage, and PassagePicker navigation flows", () => {
		const onGoHome = mock(() => {});
		const onContinue = mock(() => {});
		const onTopOpen = mock(() => {});
		const onFlip = mock(() => {});
		const onChangeEnFont = mock(() => {});
		const onOpenSearch = mock(() => {});
		const sharedTopBarProps = makeTopBarProps({
			favorites: [
				{
					id: "43:3:16",
					bookNumber: 43,
					chapter: 3,
					verse: 16,
					enText: "For God so loved the world...",
					createdAt: 100,
				},
			],
			onGoHome,
			onContinueReading: onContinue,
			onOpenPassage: onTopOpen,
			onChangeStackOrder: onFlip,
			onOpenSearch,
			onChangeEnFontStyle: onChangeEnFont,
		});
		const topBar = render(<TopBar {...sharedTopBarProps} />);
		fireClick(topBar.container.querySelector('a[aria-label="Logos2Rhema Home"]') as Element);
		const readButton = getButton(topBar.container.querySelector(".top-nav") as ParentNode, "Read");
		expect(readButton.getAttribute("title")).toBe("Read Ruth 4:12");
		fireClick(readButton);
		fireClick(getButton(topBar.container, "Go to"));
		expect(onGoHome).toHaveBeenCalledTimes(1);
		expect(onContinue).toHaveBeenCalledTimes(1);
		expect(onOpenSearch).toHaveBeenCalledTimes(1);

		fireClick(getButton(topBar.container, "Reader appearance settings"));
		const settingsPopover = topBar.container.querySelector(".settings-popover") as ParentNode;
		expect(settingsPopover).not.toBeNull();
		expect(getButton(settingsPopover, "Newsreader").className).toContain("active");
		fireClick(getButton(settingsPopover, "Newsreader"));
		expect(onChangeEnFont).not.toHaveBeenCalled();
		fireClick(getButton(settingsPopover, "Lora"));
		expect(onChangeEnFont).toHaveBeenCalledWith("lora");
		fireClick(getButton(settingsPopover, "한 / EN"));
		expect(onFlip).toHaveBeenCalledWith("ko-first");

		fireClick(getButton(topBar.container, /Favorites/));
		fireClick(
			getButton(
				topBar.container.querySelector(".top-favorites-popover") as ParentNode,
				/John 3:16/,
			),
		);
		expect(onTopOpen).toHaveBeenCalledWith(43, 3, 16);
		expect(() =>
			getButton(topBar.container.querySelector(".top-nav") as ParentNode, "Genres"),
		).toThrow();

		fireClick(getButton(topBar.container, "Reader appearance settings"));
		expect(topBar.container.querySelector(".settings-popover")).not.toBeNull();
		topBar.rerender(<TopBar isHome={true} {...sharedTopBarProps} />);
		expect(topBar.container.querySelectorAll(".appearance-btn")).toHaveLength(0);
		expect(topBar.container.querySelector(".settings-popover")).toBeNull();
		topBar.rerender(<TopBar isHome={false} {...sharedTopBarProps} />);
		expect(topBar.container.querySelectorAll(".appearance-btn")).toHaveLength(1);
		expect(topBar.container.querySelector(".settings-popover")).toBeNull();

		const onOpenPassage = mock(() => {});
		const home = render(
			<HomePage lastBookNumber={8} lastChapter={4} lastVerse={12} onOpenPassage={onOpenPassage} />,
		);
		expect(getByText(home.container, "Audio Available")).toBeDefined();
		const continueSection = home.container.querySelector(".home-continue-section") as ParentNode;
		expect(getByText(continueSection, "Continue Where You Left Off")).toBeDefined();
		expect(getByText(continueSection, "Ruth 4:12")).toBeDefined();
		fireClick(getButton(continueSection, "Read"));
		expect(onOpenPassage).toHaveBeenCalledWith(8, 4, 12);

		expect(home.container.querySelector('section[aria-label="Bible Genres"]')).toBeNull();
		const browseSection = home.container.querySelector(
			'section[aria-label="Browse"]',
		) as ParentNode;
		expect(browseSection.querySelector(".home-section-title")?.textContent).toBe("Browse");
		expect(browseSection.querySelector(".home-testaments")).not.toBeNull();
		const bookGrids = browseSection.querySelectorAll<HTMLElement>(".books-grid-vertical");
		expect(bookGrids).toHaveLength(2);
		expect(bookGrids[0]?.style.getPropertyValue("--book-cols")).toBe("3");
		expect(bookGrids[0]?.style.getPropertyValue("--book-rows")).toBe("13");
		expect(bookGrids[1]?.style.getPropertyValue("--book-cols")).toBe("3");
		expect(bookGrids[1]?.style.getPropertyValue("--book-rows")).toBe("9");

		const restoreNarrow = mockMatchMedia(false);
		try {
			const narrowHome = render(
				<HomePage lastBookNumber={8} lastChapter={4} lastVerse={12} onOpenPassage={noop} />,
			);
			const narrowGrids =
				narrowHome.container.querySelectorAll<HTMLElement>(".books-grid-vertical");
			expect(narrowGrids[0]?.style.getPropertyValue("--book-cols")).toBe("2");
			expect(narrowGrids[0]?.style.getPropertyValue("--book-rows")).toBe("20");
			expect(narrowGrids[1]?.style.getPropertyValue("--book-cols")).toBe("2");
			expect(narrowGrids[1]?.style.getPropertyValue("--book-rows")).toBe("14");
		} finally {
			restoreNarrow();
		}
		expect(getButton(browseSection, "Scripture").getAttribute("aria-selected")).toBe("true");
		expect(getButton(browseSection, "Genres").getAttribute("aria-selected")).toBe("false");

		fireClick(getButton(browseSection, "Genres"));
		expect(browseSection.querySelector(".home-section-title")?.textContent).toBe("Browse");
		expect(getButton(browseSection, "Genres").getAttribute("aria-selected")).toBe("true");
		expect(browseSection.querySelector(".home-testaments")).toBeNull();
		expect(browseSection.querySelectorAll(".home-genre-card")).toHaveLength(10);

		const homeInput = home.container.querySelector("input[type='search']") as HTMLInputElement;
		setInputValue(homeInput, "Psalms");
		expect(browseSection.querySelectorAll(".home-genre-card")).toHaveLength(1);
		setInputValue(homeInput, "");
		expect(browseSection.querySelectorAll(".home-genre-card")).toHaveLength(10);

		fireClick(getButton(browseSection, "Scripture"));
		expect(browseSection.querySelector(".home-testaments")).not.toBeNull();
		fireClick(getButton(browseSection, "Genres"));

		fireClick(getButton(browseSection, /Psalms/));
		expect(browseSection.querySelector(".home-section-title")?.textContent).toBe("Psalms · 시편");
		fireClick(getButton(browseSection, "All Books"));
		expect(browseSection.querySelector(".home-section-title")?.textContent).toBe("Browse");
		expect(browseSection.querySelectorAll(".home-genre-card")).toHaveLength(10);

		fireClick(getButton(browseSection, /Obadiah/));
		expect(onOpenPassage).toHaveBeenCalledWith(31, 1);

		fireClick(getButton(browseSection, /Psalms/));
		fireClick(getButton(browseSection, "23"));
		expect(onOpenPassage).toHaveBeenCalledWith(19, 23);

		setInputValue(homeInput, "시 23");
		submitForm(homeInput.closest("form") as HTMLFormElement);
		expect(onOpenPassage).toHaveBeenCalledWith(19, 23, undefined);

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
		setInputValue(pickerInput, "요 3:16");
		submitForm(pickerInput.closest("form") as HTMLFormElement);
		expect(onNavigate).toHaveBeenCalledWith(43, 3, 16);
		expect(onClosePicker).toHaveBeenCalledTimes(1);
	});

	it("opens App reader, syncs dictionary/rails/bookmarks/highlights, and handles out-of-range verses", async () => {
		window.location.hash = "";
		localStorage.clear();
		localStorage.setItem("logos.reader.preferences.v1", JSON.stringify({ enFontStyle: "invalid" }));
		clearLoaderCaches();
		const restoreMatchMedia = mockMatchMedia(true);

		let audioLoadCount = 0;
		const commentaryFetchUrls: string[] = [];

		try {
			await withMockFetch(
				(url) => {
					if (url.includes("/data/lexicon.json")) return Response.json({});
					if (url.includes("/data/bibles/krv/")) {
						return makeBookResponse("krv", 1, "GEN", {
							"1": [
								{ verse: 1, text: "보아스가 성문에 올라가서 거기 앉았더니" },
								{ verse: 2, text: "장로 십 인을 청하여 가로되" },
							],
							"2": [{ verse: 1, text: "천지와 만물이 다 이루니라" }],
						});
					}
					if (url.includes("/data/bibles/")) {
						return makeBookResponse("esv", 1, "GEN", {
							"1": [
								{ verse: 1, text: "In the beginning..." },
								{ verse: 2, text: "The earth was without form..." },
							],
							"2": [{ verse: 1, text: "Thus the heavens and the earth were finished..." }],
						});
					}
					if (url.includes("/api/audio/")) {
						audioLoadCount++;
						return Response.json({ tracks: [] });
					}
					if (url.includes("/api/commentary/")) {
						commentaryFetchUrls.push(url);
						const isMh = url.includes("/matthew-henry/");
						return Response.json({
							entries: [
								{
									id: `${isMh ? "matthew-henry" : "tyndale"}:GEN:1:1`,
									verseStart: 1,
									paragraphs: [isMh ? "Matthew Henry GEN 1 note." : "Tyndale GEN 1 note."],
								},
							],
						});
					}
					return new Response("Not Found", { status: 404 });
				},
				async () => {
					const { container } = render(<App />);
					await flushAsync();
					expect(getByText(container, "Audio Available")).toBeDefined();
					expect(getByText(container, "Continue Where You Left Off")).toBeDefined();
					expect(container.querySelectorAll(".appearance-btn")).toHaveLength(0);

					fireClick(
						getButton(container.querySelector(".home-continue-section") as ParentNode, "Read"),
					);
					await flushAsync();
					await waitUntil(() => {
						expect(audioLoadCount).toBeGreaterThanOrEqual(1);
						expect(window.location.hash).toBe("#/GEN/1");
						expect(getByText(container, "In the beginning...")).toBeDefined();
					});
					await flushAsync();
					expect(container.querySelectorAll(".appearance-btn")).toHaveLength(1);

					expect(commentaryFetchUrls).toEqual([]);
					fireClick(getButton(container, "올라가서"));
					expect(
						container.querySelector('[data-footnote-id="vocab-올라가다"]')?.className,
					).toContain("highlighted");

					fireClick(getButton(container, "Commentary"));
					await waitUntil(() => {
						expect(getByText(container, "Tyndale GEN 1 note.")).toBeDefined();
					});
					expect(commentaryFetchUrls).toEqual(["/api/commentary/tyndale/GEN/1"]);

					fireClick(getButton(container, "Matthew Henry"));
					await waitUntil(() => {
						expect(getByText(container, "Matthew Henry GEN 1 note.")).toBeDefined();
					});
					expect(commentaryFetchUrls).toEqual([
						"/api/commentary/tyndale/GEN/1",
						"/api/commentary/matthew-henry/GEN/1",
					]);

					fireClick(getButton(container, "올라가서"));
					expect(container.querySelector("#footnotes .panel-title")?.textContent).toBe(
						"Dictionary",
					);
					expect(
						container.querySelector('[data-footnote-id="vocab-올라가다"]')?.className,
					).toContain("highlighted");

					fireClick(getButton(container, "Commentary"));
					expect(container.querySelector("#footnotes .panel-title")?.textContent).toBe(
						"Commentary",
					);
					expect(getByText(container, "Matthew Henry GEN 1 note.")).toBeDefined();
					expect(commentaryFetchUrls).toHaveLength(2);
					expect(localStorage.getItem("logos.reader.preferences.v1")).toContain("matthew-henry");
					fireClick(getButton(container, "Dictionary"));

					const appShell = container.querySelector(".app-shell") as HTMLElement;
					expect(appShell.style.getPropertyValue("--reader-en-font")).toBe("var(--font-en)");
					fireClick(getButton(container, "Reader appearance settings"));
					const settingsPopover = container.querySelector(".settings-popover") as ParentNode;
					fireClick(getButton(settingsPopover, "Lora"));
					expect(appShell.style.getPropertyValue("--reader-en-font")).toBe("var(--font-en-lora)");
					expect(localStorage.getItem("logos.reader.preferences.v1")).toContain(
						'"enFontStyle":"lora"',
					);
					fireClick(getButton(settingsPopover, "Inter"));
					expect(appShell.style.getPropertyValue("--reader-en-font")).toBe("var(--font-ui)");
					expect(localStorage.getItem("logos.reader.preferences.v1")).toContain(
						'"enFontStyle":"inter"',
					);
					fireClick(getButton(container, "Reader appearance settings"));

					fireClick(getButton(container, "Minimize dictionary"));
					expect(container.querySelector(".dict-sidebar-wrap")?.className).toContain("minimized");
					fireClick(getButton(container, "Expand dictionary"));
					expect(container.querySelector(".dict-sidebar-wrap")?.className).toContain("expanded");

					fireClick(getButton(container, "Minimize audio"));
					expect(container.querySelector(".audio-rail-wrap")?.className).toContain("minimized");
					fireClick(getButton(container, "Expand audio"));
					expect(container.querySelector(".audio-rail-wrap")?.className).toContain("expanded");

					const audioPanel = container.querySelector(".audio-rail") as HTMLElement;
					const audioHeader = audioPanel.querySelector(".rail-panel-header") as HTMLElement;
					const dictPanel = container.querySelector("#footnotes") as HTMLElement;
					const dictHeader = dictPanel.querySelector(".dict-panel-header") as HTMLElement;

					fireDrag(audioHeader, [20, 20], [200, 140]);
					expect(audioPanel.className).toContain("floating");
					expect(container.querySelector(".audio-rail-wrap")?.className).toContain(
						"is-floating-host",
					);
					expect(audioPanel.style.zIndex).toBe("46");

					fireDrag(dictHeader, [20, 20], [320, 180]);
					expect(dictPanel.className).toContain("floating");
					expect(container.querySelector(".dict-sidebar-wrap")?.className).toContain(
						"is-floating-host",
					);
					expect(dictPanel.style.zIndex).toBe("46");
					expect(audioPanel.style.zIndex).toBe("45");

					act(() => {
						getButton(audioPanel, "Play audio").dispatchEvent(
							new window.MouseEvent("mousedown", { bubbles: true, button: 0 }),
						);
					});
					expect(audioPanel.style.zIndex).toBe("46");
					expect(dictPanel.style.zIndex).toBe("45");

					fireClick(getButton(container, "Snap audio back to original position"));
					expect(audioPanel.className).not.toContain("floating");
					expect(container.querySelector(".audio-rail-wrap")?.className).not.toContain(
						"is-floating-host",
					);
					fireClick(getButton(container, "Snap dictionary back to original position"));
					expect(dictPanel.className).not.toContain("floating");
					expect(container.querySelector(".dict-sidebar-wrap")?.className).not.toContain(
						"is-floating-host",
					);

					const headerNav = container.querySelector(
						".chapter-header .chapter-nav-header",
					) as ParentNode;
					fireClick(getButton(headerNav, "Next Chapter"));
					await flushAsync();
					await waitUntil(() => {
						expect(window.location.hash).toBe("#/GEN/2");
						expect(
							getByText(container, "Thus the heavens and the earth were finished..."),
						).toBeDefined();
					});
					await flushAsync();
					fireClick(getButton(headerNav, "Previous Chapter"));
					await flushAsync();
					await waitUntil(() => {
						expect(window.location.hash).toBe("#/GEN/1");
						expect(getByText(container, "In the beginning...")).toBeDefined();
					});
					await flushAsync();

					fireClick(getButton(container, "Bookmark Genesis 1"));
					fireClick(getButton(container, "Bookmark verse 1"));
					expect(readStoredFavorites()).toHaveLength(2);

					const verse2 = container.querySelector("#verse-2") as HTMLElement;
					expect(verse2.className).not.toContain("selected");
					fireClick(verse2.querySelector(".verse-en") as Element);
					expect(verse2.className).toContain("selected");
					fireClick(verse2.querySelector(".verse-lines") as Element);
					expect(verse2.className).not.toContain("selected");

					const enLine = container.querySelector('.verse-en[data-verse="1"]') as HTMLElement;
					const sel = selectTextRange(enLine.firstChild as Text, 7, 16);
					act(() => {
						document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
						window.dispatchEvent(
							new window.KeyboardEvent("keydown", { key: "h", metaKey: true, bubbles: true }),
						);
					});
					expect(enLine.querySelector("mark.verse-highlight")?.textContent).toBe("beginning");

					const koLine = container.querySelector('.verse-ko[data-verse="1"]') as HTMLElement;
					const koFirstText = koLine.querySelector("button")?.firstChild as Text;
					selectTextRange(koFirstText, 0, koFirstText.length);
					act(() => {
						document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
					});
					fireClick(
						getButton(
							container.querySelector(".selection-highlight-bar") as ParentNode,
							"Highlight",
						),
					);
					expect(koLine.querySelector("mark.verse-highlight")?.textContent).toBe("보아스가");

					fireClick(getButton(container.querySelector(".top-nav") as ParentNode, /Favorites/));
					fireClick(
						getButton(
							container.querySelector(".top-favorites-popover") as ParentNode,
							"Clear highlights",
						),
					);
					expect(readStoredHighlights()).toEqual([]);
					sel?.removeAllRanges();

					act(() => {
						window.location.hash = "#/GEN/2/999";
						window.dispatchEvent(new window.Event("hashchange"));
					});
					await flushAsync();
					await waitUntil(() => {
						expect(
							getByText(container, "Thus the heavens and the earth were finished..."),
						).toBeDefined();
					});
					await flushAsync();
				},
			);
		} finally {
			restoreMatchMedia();
		}
	});

	it("renders FloatingBottomBar, AudioControlRail, and validates useHumanAudio URLs", async () => {
		const onSelectLanguage = mock(() => {});
		const onSkipBy = mock((_delta: number) => {});
		const koTrack = {
			id: SUPERTONIC_TRACK_ID,
			label: "개역한글 · Daniel (AI)",
			language: "ko" as const,
			url: "https://cdn.example.com/krv/GEN/1.mp3",
		};

		const bar = render(
			<FloatingBottomBar
				{...baseBarProps()}
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
				rightRailTab="commentary"
				dictionaryOpen={false}
				onToggleDictionary={noop}
				onSelectLanguage={onSelectLanguage}
			/>,
		);
		expect(getButton(bar.container, "Toggle commentary").textContent).toContain("Notes");
		fireClick(getButton(bar.container, /Use 개역한글/));
		expect(onSelectLanguage).toHaveBeenCalledWith("ko");

		const enTrack = {
			id: "esv-api:GEN:1",
			label: "David Cochran Heath (ESV)",
			language: "en" as const,
			url: "https://audio.esv.org/hw/gen1.mp3",
		};
		bar.rerender(
			<FloatingBottomBar
				{...baseBarProps()}
				tracks={[enTrack]}
				preferredLang="ko"
				activeTrack={null}
				dictionaryOpen={false}
				onToggleDictionary={noop}
				onSelectLanguage={onSelectLanguage}
			/>,
		);
		fireClick(getButton(bar.container, /Use ESV/));
		expect(onSelectLanguage).toHaveBeenCalledWith("en");

		const supertonicTrack = {
			id: SUPERTONIC_TRACK_ID,
			label: "개역한글 · Daniel (AI)",
			language: "ko" as const,
			url: "https://cdn.example.com/JHN/3.mp3",
			verseTimings: { 1: 2.3, 12: 34.5, 16: 48.2 },
		};
		expect(resolveVerseAtTime(supertonicTrack.verseTimings, 1.5)).toBeNull();
		expect(resolveVerseAtTime(supertonicTrack.verseTimings, 2.1)).toBe(1);
		expect(resolveVerseAtTime(supertonicTrack.verseTimings, 48.5)).toBe(16);
		expect(resolveTimeForVerse(supertonicTrack.verseTimings, 17)).toBe(48.2);

		const onSyncToVisible = mock(() => {});
		const onChangeSpeed = mock((_rate: number) => {});
		const onFollowActive = mock(() => {});
		const rail = render(
			<AudioControlRail
				{...baseBarProps()}
				bookEn="John"
				bookKo="요한복음"
				chapter={3}
				tracks={[supertonicTrack]}
				preferredLang="ko"
				activeTrack={supertonicTrack}
				isPlaying={true}
				currentTime={35}
				visibleVerse={16}
				activeVerse={12}
				autoSync={true}
				isFollowingAudio={false}
				onChangeSpeed={onChangeSpeed}
				onToggleAutoSync={noop}
				onSyncToVisibleVerse={onSyncToVisible}
				onFollowActiveVerse={onFollowActive}
			/>,
		);
		// Follow recovery button is surfaced even with Settings collapsed
		fireClick(getButton(rail.container, "Follow Audio (v.12)"));
		expect(onFollowActive).toHaveBeenCalledTimes(1);

		const onMobileToggleSync = mock(() => {});
		const onMobileFollow = mock(() => {});
		const mobileSyncBar = render(
			<FloatingBottomBar
				{...baseBarProps()}
				tracks={[supertonicTrack]}
				preferredLang="ko"
				activeTrack={supertonicTrack}
				isPlaying={true}
				currentTime={35}
				activeVerse={12}
				autoSync={true}
				isFollowingAudio={true}
				dictionaryOpen={false}
				onToggleDictionary={noop}
				onToggleAutoSync={onMobileToggleSync}
				onFollowActiveVerse={onMobileFollow}
			/>,
		);
		fireClick(getButton(mobileSyncBar.container, "Sync"));
		expect(onMobileToggleSync).toHaveBeenCalledTimes(1);
		mobileSyncBar.rerender(
			<FloatingBottomBar
				{...baseBarProps()}
				tracks={[supertonicTrack]}
				preferredLang="ko"
				activeTrack={supertonicTrack}
				isPlaying={true}
				currentTime={35}
				activeVerse={12}
				autoSync={true}
				isFollowingAudio={false}
				dictionaryOpen={false}
				onToggleDictionary={noop}
				onToggleAutoSync={onMobileToggleSync}
				onFollowActiveVerse={onMobileFollow}
			/>,
		);
		fireClick(getButton(mobileSyncBar.container, "Follow v.12"));
		expect(onMobileFollow).toHaveBeenCalledTimes(1);

		fireClick(
			rail.container.querySelector('button[aria-label="Playback speed"]') as HTMLButtonElement,
		);
		fireClick(
			getButton(document.body.querySelector('.speed-menu[role="menu"]') as ParentNode, "1.25x"),
		);
		expect(onChangeSpeed).toHaveBeenCalledWith(1.25);

		const readSyncDetails = () =>
			Array.from(rail.container.querySelectorAll(".rail-sync-status .rail-kv-row")).map((row) => [
				row.querySelector("dt")?.textContent,
				row.querySelector("dd")?.textContent,
			]);
		const settingsBtn = getButton(rail.container, "Settings");
		expect(
			Array.from(rail.container.querySelectorAll(".panel-subtitle .panel-subtitle-line")).map(
				(el) => el.textContent,
			),
		).toEqual(["John 3", "요한복음 3장"]);
		expect(settingsBtn.querySelector(".rail-settings-label svg")).not.toBeNull();
		fireClick(settingsBtn);
		expect(readSyncDetails()).toEqual([
			["Reading", "v.16"],
			["Playing", "v.12"],
			["Play from", "v.16"],
		]);
		const playFromV16 = getButton(rail.container, "Play from v.16");
		expect(playFromV16.getAttribute("aria-pressed")).toBe("false");
		expect(playFromV16.className).not.toContain("active");
		fireClick(playFromV16);
		expect(onSyncToVisible).toHaveBeenCalledTimes(1);

		const pausedRailProps = {
			...baseBarProps(),
			bookEn: "John",
			bookKo: "요한복음",
			chapter: 3,
			tracks: [supertonicTrack],
			preferredLang: "ko" as const,
			activeTrack: supertonicTrack,
			autoSync: true,
			isFollowingAudio: true,
			onChangeSpeed,
			onToggleAutoSync: noop,
			onSyncToVisibleVerse: onSyncToVisible,
			onFollowActiveVerse: onFollowActive,
		};
		rail.rerender(
			<AudioControlRail
				{...pausedRailProps}
				isPlaying={false}
				currentTime={0}
				visibleVerse={1}
				activeVerse={null}
			/>,
		);
		expect(readSyncDetails()).toEqual([
			["Reading", "v.1"],
			["Play from", "v.1"],
		]);
		expect(getButton(rail.container, "Play from v.1").className).not.toContain("active");

		rail.rerender(
			<AudioControlRail
				{...pausedRailProps}
				isPlaying={true}
				currentTime={35}
				visibleVerse={12}
				activeVerse={12}
			/>,
		);
		expect(readSyncDetails()).toEqual([
			["Reading", "v.12"],
			["Playing", "v.12"],
			["Play from", "v.12"],
		]);
		const playFromV12 = getButton(rail.container, "Play from v.12");
		expect(playFromV12.getAttribute("aria-pressed")).toBe("true");
		expect(playFromV12.className).toContain("active");

		const audioAside = rail.container.querySelector(".audio-rail") as HTMLElement;
		fireDrag(rail.container.querySelector("input[type='range']") as Element, [20, 20], [160, 120]);
		expect(audioAside.className).not.toContain("floating");

		const audioHeader = rail.container.querySelector(".rail-panel-header") as HTMLElement;
		fireDrag(audioHeader, [40, 40], [280, 200]);
		expect(audioAside.className).toContain("floating");
		expect(audioAside.style.left).toBe("240px");
		expect(audioAside.style.top).toBe("160px");

		fireDrag(audioHeader, [280, 200], [180, 150]);
		expect(audioAside.style.left).toBe("140px");
		expect(audioAside.style.top).toBe("110px");

		fireClick(getButton(rail.container, "Snap audio back to original position"));
		expect(audioAside.className).not.toContain("floating");
		expect(audioAside.style.left).toBe("");

		const mockAudio = installMockAudio();
		try {
			const { result } = renderHook(() =>
				useHumanAudio({
					tracks: [
						{
							id: SUPERTONIC_TRACK_ID,
							label: "개역한글 · Daniel (AI)",
							language: "ko",
							url: "/api/audio/krv/JHN/3",
							verseTimings: { 1: 2.3, 16: 48.2 },
						},
					],
					visibleVerse: 16,
					autoSync: true,
				}),
			);
			expect(result.current.errorMessage).toBeNull();
			await act(async () => {
				result.current.togglePlay();
			});
			expect(mockAudio.getCurrentTime()).toBe(48.2);
			expect(result.current.activeVerse).toBe(16);

			for (const badUrl of [
				"javascript:alert(1)",
				"https://user:pass@cdn.example.com/krv.mp3",
				"https://localhost/krv.mp3",
				"/api/audio/../../secret",
			]) {
				const unsafeHook = renderHook(() =>
					useHumanAudio({
						tracks: [
							{
								id: "bad",
								label: "Bad",
								language: "ko",
								url: badUrl,
							},
						],
					}),
				);
				expect(unsafeHook.result.current.errorMessage).toBe("Audio stream URL was rejected.");
			}

			// Pre-metadata seek: queues target verse when readyState === 0 and seeks on loadedmetadata
			mockAudio.restore();
			const deferredAudio = installMockAudio({ readyState: 0 });
			try {
				const deferredHook = renderHook(() =>
					useHumanAudio({
						tracks: [
							{
								id: SUPERTONIC_TRACK_ID,
								label: "개역한글 · Daniel (AI)",
								language: "ko",
								url: "https://cdn.example.com/krv.mp3",
								verseTimings: { 1: 1.2, 16: 48.2 },
							},
						],
						visibleVerse: 16,
						autoSync: true,
					}),
				);
				await act(async () => {
					deferredHook.result.current.togglePlay();
				});
				expect(deferredAudio.getCurrentTime()).toBe(0);
				expect(deferredHook.result.current.activeVerse).toBe(16);
				await act(async () => {
					deferredAudio.emit("loadedmetadata");
				});
				expect(deferredAudio.getCurrentTime()).toBe(48.2);
				expect(deferredHook.result.current.activeVerse).toBe(16);
			} finally {
				deferredAudio.restore();
			}
		} finally {
			mockAudio.restore();
		}
	});

	it("hydrates static KRV timings, retries transient 5xx failures, and preserves ESV", async () => {
		clearLoaderCaches();
		let timingCalls = 0;
		try {
			await withMockFetch(
				(url) => {
					if (url === "/api/audio/JHN/3") {
						return Response.json({
							tracks: [
								{
									id: SUPERTONIC_TRACK_ID,
									label: "개역한글 · Daniel (AI)",
									language: "ko",
									url: "https://cdn.example.com/JHN/3.mp3",
								},
								{
									id: "esv-api:JHN:3",
									label: "David Cochran Heath (ESV)",
									language: "en",
									url: "https://audio.esv.org/hw/jhn3.mp3",
								},
							],
						});
					}
					if (url === "/data/timings/krv-supertonic/JHN.json") {
						timingCalls++;
						if (timingCalls === 1) {
							return new Response("Gateway Timeout", { status: 503 });
						}
						return Response.json({
							chapters: {
								"3": { "1": 2.345, "16": 51.789, bad: "x" },
							},
						});
					}
					return new Response("Not Found", { status: 404 });
				},
				async () => {
					// First load hits 503 on timings: audio track survives, and 503 is not poisoned in cache
					const first = await loadSyncedChapterAudio({ usfm: "JHN", chapter: 3 });
					expect(
						first.tracks.find((t) => t.id === SUPERTONIC_TRACK_ID)?.verseTimings,
					).toBeUndefined();

					const res = await loadSyncedChapterAudio({ usfm: "JHN", chapter: 3 });
					const supertonicTrack = res.tracks.find((t) => t.id === SUPERTONIC_TRACK_ID);
					const esvTrack = res.tracks.find((t) => t.id === "esv-api:JHN:3");
					expect(timingCalls).toBe(2);
					expect(supertonicTrack?.verseTimings).toEqual({ 1: 2.345, 16: 51.789 });
					expect(esvTrack?.verseTimings).toBeUndefined();

					// Gracefully handles missing chapter inside timing JSON without refetching
					const missing = await loadSyncedChapterAudio({ usfm: "JHN", chapter: 99 });
					expect(timingCalls).toBe(2);
					expect(
						missing.tracks.find((t) => t.id === SUPERTONIC_TRACK_ID)?.verseTimings,
					).toBeUndefined();
				},
			);
		} finally {
			clearLoaderCaches();
		}
	});

	it("keeps audio follow active on popover/sidebar scroll and retries failed chapter loads", async () => {
		window.location.hash = "#/RUT/1";
		localStorage.clear();
		clearLoaderCaches();

		const restoreMatchMedia = mockMatchMedia(true);
		const mockAudio = installMockAudio({ initialTime: 1.5, emitTimeUpdateOnPlay: true });
		let esvCalls = 0;

		try {
			await withMockFetch(
				(url) => {
					if (url.includes("/data/lexicon.json")) return Response.json({});
					if (url.includes("/data/bibles/krv/RUT.json")) {
						return makeBookResponse("krv", 8, "RUT", {
							"1": [{ verse: 1, text: "사사들의 치리하던 때에" }],
						});
					}
					if (url.includes("/data/bibles/esv/RUT.json")) {
						esvCalls++;
						if (esvCalls === 1) return new Response("Server Error", { status: 500 });
						return makeBookResponse("esv", 8, "RUT", {
							"1": [{ verse: 1, text: "In the days when the judges ruled..." }],
						});
					}
					if (url.includes("/api/audio/RUT/1")) {
						return Response.json({
							tracks: [
								{
									id: SUPERTONIC_TRACK_ID,
									label: "개역한글 · Daniel (AI)",
									language: "ko",
									url: "https://cdn.example.com/krv/RUT/1.mp3",
								},
							],
						});
					}
					if (url.includes("/data/timings/krv-supertonic/RUT.json")) {
						return Response.json({
							chapters: { "1": { "1": 1.2 } },
						});
					}
					return new Response("Not Found", { status: 404 });
				},
				async () => {
					const { container } = render(<App />);
					await waitUntil(() => {
						expect(getByText(container, "Unable to load passage")).toBeDefined();
					});
					fireClick(getButton(container, "Try again"));

					await waitUntil(() => {
						expect(getByText(container, "In the days when the judges ruled...")).toBeDefined();
						const rail = container.querySelector(".audio-rail");
						expect(rail).not.toBeNull();
						expect(getButton(rail as ParentNode, "Play audio").disabled).toBe(false);
					});

					fireClick(getButton(container.querySelector(".audio-rail") as ParentNode, "Play audio"));
					await waitUntil(() => {
						expect(container.querySelector("#verse-1")?.className).toContain("audio-active");
					});

					// Scrolling inside the dictionary sidebar or top popover should NOT pause follow
					const dictWrap = container.querySelector(".dict-sidebar-wrap") as HTMLElement;
					act(() => {
						dictWrap.dispatchEvent(new window.WheelEvent("wheel", { deltaY: 120, bubbles: true }));
					});
					fireClick(getButton(container.querySelector(".top-nav") as ParentNode, /Favorites/));
					const topPopover = container.querySelector(".popover-card") as HTMLElement;
					act(() => {
						topPopover.dispatchEvent(
							new window.WheelEvent("wheel", { deltaY: 120, bubbles: true }),
						);
					});
					expect(container.querySelector(".rail-follow-btn")).toBeNull();

					// Scrolling the main reader SHOULD pause follow and reveal Follow Audio button
					const verseEl = container.querySelector("#verse-1") as HTMLElement;
					act(() => {
						verseEl.dispatchEvent(new window.WheelEvent("wheel", { deltaY: 120, bubbles: true }));
					});
					const followBtn = getButton(container, "Follow Audio (v.1)");
					fireClick(followBtn);
					expect(container.querySelector(".rail-follow-btn")).toBeNull();
				},
			);
		} finally {
			mockAudio.restore();
			restoreMatchMedia();
			clearLoaderCaches();
		}
	});

	it("validates, toggles, merges, splits, and clears favorites and highlights", () => {
		localStorage.clear();
		localStorage.setItem(FAVORITES_STORAGE_KEY, "not-json");
		expect(readStoredFavorites()).toEqual([]);

		localStorage.setItem(
			FAVORITES_STORAGE_KEY,
			JSON.stringify([
				{ bookNumber: 999, chapter: 1 },
				{ bookNumber: 2, chapter: 2, createdAt: 10 },
				{ bookNumber: 2, chapter: 2, createdAt: 20 },
				{ bookNumber: 43, chapter: 3, verse: 16, enText: "For God so loved the world" },
			]),
		);
		const loadedFavs = readStoredFavorites();
		expect(loadedFavs).toHaveLength(2);
		expect(formatFavoriteLabel(loadedFavs[1])).toEqual({
			refEn: "John 3:16",
			refKo: "요한복음 3장 16절",
			kind: "verse",
		});
		expect(toggleFavoriteItem(loadedFavs, { bookNumber: 2, chapter: 2 })).toHaveLength(1);

		localStorage.setItem(HIGHLIGHTS_STORAGE_KEY, "bad-json");
		expect(readStoredHighlights()).toEqual([]);
		localStorage.setItem(
			HIGHLIGHTS_STORAGE_KEY,
			JSON.stringify([
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
				},
			]),
		);
		const loadedHl = readStoredHighlights();
		expect(loadedHl).toHaveLength(1);
		expect(formatHighlightLabel(loadedHl[0]).langLabel).toBe("EN");

		const verseText = "In the beginning, God created the heavens and the earth.";
		const merged = toggleHighlightSpans(
			loadedHl,
			1,
			1,
			[{ verse: 1, lang: "en", start: 10, end: 21, text: "inning, God" }],
			() => verseText,
		);
		expect(merged.next[0]?.end).toBe(21);
		const split = toggleHighlightSpans(
			merged.next,
			1,
			1,
			[{ verse: 1, lang: "en", start: 7, end: 16, text: "beginning" }],
			() => verseText,
		);
		expect(splitTextByHighlights(verseText.slice(0, 21), 0, split.next)).toEqual([
			{ text: "In the ", highlightId: split.next[0]?.id },
			{ text: "beginning" },
			{ text: ", God", highlightId: split.next[1]?.id },
		]);

		const onClearFav = mock(() => {});
		const onClearHl = mock(() => {});
		const list = render(
			<FavoritesList
				favorites={loadedFavs}
				highlights={loadedHl}
				onSelectFavorite={noop}
				onClearFavorites={onClearFav}
				onClearHighlights={onClearHl}
			/>,
		);
		fireClick(getButton(list.container, "Clear all bookmarks and highlights"));
		expect(onClearFav).toHaveBeenCalledTimes(1);
		expect(onClearHl).toHaveBeenCalledTimes(1);
	});
});
