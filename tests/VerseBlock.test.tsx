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
	clearAudioTimingsCache,
	clearCommentaryCache,
	loadSyncedChapterAudio,
} from "../src/react-app/lib/bible-loader";
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

	it("flips verse order, toggles verse bookmark, and handles Korean tooltip hover/click/speech", async () => {
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
			hasVerseTimestamps: false,
			onSelectVerse: noop,
			onToggleFavorite,
			onSelectFootnote,
		};

		const { container, rerender } = render(<VerseBlock {...verseProps} stackOrder="en-first" />);
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
			expect(onSelectFootnote).not.toHaveBeenCalled();
			const pinned = document.body.querySelector('[role="tooltip"]') as ParentNode;
			fireClick(getButton(pinned, "View in Dictionary"));
			expect(onSelectFootnote).toHaveBeenCalledWith("vocab-창조하다");
			expect(document.body.querySelector('[role="tooltip"]') !== null).toBe(true);
			act(() => {
				document.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
				);
			});
			expect(document.body.querySelector('[role="tooltip"]') === null).toBe(true);
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
				stackOrder="en-first"
				theme="paper"
				fontScale={1}
				koFontStyle="serif"
				studyMask="none"
				onGoHome={onGoHome}
				onContinueReading={onContinue}
				onOpenPassage={onTopOpen}
				onChangeStackOrder={onFlip}
				onOpenSearch={onOpenSearch}
				onChangeTheme={noop}
				onChangeFontScale={noop}
				onChangeKoFontStyle={noop}
				onChangeStudyMask={noop}
			/>,
		);
		fireClick(topBar.container.querySelector('a[aria-label="Logos2Rhema Home"]') as Element);
		const readButton = getButton(topBar.container.querySelector(".top-nav") as ParentNode, "Read");
		expect(readButton.getAttribute("title")).toBe("Read Ruth 4:12");
		fireClick(readButton);
		fireClick(getButton(topBar.container, "Go to"));
		expect(onGoHome).toHaveBeenCalledTimes(1);
		expect(onContinue).toHaveBeenCalledTimes(1);
		expect(onOpenSearch).toHaveBeenCalledTimes(1);

		fireClick(getButton(topBar.container, "Reader appearance settings"));
		fireClick(getButton(topBar.container, "EN / 한"));
		expect(onFlip).not.toHaveBeenCalled();
		fireClick(getButton(topBar.container, "한 / EN"));
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

		const onOpenPassage = mock(() => {});
		const home = render(
			<HomePage
				lastBookNumber={8}
				lastChapter={4}
				lastVerse={12}
				krvSyncedAudioEnabled={true}
				onOpenPassage={onOpenPassage}
			/>,
		);
		expect(getByText(home.container, "Verse-Synced Korean Audio")).toBeDefined();
		const continueSection = home.container.querySelector(".home-continue-section") as ParentNode;
		const continueCard = continueSection.querySelector(".home-continue-card") as ParentNode;
		const continueMeta = continueCard.querySelector(".home-continue-meta") as Element;
		expect(continueSection.querySelector(".home-section-title")).toBeNull();
		expect(continueMeta.children[0]?.className).toBe("home-continue-subtitle");
		expect(continueMeta.children[0]?.textContent).toBe("Continue Where You Left Off");
		expect(continueMeta.children[1]?.className).toBe("home-continue-ref");
		fireClick(getButton(continueSection, "Continue"));
		expect(onOpenPassage).toHaveBeenCalledWith(8, 4, 12);

		expect(home.container.querySelector('section[aria-label="Bible Genres"]')).toBeNull();
		const browseSection = home.container.querySelector(
			'section[aria-label="Browse"]',
		) as ParentNode;
		expect(browseSection.querySelector(".home-section-title")?.textContent).toBe("Browse");
		expect(browseSection.querySelector(".home-testaments")).not.toBeNull();
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
		clearCommentaryCache();
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

		let configLoaded = false;
		let audioLoadCount = 0;
		const commentaryFetchUrls: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/api/config")) {
				configLoaded = true;
				return Response.json({ krvSyncedAudioEnabled: false });
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
		}) as typeof fetch;

		const flushAsync = () =>
			act(async () => {
				await new Promise((r) => setTimeout(r, 10));
			});

		try {
			const { container } = render(<App />);
			await flushAsync();
			expect(configLoaded).toBe(true);
			expect(getByText(container, "Continue Where You Left Off")).toBeDefined();

			fireClick(
				getButton(container.querySelector(".home-continue-section") as ParentNode, "Continue"),
			);
			await flushAsync();
			await waitUntil(() => {
				expect(audioLoadCount).toBeGreaterThanOrEqual(1);
				expect(window.location.hash).toBe("#/GEN/1");
				expect(getByText(container, "In the beginning...")).toBeDefined();
			});
			await flushAsync();

			// Tooltip -> View in Dictionary -> rail minimize/expand
			expect(commentaryFetchUrls).toEqual([]);
			fireClick(getButton(container, "올라가서"));
			fireClick(
				getButton(
					document.body.querySelector('[role="tooltip"]') as ParentNode,
					"View in Dictionary",
				),
			);
			expect(container.querySelector('[data-footnote-id="vocab-올라가다"]')?.className).toContain(
				"highlighted",
			);
			act(() => {
				document.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
				);
			});

			// Lazy-load Commentary tab, switch to Matthew Henry, and let View in Dictionary switch back
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
			fireClick(
				getButton(
					document.body.querySelector('[role="tooltip"]') as ParentNode,
					"View in Dictionary",
				),
			);
			expect(container.querySelector("#footnotes .panel-title")?.textContent).toBe("Dictionary");
			expect(container.querySelector('[data-footnote-id="vocab-올라가다"]')?.className).toContain(
				"highlighted",
			);
			act(() => {
				document.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
				);
			});

			// Switching back to Commentary uses cached response without refetching
			fireClick(getButton(container, "Commentary"));
			expect(container.querySelector("#footnotes .panel-title")?.textContent).toBe("Commentary");
			expect(getByText(container, "Matthew Henry GEN 1 note.")).toBeDefined();
			expect(commentaryFetchUrls).toHaveLength(2);
			expect(localStorage.getItem("logos.reader.preferences.v1")).toContain("matthew-henry");
			fireClick(getButton(container, "Dictionary"));

			fireClick(getButton(container, "Minimize dictionary"));
			expect(container.querySelector(".dict-sidebar-wrap")?.className).toContain("minimized");
			fireClick(getButton(container, "Expand dictionary"));
			expect(container.querySelector(".dict-sidebar-wrap")?.className).toContain("expanded");

			fireClick(getButton(container, "Minimize audio"));
			expect(container.querySelector(".audio-rail-wrap")?.className).toContain("minimized");
			fireClick(getButton(container, "Expand audio"));
			expect(container.querySelector(".audio-rail-wrap")?.className).toContain("expanded");

			// Next/Prev chapter
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

			// Bookmark chapter & verse, highlight English via Cmd+H and Korean via toolbar
			fireClick(getButton(container, "Bookmark Genesis 1"));
			fireClick(getButton(container, "Bookmark verse 1"));
			expect(readStoredFavorites()).toHaveLength(2);

			const enLine = container.querySelector('.verse-en[data-verse="1"]') as HTMLElement;
			const enRange = document.createRange();
			enRange.setStart(enLine.firstChild as Text, 7);
			enRange.setEnd(enLine.firstChild as Text, 16);
			const sel = window.getSelection();
			sel?.removeAllRanges();
			sel?.addRange(enRange);
			act(() => {
				document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
				window.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "h", metaKey: true, bubbles: true }),
				);
			});
			expect(enLine.querySelector("mark.verse-highlight")?.textContent).toBe("beginning");

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

			// Clear highlights via TopBar popover, then verify out-of-range verse deep link loads cleanly
			fireClick(getButton(container.querySelector(".top-nav") as ParentNode, /Favorites/));
			fireClick(
				getButton(
					container.querySelector(".top-favorites-popover") as ParentNode,
					"Clear highlights",
				),
			);
			expect(readStoredHighlights()).toEqual([]);

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
		} finally {
			globalThis.fetch = originalFetch;
			window.matchMedia = originalMatchMedia;
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

		fireClick(getButton(rail.container, "Settings"));
		fireClick(getButton(rail.container, "Play from v.16"));
		expect(onSyncToVisible).toHaveBeenCalledTimes(1);

		// Hook auto-sync and unsafe URL rejection
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
		try {
			const { result } = renderHook(() =>
				useHumanAudio({
					tracks: [
						{
							id: SUPERTONIC_TRACK_ID,
							label: "개역한글 · Daniel (AI)",
							language: "ko",
							url: "https://cdn.example.com/krv.mp3",
							verseTimings: { 1: 2.3, 16: 48.2 },
						},
					],
					visibleVerse: 16,
					autoSync: true,
				}),
			);
			await act(async () => {
				result.current.togglePlay();
			});
			expect(mockCurrentTime).toBe(48.2);
			expect(result.current.activeVerse).toBe(16);

			for (const badUrl of [
				"javascript:alert(1)",
				"https://user:pass@cdn.example.com/krv.mp3",
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
			mockCurrentTime = 0;
			listeners.clear();
			class DeferredMetadataAudio extends MockAudio {
				readyState = 0;
			}
			globalThis.Audio = DeferredMetadataAudio as unknown as typeof Audio;
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
			expect(mockCurrentTime).toBe(0);
			expect(deferredHook.result.current.activeVerse).toBe(16);
			await act(async () => {
				for (const fn of listeners.get("loadedmetadata") ?? []) fn();
			});
			expect(mockCurrentTime).toBe(48.2);
			expect(deferredHook.result.current.activeVerse).toBe(16);
		} finally {
			globalThis.Audio = originalAudio;
		}
	});

	it("hydrates static KRV timings, retries transient 5xx failures, and preserves ESV", async () => {
		clearAudioTimingsCache();
		const originalFetch = globalThis.fetch;
		let timingCalls = 0;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
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
		}) as unknown as typeof fetch;

		try {
			// First load hits 503 on timings: audio track survives, and 503 is not poisoned in cache
			const first = await loadSyncedChapterAudio({ usfm: "JHN", chapter: 3 });
			expect(first.tracks.find((t) => t.id === SUPERTONIC_TRACK_ID)?.verseTimings).toBeUndefined();

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
		} finally {
			globalThis.fetch = originalFetch;
			clearAudioTimingsCache();
		}
	});

	it("keeps audio follow active when scrolling sidebars and pauses only on reader scroll", async () => {
		window.location.hash = "#/GEN/1";
		localStorage.clear();
		clearCommentaryCache();
		clearAudioTimingsCache();

		const originalFetch = globalThis.fetch;
		const originalAudio = globalThis.Audio;
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

		class PlayingMockAudio {
			preload = "metadata";
			src = "";
			duration = 60;
			currentTime = 1.5;
			readyState = 4;
			paused = true;
			playbackRate = 1;
			preservesPitch = true;
			private listeners = new Map<string, Array<() => void>>();
			load() {}
			removeAttribute() {}
			addEventListener(type: string, fn: () => void) {
				this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
			}
			removeEventListener() {}
			pause() {
				this.paused = true;
				for (const fn of this.listeners.get("pause") ?? []) fn();
			}
			play() {
				this.paused = false;
				for (const fn of this.listeners.get("play") ?? []) fn();
				for (const fn of this.listeners.get("timeupdate") ?? []) fn();
				return Promise.resolve();
			}
		}
		globalThis.Audio = PlayingMockAudio as unknown as typeof Audio;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/api/config")) {
				return Response.json({ krvSyncedAudioEnabled: false });
			}
			if (url.includes("/data/lexicon.json")) return Response.json({});
			if (url.includes("/data/bibles/krv/")) {
				return Response.json({
					translationId: "krv",
					bookNumber: 1,
					usfm: "GEN",
					chapters: { "1": [{ verse: 1, text: "태초에 하나님이 천지를 창조하시니라" }] },
				});
			}
			if (url.includes("/data/bibles/esv/")) {
				return Response.json({
					translationId: "esv",
					bookNumber: 1,
					usfm: "GEN",
					chapters: { "1": [{ verse: 1, text: "In the beginning..." }] },
				});
			}
			if (url.includes("/api/audio/GEN/1")) {
				return Response.json({
					tracks: [
						{
							id: SUPERTONIC_TRACK_ID,
							label: "개역한글 · Daniel (AI)",
							language: "ko",
							url: "https://cdn.example.com/krv/GEN/1.mp3",
						},
					],
				});
			}
			if (url.includes("/data/timings/krv-supertonic/GEN.json")) {
				return Response.json({
					chapters: { "1": { "1": 1.2 } },
				});
			}
			return new Response("Not Found", { status: 404 });
		}) as unknown as typeof fetch;

		try {
			const { container } = render(<App />);
			await waitUntil(() => {
				expect(getByText(container, "In the beginning...")).toBeDefined();
				const rail = container.querySelector(".audio-rail");
				expect(rail).not.toBeNull();
				expect(getButton(rail as ParentNode, "Play audio").disabled).toBe(false);
			});

			fireClick(getButton(container.querySelector(".audio-rail") as ParentNode, "Play audio"));
			await waitUntil(() => {
				expect(container.querySelector("#verse-1")?.className).toContain("audio-active");
			});

			// Scrolling inside the dictionary sidebar should NOT pause follow
			const dictWrap = container.querySelector(".dict-sidebar-wrap") as HTMLElement;
			act(() => {
				dictWrap.dispatchEvent(new window.WheelEvent("wheel", { deltaY: 120, bubbles: true }));
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
		} finally {
			globalThis.fetch = originalFetch;
			globalThis.Audio = originalAudio;
			window.matchMedia = originalMatchMedia;
			clearAudioTimingsCache();
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
