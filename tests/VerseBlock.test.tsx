import { describe, expect, it, mock } from "bun:test";

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

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

describe("VerseBlock & Korean hover tooltip", () => {
	const analysis = analyzeKoreanChapter([
		{ verse: 1, text: "태초에 하나님이 천지를 창조하시니라" },
	]);
	const tokens = analysis.tokensByVerse.get(1) ?? [];
	const sampleVerse = {
		verse: 1,
		enText: "In the beginning, God created the heavens and the earth.",
		koText: "태초에 하나님이 천지를 창조하시니라",
		tokens,
	};

	it("renders English above Korean by default and flips when stackOrder is ko-first", () => {
		const { container, rerender } = render(
			<VerseBlock
				verse={sampleVerse}
				stackOrder="en-first"
				studyMask="none"
				isSelected={false}
				isAudioActive={false}
				enCode="ESV"
				koCode="개역한글"
				hasVerseTimestamps={false}
				onSelectVerse={() => {}}
				onSelectFootnote={() => {}}
			/>,
		);

		const linesEnFirst = container.querySelectorAll(".verse-lines > p");
		expect(linesEnFirst[0]?.className).toContain("verse-en");
		expect(linesEnFirst[1]?.className).toContain("verse-ko");

		rerender(
			<VerseBlock
				verse={sampleVerse}
				stackOrder="ko-first"
				studyMask="none"
				isSelected={false}
				isAudioActive={false}
				enCode="ESV"
				koCode="개역한글"
				hasVerseTimestamps={false}
				onSelectVerse={() => {}}
				onSelectFootnote={() => {}}
			/>,
		);

		const linesKoFirst = container.querySelectorAll(".verse-lines > p");
		expect(linesKoFirst[0]?.className).toContain("verse-ko");
		expect(linesKoFirst[1]?.className).toContain("verse-en");
	});

	it("shows an English translation tooltip when hovering a Korean word", () => {
		render(
			<VerseBlock
				verse={sampleVerse}
				stackOrder="en-first"
				studyMask="none"
				isSelected={false}
				isAudioActive={false}
				enCode="ESV"
				koCode="개역한글"
				hasVerseTimestamps={false}
				onSelectVerse={() => {}}
				onSelectFootnote={() => {}}
			/>,
		);

		const wordButton = screen.getByRole("button", { name: /창조하시니라/ });
		fireEvent.mouseEnter(wordButton);

		const tooltip = screen.getByRole("tooltip");
		expect(tooltip.textContent).toContain("to create");
		expect(tooltip.textContent).toContain("Root: 창조하다");

		fireEvent.mouseLeave(wordButton);
		expect(screen.queryByRole("tooltip")).toBeNull();
	});

	it("renders FootnotesGuide vocabulary, jumps to verse on chip click, and expands All when highlighting a pronoun", () => {
		const onJump = mock(() => {});
		const onClose = mock(() => {});
		const { rerender } = render(
			<FootnotesGuide
				bookEn="Genesis"
				bookKo="창세기"
				chapter={1}
				footnotes={[
					...analysis.footnotes,
					{
						id: "vocab-그",
						lemma: "그",
						surfaceForms: ["그"],
						verses: [1],
						gloss: "he / that / the",
						pos: "pronoun",
					},
				]}
				grammarNotes={analysis.grammarNotes}
				highlightedFootnoteId={null}
				variant="sidebar"
				onClose={onClose}
				onJumpToVerse={onJump}
			/>,
		);

		expect(screen.getByText("창조하다")).toBeDefined();
		expect(screen.getByText("to create")).toBeDefined();

		const verseChip = screen.getAllByRole("button", { name: "v.1" })[0];
		fireEvent.click(verseChip);
		expect(onJump).toHaveBeenCalledWith(1);

		rerender(
			<FootnotesGuide
				bookEn="Genesis"
				bookKo="창세기"
				chapter={1}
				footnotes={[
					...analysis.footnotes,
					{
						id: "vocab-그",
						lemma: "그",
						surfaceForms: ["그"],
						verses: [1],
						gloss: "he / that / the",
						pos: "pronoun",
					},
				]}
				grammarNotes={analysis.grammarNotes}
				highlightedFootnoteId="vocab-그"
				variant="sidebar"
				onClose={onClose}
				onJumpToVerse={onJump}
			/>,
		);

		expect(screen.getByText("he / that / the")).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "Close dictionary panel" }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("displays canonical ESV and KRV editions, navigates home on logo click, and flips stack order in TopBar", () => {
		const onFlip = mock(() => {});
		const onGoHome = mock(() => {});

		render(
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
				onOpenSearch={() => {}}
				onChangeTheme={() => {}}
				onChangeFontScale={() => {}}
				onChangeKoFontStyle={() => {}}
				onChangeStudyMask={() => {}}
			/>,
		);

		expect(screen.getByText("ESV")).toBeDefined();
		expect(screen.getByText("개역한글")).toBeDefined();
		expect(screen.queryByRole("button", { name: "Select English translation" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Select Korean translation" })).toBeNull();

		fireEvent.click(screen.getByRole("link", { name: "Logos Home" }));
		expect(onGoHome).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole("button", { name: "Flip language stack order" }));
		expect(onFlip).toHaveBeenCalledTimes(1);
	});

	it("renders HomePage with Continue Reading, passage search, and inline book/chapter navigation", () => {
		const onOpenPassage = mock(() => {});

		render(
			<HomePage
				lastBookNumber={8}
				lastChapter={4}
				selectedEn={CANONICAL_BIBLES.en}
				selectedKo={CANONICAL_BIBLES.ko}
				bibleBrainEnabled={true}
				onOpenPassage={onOpenPassage}
			/>,
		);

		expect(screen.getByText("Bible Brain Verse-Synced Audio")).toBeDefined();
		expect(screen.getAllByText(/Ruth 4/).length).toBeGreaterThanOrEqual(1);

		fireEvent.click(screen.getByRole("button", { name: /Open Chapter/ }));
		expect(onOpenPassage).toHaveBeenCalledWith(8, 4);

		const searchInput = screen.getByRole("searchbox", { name: "Go to Bible passage" });
		fireEvent.change(searchInput, { target: { value: "시 23" } });
		fireEvent.submit(searchInput.closest("form") as HTMLFormElement);
		expect(onOpenPassage).toHaveBeenCalledWith(19, 23, undefined);
	});

	it("defaults App to HomePage at #/, renders 3-column desktop rails, and returns Home on logo click", async () => {
		window.location.hash = "";
		const originalFetch = globalThis.fetch;
		const originalMatchMedia = window.matchMedia;
		window.matchMedia = ((query: string) => ({
			matches: query.includes("min-width: 1024px"),
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
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
			if (url.includes("/data/lexicon.json")) {
				return Response.json({});
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
			render(<App />);

			await waitFor(() => {
				expect(screen.getByText("Continue Reading")).toBeDefined();
			});

			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: /Open Chapter/ }));
			});

			await waitFor(() => {
				expect(audioLoaded).toBe(true);
				expect(screen.queryByText("Continue Reading")).toBeNull();
				expect(window.location.hash).toBe("#/GEN/1");
				expect(screen.getByText("In the beginning...")).toBeDefined();
				expect(
					screen.getByRole("complementary", { name: "Audio Playback and Verse Sync" }),
				).toBeDefined();
				expect(
					screen.getByRole("complementary", { name: "Korean Dictionary & Grammar Guide" }),
				).toBeDefined();
			});

			await act(async () => {
				fireEvent.click(screen.getByRole("link", { name: "Logos Home" }));
			});

			expect(screen.getByText("Continue Reading")).toBeDefined();
			expect(window.location.hash).toBe("#/");
		} finally {
			globalThis.fetch = originalFetch;
			window.matchMedia = originalMatchMedia;
		}
	});

	it("jumps to bilingual passage references from PassagePicker", () => {
		const onNavigate = mock(() => {});
		const onClose = mock(() => {});

		render(
			<PassagePicker
				isOpen={true}
				currentBookNumber={1}
				currentChapter={1}
				onClose={onClose}
				onNavigate={onNavigate}
			/>,
		);

		const input = screen.getByPlaceholderText(/Jump to passage/);
		fireEvent.change(input, { target: { value: "요 3:16" } });
		fireEvent.submit(input.closest("form") as HTMLFormElement);

		expect(onNavigate).toHaveBeenCalledWith(43, 3, 16);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("renders single quick-access bottom bar without a popup and maps arrows to 10s skip while playing", () => {
		const onSelectLanguage = mock(() => {});
		const onPrevChapter = mock(() => {});
		const onNextChapter = mock(() => {});
		const onSkipBy = mock((_delta: number) => {});
		const onToggleDictionary = mock(() => {});

		const koTrack = {
			id: "helloao:krv:wordproject",
			label: "Wordproject Reader (KRV)",
			language: "ko" as const,
			translationId: "krv",
			url: "https://audio.bible.helloao.org/api/kor_old/GEN/1/audio/wordproject.mp3",
			source: "helloao" as const,
		};

		const { container, rerender } = render(
			<FloatingBottomBar
				bookEn="Genesis"
				bookKo="창세기"
				chapter={1}
				hasPrev={false}
				hasNext={true}
				onPrevChapter={onPrevChapter}
				onNextChapter={onNextChapter}
				onOpenPicker={() => {}}
				tracks={[koTrack]}
				preferredLang="ko"
				activeTrack={koTrack}
				isPlaying={false}
				isLoading={false}
				currentTime={0}
				duration={120}
				playbackRate={1}
				errorMessage={null}
				activeEnCode="ESV"
				activeKoCode="개역한글"
				dictionaryOpen={false}
				onToggleDictionary={onToggleDictionary}
				onTogglePlay={() => {}}
				onSeek={() => {}}
				onSkipBy={onSkipBy}
				onSelectTrack={() => {}}
				onSelectLanguage={onSelectLanguage}
				onCycleSpeed={() => {}}
			/>,
		);

		// No secondary audio drawer popup should exist; audio sits left and dictionary sits right
		expect(container.querySelector(".audio-drawer")).toBeNull();
		const rowButtons = Array.from(container.querySelectorAll(".quick-bar-row button"));
		const playIdx = rowButtons.indexOf(screen.getByRole("button", { name: "Play audio" }));
		const chapterIdx = rowButtons.indexOf(screen.getByText(/Genesis 1/));
		const dictIdx = rowButtons.indexOf(
			screen.getByRole("button", { name: "Toggle Korean dictionary" }),
		);
		expect(playIdx).toBeLessThan(chapterIdx);
		expect(chapterIdx).toBeLessThan(dictIdx);

		// When paused/stopped on Genesis 1, Previous Chapter is disabled and Next Chapter navigates
		const prevChapterBtn = screen.getByRole("button", { name: "Previous chapter" });
		expect((prevChapterBtn as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Next chapter" }));
		expect(onNextChapter).toHaveBeenCalledTimes(1);

		// Toggle dictionary button
		fireEvent.click(screen.getByRole("button", { name: "Toggle Korean dictionary" }));
		expect(onToggleDictionary).toHaveBeenCalledTimes(1);

		// While playing (even on Genesis 1 with hasPrev=false), left/right arrows become 10s skip
		rerender(
			<FloatingBottomBar
				bookEn="Genesis"
				bookKo="창세기"
				chapter={1}
				hasPrev={false}
				hasNext={false}
				onPrevChapter={onPrevChapter}
				onNextChapter={onNextChapter}
				onOpenPicker={() => {}}
				tracks={[koTrack]}
				preferredLang="ko"
				activeTrack={koTrack}
				isPlaying={true}
				isLoading={false}
				currentTime={15}
				duration={120}
				playbackRate={1}
				errorMessage={null}
				activeEnCode="ESV"
				activeKoCode="개역한글"
				dictionaryOpen={true}
				onToggleDictionary={onToggleDictionary}
				onTogglePlay={() => {}}
				onSeek={() => {}}
				onSkipBy={onSkipBy}
				onSelectTrack={() => {}}
				onSelectLanguage={onSelectLanguage}
				onCycleSpeed={() => {}}
			/>,
		);

		const rewindBtn = screen.getByRole("button", { name: "Rewind 10 seconds" });
		const forwardBtn = screen.getByRole("button", { name: "Forward 10 seconds" });
		expect((rewindBtn as HTMLButtonElement).disabled).toBe(false);
		expect((forwardBtn as HTMLButtonElement).disabled).toBe(false);
		expect(screen.getByRole("slider", { name: "Audio playback progress" })).toBeDefined();

		fireEvent.click(rewindBtn);
		fireEvent.click(forwardBtn);
		expect(onSkipBy).toHaveBeenNthCalledWith(1, -10);
		expect(onSkipBy).toHaveBeenNthCalledWith(2, 10);

		// Switching to unavailable EN audio displays inline status right inside the single bar
		rerender(
			<FloatingBottomBar
				bookEn="Genesis"
				bookKo="창세기"
				chapter={1}
				hasPrev={false}
				hasNext={true}
				onPrevChapter={onPrevChapter}
				onNextChapter={onNextChapter}
				onOpenPicker={() => {}}
				tracks={[koTrack]}
				preferredLang="en"
				activeTrack={null}
				isPlaying={false}
				isLoading={false}
				currentTime={0}
				duration={0}
				playbackRate={1}
				errorMessage={null}
				activeEnCode="ESV"
				activeKoCode="개역한글"
				dictionaryOpen={false}
				onToggleDictionary={onToggleDictionary}
				onTogglePlay={() => {}}
				onSeek={() => {}}
				onSkipBy={onSkipBy}
				onSelectTrack={() => {}}
				onSelectLanguage={onSelectLanguage}
				onCycleSpeed={() => {}}
			/>,
		);

		expect(screen.getByText(/No audio recording linked/)).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: /Use 개역한글/ }));
		expect(onSelectLanguage).toHaveBeenCalledWith("ko");
	});

	it("renders left-margin AudioControlRail with Bible Brain style switching and verse auto-sync", () => {
		const onSyncToVisible = mock(() => {});
		const onFollowActive = mock(() => {});
		const onToggleAutoSync = mock(() => {});
		const onSelectTrack = mock(() => {});

		const standardTrack = {
			id: "bb:ENGESVN1DA",
			label: "ESV · Narration",
			language: "en" as const,
			translationId: "esv",
			url: "https://cdn.example.com/std.mp3",
			source: "bible-brain" as const,
			audioStyle: "standard" as const,
			verseTimings: { 1: 0, 12: 34.5, 16: 48.2 },
		};
		const dramaTrack = {
			id: "bb:ENGESVN2DA",
			label: "ESV · Drama",
			language: "en" as const,
			translationId: "esv",
			url: "https://cdn.example.com/drama.mp3",
			source: "bible-brain" as const,
			audioStyle: "drama" as const,
			verseTimings: { 1: 0, 12: 36.0, 16: 50.1 },
		};

		expect(resolveVerseAtTime(standardTrack.verseTimings, 48.5)).toBe(16);
		expect(resolveTimeForVerse(standardTrack.verseTimings, 17)).toBe(48.2);

		render(
			<AudioControlRail
				bookEn="John"
				bookKo="요한복음"
				chapter={3}
				hasPrev={true}
				hasNext={true}
				tracks={[standardTrack, dramaTrack]}
				preferredLang="en"
				activeTrack={standardTrack}
				isPlaying={true}
				isLoading={false}
				currentTime={35}
				duration={120}
				playbackRate={1}
				errorMessage={null}
				activeEnCode="ESV"
				activeKoCode="개역한글"
				visibleVerse={16}
				activeVerse={12}
				autoSync={true}
				isFollowingAudio={false}
				onPrevChapter={() => {}}
				onNextChapter={() => {}}
				onOpenPicker={() => {}}
				onTogglePlay={() => {}}
				onSeek={() => {}}
				onSkipBy={() => {}}
				onSelectTrack={onSelectTrack}
				onSelectLanguage={() => {}}
				onCycleSpeed={() => {}}
				onToggleAutoSync={onToggleAutoSync}
				onSyncToVisibleVerse={onSyncToVisible}
				onFollowActiveVerse={onFollowActive}
			/>,
		);

		expect(screen.getByText("Visible: v.16")).toBeDefined();
		expect(screen.getByText("Audio: v.12")).toBeDefined();

		fireEvent.click(screen.getByRole("button", { name: "Drama" }));
		expect(onSelectTrack).toHaveBeenCalledWith(dramaTrack);

		fireEvent.click(screen.getByRole("switch"));
		expect(onToggleAutoSync).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole("button", { name: "Play from v.16" }));
		expect(onSyncToVisible).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole("button", { name: "Follow Audio (v.12)" }));
		expect(onFollowActive).toHaveBeenCalledTimes(1);
	});

	it("auto-syncs playback start to the currently visible verse when verse timings exist", async () => {
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
				const arr = listeners.get(type) ?? [];
				arr.push(fn);
				listeners.set(type, arr);
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
			const koSyncedTrack = {
				id: "bb:KORKRVN1DA",
				label: "KRV · Narration",
				language: "ko" as const,
				translationId: "krv",
				url: "https://cdn.example.com/krv.mp3",
				source: "bible-brain" as const,
				verseTimings: { 1: 0, 16: 48.2 },
			};

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
