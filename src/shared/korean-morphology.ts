import { BIBLICAL_GLOSSARY, detectKrvGrammarNotes } from "./biblical-glossary";
import {
	containsHangul,
	hasFinalConsonant,
	replaceLastFinalConsonant,
	stripLastFinalConsonant,
} from "./hangul";
import type {
	FootnoteVocabEntry,
	GlossToken,
	KrvGrammarNote,
	LexiconEntry,
	LexiconMap,
	VerseEntry,
} from "./types";

interface SuffixRule {
	suffix: string;
	note: string;
	kind: "particle" | "copula" | "verb";
	/** Replace stripped suffix with a partial stem piece (e.g. "셨" -> "시", "했" -> "하"). */
	stemPatch?: string;
}

const PARTICLE_RULES: readonly SuffixRule[] = [
	{ suffix: "께서는", note: "honorific subject + topic", kind: "particle" },
	{ suffix: "께서도", note: "honorific subject + 'also'", kind: "particle" },
	{ suffix: "께로서", note: "'from (honorific person)'", kind: "particle" },
	{ suffix: "에게는", note: "'to (person)' + topic", kind: "particle" },
	{ suffix: "에게도", note: "'to (person)' + 'also'", kind: "particle" },
	{ suffix: "에게로", note: "'toward (person)'", kind: "particle" },
	{ suffix: "에게서", note: "'from (person)'", kind: "particle" },
	{ suffix: "에서는", note: "'in/from' + topic", kind: "particle" },
	{ suffix: "에서도", note: "'in/from' + 'also'", kind: "particle" },
	{ suffix: "으로부터", note: "'from'", kind: "particle" },
	{ suffix: "로부터", note: "'from'", kind: "particle" },
	{ suffix: "으로는", note: "'with/toward' + topic", kind: "particle" },
	{ suffix: "으로도", note: "'with/toward' + 'also'", kind: "particle" },
	{ suffix: "으로나", note: "'whether by / or by'", kind: "particle" },
	{ suffix: "로나", note: "'whether by / or by'", kind: "particle" },
	{ suffix: "으로써", note: "'by means of'", kind: "particle" },
	{ suffix: "으로서", note: "'as / in capacity of'", kind: "particle" },
	{ suffix: "로써", note: "'by means of'", kind: "particle" },
	{ suffix: "로서", note: "'as / in capacity of'", kind: "particle" },
	{ suffix: "이라도", note: "'even'", kind: "particle" },
	{ suffix: "까지도", note: "'even up to'", kind: "particle" },
	{ suffix: "자들에게는", note: "plural 'those who' + 'to'", kind: "particle" },
	{ suffix: "자들에게", note: "plural 'those who' + 'to'", kind: "particle" },
	{ suffix: "들이니라", note: "plural + 'are' (declarative)", kind: "particle" },
	{ suffix: "들에게서", note: "plural + 'from (persons)'", kind: "particle" },
	{ suffix: "들에게는", note: "plural + 'to' + topic", kind: "particle" },
	{ suffix: "들에게도", note: "plural + 'to' + 'also'", kind: "particle" },
	{ suffix: "들에게", note: "plural + 'to'", kind: "particle" },
	{ suffix: "들의", note: "plural + possessive 'of'", kind: "particle" },
	{ suffix: "들이", note: "plural + subject", kind: "particle" },
	{ suffix: "들을", note: "plural + object", kind: "particle" },
	{ suffix: "들은", note: "plural + topic", kind: "particle" },
	{ suffix: "들도", note: "plural + 'also'", kind: "particle" },
	{ suffix: "들과", note: "plural + 'and/with'", kind: "particle" },
	{ suffix: "들아", note: "plural vocative ('O ...')", kind: "particle" },
	{ suffix: "께서", note: "honorific subject marker", kind: "particle" },
	{ suffix: "에서", note: "'in / at / from' (location)", kind: "particle" },
	{ suffix: "에게", note: "'to / for' (person)", kind: "particle" },
	{ suffix: "한테", note: "'to / from' (person)", kind: "particle" },
	{ suffix: "으로", note: "'toward / by / as'", kind: "particle" },
	{ suffix: "부터", note: "'from / since'", kind: "particle" },
	{ suffix: "까지", note: "'until / to / even'", kind: "particle" },
	{ suffix: "대로", note: "'according to / as'", kind: "particle" },
	{ suffix: "처럼", note: "'like / as'", kind: "particle" },
	{ suffix: "보다", note: "'than'", kind: "particle" },
	{ suffix: "마다", note: "'every / each'", kind: "particle" },
	{ suffix: "밖에", note: "'except / only'", kind: "particle" },
	{ suffix: "에도", note: "'in/at/to' + 'also'", kind: "particle" },
	{ suffix: "에는", note: "'in/at/to' + topic", kind: "particle" },
	{ suffix: "이나", note: "'or / even / though'", kind: "particle" },
	{ suffix: "들", note: "plural marker", kind: "particle" },
	{ suffix: "께", note: "'to' (honorific)", kind: "particle" },
	{ suffix: "로", note: "'toward / by / as'", kind: "particle" },
	{ suffix: "와", note: "'and / with'", kind: "particle" },
	{ suffix: "과", note: "'and / with'", kind: "particle" },
	{ suffix: "은", note: "topic marker", kind: "particle" },
	{ suffix: "는", note: "topic marker", kind: "particle" },
	{ suffix: "이", note: "subject marker", kind: "particle" },
	{ suffix: "가", note: "subject marker", kind: "particle" },
	{ suffix: "을", note: "object marker", kind: "particle" },
	{ suffix: "를", note: "object marker", kind: "particle" },
	{ suffix: "에", note: "'in / at / to'", kind: "particle" },
	{ suffix: "의", note: "possessive ('of')", kind: "particle" },
	{ suffix: "도", note: "'also / even'", kind: "particle" },
	{ suffix: "만", note: "'only'", kind: "particle" },
	{ suffix: "나", note: "'or / as for'", kind: "particle" },
	{ suffix: "야", note: "vocative / emphatic", kind: "particle" },
	{ suffix: "아", note: "vocative ('O ...')", kind: "particle" },
	{ suffix: "여", note: "archaic vocative ('O ...')", kind: "particle" },
	{ suffix: "이여", note: "archaic vocative ('O ...')", kind: "particle" },
];

