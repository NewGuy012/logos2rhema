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
		onCycleSpeed: noop,
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
		fireHover(wordBtn, true);
		const tooltip = document.body.querySelector('[role="tooltip"]');
		expect(tooltip?.textContent).toContain("to create");
		expect(tooltip?.textContent).toContain("Root: 창조하다");

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

	it("renders FootnotesGuide, jumps to verse, and expands All on highlighted pronoun", () => {
		const onJump = mock(() => {});
		const onClose = mock(() => {});
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
				onClose={onClose}
				onJumpToVerse={onJump}
			/>,
		);

		// Both KRV Grammar and KRV Words are collapsed by default to keep the dictionary minimal
		expect(container.querySelector(".grammar-cards")).toBeNull();
		expect(container.querySelector(".vocab-list")).toBeNull();
		const wordsToggle = getButton(container, /KRV Words/);
		expect(wordsToggle.getAttribute("aria-expanded")).toBe("false");

		fireClick(wordsToggle);
		expect(wordsToggle.getAttribute("aria-expanded")).toBe("true");
		expect(getByText(container, "창조하다")).toBeDefined();
		fireClick(getButton(container, "v.1"));
		expect(onJump).toHaveBeenCalledWith(1);

		fireClick(getButton(container, /KRV Grammar/));
		expect(container.querySelector(".grammar-cards")).not.toBeNull();

		// Collapsing KRV Words again, searching auto-expands it, and clicking a word clears the filter and scrolls to its translation
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
					onClose={onClose}
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
					onClose={onClose}
					onJumpToVerse={onJump}
				/>,
			);

			expect(getByText(container, "he / that / the")).toBeDefined();
			expect(scrolledIds.at(-1)).toBe("vocab-그");
		} finally {
			window.HTMLElement.prototype.scrollIntoView = origScrollIntoView;
		}

		fireClick(getButton(container, "Close dictionary panel"));
		expect(onClose).toHaveBeenCalledTimes(1);
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
		fireClick(topBar.container.querySelector('a[aria-label="Logos Home"]') as Element);
		expect(onGoHome).toHaveBeenCalledTimes(1);
		fireClick(getButton(topBar.container, "Flip language stack order"));
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
		expect(getByText(home.container, "Bible Brain Verse-Synced Audio")).toBeDefined();
		home.rerender(
			<HomePage
				lastBookNumber={8}
				lastChapter={4}
				selectedEn={CANONICAL_BIBLES.en}
				selectedKo={CANONICAL_BIBLES.ko}
				bibleBrainEnabled={false}
				onOpenPassage={onOpenPassage}
			/>,
		);
		expect(getByText(home.container, "Audio Available")).toBeDefined();
		expect(home.container.textContent).not.toContain("Human Audio Ready");
		fireClick(getButton(home.container, "Open Chapter"));
		expect(onOpenPassage).toHaveBeenCalledWith(8, 4);

		const homeInput = home.container.querySelector("input[type='search']") as HTMLInputElement;
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

	it("opens App on HomePage, loads 3-column desktop reader, and returns Home", async () => {
		window.location.hash = "";
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
					chapters: { "1": [{ verse: 1, text: "보아스가 성문에 올라가서 거기 앉았더니" }] },
				});
			}
			if (url.includes("/data/bibles/")) {
				return Response.json({
					translationId: "esv",
					bookNumber: 1,
					usfm: "GEN",
					chapters: { "1": [{ verse: 1, text: "In the beginning..." }] },
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

			fireClick(getButton(container, "Open Chapter"));

			await waitUntil(() => {
				expect(audioLoaded).toBe(true);
				expect(window.location.hash).toBe("#/GEN/1");
				expect(getByText(container, "In the beginning...")).toBeDefined();
				expect(
					container.querySelector('aside[aria-label="Audio Playback and Verse Sync"]'),
				).not.toBeNull();
				expect(
					container.querySelector('aside[aria-label="Korean Dictionary & Grammar Guide"]'),
				).not.toBeNull();
			});

			// KRV Words starts collapsed, then clicking a word ("View in Dictionary") expands, highlights & reveals its translation
			expect(container.querySelector(".vocab-list")).toBeNull();
			fireClick(getButton(container, "올라가서"));
			const dictEntry = container.querySelector('[data-footnote-id="vocab-올라가다"]');
			expect(dictEntry).not.toBeNull();
			expect(dictEntry?.className).toContain("highlighted");
			expect(dictEntry?.textContent).toContain("to go up");

			fireClick(container.querySelector('a[aria-label="Logos Home"]') as Element);
			expect(getByText(container, "Continue Reading")).toBeDefined();
			expect(window.location.hash).toBe("#/");
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
		const onRailSkip = mock((_delta: number) => {});
		const rail = render(
			<AudioControlRail
				{...baseBarProps()}
				bookEn="John"
				bookKo="요한복음"
				chapter={3}
				hasPrev={true}
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
				onSkipBy={onRailSkip}
				onToggleAutoSync={noop}
				onSyncToVisibleVerse={onSyncToVisible}
				onFollowActiveVerse={noop}
			/>,
		);
		fireClick(getButton(rail.container, "Drama"));
		expect(onSelectTrack).toHaveBeenCalledWith(dramaTrack);
		fireClick(getButton(rail.container, "Play from v.16"));
		expect(onSyncToVisible).toHaveBeenCalledTimes(1);
		fireClick(getButton(rail.container, "Rewind 10 seconds"));
		fireClick(getButton(rail.container, "Forward 10 seconds"));
		expect(onRailSkip).toHaveBeenNthCalledWith(1, -10);
		expect(onRailSkip).toHaveBeenNthCalledWith(2, 10);

		rail.rerender(
			<AudioControlRail
				{...baseBarProps()}
				bookEn="Ruth"
				bookKo="룻기"
				chapter={4}
				hasPrev={true}
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
		expect(getButton(rail.container, "Play audio").textContent).toBe("Listen");
		expect(getByText(rail.container, "Chapter audio")).toBeDefined();
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
		} finally {
			globalThis.Audio = originalAudio;
		}
	});
});
