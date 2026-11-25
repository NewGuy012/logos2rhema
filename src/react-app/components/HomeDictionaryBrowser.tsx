import { useEffect, useMemo, useState } from "react";

import { BIBLICAL_GLOSSARY, KRV_GRAMMAR_RULES } from "../../shared/biblical-glossary";
import { containsHangul, romanizeHangul } from "../../shared/hangul";
import { analyzeKoreanChapter } from "../../shared/korean-morphology";
import { CANONICAL_BIBLES } from "../../shared/translations";
import type { LexiconEntry, LexiconMap, RightRailTab, VerseEntry } from "../../shared/types";
import { useKoreanSpeech } from "../hooks/useKoreanSpeech";
import { loadLexicon, loadTranslationChapter } from "../lib/bible-loader";
import { HomePassageBar, usePassageSelection } from "./HomeStudyShared";
import {
	filterVocabEntries,
	GrammarRuleCard,
	PanelDisclosure,
	PanelSearchInput,
	PanelStatus,
	SegmentedControl,
	toggleSetItem,
	VocabEntryBody,
} from "./RailShared";

type DictionaryMode = "glossary" | "chapter" | "grammar";
type GlossaryFilter = "all" | "biblical" | "noun" | "verb" | "adj" | "adv" | "name";

const PAGE_SIZE = 60;

const DICTIONARY_MODES: ReadonlyArray<{ value: DictionaryMode; label: string }> = [
	{ value: "glossary", label: "Glossary & Lexicon" },
	{ value: "chapter", label: "By Chapter" },
	{ value: "grammar", label: "KRV Grammar" },
];

const GLOSSARY_FILTERS: ReadonlyArray<{ id: GlossaryFilter; label: string }> = [
	{ id: "all", label: "All" },
	{ id: "biblical", label: "Biblical" },
	{ id: "noun", label: "Nouns" },
	{ id: "verb", label: "Verbs" },
	{ id: "adj", label: "Adjectives" },
	{ id: "adv", label: "Adverbs" },
	{ id: "name", label: "Names" },
];

interface MergedDictEntry {
	lemma: string;
	gloss: string;
	glossLower: string;
	hanja?: string;
	pos?: LexiconEntry["pos"];
	romanized: string;
	romanizedSearch: string;
	isBiblical: boolean;
}

const mergedEntriesCache = new WeakMap<LexiconMap, MergedDictEntry[]>();

function buildMergedEntries(lexicon: LexiconMap): MergedDictEntry[] {
	const cached = mergedEntriesCache.get(lexicon);
	if (cached) return cached;

	const entries: MergedDictEntry[] = [];
	const sources: ReadonlyArray<readonly [LexiconMap, boolean]> = [
		[BIBLICAL_GLOSSARY, true],
		[lexicon, false],
	];

	for (const [source, isBiblical] of sources) {
		for (const [lemma, item] of Object.entries(source)) {
			if (!item || (!isBiblical && Object.hasOwn(BIBLICAL_GLOSSARY, lemma))) continue;
			const romanized = containsHangul(lemma) ? romanizeHangul(lemma) : "";
			entries.push({
				lemma,
				gloss: item.gloss,
				glossLower: item.gloss.toLowerCase(),
				hanja: item.hanja,
				pos: item.pos,
				romanized,
				romanizedSearch: romanized.toLowerCase().replace(/-/g, ""),
				isBiblical,
			});
		}
	}

	mergedEntriesCache.set(lexicon, entries);
	return entries;
}

function scoreMatch(
	entry: MergedDictEntry,
	trimmed: string,
	lower: string,
	romanizedQuery: string,
): number {
	if (entry.lemma === trimmed || entry.glossLower === lower) return 0;
	if (
		entry.lemma.startsWith(trimmed) ||
		entry.glossLower.startsWith(lower) ||
		(romanizedQuery.length > 0 && entry.romanizedSearch.startsWith(romanizedQuery))
	) {
		return entry.isBiblical ? 1 : 2;
	}
	return entry.isBiblical ? 3 : 4;
}

interface HomeDictionaryBrowserProps {
	initialBookNumber: number;
	initialChapter: number;
	lexicon?: LexiconMap;
	onOpenPassage: (
		bookNumber: number,
		chapter: number,
		verse?: number,
		options?: { rightRailTab?: RightRailTab },
	) => void;
}