const COPULA_RULES: readonly SuffixRule[] = [
	{ suffix: "이시니라", note: "'is / are' (hon. declarative)", kind: "copula" },
	{ suffix: "이시니이다", note: "'you are / it is' (polite hon.)", kind: "copula" },
	{ suffix: "이시며", note: "'is ... and' (hon.)", kind: "copula" },
	{ suffix: "이시니", note: "'because [it] is' (hon.)", kind: "copula" },
	{ suffix: "이시요", note: "'is' (hon.)", kind: "copula" },
	{ suffix: "이니이다", note: "'is' (polite KRV declarative)", kind: "copula" },
	{ suffix: "이니라", note: "'is / it is' (KRV declarative)", kind: "copula" },
	{ suffix: "이로다", note: "'is indeed!' (exclamatory)", kind: "copula" },
	{ suffix: "이로라", note: "'am / is' (literary declarative)", kind: "copula" },
	{ suffix: "이로되", note: "'though / is ... yet'", kind: "copula" },
	{ suffix: "인지라", note: "'since [it] is'", kind: "copula" },
	{ suffix: "이라서", note: "'because [it] is'", kind: "copula" },
	{ suffix: "이면", note: "'if [it] is'", kind: "copula" },
	{ suffix: "인줄", note: "'that [it] is'", kind: "copula" },
	{ suffix: "이라", note: "'is / called' (declarative)", kind: "copula" },
	{ suffix: "이며", note: "'is ... and'", kind: "copula" },
	{ suffix: "이고", note: "'is ... and'", kind: "copula" },
	{ suffix: "이요", note: "'is ... and' (archaic)", kind: "copula" },
	{ suffix: "이니", note: "'because [it] is'", kind: "copula" },
	{ suffix: "시니라", note: "'is / are' (hon. declarative)", kind: "copula" },
	{ suffix: "니이다", note: "'is' (polite declarative)", kind: "copula" },
	{ suffix: "니라", note: "'is' (declarative)", kind: "copula" },
	{ suffix: "로다", note: "'is indeed!'", kind: "copula" },
	{ suffix: "러라", note: "'was / indeed' (literary)", kind: "copula" },
	{ suffix: "로라", note: "'am / is' (literary)", kind: "copula" },
	{ suffix: "로되", note: "'though / is ... yet'", kind: "copula" },
	{ suffix: "며", note: "'is ... and'", kind: "copula" },
	{ suffix: "요", note: "'is ... and'", kind: "copula" },
	{ suffix: "라", note: "'is / called'", kind: "copula" },
	{ suffix: "냐", note: "'is it ...?' (question)", kind: "copula" },
	{ suffix: "인", note: "'who/which is' (copula modifier)", kind: "copula" },
];

const PAST_ENDINGS: ReadonlyArray<readonly [string, string]> = [
	["음이라", "past nominalizer + 'is'"],
	["으므로", "past + 'because'"],
	["느니라", "past declarative"],
	["노라", "1st-person past declarative"],
	["나니", "past + 'for / since'"],
	["더라", "past observed"],
	["더니", "past + 'and then'"],
	["으니", "past + 'so / since'"],
	["으나", "past + 'but / though'"],
	["으며", "past + 'and'"],
	["고", "past + 'and'"],
	["다", "past tense"],
];

