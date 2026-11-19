import { useCallback, useEffect, useMemo, useState } from "react";

import { BIBLICAL_GLOSSARY, KRV_GRAMMAR_RULES } from "../../shared/biblical-glossary";
import { BIBLE_BOOKS, getBookByNumber } from "../../shared/books";
import { containsHangul, romanizeHangul } from "../../shared/hangul";
import { analyzeKoreanChapter } from "../../shared/korean-morphology";
import { CANONICAL_BIBLES } from "../../shared/translations";
import type { LexiconEntry, LexiconMap, RightRailTab, VerseEntry } from "../../shared/types";
import { useKoreanSpeech } from "../hooks/useKoreanSpeech";
import { loadLexicon, loadTranslationChapter } from "../lib/bible-loader";
import { HomePassageBar } from "./HomeStudyShared";
import { Loader2, Volume2 } from "./Icons";
import { PanelDisclosure, PanelSearchInput } from "./RailShared";

type DictionaryMode = "glossary" | "chapter" | "grammar";
type GlossaryFilter = "all" | "biblical" | "noun" | "verb" | "adj" | "adv" | "name";

const PAGE_SIZE = 60;

const DICTIONARY_MODES: ReadonlyArray<{ id: DictionaryMode; label: string }> = [
	{ id: "glossary", label: "Glossary & Lexicon" },
	{ id: "chapter", label: "By Chapter" },
	{ id: "grammar", label: "KRV Grammar" },
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

function buildMergedEntries(lexicon: LexiconMap): MergedDictEntry[] {
	const entries: MergedDictEntry[] = [];

	for (const [lemma, item] of Object.entries(BIBLICAL_GLOSSARY)) {
		const romanized = containsHangul(lemma) ? romanizeHangul(lemma) : "";
		entries.push({
			lemma,
			gloss: item.gloss,
			glossLower: item.gloss.toLowerCase(),
			hanja: item.hanja,
			pos: item.pos,
			romanized,
			romanizedSearch: romanized.toLowerCase().replace(/-/g, ""),
			isBiblical: true,
		});
	}

	for (const [lemma, item] of Object.entries(lexicon)) {
		if (!item || Object.hasOwn(BIBLICAL_GLOSSARY, lemma)) continue;
		const romanized = containsHangul(lemma) ? romanizeHangul(lemma) : "";
		entries.push({
			lemma,
			gloss: item.gloss,
			glossLower: item.gloss.toLowerCase(),
			hanja: item.hanja,
			pos: item.pos,
			romanized,
			romanizedSearch: romanized.toLowerCase().replace(/-/g, ""),
			isBiblical: false,
		});
	}

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
	onOpenPassage,
}: HomeDictionaryBrowserProps) {
	const initialBook = getBookByNumber(initialBookNumber) ?? BIBLE_BOOKS[0];
	const [mode, setMode] = useState<DictionaryMode>("glossary");
	const [glossaryQuery, setGlossaryQuery] = useState("");
	const [posFilter, setPosFilter] = useState<GlossaryFilter>("all");
	const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

	const [lexicon, setLexicon] = useState<LexiconMap>({});
	const [lexiconLoading, setLexiconLoading] = useState(true);

	const [bookNumber, setBookNumber] = useState(initialBook.number);
	const [chapter, setChapter] = useState(initialChapter);
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

	const currentBook = useMemo(() => getBookByNumber(bookNumber) ?? BIBLE_BOOKS[0], [bookNumber]);

	useEffect(() => {
		let cancelled = false;
		setLexiconLoading(true);
		loadLexicon()
			.then((lex) => {
				if (cancelled) return;
				setLexicon(lex);
				setLexiconLoading(false);
			})
			.catch(() => {
				if (cancelled) return;
				setLexiconLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		clearSpeechError();
	}, [mode, glossaryQuery, posFilter, bookNumber, chapter, clearSpeechError]);

	useEffect(() => {
		setVisibleLimit(PAGE_SIZE);
	}, [glossaryQuery, posFilter]);

	useEffect(() => {
		setChapterVisibleLimit(PAGE_SIZE);
		setExpandedVerseLists(new Set());
	}, [bookNumber, chapter, chapterQuery]);

	useEffect(() => {
		if (mode !== "chapter") return;
		let cancelled = false;
		setChapterLoading(true);
		setChapterError(null);
		loadTranslationChapter(CANONICAL_BIBLES.ko.id, currentBook.number, chapter)
			.then((verses) => {
				if (cancelled) return;
				setChapterVerses(verses);
				setChapterLoading(false);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setChapterVerses([]);
				setChapterError(err instanceof Error ? err.message : "Unable to load chapter vocabulary.");
				setChapterLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [mode, currentBook.number, chapter, chapterRetrySeq]);

	const handleChangePassage = useCallback((nextBookNumber: number, nextChapter: number) => {
		const target = getBookByNumber(nextBookNumber) ?? BIBLE_BOOKS[0];
		setBookNumber(target.number);
		setChapter(Math.max(1, Math.min(target.chapters, nextChapter)));
	}, []);

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

	const visibleChapterEntries = useMemo(() => {
		const trimmed = chapterQuery.trim().toLowerCase();
		if (!trimmed) return chapterAnalysis.footnotes;
		return chapterAnalysis.footnotes.filter(
			(entry) =>
				entry.lemma.toLowerCase().includes(trimmed) ||
				entry.gloss.toLowerCase().includes(trimmed) ||
				Boolean(entry.hanja?.includes(chapterQuery.trim())) ||
				entry.surfaceForms.some((form) => form.toLowerCase().includes(trimmed)),
		);
	}, [chapterAnalysis.footnotes, chapterQuery]);

	const shownChapterEntries = useMemo(
		() => visibleChapterEntries.slice(0, chapterVisibleLimit),
		[visibleChapterEntries, chapterVisibleLimit],
	);

	const toggleVerseList = (id: string) => {
		setExpandedVerseLists((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<div className="home-study-browser">
			<div className="home-study-card home-study-toolbar">
				<div className="home-dict-header-row">
					<div
						className="segmented-row home-dict-mode-toggle"
						role="tablist"
						aria-label="Dictionary browse mode"
					>
						{DICTIONARY_MODES.map((item) => {
							const active = mode === item.id;
							return (
								<button
									key={item.id}
									type="button"
									role="tab"
									aria-selected={active}
									className={`segmented-btn ${active ? "active" : ""}`.trim()}
									onClick={() => setMode(item.id)}
								>
									{item.label}
								</button>
							);
						})}
					</div>

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
						<div className="commentary-status">
							<p className="commentary-status-text">
								No dictionary entries matched "{glossaryQuery.trim()}".
							</p>
						</div>
					) : (
						<div className="home-dict-grid">
							{shownGlossary.map((entry) => {
								const key = `dict-${entry.lemma}`;
								return (
									<div key={key} className="home-dict-card">
										<div className="vocab-head-row">
											<div className="vocab-lemma-group">
												<div className="vocab-lemma" lang="ko">
													{entry.lemma}
													{entry.hanja && <span className="vocab-hanja">{entry.hanja}</span>}
												</div>
												<button
													type="button"
													className={`vocab-speak-btn ${speakingKey === key ? "speaking" : ""}`.trim()}
													onClick={() => handleSpeak(entry.lemma, key)}
													aria-label={`Pronounce ${entry.lemma}`}
													title={`Pronounce ${entry.lemma}`}
												>
													<Volume2 size={13} />
												</button>
											</div>
											<div className="vocab-head-meta">
												{entry.isBiblical && <span className="home-study-badge">Biblical</span>}
												{entry.pos && <span className="vocab-pos">{entry.pos}</span>}
											</div>
										</div>
										{entry.romanized && <div className="vocab-phonetics">[{entry.romanized}]</div>}
										<div className="vocab-gloss">{entry.gloss}</div>
										{speechErrorKey === key && (
											<div className="vocab-speech-note">
												Korean voice unavailable in this browser.
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}

					{filteredGlossary.length > shownGlossary.length && (
						<div className="home-dict-more">
							<button
								type="button"
								className="home-search-submit"
								onClick={() => setVisibleLimit((limit) => limit + PAGE_SIZE)}
							>
								Show more ({filteredGlossary.length - shownGlossary.length} remaining)
							</button>
						</div>
					)}
				</div>
			)}

			{mode === "chapter" && (
				<div className="home-study-card home-dict-results-card">
					{chapterLoading ? (
						<div className="commentary-status" role="status">
							<Loader2 size={16} className="spin" />
							<span>
								Analyzing vocabulary for {currentBook.en} {chapter}...
							</span>
						</div>
					) : chapterError ? (
						<div className="commentary-status commentary-error">
							<p className="commentary-status-text">{chapterError}</p>
							<button
								type="button"
								className="quick-inline-chip active"
								onClick={() => setChapterRetrySeq((seq) => seq + 1)}
							>
								Try again
							</button>
						</div>
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
											<div key={note.id} className="grammar-card">
												<div className="grammar-pattern">{note.pattern}</div>
												<div className="grammar-modern">
													Modern: {note.modern} · e.g. {note.examples.join(", ")}
												</div>
												<p className="grammar-desc">{note.explanation}</p>
												{note.verses.length > 0 && (
													<div className="home-dict-verses">
														{note.verses.slice(0, 6).map((v) => (
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
														))}
													</div>
												)}
											</div>
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
								<div className="commentary-status">
									<p className="commentary-status-text">
										No matching vocabulary entries in {currentBook.en} {chapter}.
									</p>
								</div>
							) : (
								<div className="home-dict-grid">
									{shownChapterEntries.map((entry) => {
										const romanized = containsHangul(entry.lemma)
											? romanizeHangul(entry.lemma)
											: "";
										const hasVariantForms = entry.surfaceForms.some((f) => f !== entry.lemma);
										const isVersesExpanded = expandedVerseLists.has(entry.id);
										const displayedVerses = isVersesExpanded
											? entry.verses
											: entry.verses.slice(0, 4);
										const hiddenCount = entry.verses.length - displayedVerses.length;
										const speechKey = `ch-${entry.id}`;

										return (
											<div key={entry.id} className="home-dict-card">
												<div className="vocab-head-row">
													<div className="vocab-lemma-group">
														<div className="vocab-lemma" lang="ko">
															{entry.lemma}
															{entry.hanja && <span className="vocab-hanja">{entry.hanja}</span>}
														</div>
														<button
															type="button"
															className={`vocab-speak-btn ${speakingKey === speechKey ? "speaking" : ""}`.trim()}
															onClick={() => handleSpeak(entry.lemma, speechKey)}
															aria-label={`Pronounce ${entry.lemma}`}
															title={`Pronounce ${entry.lemma}`}
														>
															<Volume2 size={13} />
														</button>
													</div>
													<div className="vocab-head-meta">
														{entry.pos && <span className="vocab-pos">{entry.pos}</span>}
													</div>
												</div>

												{romanized && <div className="vocab-phonetics">[{romanized}]</div>}
												<div className="vocab-gloss">{entry.gloss}</div>

												{(entry.grammarNote || hasVariantForms) && (
													<div className="vocab-forms">
														{hasVariantForms && <span>{entry.surfaceForms.join(", ")}</span>}
														{hasVariantForms && entry.grammarNote && <span> · </span>}
														{entry.grammarNote && <span>{entry.grammarNote}</span>}
													</div>
												)}

												{entry.verses.length > 0 && (
													<div className="home-dict-verses">
														{displayedVerses.map((v) => (
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
														))}
														{hiddenCount > 0 && (
															<button
																type="button"
																className="verse-ref-chip"
																onClick={() => toggleVerseList(entry.id)}
															>
																+{hiddenCount}
															</button>
														)}
													</div>
												)}

												{speechErrorKey === speechKey && (
													<div className="vocab-speech-note">
														Korean voice unavailable in this browser.
													</div>
												)}
											</div>
										);
									})}
								</div>
							)}

							{visibleChapterEntries.length > shownChapterEntries.length && (
								<div className="home-dict-more">
									<button
										type="button"
										className="home-search-submit"
										onClick={() => setChapterVisibleLimit((limit) => limit + PAGE_SIZE)}
									>
										Show more ({visibleChapterEntries.length - shownChapterEntries.length}{" "}
										remaining)
									</button>
								</div>
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
							<div key={rule.id} className="grammar-card">
								<div className="grammar-pattern">{rule.pattern}</div>
								<div className="grammar-modern">Modern Korean: {rule.modern}</div>
								<p className="grammar-desc">{rule.explanation}</p>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
