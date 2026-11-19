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
	/** Partial stem restored after stripping (e.g. "했" -> "하"). */
	stemPatch?: string;
}

type RuleSpec = readonly [suffix: string, note: string, stemPatch?: string];

function toRules(kind: SuffixRule["kind"], specs: readonly RuleSpec[]): SuffixRule[] {
	return specs.map(([suffix, note, stemPatch]) => ({ suffix, note, kind, stemPatch }));
}

const PARTICLE_RULES: readonly SuffixRule[] = toRules("particle", [
	["께서는", "honorific subject + topic"],
	["께서도", "honorific subject + 'also'"],
	["께로서", "'from (honorific person)'"],
	["에게는", "'to (person)' + topic"],
	["에게도", "'to (person)' + 'also'"],
	["에게로", "'toward (person)'"],
	["에게서", "'from (person)'"],
	["에서는", "'in/from' + topic"],
	["에서도", "'in/from' + 'also'"],
	["으로부터", "'from'"],
	["로부터", "'from'"],
	["으로는", "'with/toward' + topic"],
	["으로도", "'with/toward' + 'also'"],
	["으로나", "'whether by / or by'"],
	["로나", "'whether by / or by'"],
	["으로써", "'by means of'"],
	["으로서", "'as / in capacity of'"],
	["로써", "'by means of'"],
	["로서", "'as / in capacity of'"],
	["이라도", "'even'"],
	["까지도", "'even up to'"],
	["자들에게는", "plural 'those who' + 'to'"],
	["자들에게", "plural 'those who' + 'to'"],
	["들이니라", "plural + 'are' (declarative)"],
	["들에게서", "plural + 'from (persons)'"],
	["들에게는", "plural + 'to' + topic"],
	["들에게도", "plural + 'to' + 'also'"],
	["들에게", "plural + 'to'"],
	["들의", "plural + possessive 'of'"],
	["들이", "plural + subject"],
	["들을", "plural + object"],
	["들은", "plural + topic"],
	["들도", "plural + 'also'"],
	["들과", "plural + 'and/with'"],
	["들아", "plural vocative ('O ...')"],
	["께서", "honorific subject marker"],
	["에서", "'in / at / from' (location)"],
	["에게", "'to / for' (person)"],
	["한테", "'to / from' (person)"],
	["으로", "'toward / by / as'"],
	["부터", "'from / since'"],
	["까지", "'until / to / even'"],
	["대로", "'according to / as'"],
	["처럼", "'like / as'"],
	["보다", "'than'"],
	["마다", "'every / each'"],
	["밖에", "'except / only'"],
	["에도", "'in/at/to' + 'also'"],
	["에는", "'in/at/to' + topic"],
	["이나", "'or / even / though'"],
	["들", "plural marker"],
	["께", "'to' (honorific)"],
	["로", "'toward / by / as'"],
	["와", "'and / with'"],
	["과", "'and / with'"],
	["은", "topic marker"],
	["는", "topic marker"],
	["이", "subject marker"],
	["가", "subject marker"],
	["을", "object marker"],
	["를", "object marker"],
	["에", "'in / at / to'"],
	["의", "possessive ('of')"],
	["도", "'also / even'"],
	["만", "'only'"],
	["나", "'or / as for'"],
	["야", "vocative / emphatic"],
	["아", "vocative ('O ...')"],
	["여", "archaic vocative ('O ...')"],
	["이여", "archaic vocative ('O ...')"],
]);