const CONNECTIVE_PAIRS: ReadonlyArray<readonly [string, string]> = [
	["야", "'must / only if'"],
	["도", "'even if / though'"],
	["서", "'because / and then'"],
];

const STEM_CONTRACTIONS: ReadonlyArray<readonly [string, string]> = [
	["하여", "하다"],
	["와", "오다"],
	["봐", "보다"],
	["줘", "주다"],
	["돼", "되다"],
	["쳐", "치다"],
	["려", "리다"],
	["렸", "리다"],
];

const VERB_ENDING_RULES: readonly SuffixRule[] = [
	// Honorific + past/present/polite KRV endings
	{ suffix: "셨느니라", note: "-시- (hon.) + past + -느니라", kind: "verb" },
	{ suffix: "셨으니", note: "-시- (hon.) + past + 'so/since'", kind: "verb" },
	{ suffix: "셨더라", note: "-시- (hon.) + past observed", kind: "verb" },
	{ suffix: "셨고", note: "-시- (hon.) + past + 'and'", kind: "verb" },
	{ suffix: "셨다", note: "-시- (hon.) + past", kind: "verb" },
	{ suffix: "셨으며", note: "-시- (hon.) + past + 'and'", kind: "verb" },
	{ suffix: "시나이다", note: "-시- (hon.) + polite declarative", kind: "verb" },
	{ suffix: "시나이까", note: "-시- (hon.) + polite question", kind: "verb" },
	{ suffix: "시나니", note: "-시- (hon.) + 'for / since'", kind: "verb" },
	{ suffix: "심이니이다", note: "-시- (hon.) + nominalizer + polite 'is'", kind: "verb" },
	{ suffix: "심이니라", note: "-시- (hon.) + nominalizer + 'is'", kind: "verb" },
	{ suffix: "심이라", note: "-시- (hon.) + nominalizer + 'is'", kind: "verb" },
	{ suffix: "심으로", note: "-시- (hon.) + 'by doing'", kind: "verb" },
	{ suffix: "심을", note: "-시- (hon.) + nominalizer + object", kind: "verb" },
	{ suffix: "심이", note: "-시- (hon.) + nominalizer + subject", kind: "verb" },
	{ suffix: "시는도다", note: "-시- (hon.) + exclamatory", kind: "verb" },
	{ suffix: "시니라", note: "-시- (hon.) + -니라 (declarative)", kind: "verb" },
	{ suffix: "시리라", note: "-시- (hon.) + future declarative", kind: "verb" },
	{ suffix: "시리로다", note: "-시- (hon.) + future exclamatory", kind: "verb" },
	{ suffix: "시던", note: "-시- (hon.) + past modifier", kind: "verb" },
	{ suffix: "시더라", note: "-시- (hon.) + past observed", kind: "verb" },
	{ suffix: "시면", note: "-시- (hon.) + 'if / when'", kind: "verb" },
	{ suffix: "시매", note: "-시- (hon.) + -매 ('when/since')", kind: "verb" },
	{ suffix: "시며", note: "-시- (hon.) + 'and / while'", kind: "verb" },
	{ suffix: "시고", note: "-시- (hon.) + 'and'", kind: "verb" },
	{ suffix: "시니", note: "-시- (hon.) + 'so / as'", kind: "verb" },
	{ suffix: "시되", note: "-시- (hon.) + 'saying / but'", kind: "verb" },
	{ suffix: "시사", note: "-시- (hon.) + archaic connective", kind: "verb" },
	{ suffix: "시게", note: "-시- (hon.) + 'so that'", kind: "verb" },
	{ suffix: "시지", note: "-시- (hon.) + negative/connective", kind: "verb" },
	{ suffix: "시기에", note: "-시- (hon.) + 'when / to see'", kind: "verb" },
	{ suffix: "시는", note: "-시- (hon.) + present modifier", kind: "verb" },
	{ suffix: "신바", note: "-시- (hon.) + 'that which'", kind: "verb" },
	{ suffix: "실", note: "-시- (hon.) + future modifier", kind: "verb" },
	{ suffix: "신", note: "-시- (hon.) + past modifier", kind: "verb" },
	{ suffix: "심", note: "-시- (hon.) + nominalizer", kind: "verb" },

	// KRV literary/archaic, polite (-나이다/-삽나이까), & -으- epenthetic endings
	{ suffix: "삽나이까", note: "humble archaic question", kind: "verb" },
	{ suffix: "나이다", note: "polite archaic declarative", kind: "verb" },
	{ suffix: "나이까", note: "polite archaic question", kind: "verb" },
	{ suffix: "이니이다", note: "polite KRV declarative", kind: "verb" },
	{ suffix: "음이니이다", note: "nominalizer + polite 'is'", kind: "verb" },
	{ suffix: "으시니라", note: "-시- (hon.) + -니라 (declarative)", kind: "verb" },
	{ suffix: "으시면", note: "-시- (hon.) + 'if / when'", kind: "verb" },
	{ suffix: "으시매", note: "-시- (hon.) + 'when / since'", kind: "verb" },
	{ suffix: "으시며", note: "-시- (hon.) + 'and'", kind: "verb" },
	{ suffix: "으시고", note: "-시- (hon.) + 'and'", kind: "verb" },
	{ suffix: "으시니", note: "-시- (hon.) + 'so / since'", kind: "verb" },
	{ suffix: "으신", note: "-시- (hon.) + past modifier", kind: "verb" },
	{ suffix: "으실", note: "-시- (hon.) + future modifier", kind: "verb" },
	{ suffix: "으심", note: "-시- (hon.) + nominalizer", kind: "verb" },
	{ suffix: "으리로다", note: "future exclamatory ('will surely')", kind: "verb" },
	{ suffix: "으리라", note: "future declarative ('shall / will')", kind: "verb" },
	{ suffix: "으리니", note: "future connective ('for ... will')", kind: "verb" },
	{ suffix: "으니라", note: "declarative ('indeed')", kind: "verb" },
	{ suffix: "으매", note: "archaic connective ('when / since')", kind: "verb" },
	{ suffix: "으며", note: "'and / while'", kind: "verb" },
	{ suffix: "으니", note: "'so / since / when'", kind: "verb" },
	{ suffix: "으나", note: "'but / though'", kind: "verb" },
	{ suffix: "으면", note: "'if / when'", kind: "verb" },
	{ suffix: "으라", note: "imperative ('command')", kind: "verb" },
	{ suffix: "으사", note: "archaic connective ('having ...')", kind: "verb" },
	{ suffix: "으되", note: "'though / saying'", kind: "verb" },

	// Future/volitional -겠- endings
	{ suffix: "겠느니라", note: "future/certainty declarative", kind: "verb" },
	{ suffix: "겠느냐", note: "future/certainty question", kind: "verb" },
	{ suffix: "겠나이다", note: "polite future declarative", kind: "verb" },
	{ suffix: "겠노라", note: "1st-person resolve ('I will')", kind: "verb" },
	{ suffix: "겠으니", note: "future + 'so / since'", kind: "verb" },
	{ suffix: "겠고", note: "future + 'and'", kind: "verb" },
	{ suffix: "겠다", note: "future / 'will / would'", kind: "verb" },

	// Past tense endings (-였/-었/-았 + -했)
	...["였", "었", "았"].flatMap((tense): SuffixRule[] =>
		PAST_ENDINGS.map(([tail, note]) => ({ suffix: `${tense}${tail}`, note, kind: "verb" })),
	),
	...["느니라", "더라", "으니", "고", "다"].map((tail): SuffixRule => {
		const note = PAST_ENDINGS.find(([t]) => t === tail)?.[1] ?? "past tense";
		return { suffix: `했${tail}`, note, kind: "verb", stemPatch: "하" };
	}),
	{ suffix: "었으매", note: "past + 'when / since'", kind: "verb" },
	{ suffix: "었으되", note: "past + 'though'", kind: "verb" },
	{ suffix: "았다가", note: "past + 'and then'", kind: "verb" },
	{ suffix: "었다가", note: "past + 'and then'", kind: "verb" },

	// Declarative, concessive, imperative, prophetic & connective endings
	{ suffix: "을찌라도", note: "'even though' (archaic KRV)", kind: "verb" },
	{ suffix: "찌라도", note: "'even though' (archaic KRV)", kind: "verb" },
	{ suffix: "지라도", note: "'even though'", kind: "verb" },
	{ suffix: "찐대", note: "'if indeed / since' (archaic KRV)", kind: "verb" },
	{ suffix: "지니라", note: "solemn command / 'shall'", kind: "verb" },
	{ suffix: "지어다", note: "blessing / imperative ('let there be')", kind: "verb" },
	{ suffix: "느니라", note: "timeless declarative", kind: "verb" },
	{ suffix: "는도다", note: "poetic exclamatory", kind: "verb" },
	{ suffix: "리로다", note: "future exclamatory", kind: "verb" },
	{ suffix: "리라", note: "future declarative ('shall / will')", kind: "verb" },
	{ suffix: "리니", note: "future connective", kind: "verb" },
	{ suffix: "리요", note: "rhetorical future ('would ...?')", kind: "verb" },
	{ suffix: "노라", note: "1st-person declarative", kind: "verb" },
	{ suffix: "노니", note: "1st-person 'for I ...'", kind: "verb" },
	{ suffix: "느냐", note: "question ('do you ...?')", kind: "verb" },
	{ suffix: "거니와", note: "'indeed, yet / besides'", kind: "verb" },
	{ suffix: "거든", note: "'if / when'", kind: "verb" },
	{ suffix: "건대", note: "'when considering'", kind: "verb" },
	{ suffix: "더이다", note: "polite past observed", kind: "verb" },
	{ suffix: "더라", note: "observed past", kind: "verb" },
	{ suffix: "더니", note: "'and then / since'", kind: "verb" },
	{ suffix: "던", note: "retrospective past modifier", kind: "verb" },
	{ suffix: "도다", note: "exclamatory", kind: "verb" },
	{ suffix: "니라", note: "KRV declarative", kind: "verb" },
	{ suffix: "나니", note: "'for / since'", kind: "verb" },
	{ suffix: "은바", note: "'that which'", kind: "verb" },
	{ suffix: "한바", note: "'that which'", kind: "verb", stemPatch: "하" },
	{ suffix: "은것", note: "'the thing that'", kind: "verb" },
	{ suffix: "기가", note: "nominalized subject", kind: "verb" },
	{ suffix: "기에", note: "'for / at doing'", kind: "verb" },
	{ suffix: "기를", note: "nominalized object", kind: "verb" },
	{ suffix: "기로", note: "'by / to do'", kind: "verb" },
	{ suffix: "므로", note: "'because / since'", kind: "verb" },
	{ suffix: "매", note: "'when / since'", kind: "verb" },
	{ suffix: "며", note: "'and / while'", kind: "verb" },
	{ suffix: "면", note: "'if / when'", kind: "verb" },
	{ suffix: "고", note: "'and / then'", kind: "verb" },
	{ suffix: "니", note: "'so / since'", kind: "verb" },
	{ suffix: "나", note: "'but / though'", kind: "verb" },
	{ suffix: "되", note: "'saying / though'", kind: "verb" },
	{ suffix: "도", note: "'even / though'", kind: "verb" },
	...["어", "아", "여"].flatMap((vowel): SuffixRule[] =>
		CONNECTIVE_PAIRS.map(([tail, note]) => ({ suffix: `${vowel}${tail}`, note, kind: "verb" })),
	),
	{ suffix: "다가", note: "'while doing, then'", kind: "verb" },
	{ suffix: "라고", note: "quotative ('to / saying')", kind: "verb" },
	{ suffix: "지", note: "negative / auxiliary connective", kind: "verb" },
	{ suffix: "치", note: "contracted -하지 ('not / do')", kind: "verb", stemPatch: "하" },
	{ suffix: "케", note: "contracted -하게 (causative)", kind: "verb", stemPatch: "하" },
	{ suffix: "게", note: "causative / 'so that'", kind: "verb" },
	{ suffix: "기", note: "nominalizer ('-ing')", kind: "verb" },
	{ suffix: "려", note: "'intending to / in order to'", kind: "verb" },
	{ suffix: "러", note: "'in order to'", kind: "verb" },
	{ suffix: "을까", note: "'lest / might'", kind: "verb" },
	{ suffix: "까", note: "'lest / might'", kind: "verb" },
	{ suffix: "는", note: "present modifier", kind: "verb" },
	{ suffix: "은", note: "past/adj modifier", kind: "verb" },
	{ suffix: "을", note: "future modifier", kind: "verb" },
	{ suffix: "음", note: "nominalizer", kind: "verb" },
	{ suffix: "사", note: "archaic connective", kind: "verb" },
	{ suffix: "서", note: "'and then / so'", kind: "verb" },
	{ suffix: "여", note: "connective", kind: "verb" },
	{ suffix: "아", note: "connective", kind: "verb" },
	{ suffix: "어", note: "connective", kind: "verb" },
	{ suffix: "라", note: "imperative / declarative", kind: "verb" },
];

