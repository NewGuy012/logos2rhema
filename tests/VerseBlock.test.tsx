import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { FloatingBottomBar } from "../src/react-app/components/FloatingBottomBar";
import { FootnotesGuide } from "../src/react-app/components/FootnotesGuide";
import { PassagePicker } from "../src/react-app/components/PassagePicker";
import { TopBar } from "../src/react-app/components/TopBar";
import { VerseBlock } from "../src/react-app/components/VerseBlock";
import { analyzeKoreanChapter } from "../src/shared/korean-morphology";
import {
	BUILTIN_ENGLISH_TRANSLATIONS,
	BUILTIN_KOREAN_TRANSLATIONS,
} from "../src/shared/translations";

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

	it("renders FootnotesGuide vocabulary and jumps to verse on chip click", () => {
		const onJump = mock(() => {});
		render(
			<FootnotesGuide
				bookEn="Genesis"
				bookKo="창세기"
				chapter={1}
				footnotes={analysis.footnotes}
				grammarNotes={analysis.grammarNotes}
				highlightedFootnoteId={null}
				onJumpToVerse={onJump}
			/>,
		);

		expect(screen.getByText("창조하다")).toBeDefined();
		expect(screen.getByText("to create")).toBeDefined();

		const verseChip = screen.getAllByRole("button", { name: "v.1" })[0];
		fireEvent.click(verseChip);
		expect(onJump).toHaveBeenCalledWith(1);
	});

	it("supports 1-click language stack flip and translation selection in TopBar", () => {
		const onFlip = mock(() => {});
		const onSelectEn = mock(() => {});

		render(
			<TopBar
				englishTranslations={[...BUILTIN_ENGLISH_TRANSLATIONS]}
				koreanTranslations={[...BUILTIN_KOREAN_TRANSLATIONS]}
				selectedEn={BUILTIN_ENGLISH_TRANSLATIONS[0]}
				selectedKo={BUILTIN_KOREAN_TRANSLATIONS[0]}
				stackOrder="en-first"
				theme="paper"
				fontScale={1}
				koFontStyle="serif"
				studyMask="none"
				onSelectEn={onSelectEn}
				onSelectKo={() => {}}
				onFlipStackOrder={onFlip}
				onOpenSearch={() => {}}
				onChangeTheme={() => {}}
				onChangeFontScale={() => {}}
				onChangeKoFontStyle={() => {}}
				onChangeStudyMask={() => {}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Flip language stack order" }));
		expect(onFlip).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole("button", { name: "Select English translation" }));
		fireEvent.click(screen.getByRole("menuitemradio", { name: /Berean Standard Bible/ }));
		expect(onSelectEn).toHaveBeenCalledTimes(1);
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

	it("renders synced human audio controls and reports unavailable tracks honestly", () => {
		const onSelectLanguage = mock(() => {});

		const { rerender } = render(
			<FloatingBottomBar
				bookEn="Genesis"
				bookKo="창세기"
				chapter={1}
				hasPrev={false}
				hasNext={true}
				onPrevChapter={() => {}}
				onNextChapter={() => {}}
				onOpenPicker={() => {}}
				audioDrawerOpen={true}
				onToggleAudioDrawer={() => {}}
				tracks={[
					{
						id: "helloao:krv:wordproject",
						label: "Wordproject Reader (KRV)",
						language: "ko",
						translationId: "krv",
						url: "https://audio.bible.helloao.org/api/kor_old/GEN/1/audio/wordproject.mp3",
						source: "helloao",
					},
				]}
				preferredLang="ko"
				activeTrack={{
					id: "helloao:krv:wordproject",
					label: "Wordproject Reader (KRV)",
					language: "ko",
					translationId: "krv",
					url: "https://audio.bible.helloao.org/api/kor_old/GEN/1/audio/wordproject.mp3",
					source: "helloao",
				}}
				isPlaying={false}
				isLoading={false}
				currentTime={0}
				duration={120}
				playbackRate={1}
				autoAdvance={true}
				errorMessage={null}
				activeEnCode="ESV"
				activeKoCode="개역한글"
				onTogglePlay={() => {}}
				onSeek={() => {}}
				onSkipBy={() => {}}
				onSelectTrack={() => {}}
				onSelectLanguage={onSelectLanguage}
				onCycleSpeed={() => {}}
				onToggleAutoAdvance={() => {}}
			/>,
		);

		expect(screen.getByText("Wordproject Reader (KRV)")).toBeDefined();
		expect(screen.getByRole("button", { name: "Play audio" })).toBeDefined();

		rerender(
			<FloatingBottomBar
				bookEn="Genesis"
				bookKo="창세기"
				chapter={1}
				hasPrev={false}
				hasNext={true}
				onPrevChapter={() => {}}
				onNextChapter={() => {}}
				onOpenPicker={() => {}}
				audioDrawerOpen={true}
				onToggleAudioDrawer={() => {}}
				tracks={[
					{
						id: "helloao:krv:wordproject",
						label: "Wordproject Reader (KRV)",
						language: "ko",
						translationId: "krv",
						url: "https://audio.bible.helloao.org/api/kor_old/GEN/1/audio/wordproject.mp3",
						source: "helloao",
					},
				]}
				preferredLang="en"
				activeTrack={null}
				isPlaying={false}
				isLoading={false}
				currentTime={0}
				duration={0}
				playbackRate={1}
				autoAdvance={true}
				errorMessage={null}
				activeEnCode="ESV"
				activeKoCode="개역한글"
				onTogglePlay={() => {}}
				onSeek={() => {}}
				onSkipBy={() => {}}
				onSelectTrack={() => {}}
				onSelectLanguage={onSelectLanguage}
				onCycleSpeed={() => {}}
				onToggleAutoAdvance={() => {}}
			/>,
		);

		expect(screen.getByText(/No human audio recording is linked/)).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: /Switch to Korean Audio/ }));
		expect(onSelectLanguage).toHaveBeenCalledWith("ko");
	});
});