const COPULA_RULES: readonly SuffixRule[] = toRules("copula", [
	["이시니라", "'is / are' (hon. declarative)"],
	["이시니이다", "'you are / it is' (polite hon.)"],
	["이시로다", "'is indeed!' (hon. exclamatory)"],
	["이시며", "'is ... and' (hon.)"],
	["이시고", "'is ... and' (hon.)"],
	["이시매", "'since [it] is' (hon.)"],
	["이시되", "'though / is' (hon.)"],
	["이시니", "'because [it] is' (hon.)"],
	["이시요", "'is' (hon.)"],
	["이니이다", "'is' (polite KRV declarative)"],
	["이니라", "'is / it is' (KRV declarative)"],
	["이리로다", "'will surely be!'"],
	["이리라", "'shall be' (declarative)"],
	["이로다", "'is indeed!' (exclamatory)"],
	["이로라", "'am / is' (literary declarative)"],
	["이로되", "'though / is ... yet'"],
	["인지라", "'since [it] is'"],
	["이라서", "'because [it] is'"],
	["이면", "'if [it] is'"],
	["인줄", "'that [it] is'"],
	["이라", "'is / called' (declarative)"],
	["이며", "'is ... and'"],
	["이고", "'is ... and'"],
	["이요", "'is ... and' (archaic)"],
	["이니", "'because [it] is'"],
	["시니이다", "'you are / it is' (polite hon.)"],
	["시니라", "'is / are' (hon. declarative)"],
	["시로다", "'is indeed!' (hon. exclamatory)"],
	["시며", "'is ... and' (hon.)"],
	["시고", "'is ... and' (hon.)"],
	["시매", "'since [it] is' (hon.)"],
	["시되", "'though / is' (hon.)"],
	["시니", "'because [it] is' (hon.)"],
	["시요", "'is' (hon.)"],
	["시라", "'is' (hon. declarative)"],
	["니이다", "'is' (polite declarative)"],
	["니라", "'is' (declarative)"],
	["로다", "'is indeed!'"],
	["러라", "'was / indeed' (literary)"],
	["로라", "'am / is' (literary)"],
	["로되", "'though / is ... yet'"],
	["며", "'is ... and'"],
	["요", "'is ... and'"],
	["라", "'is / called'"],
	["냐", "'is it ...?' (question)"],
	["인", "'who/which is' (copula modifier)"],
]);