const SORTED_PARTICLE_RULES: readonly SuffixRule[] = [...PARTICLE_RULES].sort(
	(a, b) => b.suffix.length - a.suffix.length,
);

const SORTED_NOMINAL_RULES: readonly SuffixRule[] = [...PARTICLE_RULES, ...COPULA_RULES].sort(
	(a, b) => b.suffix.length - a.suffix.length,
);

const SORTED_VERB_ENDING_RULES: readonly SuffixRule[] = [...VERB_ENDING_RULES].sort(
	(a, b) => b.suffix.length - a.suffix.length,
);

type EntryLookup = (key: string) => LexiconEntry | undefined;

function isSafeLexiconNounStem(stem: string): boolean {
	return stem.length >= 2 && !stem.endsWith("하");
}

function makeToken(
	parts: { leadPunct: string; word: string; trailPunct: string },
	raw: string,
	lemma: string,
	entry: LexiconEntry,
	grammarNote?: string,
): GlossToken {
	return {
		raw,
		leadPunct: parts.leadPunct,
		word: parts.word,
		trailPunct: parts.trailPunct,
		lemma,
		gloss: entry.gloss,
		hanja: entry.hanja,
		pos: entry.pos,
		grammarNote,
		matched: true,
	};
}

function matchNominalRules(
	raw: string,
	parts: { leadPunct: string; word: string; trailPunct: string },
	lookup: EntryLookup,
	allowSingleCharNoun: boolean,
): GlossToken | null {
	const { word } = parts;
	for (const rule of SORTED_NOMINAL_RULES) {
		if (!word.endsWith(rule.suffix) || word.length <= rule.suffix.length) continue;
		const stem = word.slice(0, -rule.suffix.length);

		if (allowSingleCharNoun || isSafeLexiconNounStem(stem)) {
			const directStem = lookup(stem);
			if (directStem) {
				return makeToken(parts, raw, stem, directStem, `${rule.suffix} (${rule.note})`);
			}
		}

		// Handle nominalized verb + particle/copula (e.g. 부족함이, 있음이, 함이라)
		if (stem.endsWith("음") && stem.length >= 2) {
			const baseStem = stem.slice(0, -1);
			for (const candidate of generatePredicateLemmaCandidates(baseStem, false)) {
				const hit = lookup(candidate);
				if (hit) {
					return makeToken(
						parts,
						raw,
						candidate,
						hit,
						`-음 (nominalizer) + ${rule.suffix} (${rule.note})`,
					);
				}
			}
		}

		// Strip -ㅁ/-ㄴ/-ㄹ nominalizer/modifier inside particles, or -ㅁ nominalizer inside copulas
		const coda = stripLastFinalConsonant(stem);
		const allowCoda =
			coda &&
			(rule.kind === "particle" ? ["ㅁ", "ㄴ", "ㄹ"].includes(coda.final) : coda.final === "ㅁ");
		if (coda && allowCoda) {
			for (const candidate of generatePredicateLemmaCandidates(coda.stem, false)) {
				const hit = lookup(candidate);
				if (hit) {
					return makeToken(
						parts,
						raw,
						candidate,
						hit,
						`-${coda.final} + ${rule.suffix} (${rule.note})`,
					);
				}
			}
		}
	}
	return null;
}

