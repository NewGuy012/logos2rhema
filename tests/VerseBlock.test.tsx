import "./dom";

import { afterEach, describe, expect, it, mock } from "bun:test";

import { act, type ComponentProps, StrictMode } from "react";

import App from "../src/react-app/App";
import { AudioControlRail } from "../src/react-app/components/AudioControlRail";
import { FavoritesList } from "../src/react-app/components/FavoritesList";
import { FloatingBottomBar } from "../src/react-app/components/FloatingBottomBar";
import { HomePage } from "../src/react-app/components/HomePage";
import { PassagePicker } from "../src/react-app/components/PassagePicker";
import { StudyRightRail } from "../src/react-app/components/StudyRightRail";
import { TopBar } from "../src/react-app/components/TopBar";
import { VerseBlock } from "../src/react-app/components/VerseBlock";
import { useHumanAudio } from "../src/react-app/hooks/useHumanAudio";
import { readStoredFavorites } from "../src/react-app/lib/favorites";
import { readStoredHighlights } from "../src/react-app/lib/highlights";
import {
	SUPERTONIC_LICENSE_NAME,
	SUPERTONIC_LICENSE_URL,
	SUPERTONIC_MOBILE_BADGE,
	SUPERTONIC_TRACK_ATTRIBUTION,
} from "../src/shared/audio-timings";
import { analyzeKoreanChapter } from "../src/shared/korean-morphology";
import {
	cleanupDom,
	createReaderFetchHandler,
	fireClick,
	fireDrag,
	fireHover,
	getButton,
	getByText,
	installMockAudio,
	makeBookResponse,
	makeChapterResponse,
	makeSupertonicTrack,
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
	const spoken: Array<{ text: string; lang: string; rate: number }> = [];
	const origSynth = Object.getOwnPropertyDescriptor(window, "speechSynthesis");
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
			cancel: noop,
			getVoices: () => [{ lang: "ko-KR", localService: true, name: "Yuna" }],
			speak: (u: MockUtterance) => {
				spoken.push({ text: u.text, lang: u.lang, rate: u.rate });
				u.onstart?.();
				u.onend?.();
			},
		},
	});

	return {
		spoken,
		restore: () => {
			if (origSynth) Object.defineProperty(window, "speechSynthesis", origSynth);
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

const baseAudioProps = {
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

describe("Reader UI & Audio Hooks", () => {
	afterEach(cleanupDom);
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

	it("handles VerseBlock order, selection filtering, and KoreanToken tooltip/speech", async () => {
		const onToggleFavorite = mock(() => {});
		const onSelectFootnote = mock(() => {});
		const onSelectVerse = mock((_n: number) => {});
		const verseProps = makeVerseProps({
			verse: {
				...sampleVerse,
				heading: "The Creation",
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
			onSelectVerse,
		});

		const { container, rerender } = render(<VerseBlock {...verseProps} />);
		fireClick(getButton(container, "Bookmark verse 1"));
		expect(onToggleFavorite).toHaveBeenCalledTimes(1);
		expect(onSelectVerse).not.toHaveBeenCalled();

		// Clicking prose/heading selects verse; clicking during text selection does not
		fireClick(container.querySelector(".verse-en") as Element);
		fireClick(container.querySelector(".verse-heading") as Element);
		expect(onSelectVerse).toHaveBeenCalledTimes(2);

		const enLine = container.querySelector(".verse-en") as HTMLElement;
		const sel = selectTextRange(enLine.firstChild as Text, 7, 16);
		fireClick(enLine);
		expect(onSelectVerse).toHaveBeenCalledTimes(2);
		sel?.removeAllRanges();

		rerender(<VerseBlock {...verseProps} stackOrder="ko-first" isFavorited={true} />);
		expect(container.querySelectorAll(".verse-lines > p")[0]?.className).toContain("verse-ko");

		const wordBtn = getButton(container, "창조하시니라");
		const { spoken, restore } = setupMockKoreanSpeech();
		try {
			fireHover(wordBtn, true);
			const tooltip = document.body.querySelector('[role="tooltip"]') as HTMLElement;
			expect(tooltip.textContent).toContain("to create");
			expect(tooltip.textContent).toContain("[chang-jo-ha-si-ni-ra]");
			expect(tooltip.querySelector(".ko-tooltip-word")?.getAttribute("lang")).toBe("ko");

			fireClick(getButton(tooltip, "Pronounce 창조하시니라"));
			fireClick(getButton(tooltip, "Pronounce root 창조하다"));
			expect(spoken.map((s) => s.text)).toEqual(["창조하시니라", "창조하다"]);

			// Leaving the word enters a brief grace period so moving into the tooltip stays open,
			// then leaving the tooltip closes immediately
			fireHover(wordBtn, false);
			expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();
			fireHover(tooltip, true);
			await act(async () => {
				await new Promise((r) => setTimeout(r, 70));
			});
			expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();
			fireHover(tooltip, false);
			expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

			// Hovering another Korean word immediately replaces any open tooltip, and leaving it closes promptly
			const otherWordBtn = getButton(container, "하나님이");
			fireHover(wordBtn, true);
			fireHover(otherWordBtn, true);
			const activeTooltips = document.body.querySelectorAll('[role="tooltip"]');
			expect(activeTooltips.length).toBe(1);
			expect(activeTooltips[0]?.textContent).toContain("하나님이");
			fireHover(otherWordBtn, false);
			await waitUntil(() => {
				expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
			});

			fireClick(wordBtn);
			expect(onSelectFootnote).toHaveBeenCalledWith("vocab-창조하다");

			fireHover(wordBtn, true);
			act(() => {
				document.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
				);
			});
			expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

			// Turning wordTooltip off hides any open tooltip and blocks hover/focus tooltips while keeping click lookup
			fireHover(wordBtn, true);
			expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();
			rerender(<VerseBlock {...verseProps} wordTooltip={false} />);
			expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
			fireHover(wordBtn, true);
			act(() => {
				wordBtn.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
			});
			expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
			fireClick(getButton(container, "낯선말"));
			expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
			fireClick(wordBtn);
			expect(onSelectFootnote).toHaveBeenCalledWith("vocab-창조하다");
		} finally {
			restore();
		}
	});

	it("renders FootnotesGuide disclosures, multi-verse menu, search, and scroll highlight", () => {
		const onJump = mock(() => {});
		const footnotes = [
			...analysis.footnotes,
			{
				id: "vocab-여호와",
				lemma: "여호와",
				surfaceForms: ["여호와", "여호와께"],
				verses: [4, 5, 7, 8, 10],
				gloss: "the LORD (Yahweh)",
				pos: "name" as const,
			},
		];
		const railProps: ComponentProps<typeof StudyRightRail> = {
			activeTab: "dictionary",
			onChangeTab: noop,
			onMinimize: noop,
			bookEn: "Genesis",
			bookKo: "창세기",
			chapter: 1,
			footnotes,
			grammarNotes: analysis.grammarNotes,
			highlightedFootnoteId: null,
			commentarySource: "tyndale",
			commentaryData: null,
			commentaryLoading: false,
			commentaryError: null,
			selectedVerse: null,
			onChangeCommentarySource: noop,
			onRetryCommentary: noop,
			onJumpToVerse: onJump,
		};

		const { container, rerender } = render(<StudyRightRail {...railProps} />);
		expect(container.querySelector(".vocab-list")).toBeNull();
		fireClick(getButton(container, `Words (${footnotes.length})`));
		expect(getByText(container, "[chang-jo-ha-da]")).toBeDefined();

		// Multi-verse menu & jump
		const multiRow = container.querySelector('[data-footnote-id="vocab-여호와"]') as ParentNode;
		fireClick(getButton(multiRow, "여호와 verses: v.4 and 4 more"));
		const verseMenu = document.body.querySelector(".verse-ref-menu") as ParentNode;
		expect(verseMenu.querySelectorAll(".verse-ref-menu-item")).toHaveLength(5);
		fireClick(getButton(verseMenu, "v.8"));
		expect(onJump).toHaveBeenCalledWith(8);
		expect(document.body.querySelector(".verse-ref-menu")).toBeNull();

		// Search auto-filters, tapping verse word clears filter and scrolls into view
		const dictSearch = container.querySelector("input[type='search']") as HTMLInputElement;
		setInputValue(dictSearch, "태초");
		expect(container.querySelector('[data-footnote-id="vocab-창조하다"]')).toBeNull();

		const scrolledIds: string[] = [];
		const origScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
		window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
			if (this.dataset.footnoteId) scrolledIds.push(this.dataset.footnoteId);
		};
		try {
			rerender(
				<StudyRightRail {...railProps} highlightedFootnoteId="vocab-창조하다" highlightSeq={1} />,
			);
			expect(dictSearch.value).toBe("");
			expect(scrolledIds.at(-1)).toBe("vocab-창조하다");
		} finally {
			window.HTMLElement.prototype.scrollIntoView = origScrollIntoView;
		}
	});

	it("handles TopBar, HomePage scripture/genres/search, PassagePicker, and FavoritesList", async () => {
		const onChangePref = mock(() => {});
		const onOpenPassage = mock(() => {});
		const onClearFav = mock(() => {});
		const onClearHl = mock(() => {});

		const topBarProps: ComponentProps<typeof TopBar> = {
			lastBookNumber: 8,
			lastChapter: 4,
			lastVerse: 12,
			prefs: {
				stackOrder: "en-first",
				theme: "paper",
				fontScale: 1,
				enFontStyle: "serif",
				koFontStyle: "serif",
				studyMask: "none",
			},
			onGoHome: noop,
			onContinueReading: noop,
			onOpenPassage,
			onChangePref,
			onOpenSearch: noop,
		};
		const topBar = render(<TopBar {...topBarProps} />);
		fireClick(getButton(topBar.container, "Reader appearance settings"));
		fireClick(getButton(topBar.container, /^\s*Sans\s*$/));
		expect(onChangePref).toHaveBeenCalledWith({ enFontStyle: "sans" });
		topBar.rerender(<TopBar activeView="home" {...topBarProps} />);
		expect(topBar.container.querySelector(".appearance-btn")).toBeNull();

		await withMockFetch(
			() => new Response(null, { status: 404 }),
			async () => {
				const home = render(
					<HomePage
						lastBookNumber={8}
						lastChapter={4}
						lastVerse={12}
						onOpenPassage={onOpenPassage}
					/>,
				);
				await waitUntil(() =>
					expect(getByText(home.container, "English (ESV) unavailable")).toBeDefined(),
				);
				const browse = home.container.querySelector('section[aria-label="Browse"]') as ParentNode;
				const browseToggle = getButton(browse, "Browse");
				expect(browseToggle.getAttribute("aria-expanded")).toBe("false");
				expect(browse.querySelectorAll(".books-grid-vertical")).toHaveLength(0);
				fireClick(browseToggle);
				expect(browseToggle.getAttribute("aria-expanded")).toBe("true");
				expect(browse.querySelectorAll(".books-grid-vertical")).toHaveLength(2);
				fireClick(getButton(browse, "Genres"));
				expect(browse.querySelectorAll(".home-genre-card")).toHaveLength(10);
				fireClick(getButton(browse, /Obadiah/));
				expect(onOpenPassage).toHaveBeenCalledWith(31, 1);

				const homeInput = home.container.querySelector("input[type='search']") as HTMLInputElement;
				setInputValue(homeInput, "시 23");
				submitForm(homeInput.closest("form") as HTMLFormElement);
				expect(onOpenPassage).toHaveBeenCalledWith(19, 23, undefined);

				fireClick(browseToggle);
				expect(browseToggle.getAttribute("aria-expanded")).toBe("false");
				expect(browse.querySelector(".home-browse-content")).toBeNull();
			},
		);

		const picker = render(
			<PassagePicker
				isOpen={true}
				currentBookNumber={1}
				currentChapter={1}
				onClose={noop}
				onNavigate={onOpenPassage}
			/>,
		);
		const pickerInput = picker.container.querySelector("input[type='search']") as HTMLInputElement;
		setInputValue(pickerInput, "요 3:16");
		submitForm(pickerInput.closest("form") as HTMLFormElement);
		expect(onOpenPassage).toHaveBeenCalledWith(43, 3, 16);

		const list = render(
			<FavoritesList
				favorites={[{ id: "43:3:16", bookNumber: 43, chapter: 3, verse: 16, createdAt: 1 }]}
				highlights={[
					{
						id: "1:1:1:en:0-5",
						bookNumber: 1,
						chapter: 1,
						verse: 1,
						lang: "en",
						start: 0,
						end: 5,
						text: "In th",
						createdAt: 1,
					},
				]}
				onSelectFavorite={noop}
				onClearFavorites={onClearFav}
				onClearHighlights={onClearHl}
			/>,
		);
		fireClick(getButton(list.container, "Clear all bookmarks and highlights"));
		expect(onClearFav).toHaveBeenCalledTimes(1);
		expect(onClearHl).toHaveBeenCalledTimes(1);
	});

	it("renders App reader end-to-end: settings, rails, bookmarks, highlights, ESV retry, audio follow, LegalFooter, and deep-link scroll", async () => {
		localStorage.setItem("logos.reader.preferences.v1", JSON.stringify({ enFontStyle: "invalid" }));
		window.location.hash = "#/GEN/1/2";
		const restoreMatchMedia = mockMatchMedia(true);
		const mockAudio = installMockAudio({ initialTime: 1.5, emitTimeUpdateOnPlay: true });
		let esvCalls = 0;

		const scrolledIds: string[] = [];
		const origScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
		window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
			if (this.id) scrolledIds.push(this.id);
		};

		try {
			await withMockFetch(
				createReaderFetchHandler({
					krv: () =>
						makeBookResponse("krv", 1, "GEN", {
							"1": [
								{ verse: 1, text: "보아스가 성문에 올라가서 거기 앉았더니" },
								{ verse: 2, text: "장로 십 인을 청하여 가로되" },
							],
							"2": [{ verse: 1, text: "천지와 만물이 다 이루니라" }],
						}),
					esv: (url) => {
						esvCalls++;
						if (esvCalls === 1) {
							return Response.json({ error: "ESV API rate limit reached." }, { status: 429 });
						}
						return url.endsWith("/GEN/2")
							? makeChapterResponse("esv", 1, "GEN", 2, [
									{ verse: 1, text: "Thus the heavens and the earth were finished." },
								])
							: makeChapterResponse("esv", 1, "GEN", 1, [
									{ verse: 1, text: "In the beginning, God created." },
									{ verse: 2, text: "The earth was without form." },
								]);
					},
					audio: () =>
						Response.json({
							tracks: [makeSupertonicTrack("https://cdn.example.com/krv/GEN/1.mp3")],
						}),
					timings: () => Response.json({ chapters: { "1": { "1": 1.2, "2": 5.0 } } }),
				}),
				async () => {
					const { container } = render(<App />);

					// Deep-link #/GEN/1/2 waits for async chapter load then scrolls to #verse-2
					await waitUntil(() => {
						expect(getByText(container, "보아스가")).toBeDefined();
						expect(scrolledIds).toContain("verse-2");
						expect(getByText(container, "English (ESV) unavailable")).toBeDefined();
					});

					// Verify LegalFooter 3-line compliance once
					const footer = container.querySelector("footer.copyright-footer") as HTMLElement;
					expect(footer.querySelector(".footer-motto-verse")).toBeNull();
					const lines = Array.from(footer.querySelectorAll(".copyright-footer-line")).map((el) =>
						(el.textContent ?? "").trim(),
					);
					expect(lines).toHaveLength(3);
					expect(lines[0]).toContain("대한성서공회");
					expect(lines[1]).toContain("AI 낭독");
					expect(lines[2]).toContain("ESV® Bible");
					expect(footer.querySelector(`a[href="${SUPERTONIC_LICENSE_URL}"]`)?.textContent).toBe(
						SUPERTONIC_LICENSE_NAME,
					);
					expect(footer.querySelector('a[href="https://www.esv.org"]')).not.toBeNull();

					// Retry ESV 429 error
					fireClick(getButton(container, "Retry"));
					await waitUntil(() => {
						expect(getByText(container, "In the beginning, God created.")).toBeDefined();
						expect(container.querySelector(".en-load-banner")).toBeNull();
					});

					// Appearance setting persists via data attribute
					const appShell = container.querySelector(".app-shell") as HTMLElement;
					expect(appShell.getAttribute("data-en-font")).toBe("serif");
					fireClick(getButton(container, "Reader appearance settings"));
					fireClick(getButton(container.querySelector(".settings-popover")!, /^\s*Sans\s*$/));
					expect(appShell.getAttribute("data-en-font")).toBe("sans");
					expect(localStorage.getItem("logos.reader.preferences.v1")).toContain(
						'"enFontStyle":"sans"',
					);
					fireClick(getButton(container, "Reader appearance settings"));

					// Rail drag z-order & snap-back
					const audioPanel = container.querySelector(".audio-rail") as HTMLElement;
					const dictPanel = container.querySelector("#footnotes") as HTMLElement;
					fireDrag(audioPanel.querySelector(".rail-panel-header")!, [20, 20], [200, 140]);
					fireDrag(dictPanel.querySelector(".dict-panel-header")!, [20, 20], [320, 180]);
					expect(dictPanel.style.zIndex).toBe("46");
					expect(audioPanel.style.zIndex).toBe("45");
					fireClick(getButton(container, "Snap audio back to original position"));
					fireClick(getButton(container, "Snap dictionary back to original position"));

					// Bookmarks & text highlight via ⌘H
					fireClick(getButton(container, "Bookmark Genesis 1"));
					fireClick(getButton(container, "Bookmark verse 1"));
					expect(readStoredFavorites()).toHaveLength(2);

					const enLine = container.querySelector('.verse-en[data-verse="1"]') as HTMLElement;
					selectTextRange(enLine.firstChild as Text, 7, 16);
					act(() => {
						window.dispatchEvent(
							new window.KeyboardEvent("keydown", { key: "h", metaKey: true, bubbles: true }),
						);
					});
					expect(enLine.querySelector("mark.verse-highlight")?.textContent).toBe("beginning");
					expect(readStoredHighlights()).toHaveLength(1);

					// Audio follow ignores sidebar/popover wheel, pauses on reader wheel
					fireClick(getButton(audioPanel, "Play audio"));
					await waitUntil(() =>
						expect(container.querySelector("#verse-1")?.className).toContain("audio-active"),
					);
					act(() => {
						container
							.querySelector(".dict-sidebar-wrap")
							?.dispatchEvent(new window.WheelEvent("wheel", { deltaY: 120, bubbles: true }));
					});
					expect(container.querySelector(".rail-follow-btn")).toBeNull();
					act(() => {
						container
							.querySelector("#verse-1")
							?.dispatchEvent(new window.WheelEvent("wheel", { deltaY: 120, bubbles: true }));
					});
					fireClick(getButton(container, "Follow Audio (v.1)"));
					expect(container.querySelector(".rail-follow-btn")).toBeNull();
				},
			);
		} finally {
			window.HTMLElement.prototype.scrollIntoView = origScrollIntoView;
			mockAudio.restore();
			restoreMatchMedia();
		}
	});

	it("defers ESV audio API fetch until EN is selected, preserves autoplay on swap, and keeps KO fallback", async () => {
		window.location.hash = "#/GEN/1";
		const restoreMatchMedia = mockMatchMedia(true);
		const mockAudio = installMockAudio({ initialTime: 1.0, emitTimeUpdateOnPlay: true });
		const audioUrls: string[] = [];
		let resolveDeferredEn: ((res: Response) => void) | null = null;

		try {
			await withMockFetch(
				createReaderFetchHandler({
					krv: () =>
						makeBookResponse("krv", 1, "GEN", {
							"1": [{ verse: 1, text: "태초에 하나님이 천지를 창조하시니라" }],
							"2": [{ verse: 1, text: "천지와 만물이 다 이루니라" }],
						}),
					esv: (url) =>
						makeChapterResponse("esv", 1, "GEN", url.endsWith("/2") ? 2 : 1, [
							{ verse: 1, text: "In the beginning." },
						]),
					audio: (url) => {
						audioUrls.push(url);
						const parsed = new URL(url, "https://app.local");
						const lang = parsed.searchParams.get("lang");
						if (parsed.pathname === "/api/audio/GEN/1" && lang === "en") {
							return new Promise<Response>((resolve) => {
								resolveDeferredEn = resolve;
							});
						}
						if (parsed.pathname === "/api/audio/GEN/2" && lang === "en") {
							return Response.json({ tracks: [] });
						}
						return Response.json({
							tracks: [makeSupertonicTrack(`/api/audio/krv/${parsed.pathname.slice(11)}`)],
						});
					},
				}),
				async () => {
					const { container } = render(<App />);

					await waitUntil(() => {
						expect(getByText(container, "태초에")).toBeDefined();
						expect(audioUrls).toEqual(["/api/audio/GEN/1?lang=ko"]);
					});

					// Play KO audio, then click EN -> shows loading without unavailable flash, then auto-plays ESV track
					const audioPanel = container.querySelector(".audio-rail") as HTMLElement;
					fireClick(getButton(audioPanel, "Play audio"));
					await waitUntil(() => expect(getButton(audioPanel, "Pause audio")).toBeDefined());

					fireClick(getButton(audioPanel, "EN"));
					await waitUntil(() => {
						expect(audioUrls).toEqual(["/api/audio/GEN/1?lang=ko", "/api/audio/GEN/1?lang=en"]);
						expect(getByText(audioPanel, "Checking available audio tracks...")).toBeDefined();
					});
					expect(audioPanel.textContent).not.toContain("No ESV audio for this chapter.");
					expect(container.querySelector(".quick-strip-unavailable")).toBeNull();

					resolveDeferredEn!(
						Response.json({
							tracks: [
								{
									id: "esv-api:GEN:1",
									label: "David Cochran Heath (ESV)",
									language: "en",
									url: "https://audio.esv.org/hw/gen1.mp3",
								},
							],
						}),
					);
					await waitUntil(() => {
						expect(getByText(audioPanel, "David Cochran Heath (ESV)")).toBeDefined();
						expect(mockAudio.latest()?.src).toBe("https://audio.esv.org/hw/gen1.mp3");
						expect(getButton(audioPanel, "Pause audio")).toBeDefined();
					});

					// Toggling 한 -> EN on the same chapter does not re-fetch lang=en
					fireClick(getButton(audioPanel, "한"));
					fireClick(getButton(audioPanel, "EN"));
					expect(audioUrls.filter((u) => u === "/api/audio/GEN/1?lang=en")).toHaveLength(1);

					// Switching back to 한 before navigating keeps GEN 2 KO-only; clicking EN on GEN 2 keeps KO fallback if ESV returns []
					fireClick(getButton(audioPanel, "한"));
					fireClick(getButton(container, "Next Chapter"));
					await waitUntil(() => {
						expect(audioUrls).toContain("/api/audio/GEN/2?lang=ko");
						expect(getByText(container, "천지와 만물이 다 이루니라")).toBeDefined();
						expect(getByText(audioPanel, SUPERTONIC_TRACK_ATTRIBUTION)).toBeDefined();
					});
					expect(
						audioUrls.some((u) => u.startsWith("/api/audio/GEN/2") && !u.includes("lang=ko")),
					).toBe(false);

					fireClick(getButton(audioPanel, "EN"));
					await waitUntil(() => {
						expect(audioUrls).toContain("/api/audio/GEN/2?lang=en");
						expect(getByText(audioPanel, "No ESV audio for this chapter.")).toBeDefined();
						expect(getButton(audioPanel, "Use 개역한글 Audio")).toBeDefined();
					});
				},
			);
		} finally {
			mockAudio.restore();
			restoreMatchMedia();
		}
	});

	it("toggles automatic word tooltips on/off from the Dictionary panel and persists the preference", async () => {
		window.location.hash = "#/GEN/1";
		const restoreMatchMedia = mockMatchMedia(true);

		try {
			await withMockFetch(
				createReaderFetchHandler({
					krv: () =>
						makeBookResponse("krv", 1, "GEN", {
							"1": [{ verse: 1, text: "태초에 하나님이 천지를 창조하시니라" }],
						}),
					esv: () =>
						makeChapterResponse("esv", 1, "GEN", 1, [
							{ verse: 1, text: "In the beginning, God created the heavens and the earth." },
						]),
				}),
				async () => {
					const { container } = render(<App />);

					await waitUntil(() => {
						expect(getByText(container, "창조하시니라")).toBeDefined();
					});

					const dictPanel = container.querySelector("#footnotes") as HTMLElement;
					const tooltipSwitch = getButton(dictPanel, "Toggle word translation tooltips");
					expect(tooltipSwitch.getAttribute("aria-checked")).toBe("true");
					expect(tooltipSwitch.textContent).toBe("On");

					// Default: hovering a Korean word opens the tooltip
					const wordBtn = getButton(container, "창조하시니라");
					fireHover(wordBtn, true);
					expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();

					// Turn off tooltips in Dictionary -> closes active tooltip and suppresses hover tooltips
					fireClick(tooltipSwitch);
					expect(tooltipSwitch.getAttribute("aria-checked")).toBe("false");
					expect(tooltipSwitch.textContent).toBe("Off");
					expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
					expect(localStorage.getItem("logos.reader.preferences.v1")).toContain(
						'"wordTooltip":false',
					);

					fireHover(wordBtn, true);
					expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

					// Clicking a word still jumps to it in the Dictionary even with tooltips off
					fireClick(wordBtn);
					expect(dictPanel.querySelector('[data-footnote-id="vocab-창조하다"]')).not.toBeNull();

					// Turn tooltips back on
					fireClick(tooltipSwitch);
					expect(tooltipSwitch.getAttribute("aria-checked")).toBe("true");
					expect(tooltipSwitch.textContent).toBe("On");
					fireHover(wordBtn, true);
					expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();
				},
			);
		} finally {
			restoreMatchMedia();
		}
	});

	it("renders audio controls/speed menu and verifies useHumanAudio auto-advance, active-lang stability, deferred seek, and URL safety", async () => {
		const onChangeSpeed = mock((_r: number) => {});
		const onSkipBy = mock((_d: number) => {});
		const track = makeSupertonicTrack("/api/audio/krv/JHN/3", { 1: 2.3, 12: 34.5, 16: 48.2 });

		const bar = render(
			<FloatingBottomBar
				{...baseAudioProps}
				tracks={[track]}
				activeTrack={track}
				isPlaying={true}
				currentTime={15}
				dictionaryOpen={false}
				onToggleDictionary={noop}
				onSkipBy={onSkipBy}
			/>,
		);
		expect(bar.container.querySelector(".quick-strip-ai-badge")?.textContent).toBe(
			SUPERTONIC_MOBILE_BADGE,
		);
		fireClick(getButton(bar.container, "Rewind 10 seconds"));
		fireClick(getButton(bar.container, "Forward 10 seconds"));
		expect(onSkipBy).toHaveBeenNthCalledWith(1, -10);
		expect(onSkipBy).toHaveBeenNthCalledWith(2, 10);

		const rail = render(
			<AudioControlRail
				{...baseAudioProps}
				tracks={[track]}
				activeTrack={track}
				isPlaying={true}
				currentTime={35}
				visibleVerse={16}
				activeVerse={12}
				autoSync={true}
				isFollowingAudio={false}
				onChangeSpeed={onChangeSpeed}
				onToggleAutoSync={noop}
				onSyncToVisibleVerse={noop}
				onFollowActiveVerse={noop}
			/>,
		);
		expect(rail.container.querySelector(".rail-track-name")?.textContent).toBe(
			SUPERTONIC_TRACK_ATTRIBUTION,
		);
		fireClick(getButton(rail.container, "Playback speed"));
		const speedMenu = document.body.querySelector('.speed-menu[role="menu"]') as ParentNode;
		const speedInput = speedMenu.querySelector(
			'input[aria-label="Custom playback speed (0.1 to 2.0)"]',
		) as HTMLInputElement;
		setInputValue(speedInput, "0.05");
		submitForm(speedMenu.querySelector("form.speed-menu-custom")!);
		expect(speedInput.getAttribute("aria-invalid")).toBe("true");
		setInputValue(speedInput, "0.85");
		submitForm(speedMenu.querySelector("form.speed-menu-custom")!);
		expect(onChangeSpeed).toHaveBeenCalledWith(0.85);

		// Hook regressions: active-language re-click doesn't reset time, auto-advance survives isLoadingTracks
		const mockAudio = installMockAudio();
		try {
			const nextTrack = makeSupertonicTrack("/api/audio/krv/JHN/4", { 1: 1.0 });
			const hook = renderHook(
				(props: { tracks: (typeof track)[]; isLoadingTracks: boolean }) =>
					useHumanAudio({
						tracks: props.tracks,
						isLoadingTracks: props.isLoadingTracks,
						visibleVerse: 16,
						autoSync: true,
						onChapterEnded: () => true,
					}),
				{ tracks: [track], isLoadingTracks: false },
			);

			await act(async () => {
				hook.result.current.togglePlay();
			});
			expect(mockAudio.getCurrentTime()).toBe(48.2);

			// Clicking already-active language ("ko") must NOT reset currentTime or stall
			await act(async () => {
				hook.result.current.selectLanguage("ko");
			});
			expect(mockAudio.getCurrentTime()).toBe(48.2);
			expect(hook.result.current.isPlaying).toBe(true);

			// Chapter ended -> tracks momentarily empty while loading -> new chapter arrives -> auto-plays!
			const playsBeforeAdvance = mockAudio.latest()!.playCalls;
			await act(async () => {
				mockAudio.emit("ended");
			});
			hook.rerender({ tracks: [], isLoadingTracks: true });
			hook.rerender({ tracks: [nextTrack], isLoadingTracks: false });
			expect(mockAudio.latest()!.playCalls).toBeGreaterThan(playsBeforeAdvance);
			expect(mockAudio.latest()!.src).toBe("/api/audio/krv/JHN/4");

			// Rejects unsafe track URL
			const unsafe = renderHook(() =>
				useHumanAudio({
					tracks: [{ id: "bad", label: "Bad", language: "ko", url: "javascript:alert(1)" }],
				}),
			);
			expect(unsafe.result.current.errorMessage).toBe("Audio stream URL was rejected.");

			// Deferred seek when readyState === 0
			mockAudio.restore();
			const deferred = installMockAudio({ readyState: 0 });
			try {
				const dHook = renderHook(() =>
					useHumanAudio({ tracks: [track], visibleVerse: 16, autoSync: true }),
				);
				await act(async () => {
					dHook.result.current.togglePlay();
				});
				expect(deferred.getCurrentTime()).toBe(0);
				await act(async () => {
					deferred.emit("loadedmetadata");
				});
				expect(deferred.getCurrentTime()).toBe(48.2);
			} finally {
				deferred.restore();
			}
		} finally {
			mockAudio.restore();
		}
	});

	it("loads ESV chapter and commentary cleanly under React StrictMode double-effect mounts", async () => {
		window.location.hash = "#/GEN/1";
		const restoreMatchMedia = mockMatchMedia(true);
		const rawHandler = createReaderFetchHandler({
			krv: () =>
				makeBookResponse("krv", 1, "GEN", {
					"1": [{ verse: 1, text: "태초에 하나님이 천지를 창조하시니라" }],
				}),
			esv: () =>
				makeChapterResponse("esv", 1, "GEN", 1, [
					{ verse: 1, text: "In the beginning, God created the heavens and the earth." },
				]),
			commentary: () =>
				Response.json({
					entries: [
						{
							id: "tyndale:GEN:1:1",
							verseStart: 1,
							paragraphs: ["StrictMode commentary loaded."],
						},
					],
				}),
		});

		try {
			await withMockFetch(
				(url, init) =>
					new Promise((resolve, reject) => {
						const signal = init?.signal;
						if (signal?.aborted) {
							reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
							return;
						}
						const onAbort = () => {
							reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
						};
						signal?.addEventListener("abort", onAbort, { once: true });
						queueMicrotask(() => {
							Promise.resolve(rawHandler(url)).then(
								(res) => {
									signal?.removeEventListener("abort", onAbort);
									if (signal?.aborted) onAbort();
									else resolve(res);
								},
								(err) => {
									signal?.removeEventListener("abort", onAbort);
									reject(err);
								},
							);
						});
					}),
				async () => {
					const { container } = render(
						<StrictMode>
							<App />
						</StrictMode>,
					);

					await waitUntil(() => {
						expect(
							getByText(container, "In the beginning, God created the heavens and the earth."),
						).toBeDefined();
						expect(getByText(container, "태초에")).toBeDefined();
						expect(container.querySelector(".en-load-banner")).toBeNull();
					});

					fireClick(getButton(container, "Commentary"));
					await waitUntil(() => {
						expect(getByText(container, "StrictMode commentary loaded.")).toBeDefined();
					});
				},
			);
		} finally {
			restoreMatchMedia();
		}
	});
});