const PAST_ENDINGS: readonly RuleSpec[] = [
	["음이라", "past nominalizer + 'is'"],
	["으므로", "past + 'because'"],
	["나이다", "past polite declarative"],
	["나이까", "past polite question"],
	["도다", "past exclamatory"],
	["느니라", "past declarative"],
	["느냐", "past question"],
	["느니", "past + 'since'"],
	["거늘", "past + 'when / since'"],
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

const EPENTHETIC_EU_ENDINGS: readonly RuleSpec[] = [
	["시니라", "-시- (hon.) + -니라 (declarative)"],
	["시면", "-시- (hon.) + 'if / when'"],
	["시매", "-시- (hon.) + 'when / since'"],
	["시며", "-시- (hon.) + 'and'"],
	["시고", "-시- (hon.) + 'and'"],
	["시니", "-시- (hon.) + 'so / since'"],
	["신", "-시- (hon.) + past modifier"],
	["실", "-시- (hon.) + future modifier"],
	["심", "-시- (hon.) + nominalizer"],
	["리로다", "future exclamatory ('will surely')"],
	["리라", "future declarative ('shall / will')"],
	["리니", "future connective ('for ... will')"],
	["니라", "declarative ('indeed')"],
	["매", "archaic connective ('when / since')"],
	["며", "'and / while'"],
	["니", "'so / since / when'"],
	["나", "'but / though'"],
	["면", "'if / when'"],
	["라", "imperative ('command')"],
	["사", "archaic connective ('having ...')"],
	["되", "'though / saying'"],
];

const CONNECTIVE_PAIRS: readonly RuleSpec[] = [
	["다가", "'and then'"],
	["야", "'must / only if'"],
	["도", "'even if / though'"],
	["서", "'because / and then'"],
];

// Vowel-contracted verb/adj stem endings (both connective and past -ㅆ- forms)
const STEM_CONTRACTIONS: ReadonlyArray<readonly [string, string]> = [
	["하여", "하다"],
	["와", "오다"],
	["왔", "오다"],
	["봐", "보다"],
	["봤", "보다"],
	["줘", "주다"],
	["줬", "주다"],
	["돼", "되다"],
	["됐", "되다"],
	["둬", "두다"],
	["뒀", "두다"],
	["쳐", "치다"],
	["쳤", "치다"],
	["려", "리다"],
	["렸", "리다"],
	["켜", "키다"],
	["켰", "키다"],
	["워", "우다"],
	["웠", "우다"],
	["져", "지다"],
	["졌", "지다"],
	["여", "이다"],
	["였", "이다"],
	["겨", "기다"],
	["겼", "기다"],
	["셔", "시다"],
	["셨", "시다"],
	["펴", "피다"],
	["폈", "피다"],
	["혀", "히다"],
	["혔", "히다"],
	["눠", "누다"],
	["눴", "누다"],
];

const VERB_ENDING_RULES: readonly SuffixRule[] = [
	...toRules("verb", [
		["셨나이다", "-시- (hon.) + past polite declarative"],
		["셨나이까", "-시- (hon.) + past polite question"],
		["셨느니라", "-시- (hon.) + past + -느니라"],
		["셨느냐", "-시- (hon.) + past question"],
		["셨거늘", "-시- (hon.) + past + 'when / since'"],
		["셨으매", "-시- (hon.) + past + 'when / since'"],
		["셨으니", "-시- (hon.) + past + 'so/since'"],
		["셨더라", "-시- (hon.) + past observed"],
		["셨고", "-시- (hon.) + past + 'and'"],
		["셨다", "-시- (hon.) + past"],
		["셨으며", "-시- (hon.) + past + 'and'"],
		["시옵소서", "-시- (hon.) + humble request ('please')"],
		["시나이다", "-시- (hon.) + polite declarative"],
		["시나이까", "-시- (hon.) + polite question"],
		["시나니", "-시- (hon.) + 'for / since'"],
		["심이니이다", "-시- (hon.) + nominalizer + polite 'is'"],
		["심이니라", "-시- (hon.) + nominalizer + 'is'"],
		["심이라", "-시- (hon.) + nominalizer + 'is'"],
		["심으로", "-시- (hon.) + 'by doing'"],
		["심을", "-시- (hon.) + nominalizer + object"],
		["심이", "-시- (hon.) + nominalizer + subject"],
		["시는도다", "-시- (hon.) + exclamatory"],
		["시니라", "-시- (hon.) + -니라 (declarative)"],
		["시리라", "-시- (hon.) + future declarative"],
		["시리로다", "-시- (hon.) + future exclamatory"],
		["시던", "-시- (hon.) + past modifier"],
		["시더라", "-시- (hon.) + past observed"],
		["시면", "-시- (hon.) + 'if / when'"],
		["시매", "-시- (hon.) + -매 ('when/since')"],
		["시며", "-시- (hon.) + 'and / while'"],
		["시고", "-시- (hon.) + 'and'"],
		["시니", "-시- (hon.) + 'so / as'"],
		["시되", "-시- (hon.) + 'saying / but'"],
		["시사", "-시- (hon.) + archaic connective"],
		["시게", "-시- (hon.) + 'so that'"],
		["시지", "-시- (hon.) + negative/connective"],
		["시기에", "-시- (hon.) + 'when / to see'"],
		["시기를", "-시- (hon.) + 'to do'"],
		["시기로", "-시- (hon.) + 'to do'"],
		["시는", "-시- (hon.) + present modifier"],
		["신대로", "-시- (hon.) + 'according to'"],
		["신바", "-시- (hon.) + 'that which'"],
		["실", "-시- (hon.) + future modifier"],
		["신", "-시- (hon.) + past modifier"],
		["심", "-시- (hon.) + nominalizer"],
		["옵소서", "humble polite request ('please')"],
		["소서", "polite request ('please')"],
		["삽나이까", "humble archaic question"],
		["나이다", "polite archaic declarative"],
		["나이까", "polite archaic question"],
		["이니이다", "polite KRV declarative"],
		["음이니이다", "nominalizer + polite 'is'"],
	]),
	...toRules(
		"verb",
		EPENTHETIC_EU_ENDINGS.map(([tail, note]) => [`으${tail}`, note]),
	),
	...toRules("verb", [
		["겠느니라", "future/certainty declarative"],
		["겠느냐", "future/certainty question"],
		["겠나이다", "polite future declarative"],
		["겠노라", "1st-person resolve ('I will')"],
		["겠으니", "future + 'so / since'"],
		["겠고", "future + 'and'"],
		["겠다", "future / 'will / would'"],
	]),
	...toRules(
		"verb",
		["였", "었", "았"].flatMap((tense) =>
			PAST_ENDINGS.map(([tail, note]): RuleSpec => [`${tense}${tail}`, note]),
		),
	),
	...toRules(
		"verb",
		["나이다", "나이까", "도다", "느니라", "느냐", "거늘", "더라", "으니", "으며", "고", "다"].map(
			(tail): RuleSpec => [
				`했${tail}`,
				PAST_ENDINGS.find(([t]) => t === tail)?.[1] ?? "past tense",
				"하",
			],
		),
	),
	...toRules("verb", [
		["었으매", "past + 'when / since'"],
		["었으되", "past + 'though'"],
		["았다가", "past + 'and then'"],
		["었다가", "past + 'and then'"],
		["을찌라도", "'even though' (archaic KRV)"],
		["찌라도", "'even though' (archaic KRV)"],
		["지라도", "'even though'"],
		["찐대", "'if indeed / since' (archaic KRV)"],
		["찐저", "archaic prophetic ('surely')"],
		["을찐저", "archaic prophetic ('surely')"],
		["을찌니라", "solemn command / 'shall' (archaic KRV)"],
		["찌니라", "solemn command / 'shall' (archaic KRV)"],
		["지니라", "solemn command / 'shall'"],
		["을찌어다", "blessing / imperative (archaic KRV)"],
		["찌어다", "blessing / imperative (archaic KRV)"],
		["지어다", "blessing / imperative ('let there be')"],
		["느니라", "timeless declarative"],
		["는도다", "poetic exclamatory"],
		["리로다", "future exclamatory"],
		["리라", "future declarative ('shall / will')"],
		["리니", "future connective"],
		["리요", "rhetorical future ('would ...?')"],
		["노라", "1st-person declarative"],
		["노니", "1st-person 'for I ...'"],
		["느냐", "question ('do you ...?')"],
		["거니와", "'indeed, yet / besides'"],
		["거든", "'if / when'"],
		["거늘", "archaic connective ('when / since')"],
		["건대", "'when considering'"],
		["더이다", "polite past observed"],
		["더라", "observed past"],
		["더니", "'and then / since'"],
		["던", "retrospective past modifier"],
		["도다", "exclamatory"],
		["니라", "KRV declarative"],
		["나니", "'for / since'"],
		["는데", "'while / when / and'"],
		["는대로", "'as / according to'"],
		["은바", "'that which'"],
		["한바", "'that which'", "하"],
		["은것", "'the thing that'"],
		["기가", "nominalized subject"],
		["기에", "'for / at doing'"],
		["기를", "nominalized object"],
		["기로", "'by / to do'"],
		["므로", "'because / since'"],
		["매", "'when / since'"],
		["며", "'and / while'"],
		["면", "'if / when'"],
		["고", "'and / then'"],
		["니", "'so / since'"],
		["나", "'but / though'"],
		["되", "'saying / though'"],
		["도", "'even / though'"],
	]),
	...toRules(
		"verb",
		["어", "아", "여"].flatMap((vowel) =>
			CONNECTIVE_PAIRS.map(([tail, note]): RuleSpec => [`${vowel}${tail}`, note]),
		),
	),
	...toRules("verb", [
		["다가", "'while doing, then'"],
		["라고", "quotative ('to / saying')"],
		["지", "negative / auxiliary connective"],
		["치", "contracted -하지 ('not / do')", "하"],
		["케", "contracted -하게 (causative)", "하"],
		["게", "causative / 'so that'"],
		["기", "nominalizer ('-ing')"],
		["려", "'intending to / in order to'"],
		["러", "'in order to'"],
		["자", "hortative ('let us ...')"],
		["을까", "'lest / might'"],
		["까", "'lest / might'"],
		["는", "present modifier"],
		["은", "past/adj modifier"],
		["을", "future modifier"],
		["음", "nominalizer"],
		["사", "archaic connective"],
		["서", "'and then / so'"],
		["여", "connective"],
		["아", "connective"],
		["어", "connective"],
		["라", "imperative / declarative"],
	]),
];

const byLongestSuffix = (a: SuffixRule, b: SuffixRule) => b.suffix.length - a.suffix.length;
const SORTED_PARTICLE_RULES: readonly SuffixRule[] = [...PARTICLE_RULES].sort(byLongestSuffix);
const SORTED_NOMINAL_RULES: readonly SuffixRule[] = [...PARTICLE_RULES, ...COPULA_RULES].sort(
	byLongestSuffix,
);
const SORTED_VERB_ENDING_RULES: readonly SuffixRule[] = [...VERB_ENDING_RULES].sort(
	byLongestSuffix,
);

const RIEUL_MODIFIER_ENDINGS = new Set([
	"찌라도",
	"지라도",
	"찐대",
	"찐저",
	"찌니라",
	"지니라",
	"찌어다",
	"지어다",
	"까",
]);
const CODA_MODIFIERS = new Set(["ㄴ", "ㄹ", "ㅁ"]);

type EntryLookup = (key: string) => LexiconEntry | undefined;

interface TokenParts {
	leadPunct: string;
	word: string;
	trailPunct: string;
}

function isSafeLexiconNounStem(stem: string): boolean {
	return stem.length >= 2 && !stem.endsWith("하");
}

function isPredicateHit(entry: LexiconEntry): boolean {
	return !entry.pos || entry.pos === "verb" || entry.pos === "adj";
}

function isNominalHit(entry: LexiconEntry): boolean {
	return entry.pos !== "verb" && entry.pos !== "adj";
}

function makeToken(
	parts: TokenParts,
	raw: string,
	lemma: string,
	entry: LexiconEntry,
	grammarNote?: string,
): GlossToken {
	return {
		raw,
		...parts,
		lemma,
		gloss: entry.gloss,
		hanja: entry.hanja,
		pos: entry.pos,
		grammarNote,
		matched: true,
	};
}

function findPredicateToken(
	raw: string,
	parts: TokenParts,
	stem: string,
	lookup: EntryLookup,
	grammarNote: string,
	allowHaSuffix = false,
	allowIrregular = true,
): GlossToken | null {
	for (const candidate of generatePredicateLemmaCandidates(stem, allowHaSuffix, allowIrregular)) {
		const hit = lookup(candidate);
		if (hit && isPredicateHit(hit)) return makeToken(parts, raw, candidate, hit, grammarNote);
	}
	return null;
}

function matchNominalRules(
	raw: string,
	parts: TokenParts,
	lookup: EntryLookup,
	allowSingleCharNoun: boolean,
): GlossToken | null {
	const { word } = parts;
	for (const rule of SORTED_NOMINAL_RULES) {
		if (!word.endsWith(rule.suffix) || word.length <= rule.suffix.length) continue;
		const stem = word.slice(0, -rule.suffix.length);
		const isBareVowelCopula = rule.kind === "copula" && !rule.suffix.startsWith("이");

		// Copula forms without leading "이" (e.g. -라, -니라, -로다) only attach after an open vowel;
		// for 1-char stems (e.g. 주니라, 보라), let predicate matching win when a verb exists.
		if (isBareVowelCopula) {
			if (hasFinalConsonant(stem)) continue;
			if (stem.length === 1 && matchVerbOrModifier(raw, parts, lookup)) continue;
		}

		if (allowSingleCharNoun || isSafeLexiconNounStem(stem)) {
			const directStem = lookup(stem);
			if (directStem && isNominalHit(directStem))
				return makeToken(parts, raw, stem, directStem, `${rule.suffix} (${rule.note})`);
		}

		// Nominalized verb + particle/copula (e.g. 부족함이, 함이라)
		if (stem.endsWith("음") && stem.length >= 2) {
			const hit = findPredicateToken(
				raw,
				parts,
				stem.slice(0, -1),
				lookup,
				`-음 (nominalizer) + ${rule.suffix} (${rule.note})`,
			);
			if (hit) return hit;
		}

		// Strip -ㅁ/-ㄴ/-ㄹ nominalizer/modifier inside particles, or -ㅁ inside copulas.
		// Require 2+ char stems for particle -ㄴ/-ㄹ (and disable irregular guessing) so 1-char
		// nouns like 전에는 ("before") or 단을 ("altar") don't mis-parse as 절다 ("limp") / 달다 ("sweet").
		const coda = stripLastFinalConsonant(stem);
		const allowCoda =
			coda &&
			(rule.kind === "particle"
				? CODA_MODIFIERS.has(coda.final) &&
					(coda.stem.length >= 2 || (allowSingleCharNoun && coda.final === "ㅁ"))
				: coda.final === "ㅁ" && (coda.stem.length >= 2 || allowSingleCharNoun));
		if (coda && allowCoda) {
			const hit = findPredicateToken(
				raw,
				parts,
				coda.stem,
				lookup,
				`-${coda.final} + ${rule.suffix} (${rule.note})`,
				false,
				false,
			);
			if (hit) return hit;
		}
	}
	return null;
}

function endsWithOpenAEoVowel(word: string): boolean {
	if (!word) return false;
	const code = word.charCodeAt(word.length - 1);
	if (code < 0xac00 || code > 0xd7a3) return false;
	const offset = code - 0xac00;
	const jong = offset % 28;
	if (jong !== 0) return false;
	const jung = Math.floor(offset / 28) % 21;
	// Open vowels ㅏ (0), ㅐ (1), ㅓ (4), ㅔ (5) drop redundant -아/-어 in connectives (e.g. 들어가, 보내, 떠나).
	return jung === 0 || jung === 1 || jung === 4 || jung === 5;
}

function matchBareConnectivePredicate(
	raw: string,
	parts: TokenParts,
	lookup: EntryLookup,
): GlossToken | null {
	const { word } = parts;
	// Match vowel-contracted connectives (지켜 -> 지키다, 세워 -> 세우다, 가져 -> 가지다, 쳐 -> 치다)
	// and uncontracted -아/-어 connectives (들어가 -> 들어가다, 떠나 -> 떠나다) before stripping single-char endings.
	for (const [tail, replacement] of STEM_CONTRACTIONS) {
		if (word.endsWith(tail)) {
			const candidate = `${word.slice(0, -tail.length)}${replacement}`;
			const hit = lookup(candidate);
			if (hit && isPredicateHit(hit)) {
				return makeToken(parts, raw, candidate, hit, "-아/-어 (connective)");
			}
		}
	}
	if (word.length >= 2 && endsWithOpenAEoVowel(word)) {
		const directCandidate = `${word}다`;
		const directHit = lookup(directCandidate);
		if (directHit && isPredicateHit(directHit)) {
			return makeToken(parts, raw, directCandidate, directHit, "-아/-어 (connective)");
		}
	}
	return null;
}

function matchVerbOrModifier(
	raw: string,
	parts: TokenParts,
	lookup: EntryLookup,
): GlossToken | null {
	const { word } = parts;

	const bareConnective = matchBareConnectivePredicate(raw, parts, lookup);
	if (bareConnective) return bareConnective;

	// Check direct -ㄴ/-ㄹ/-ㅁ modifier/nominalizer on open-vowel / ㅂ-irregular stems (e.g. 모은 -> 모으다,
	// 어두운 -> 어둡다) before -은/-을 strips to a 1-char stem and triggers spurious ㄹ-deletion (몰다).
	const strippedTail = stripLastFinalConsonant(word);
	if (
		strippedTail &&
		CODA_MODIFIERS.has(strippedTail.final) &&
		!/(?:으?시|었|았|였|겠|했|던)$/.test(strippedTail.stem)
	) {
		const modNote =
			strippedTail.final === "ㄴ"
				? "-ㄴ (modifier)"
				: strippedTail.final === "ㄹ"
					? "-ㄹ (future modifier)"
					: "-ㅁ (nominalizer)";
		for (const candidate of [`${strippedTail.stem}다`, getBIrregularLemma(strippedTail.stem)]) {
			if (!candidate) continue;
			const hit = lookup(candidate);
			if (hit && isPredicateHit(hit)) return makeToken(parts, raw, candidate, hit, modNote);
		}
	}

	for (const rule of SORTED_VERB_ENDING_RULES) {
		if (!word.endsWith(rule.suffix) || word.length <= rule.suffix.length) continue;
		const stem = `${word.slice(0, -rule.suffix.length)}${rule.stemPatch ?? ""}`;

		if (rule.suffix !== "까") {
			const hit = findPredicateToken(
				raw,
				parts,
				stem,
				lookup,
				`-${rule.suffix} (${rule.note})`,
				rule.suffix === "지",
			);
			if (hit) return hit;
		}

		// Handle -ㄹ찌라도 / -ㄹ지니라 / -ㄹ지어다 / -ㄹ찐대 / -ㄹ찐저 / -ㄹ까 where ㄹ is the stem coda
		if (RIEUL_MODIFIER_ENDINGS.has(rule.suffix)) {
			const strippedRieul = stripLastFinalConsonant(stem);
			if (strippedRieul && strippedRieul.final === "ㄹ") {
				const hit = findPredicateToken(
					raw,
					parts,
					strippedRieul.stem,
					lookup,
					`-ㄹ${rule.suffix} (${rule.note})`,
				);
				if (hit) return hit;
			}
		}
	}

	// Fallback bare consonant modifier/nominalizer including ㄹ-deletion (만든 -> 만들다, 큰 -> 크다)
	if (strippedTail && CODA_MODIFIERS.has(strippedTail.final)) {
		const modNote =
			strippedTail.final === "ㄴ"
				? "-ㄴ (modifier)"
				: strippedTail.final === "ㄹ"
					? "-ㄹ (future modifier)"
					: "-ㅁ (nominalizer)";
		const hit = findPredicateToken(raw, parts, strippedTail.stem, lookup, modNote);
		if (hit) return hit;
	}

	return null;
}

function getBIrregularLemma(stem: string): string | null {
	if (!stem.endsWith("우") || stem.length < 2) return null;
	const patched = replaceLastFinalConsonant(stem.slice(0, -1), "ㅂ");
	return patched ? `${patched}다` : null;
}

function generatePredicateLemmaCandidates(
	rawStem: string,
	allowHaSuffix = true,
	allowIrregular = true,
): string[] {
	if (!rawStem) return [];
	const candidates: string[] = [];
	const push = (val: string | null | undefined) => {
		if (val && !candidates.includes(val)) candidates.push(val);
	};

	push(`${rawStem}다`);

	for (const [tail, replacement] of STEM_CONTRACTIONS) {
		if (rawStem.endsWith(tail)) push(`${rawStem.slice(0, -tail.length)}${replacement}`);
	}
	if (allowHaSuffix && !rawStem.endsWith("하")) push(`${rawStem}하다`);

	if (!allowIrregular) return candidates;

	push(getBIrregularLemma(rawStem));

	// 르-irregular: 일러 -> 이르다, 불러 -> 부르다
	if (rawStem.endsWith("러") || rawStem.endsWith("라")) {
		const stripped = stripLastFinalConsonant(rawStem.slice(0, -1));
		if (stripped && stripped.final === "ㄹ") push(`${stripped.stem}르다`);
	}

	// ㄹ-deletion & ㅅ-irregular only when surface stem ends in an open vowel
	if (!hasFinalConsonant(rawStem)) {
		const withRieul = replaceLastFinalConsonant(rawStem, "ㄹ");
		if (withRieul) push(`${withRieul}다`);
		const withSiot = replaceLastFinalConsonant(rawStem, "ㅅ");
		if (withSiot) push(`${withSiot}다`);
	}

	// ㄷ-irregular (들으라 -> 듣다)
	const strippedCoda = stripLastFinalConsonant(rawStem);
	if (strippedCoda && strippedCoda.final === "ㄹ") {
		const withDigeut = replaceLastFinalConsonant(rawStem, "ㄷ");
		if (withDigeut) push(`${withDigeut}다`);
	}

	// Single-coda modifier/nominalizer (-ㄴ, -ㄹ, -ㅁ) on vowel stem (큰 -> 크다, 어두운 -> 어둡다)
	if (strippedCoda && CODA_MODIFIERS.has(strippedCoda.final)) {
		push(`${strippedCoda.stem}다`);
		push(getBIrregularLemma(strippedCoda.stem));
	}

	return candidates;
}

function findNounHaFallback(
	raw: string,
	parts: TokenParts,
	passes: ReadonlyArray<{ lookup: EntryLookup }>,
): GlossToken | null {
	const { word } = parts;
	for (const rule of SORTED_VERB_ENDING_RULES) {
		if (!word.endsWith(rule.suffix) || word.length <= rule.suffix.length) continue;
		const stem = `${word.slice(0, -rule.suffix.length)}${rule.stemPatch ?? ""}`;
		if (!stem.endsWith("하") || stem.length < 3) continue;
		const nounRoot = stem.slice(0, -1);
		for (const { lookup } of passes) {
			const hit = lookup(nounRoot);
			if (hit && isNominalHit(hit)) {
				return makeToken(parts, raw, nounRoot, hit, `-${rule.suffix} (${rule.note})`);
			}
		}
	}
	return null;
}

function splitPunctuation(raw: string): TokenParts {
	const leadMatch = raw.match(/^([^\uAC00-\uD7A3a-zA-Z0-9]+)/);
	const leadPunct = leadMatch ? leadMatch[1] : "";
	const withoutLead = raw.slice(leadPunct.length);
	const trailMatch = withoutLead.match(/([^\uAC00-\uD7A3a-zA-Z0-9]+)$/);
	const trailPunct = trailMatch ? trailMatch[1] : "";
	return {
		leadPunct,
		word: withoutLead.slice(0, withoutLead.length - trailPunct.length),
		trailPunct,
	};
}

const hasOwnProp = Object.prototype.hasOwnProperty;

function ownEntry(map: LexiconMap): EntryLookup {
	return (key) => (hasOwnProp.call(map, key) ? map[key] : undefined);
}

export function analyzeKoreanWord(raw: string, lexicon: LexiconMap = {}): GlossToken {
	const parts = splitPunctuation(raw);
	const { word } = parts;

	if (!word || !containsHangul(word)) {
		return { raw, ...parts, lemma: word, gloss: "", matched: false };
	}

	// Curated biblical glossary takes priority (including 1-char stems); general lexicon skips 1-char exact homograph noise.
	const passes: ReadonlyArray<{ lookup: EntryLookup; allowSingleChar: boolean }> = [
		{ lookup: ownEntry(BIBLICAL_GLOSSARY), allowSingleChar: true },
		{ lookup: ownEntry(lexicon), allowSingleChar: false },
	];

	for (const { lookup, allowSingleChar } of passes) {
		if (allowSingleChar || word.length >= 2) {
			const exact = lookup(word);
			if (exact) return makeToken(parts, raw, word, exact);
		}
		const nominal = matchNominalRules(raw, parts, lookup, allowSingleChar);
		if (nominal) return nominal;
		const verb = matchVerbOrModifier(raw, parts, lookup);
		if (verb) return verb;
	}

	// Only after failing to find a "-하다" verb in both passes, map 2+ char noun + 하 (e.g. 창조하 -> 창조)
	const nounHa = findNounHaFallback(raw, parts, passes);
	if (nounHa) return nounHa;

	// Fallback: strip probable particle so rare words still display a root guess
	for (const rule of SORTED_PARTICLE_RULES) {
		if (word.endsWith(rule.suffix) && word.length > rule.suffix.length) {
			const stem = word.slice(0, -rule.suffix.length);
			return {
				raw,
				...parts,
				lemma: stem,
				gloss: `root: ${stem} (see English verse above)`,
				grammarNote: `${rule.suffix} (${rule.note})`,
				matched: false,
			};
		}
	}

	return { raw, ...parts, lemma: word, gloss: "see aligned English verse", matched: false };
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
				if (!entry.surfaceForms.includes(token.word)) entry.surfaceForms.push(token.word);
				if (!entry.verses.includes(verseEntry.verse)) entry.verses.push(verseEntry.verse);
				if (!entry.pos && token.pos) entry.pos = token.pos;
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