function matchVerbOrModifier(
	raw: string,
	parts: { leadPunct: string; word: string; trailPunct: string },
	lookup: EntryLookup,
	allowSingleCharNoun: boolean,
): GlossToken | null {
	const { word } = parts;

	for (const rule of SORTED_VERB_ENDING_RULES) {
		if (!word.endsWith(rule.suffix) || word.length <= rule.suffix.length) continue;
		const stem = `${word.slice(0, -rule.suffix.length)}${rule.stemPatch ?? ""}`;

		if (rule.suffix !== "까") {
			for (const candidate of generatePredicateLemmaCandidates(stem, rule.suffix === "지")) {
				const hit = lookup(candidate);
				if (hit) {
					return makeToken(parts, raw, candidate, hit, `-${rule.suffix} (${rule.note})`);
				}
			}
		}

		// Handle -ㄹ찌라도 / -ㄹ지니라 / -ㄹ지어다 / -ㄹ찐대 / -ㄹ까 where ㄹ is the final consonant of stem
		if (["찌라도", "지라도", "찐대", "지니라", "지어다", "까"].includes(rule.suffix)) {
			const strippedRieul = stripLastFinalConsonant(stem);
			if (strippedRieul && strippedRieul.final === "ㄹ") {
				for (const candidate of generatePredicateLemmaCandidates(strippedRieul.stem, false)) {
					const hit = lookup(candidate);
					if (hit) {
						return makeToken(parts, raw, candidate, hit, `-ㄹ${rule.suffix} (${rule.note})`);
					}
				}
			}
		}

		if (rule.suffix !== "까" && (allowSingleCharNoun || isSafeLexiconNounStem(stem))) {
			const nounHit = lookup(stem);
			if (nounHit) {
				return makeToken(parts, raw, stem, nounHit, `-${rule.suffix} (${rule.note})`);
			}
		}
	}

	// Check predicate modifiers formed purely via final consonant (-ㄴ/-ㄹ/-ㅁ) without suffix (큰 -> 크다, 무를 -> 무르다)
	const strippedTail = stripLastFinalConsonant(word);
	if (strippedTail && ["ㄴ", "ㄹ", "ㅁ"].includes(strippedTail.final)) {
		for (const candidate of generatePredicateLemmaCandidates(strippedTail.stem, false)) {
			const hit = lookup(candidate);
			if (hit) {
				const modNote =
					strippedTail.final === "ㄴ"
						? "-ㄴ (modifier)"
						: strippedTail.final === "ㄹ"
							? "-ㄹ (future modifier)"
							: "-ㅁ (nominalizer)";
				return makeToken(parts, raw, candidate, hit, modNote);
			}
		}
	}

	return null;
}