export function HomeDictionaryBrowser({
	initialBookNumber,
	initialChapter,
	lexicon: externalLexicon,
	onOpenPassage,
}: HomeDictionaryBrowserProps) {
	const [mode, setMode] = useState<DictionaryMode>("glossary");
	const [glossaryQuery, setGlossaryQuery] = useState("");
	const [posFilter, setPosFilter] = useState<GlossaryFilter>("all");
	const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

	const [internalLexicon, setInternalLexicon] = useState<LexiconMap>({});
	const [internalLexiconLoading, setInternalLexiconLoading] = useState(
		() => externalLexicon === undefined,
	);
	const lexicon = externalLexicon ?? internalLexicon;
	const lexiconLoading = externalLexicon === undefined && internalLexiconLoading;

	const {
		book: currentBook,
		chapter,
		selectPassage: handleChangePassage,
	} = usePassageSelection(initialBookNumber, initialChapter);
	const [chapterQuery, setChapterQuery] = useState("");
	const [chapterVerses, setChapterVerses] = useState<VerseEntry[]>([]);
	const [chapterLoading, setChapterLoading] = useState(false);
	const [chapterError, setChapterError] = useState<string | null>(null);
	const [chapterRetrySeq, setChapterRetrySeq] = useState(0);
	const [chapterGrammarOpen, setChapterGrammarOpen] = useState(true);
	const [chapterVisibleLimit, setChapterVisibleLimit] = useState(PAGE_SIZE);
	const [expandedVerseLists, setExpandedVerseLists] = useState<Set<string>>(() => new Set());

	const {
		speakingKey,
		speechErrorKey,
		speak: handleSpeak,
		clearSpeechError,
	} = useKoreanSpeech<string>();

	useEffect(() => {
		if (externalLexicon !== undefined) return;
		let cancelled = false;
		setInternalLexiconLoading(true);
		loadLexicon()
			.then((lex) => {
				if (cancelled) return;
				setInternalLexicon(lex);
				setInternalLexiconLoading(false);
			})
			.catch(() => {
				if (cancelled) return;
				setInternalLexiconLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [externalLexicon]);

	useEffect(() => {
		clearSpeechError();
	}, [mode, glossaryQuery, posFilter, currentBook.number, chapter, clearSpeechError]);

	useEffect(() => {
		setVisibleLimit(PAGE_SIZE);
	}, [glossaryQuery, posFilter]);

	useEffect(() => {
		setChapterVisibleLimit(PAGE_SIZE);
		setExpandedVerseLists(new Set());
	}, [currentBook.number, chapter, chapterQuery]);

	useEffect(() => {
		if (mode !== "chapter") return;
		const controller = new AbortController();
		setChapterLoading(true);
		setChapterError(null);
		loadTranslationChapter(CANONICAL_BIBLES.ko.id, currentBook.number, chapter, controller.signal)
			.then((verses) => {
				if (controller.signal.aborted) return;
				setChapterVerses(verses);
				setChapterLoading(false);
			})
			.catch((err: unknown) => {
				if (controller.signal.aborted) return;
				setChapterVerses([]);
				setChapterError(err instanceof Error ? err.message : "Unable to load chapter vocabulary.");
				setChapterLoading(false);
			});
		return () => controller.abort();
	}, [mode, currentBook.number, chapter, chapterRetrySeq]);

	const allEntries = useMemo(() => buildMergedEntries(lexicon), [lexicon]);

	const filteredGlossary = useMemo(() => {
		const trimmed = glossaryQuery.trim();
		const lower = trimmed.toLowerCase();
		const romanizedQuery = lower.replace(/-/g, "");

		const base = allEntries.filter((entry) => {
			if (posFilter === "biblical" && !entry.isBiblical) return false;
			if (posFilter !== "all" && posFilter !== "biblical" && entry.pos !== posFilter) {
				return false;
			}
			if (!trimmed) return true;
			return (
				entry.lemma.includes(trimmed) ||
				entry.glossLower.includes(lower) ||
				Boolean(entry.hanja?.includes(trimmed)) ||
				(romanizedQuery.length > 0 && entry.romanizedSearch.includes(romanizedQuery))
			);
		});

		if (!trimmed) return base;
		return [...base].sort((a, b) => {
			const diff =
				scoreMatch(a, trimmed, lower, romanizedQuery) -
				scoreMatch(b, trimmed, lower, romanizedQuery);
			if (diff !== 0) return diff;
			return a.lemma.length - b.lemma.length || a.lemma.localeCompare(b.lemma, "ko");
		});
	}, [allEntries, glossaryQuery, posFilter]);

	const shownGlossary = useMemo(
		() => filteredGlossary.slice(0, visibleLimit),
		[filteredGlossary, visibleLimit],
	);

	const chapterAnalysis = useMemo(() => {
		if (mode !== "chapter" || chapterVerses.length === 0) {
			return { footnotes: [], grammarNotes: [] };
		}
		return analyzeKoreanChapter(chapterVerses, lexicon);
	}, [mode, chapterVerses, lexicon]);

	const visibleChapterEntries = useMemo(
		() => filterVocabEntries(chapterAnalysis.footnotes, chapterQuery),
		[chapterAnalysis.footnotes, chapterQuery],
	);

	const shownChapterEntries = useMemo(
		() => visibleChapterEntries.slice(0, chapterVisibleLimit),
		[visibleChapterEntries, chapterVisibleLimit],
	);

	const renderMoreButton = (remaining: number, onClick: () => void) =>
		remaining > 0 && (
			<div className="home-dict-more">
				<button type="button" className="home-search-submit" onClick={onClick}>
					Show more ({remaining} remaining)
				</button>
			</div>
		);

	const renderVerseRefChips = (verses: readonly number[]) =>
		verses.map((v) => (
			<button
				key={v}
				type="button"
				className="verse-ref-chip"
				onClick={() =>
					onOpenPassage(currentBook.number, chapter, v, {
						rightRailTab: "dictionary",
					})
				}
				title={`Open ${currentBook.en} ${chapter}:${v}`}
			>
				v.{v}
			</button>
		));

	return (
		<div className="home-study-browser">
			<div className="home-study-card home-study-toolbar">
				<div className="home-dict-header-row">
					<SegmentedControl
						value={mode}
						options={DICTIONARY_MODES}
						onChange={setMode}
						className="home-dict-mode-toggle"
						role="tablist"
						ariaLabel="Dictionary browse mode"
					/>

					<span className="home-dict-count">
						{allEntries.length.toLocaleString()} words
						{lexiconLoading ? " (loading lexicon…)" : ""}
					</span>
				</div>

				{mode === "glossary" && (
					<>
						<PanelSearchInput
							value={glossaryQuery}
							onChange={setGlossaryQuery}
							placeholder="Search Korean, English, romanization, or Hanja (e.g. 태초, grace, 創)..."
							ariaLabel="Search Korean dictionary and glossary"
							clearAriaLabel="Clear dictionary search"
						/>

						<div className="home-dict-filters" role="group" aria-label="Filter by part of speech">
							{GLOSSARY_FILTERS.map((filter) => {
								const active = posFilter === filter.id;
								return (
									<button
										key={filter.id}
										type="button"
										className={`quick-inline-chip ${active ? "active" : ""}`.trim()}
										aria-pressed={active}
										onClick={() => setPosFilter(filter.id)}
									>
										{filter.label}
									</button>
								);
							})}
						</div>
					</>
				)}

				{mode === "chapter" && (
					<>
						<HomePassageBar
							bookNumber={currentBook.number}
							chapter={chapter}
							onChangePassage={handleChangePassage}
							onOpenInReader={() =>
								onOpenPassage(currentBook.number, chapter, undefined, {
									rightRailTab: "dictionary",
								})
							}
						/>
						<PanelSearchInput
							value={chapterQuery}
							onChange={setChapterQuery}
							placeholder={`Filter vocabulary in ${currentBook.en} ${chapter}...`}
							ariaLabel="Filter chapter vocabulary"
							clearAriaLabel="Clear chapter vocabulary search"
						/>
					</>
				)}
			</div>

			{mode === "glossary" && (
				<div className="home-study-card home-dict-results-card">
					<div className="home-dict-results-head">
						<span className="home-favorites-group-title">
							Showing {shownGlossary.length.toLocaleString()} of{" "}
							{filteredGlossary.length.toLocaleString()} entries
						</span>
					</div>

					{shownGlossary.length === 0 ? (
						<PanelStatus emptyText={`No dictionary entries matched "${glossaryQuery.trim()}".`} />
					) : (
						<div className="home-dict-grid">
							{shownGlossary.map((entry) => {
								const key = `dict-${entry.lemma}`;
								return (
									<div key={key} className="home-dict-card">
										<VocabEntryBody
											lemma={entry.lemma}
											hanja={entry.hanja}
											pos={entry.pos}
											gloss={entry.gloss}
											romanized={entry.romanized}
											isSpeaking={speakingKey === key}
											hasSpeechError={speechErrorKey === key}
											onSpeak={() => handleSpeak(entry.lemma, key)}
											metaPrefix={
												entry.isBiblical ? <span className="home-study-badge">Biblical</span> : null
											}
										/>
									</div>
								);
							})}
						</div>
					)}

					{renderMoreButton(filteredGlossary.length - shownGlossary.length, () =>
						setVisibleLimit((limit) => limit + PAGE_SIZE),
					)}
				</div>
			)}

			{mode === "chapter" && (
				<div className="home-study-card home-dict-results-card">
					{chapterLoading || chapterError ? (
						<PanelStatus
							loading={chapterLoading}
							loadingText={`Analyzing vocabulary for ${currentBook.en} ${chapter}...`}
							error={chapterError}
							onRetry={() => setChapterRetrySeq((seq) => seq + 1)}
						/>
					) : (
						<>
							{!chapterQuery.trim() && chapterAnalysis.grammarNotes.length > 0 && (
								<PanelDisclosure
									label={`Grammar Notes (${chapterAnalysis.grammarNotes.length})`}
									open={chapterGrammarOpen}
									onToggle={() => setChapterGrammarOpen((prev) => !prev)}
								>
									<div className="home-dict-grammar-list">
										{chapterAnalysis.grammarNotes.map((note) => (
											<GrammarRuleCard
												key={note.id}
												pattern={note.pattern}
												modernText={`Modern: ${note.modern} · e.g. ${note.examples.join(", ")}`}
												explanation={note.explanation}
											>
												{note.verses.length > 0 && (
													<div className="home-dict-verses">
														{renderVerseRefChips(note.verses.slice(0, 6))}
													</div>
												)}
											</GrammarRuleCard>
										))}
									</div>
								</PanelDisclosure>
							)}

							<div className="home-dict-results-head">
								<span className="home-favorites-group-title">
									{currentBook.en} {chapter} Words ({visibleChapterEntries.length})
								</span>
							</div>

							{shownChapterEntries.length === 0 ? (
								<PanelStatus
									emptyText={`No matching vocabulary entries in ${currentBook.en} ${chapter}.`}
								/>
							) : (
								<div className="home-dict-grid">
									{shownChapterEntries.map((entry) => {
										const isVersesExpanded = expandedVerseLists.has(entry.id);
										const displayedVerses = isVersesExpanded
											? entry.verses
											: entry.verses.slice(0, 4);
										const hiddenCount = entry.verses.length - displayedVerses.length;
										const speechKey = `ch-${entry.id}`;

										return (
											<div key={entry.id} className="home-dict-card">
												<VocabEntryBody
													lemma={entry.lemma}
													hanja={entry.hanja}
													pos={entry.pos}
													gloss={entry.gloss}
													surfaceForms={entry.surfaceForms}
													grammarNote={entry.grammarNote}
													isSpeaking={speakingKey === speechKey}
													hasSpeechError={speechErrorKey === speechKey}
													onSpeak={() => handleSpeak(entry.lemma, speechKey)}
												>
													{entry.verses.length > 0 && (
														<div className="home-dict-verses">
															{renderVerseRefChips(displayedVerses)}
															{hiddenCount > 0 && (
																<button
																	type="button"
																	className="verse-ref-chip"
																	onClick={() =>
																		setExpandedVerseLists((prev) => toggleSetItem(prev, entry.id))
																	}
																>
																	+{hiddenCount}
																</button>
															)}
														</div>
													)}
												</VocabEntryBody>
											</div>
										);
									})}
								</div>
							)}

							{renderMoreButton(visibleChapterEntries.length - shownChapterEntries.length, () =>
								setChapterVisibleLimit((limit) => limit + PAGE_SIZE),
							)}
						</>
					)}
				</div>
			)}

			{mode === "grammar" && (
				<div className="home-study-card home-dict-results-card">
					<div className="home-dict-results-head">
						<span className="home-favorites-group-title">
							개역한글 (KRV) Classical Endings & Honorific Patterns ({KRV_GRAMMAR_RULES.length})
						</span>
					</div>
					<div className="home-dict-grammar-list">
						{KRV_GRAMMAR_RULES.map((rule) => (
							<GrammarRuleCard
								key={rule.id}
								pattern={rule.pattern}
								modernText={`Modern Korean: ${rule.modern}`}
								explanation={rule.explanation}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