function generatePredicateLemmaCandidates(rawStem: string, allowHaSuffix = true): string[] {
	if (!rawStem) return [];
	const candidates: string[] = [];
	const push = (val: string | null | undefined) => {
		if (val && !candidates.includes(val)) candidates.push(val);
	};

	push(`${rawStem}다`);

	// Noun + 하다 when stem ends with 하 (e.g. 창조하 -> 창조하다 / 창조)
	if (rawStem.endsWith("하") && rawStem.length >= 2) {
		push(rawStem.slice(0, -1));
	}

	// Common vowel contractions on stem tail
	for (const [tail, replacement] of STEM_CONTRACTIONS) {
		if (rawStem.endsWith(tail)) {
			push(`${rawStem.slice(0, -tail.length)}${replacement}`);
		}
	}
	// KRV -지 아니하다 contraction (영접지 -> 영접하다)
	if (allowHaSuffix && !rawStem.endsWith("하")) {
		push(`${rawStem}하다`);
	}

	// ㅂ-irregular: 아름다우 -> 아름답다
	if (rawStem.endsWith("우") && rawStem.length >= 2) {
		const patched = replaceLastFinalConsonant(rawStem.slice(0, -1), "ㅂ");
		if (patched) push(`${patched}다`);
	}

	// 르-irregular: 일러 -> 이르다, 불러 -> 부르다
	if (rawStem.endsWith("러") || rawStem.endsWith("라")) {
		const prev = rawStem.slice(0, -1);
		const stripped = stripLastFinalConsonant(prev);
		if (stripped && stripped.final === "ㄹ") {
			push(`${stripped.stem}르다`);
		}
	}

	// ㄹ-deletion & ㅅ-irregular only occur when the surface stem ends in an open vowel (no coda)
	if (!hasFinalConsonant(rawStem)) {
		// ㄹ-deletion before -시-/-니-/-ㅂ- (만드시니라 -> 만드 -> 만들다)
		const withRieul = replaceLastFinalConsonant(rawStem, "ㄹ");
		if (withRieul) push(`${withRieul}다`);

		// ㅅ-irregular (지으시니 -> 지 -> 짓다)
		const withSiot = replaceLastFinalConsonant(rawStem, "ㅅ");
		if (withSiot) push(`${withSiot}다`);
	}

	// ㄷ-irregular (들으라 -> 들 -> 듣다)
	const strippedCoda = stripLastFinalConsonant(rawStem);
	if (strippedCoda && strippedCoda.final === "ㄹ") {
		const withDigeut = replaceLastFinalConsonant(rawStem, "ㄷ");
		if (withDigeut) push(`${withDigeut}다`);
	}

	// Single-coda modifier/nominalizer (-ㄴ, -ㄹ, -ㅁ) attached to vowel stem (큰 -> 크다, 됨 -> 되다)
	if (strippedCoda && ["ㄴ", "ㄹ", "ㅁ"].includes(strippedCoda.final)) {
		push(`${strippedCoda.stem}다`);
		if (strippedCoda.stem.endsWith("하") && strippedCoda.stem.length >= 2) {
			push(strippedCoda.stem.slice(0, -1));
		}
		// ㅂ-irregular with -운 / -울 (어두운 -> 어둡다)
		if (strippedCoda.stem.endsWith("우") && strippedCoda.stem.length >= 2) {
			const bStem = replaceLastFinalConsonant(strippedCoda.stem.slice(0, -1), "ㅂ");
			if (bStem) push(`${bStem}다`);
		}
	}

	return candidates;
}

function splitPunctuation(raw: string): {
	leadPunct: string;
	word: string;
	trailPunct: string;
} {
	const leadMatch = raw.match(/^([^\uAC00-\uD7A3a-zA-Z0-9]+)/);
	const leadPunct = leadMatch ? leadMatch[1] : "";
	const withoutLead = raw.slice(leadPunct.length);
	const trailMatch = withoutLead.match(/([^\uAC00-\uD7A3a-zA-Z0-9]+)$/);
	const trailPunct = trailMatch ? trailMatch[1] : "";
	const word = withoutLead.slice(0, withoutLead.length - trailPunct.length);
	return { leadPunct, word, trailPunct };
}

export function analyzeKoreanWord(raw: string, lexicon: LexiconMap = {}): GlossToken {
	const parts = splitPunctuation(raw);
	const { leadPunct, word, trailPunct } = parts;

	if (!word || !containsHangul(word)) {
		return {
			raw,
			leadPunct,
			word,
			trailPunct,
			lemma: word,
			gloss: "",
			matched: false,
		};
	}

	const glossaryLookup: EntryLookup = (key) => BIBLICAL_GLOSSARY[key];
	const lexiconLookup: EntryLookup = (key) => lexicon[key];

	// 1. Direct exact lookup in curated biblical glossary first
	const exactGlossary = BIBLICAL_GLOSSARY[word];
	if (exactGlossary) {
		return makeToken(parts, raw, word, exactGlossary);
	}

	// 2. Curated biblical stem + particle/copula (avoids noisy Kengdic entries like 위에="hereinbefore")
	const glossaryNominal = matchNominalRules(raw, parts, glossaryLookup, true);
	if (glossaryNominal) {
		return glossaryNominal;
	}

	// 3. Curated biblical verbs/adjectives & irregular conjugations before general Kengdic lookup
	const glossaryVerb = matchVerbOrModifier(raw, parts, glossaryLookup, true);
	if (glossaryVerb) {
		return glossaryVerb;
	}

	// 4. Direct exact lookup in general lexicon (skip 1-syllable homograph noise)
	if (word.length >= 2) {
		const exactLexicon = lexicon[word];
		if (exactLexicon) {
			return makeToken(parts, raw, word, exactLexicon);
		}
	}

	// 5. Particle & Copula stripping against general lexicon (block 1-syllable and *-하 verb stems)
	const lexiconNominal = matchNominalRules(raw, parts, lexiconLookup, false);
	if (lexiconNominal) {
		return lexiconNominal;
	}

	// 6. Verb / Adjective ending stripping against general lexicon
	const lexiconVerb = matchVerbOrModifier(raw, parts, lexiconLookup, false);
	if (lexiconVerb) {
		return lexiconVerb;
	}

	// 7. Fallback: strip the most probable particle/ending so even rare words show a clean root guess
	for (const rule of SORTED_PARTICLE_RULES) {
		if (word.endsWith(rule.suffix) && word.length > rule.suffix.length) {
			const stem = word.slice(0, -rule.suffix.length);
			return {
				raw,
				leadPunct,
				word,
				trailPunct,
				lemma: stem,
				gloss: `root: ${stem} (see English verse above)`,
				grammarNote: `${rule.suffix} (${rule.note})`,
				matched: false,
			};
		}
	}

	return {
		raw,
		leadPunct,
		word,
		trailPunct,
		lemma: word,
		gloss: "see aligned English verse",
		matched: false,
	};
}

export function analyzeKoreanVerse(text: string, lexicon: LexiconMap = {}): GlossToken[] {
	if (!text.trim()) return [];
	return text
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((raw) => analyzeKoreanWord(raw, lexicon));
}

export interface ChapterAnalysisResult {
	tokensByVerse: Map<number, GlossToken[]>;
	footnotes: FootnoteVocabEntry[];
	grammarNotes: KrvGrammarNote[];
}

export function analyzeKoreanChapter(
	koreanVerses: VerseEntry[],
	lexicon: LexiconMap = {},
): ChapterAnalysisResult {
	const tokensByVerse = new Map<number, GlossToken[]>();
	const vocabByLemma = new Map<string, FootnoteVocabEntry>();
	const wordsForGrammar: Array<{ verse: number; words: string[] }> = [];

	for (const verseEntry of koreanVerses) {
		const tokens = analyzeKoreanVerse(verseEntry.text, lexicon);
		const verseWords: string[] = [];

		for (const token of tokens) {
			if (!token.word || !containsHangul(token.word)) continue;
			verseWords.push(token.word);

			if (!token.matched || !token.gloss) continue;

			const entryId = `vocab-${token.lemma}`;
			token.footnoteId = entryId;

			let entry = vocabByLemma.get(token.lemma);
			if (!entry) {
				entry = {
					id: entryId,
					lemma: token.lemma,
					surfaceForms: [token.word],
					verses: [verseEntry.verse],
					gloss: token.gloss,
					hanja: token.hanja,
					pos: token.pos,
					grammarNote: token.grammarNote,
				};
				vocabByLemma.set(token.lemma, entry);
			} else {
				if (!entry.surfaceForms.includes(token.word)) {
					entry.surfaceForms.push(token.word);
				}
				if (!entry.verses.includes(verseEntry.verse)) {
					entry.verses.push(verseEntry.verse);
				}
			}
		}

		tokensByVerse.set(verseEntry.verse, tokens);
		wordsForGrammar.push({ verse: verseEntry.verse, words: verseWords });
	}

	return {
		tokensByVerse,
		footnotes: [...vocabByLemma.values()],
		grammarNotes: detectKrvGrammarNotes(wordsForGrammar),
	};
}
