import { BIBLICAL_GLOSSARY, detectKrvGrammarNotes } from "./biblical-glossary";
import {
	containsHangul,
	endsWithOpenAEoVowel,
	getFirstInitialConsonant,
	hasFinalConsonant,
	replaceLastFinalConsonant,
	restoreEuIrregularStem,
	startsWithOpenOVowel,
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

type CodaReq = "consonant" | "vowel" | "vowelOrRieul";

interface SuffixRule {
	suffix: string;
	note: string;
	kind: "particle" | "copula" | "verb";
	/** Partial stem restored after stripping (e.g. "했" -> "하"). */
	stemPatch?: string;
	/** Phonological 받침 requirement on the preceding stem (for particles/copulas). */
	codaReq?: CodaReq;
}

type RuleSpec = readonly [suffix: string, note: string, stemPatch?: string, codaReq?: CodaReq];

function toRules(kind: SuffixRule["kind"], specs: readonly RuleSpec[]): SuffixRule[] {
	return specs.map(([suffix, note, stemPatch, codaReq]) => ({
		suffix,
		note,
		kind,
		stemPatch,
		codaReq,
	}));
}

function withEuphonicRo(specs: readonly (readonly [tail: string, note: string])[]): RuleSpec[] {
	return specs.flatMap(([tail, note]): RuleSpec[] => [
		[`으${tail}`, note, undefined, "consonant"],
		[tail, note, undefined, "vowelOrRieul"],
	]);
}

const PARTICLE_RULES: readonly SuffixRule[] = toRules("particle", [
	["께로부터", "'from (honorific person)'"],
	["에게로부터", "'from (person)'"],
	["께서는", "honorific subject + topic"],
	["께서도", "honorific subject + 'also'"],
	["께로서", "'from (honorific person)'"],
	["께로", "'toward (honorific person)'"],
	["에게는", "'to (person)' + topic"],
	["에게도", "'to (person)' + 'also'"],
	["에게로", "'toward (person)'"],
	["에게서", "'from (person)'"],
	["게서", "'from (person)'"],
	["게로", "'toward (person)'"],
	["에서는", "'in/from' + topic"],
	["에서도", "'in/from' + 'also'"],
	["에서만", "'only in/from'"],
	["에서야", "'only in/at/from'"],
	["에야", "'only at/in'"],
	["에나", "'even at/in / or at'"],
	["에라", "'at/in' + emphatic"],
	["에라도", "'even at/in'"],
	["서부터", "'from (place)'"],
	["서도", "'from (place)' + 'also'"],
	["서는", "'from (place)' + topic"],
	...withEuphonicRo([
		["로부터", "'from'"],
		["로는", "'with/toward' + topic"],
		["로도", "'with/toward' + 'also'"],
		["로나", "'whether by / or by'"],
		["로만", "'only by/toward'"],
		["로써", "'by means of'"],
		["로서", "'as / in capacity of'"],
	]),
	["이라도", "'even'", undefined, "consonant"],
	["라도", "'even'", undefined, "vowel"],
	["까지라도", "'even up to'"],
	["까지도", "'even up to'"],
	["까지는", "'up to' + topic"],
	["까지나", "'even up to'"],
	["부터는", "'from' + topic"],
	["대로는", "'according to' + topic"],
	["보다는", "'than' + topic"],
	["께서", "honorific subject marker"],
	["에서", "'in / at / from' (location)"],
	["에게", "'to / for' (person)"],
	["한테", "'to / from' (person)"],
	["으로", "'toward / by / as'", undefined, "consonant"],
	["부터", "'from / since'"],
	["까지", "'until / to / even'"],
	["대로", "'according to / as'"],
	["처럼", "'like / as'"],
	["보다", "'than'"],
	["마다", "'every / each'"],
	["밖에", "'except / only'"],
	["에도", "'in/at/to' + 'also'"],
	["에는", "'in/at/to' + topic"],
	["에만", "'only in/at/to'"],
	["이나", "'or / even / though'", undefined, "consonant"],
	["이여", "archaic vocative ('O ...')", undefined, "consonant"],
	["들", "plural marker"],
	["께", "'to' (honorific)"],
	["로", "'toward / by / as'", undefined, "vowelOrRieul"],
	["와", "'and / with'", undefined, "vowel"],
	["과", "'and / with'", undefined, "consonant"],
	["은", "topic marker", undefined, "consonant"],
	["는", "topic marker", undefined, "vowel"],
	["이", "subject marker", undefined, "consonant"],
	["가", "subject marker", undefined, "vowel"],
	["을", "object marker", undefined, "consonant"],
	["를", "object marker", undefined, "vowel"],
	["에", "'in / at / to'"],
	["의", "possessive ('of')"],
	["도", "'also / even'"],
	["만", "'only'"],
	["나", "'or / as for'", undefined, "vowel"],
	["야", "vocative / emphatic", undefined, "vowel"],
	["아", "vocative ('O ...')", undefined, "consonant"],
	["여", "archaic vocative ('O ...')", undefined, "vowel"],
]);

const BARE_COPULA_SPECS: readonly RuleSpec[] = [
	["시니이다", "'you are / it is' (polite hon.)"],
	["시니라", "'is / are' (hon. declarative)"],
	["시리라", "'shall be' (hon. declarative)"],
	["시로다", "'is indeed!' (hon. exclamatory)"],
	["시며", "'is ... and' (hon.)"],
	["시고", "'is ... and' (hon.)"],
	["시매", "'since [it] is' (hon.)"],
	["시되", "'though / is' (hon.)"],
	["시니", "'because [it] is' (hon.)"],
	["시요", "'is' (hon.)"],
	["시라", "'is' (hon. declarative)"],
	["시냐", "'is ...?' (hon. question)"],
	["시뇨", "'is ...?' (hon. archaic question)"],
	["시랴", "'would ... be?' (hon. rhetorical)"],
	["니이다", "'is' (polite KRV declarative)"],
	["니라", "'is' (declarative)"],
	["더라", "'was' (observed past)"],
	["로다", "'is indeed!' (exclamatory)"],
	["로라", "'am / is' (literary)"],
	["로되", "'though / is ... yet'"],
	["관대", "'what/who ... that' (archaic KRV)"],
	["오며", "'is ... and' (humble KRV)"],
	["오니", "'since [it] is' (humble KRV)"],
	["오매", "'when/since [it] is' (humble KRV)"],
	["오되", "'though [it] is' (humble KRV)"],
	["며", "'is ... and'"],
	["요", "'is ... and'"],
	["라", "'is / called'"],
	["냐", "'is it ...?' (question)"],
	["뇨", "'is it ...?' (archaic KRV question)"],
	["랴", "'would it be ...?' (rhetorical)"],
];

const NOMINALIZER_CASE_TAILS: readonly (readonly [tail: string, note: string])[] = [
	["이니이다", "nominalizer + polite 'is'"],
	["이니라", "nominalizer + 'is'"],
	["이라", "nominalizer + 'is'"],
	["이요", "nominalizer + 'is ... and'"],
	["이며", "nominalizer + 'is ... and'"],
	["은", "nominalizer + topic"],
	["을", "nominalizer + object"],
	["이", "nominalizer + subject"],
];

const COPULA_RULES: readonly SuffixRule[] = toRules("copula", [
	...BARE_COPULA_SPECS.map(([suffix, note]): RuleSpec => [suffix, note, undefined, "vowel"]),
	...BARE_COPULA_SPECS.map(([suffix, note]): RuleSpec => [`이${suffix}`, note]),
	["이리로다", "'will surely be!'"],
	["이리라", "'shall be' (declarative)"],
	...NOMINALIZER_CASE_TAILS.map(([tail, note]): RuleSpec => [`임${tail}`, `copula ${note}`]),
	["임이여", "copula nominalizer + exclamatory"],
	["임이로다", "copula nominalizer + 'is indeed!'"],
	["임이니", "copula nominalizer + 'for / since'"],
	["이러라", "'was / indeed' (literary)"],
	["인지라", "'since [it] is'"],
	["인지", "'whether / what [it] is'"],
	["인즉", "'since/if [it] is' (archaic KRV)"],
	["이라서", "'because [it] is'"],
	["이면", "'if [it] is'"],
	["인줄", "'that [it] is'"],
	["이고", "'is ... and'"],
	["이니", "'because [it] is'"],
	["러라", "'was / indeed' (literary)", undefined, "vowel"],
	["인", "'who/which is' (copula modifier)", undefined, "consonant"],
]);

const PAST_ENDINGS: readonly RuleSpec[] = [
	...NOMINALIZER_CASE_TAILS.map(([tail, note]): RuleSpec => [`음${tail}`, `past ${note}`]),
	["음이러라", "past nominalizer + literary 'was'"],
	["으므로", "past + 'because'"],
	["는지라", "past + 'because / since'"],
	["는데", "past + 'while / and'"],
	["거니와", "past + 'indeed, yet'"],
	["은즉", "past + 'since / when'"],
	["으매", "past + 'when / since'"],
	["으되", "past + 'though / saying'"],
	["으리이다", "past + polite future/presumption"],
	["으리요", "past + rhetorical ('would ...?')"],
	["었노라", "double-past 1st-person declarative"],
	["사오니", "past humble + 'for / since'"],
	["사오며", "past humble + 'and'"],
	["사오매", "past humble + 'when / since'"],
	["사오되", "past humble + 'though / saying'"],
	["나이다", "past polite declarative"],
	["나이까", "past polite question"],
	["도다", "past exclamatory"],
	["느니라", "past declarative"],
	["느냐", "past question"],
	["느뇨", "past archaic question"],
	["느니", "past + 'since'"],
	["거늘", "past + 'when / since'"],
	["노라", "1st-person past declarative"],
	["나니", "past + 'for / since'"],
	["더라", "past observed"],
	["더니", "past + 'and then'"],
	["다가", "past + 'and then'"],
	["으니", "past + 'so / since'"],
	["으나", "past + 'but / though'"],
	["으며", "past + 'and'"],
	["던", "past retrospective modifier"],
	["는", "past modifier (KRV)"],
	["을", "past future/conditional modifier"],
	["고", "past + 'and'"],
	["다", "past tense"],
];

const HONORIFIC_SI_ENDINGS: readonly RuleSpec[] = [
	...PAST_ENDINGS.map(([tail, note]): RuleSpec => [`셨${tail}`, `-시- (hon.) + ${note}`]),
	["시옵소서", "-시- (hon.) + humble request ('please')"],
	["시옵나이다", "-시- (hon.) + humble polite declarative"],
	["시옵나이까", "-시- (hon.) + humble polite question"],
	["시오니", "-시- (hon.) + humble 'for / since'"],
	["시오며", "-시- (hon.) + humble 'and'"],
	["시오매", "-시- (hon.) + humble 'when / since'"],
	["시오되", "-시- (hon.) + humble 'though / saying'"],
	["시나이다", "-시- (hon.) + polite declarative"],
	["시나이까", "-시- (hon.) + polite question"],
	["시나니", "-시- (hon.) + 'for / since'"],
	["시느니라", "-시- (hon.) + timeless declarative"],
	["시느뇨", "-시- (hon.) + archaic question"],
	["시느냐", "-시- (hon.) + question"],
	["시는지라", "-시- (hon.) + 'because / since'"],
	["신지라", "-시- (hon.) + 'because / since'"],
	["신즉", "-시- (hon.) + 'since / when'"],
	["신대", "-시- (hon.) + 'when / as'"],
	["시므로", "-시- (hon.) + 'because / since'"],
	["시려고", "-시- (hon.) + 'in order to'"],
	["심이니이다", "-시- (hon.) + nominalizer + polite 'is'"],
	["심이니라", "-시- (hon.) + nominalizer + 'is'"],
	["심이라", "-시- (hon.) + nominalizer + 'is'"],
	["심으로", "-시- (hon.) + 'by doing'"],
	["심을", "-시- (hon.) + nominalizer + object"],
	["심이", "-시- (hon.) + nominalizer + subject"],
	["시는도다", "-시- (hon.) + exclamatory"],
	["시도다", "-시- (hon.) + exclamatory"],
	["시니라", "-시- (hon.) + -니라 (declarative)"],
	["시리이다", "-시- (hon.) + polite future declarative"],
	["시리라", "-시- (hon.) + future declarative"],
	["시리니", "-시- (hon.) + future connective"],
	["시리로다", "-시- (hon.) + future exclamatory"],
	["시리요", "-시- (hon.) + rhetorical future"],
	["시랴", "-시- (hon.) + rhetorical question"],
	["시냐", "-시- (hon.) + question"],
	["시뇨", "-시- (hon.) + archaic question"],
	["시던", "-시- (hon.) + past modifier"],
	["시더라", "-시- (hon.) + past observed"],
	["시더니", "-시- (hon.) + 'and then'"],
	["시는데", "-시- (hon.) + 'while / when'"],
	["시면", "-시- (hon.) + 'if / when'"],
	["시매", "-시- (hon.) + -매 ('when / since')"],
	["시며", "-시- (hon.) + 'and / while'"],
	["시고", "-시- (hon.) + 'and'"],
	["시니", "-시- (hon.) + 'so / as'"],
	["시나", "-시- (hon.) + 'but / though'"],
	["시되", "-시- (hon.) + 'saying / but'"],
	["시사", "-시- (hon.) + archaic connective"],
	["시게", "-시- (hon.) + 'so that'"],
	["시지", "-시- (hon.) + negative/connective"],
	["시기에", "-시- (hon.) + 'when / to do'"],
	["시기를", "-시- (hon.) + 'to do'"],
	["시기로", "-시- (hon.) + 'to do'"],
	["시는", "-시- (hon.) + present modifier"],
	["신대로", "-시- (hon.) + 'according to'"],
	["신바", "-시- (hon.) + 'that which'"],
	["실지라", "-시- (hon.) + 'shall'"],
	["실찌라", "-시- (hon.) + 'shall' (KRV)"],
	["실찌니라", "-시- (hon.) + 'shall' (KRV)"],
	["실", "-시- (hon.) + future modifier"],
	["신", "-시- (hon.) + past modifier"],
	["심", "-시- (hon.) + nominalizer"],
];

const EPENTHETIC_EU_ENDINGS: readonly RuleSpec[] = [
	["소서", "polite request ('please')"],
	["니이다", "polite declarative ('indeed')"],
	["나이다", "polite archaic declarative"],
	["나이까", "polite archaic question"],
	["리로다", "future exclamatory ('will surely')"],
	["리이다", "polite future declarative ('shall / will')"],
	["리이까", "polite future question ('shall ...?')"],
	["리라", "future declarative ('shall / will')"],
	["리니", "future connective ('for ... will')"],
	["리요", "rhetorical future ('would ...?')"],
	["리야", "rhetorical future ('would ...?')"],
	["랴", "rhetorical question ('would ...?')"],
	["려니와", "'indeed, yet'"],
	["려거든", "'if intending to'"],
	["려다가", "'while intending to'"],
	["려고", "'in order to'"],
	["려면", "'if intending to'"],
	["려", "'intending to / in order to'"],
	["러", "'in order to'"],
	["므로", "'because / since'"],
	["니라", "declarative ('indeed')"],
	["매", "archaic connective ('when / since')"],
	["며", "'and / while'"],
	["니", "'so / since / when'"],
	["나", "'but / though'"],
	["냐", "question ('do ...?')"],
	["뇨", "archaic question ('do ...?')"],
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

const VOWEL_CONTRACTIONS: ReadonlyArray<readonly [string, string]> = [
	["와", "오다"],
	["봐", "보다"],
	["줘", "주다"],
	["돼", "되다"],
	["둬", "두다"],
	["쳐", "치다"],
	["려", "리다"],
	["켜", "키다"],
	["워", "우다"],
	["져", "지다"],
	["여", "이다"],
	["겨", "기다"],
	["셔", "시다"],
	["펴", "피다"],
	["혀", "히다"],
	["눠", "누다"],
];

// Contracted verb/adj stems and their past -ㅆ- forms
const STEM_CONTRACTIONS: ReadonlyArray<readonly [string, string]> = [
	["하여", "하다"],
	...VOWEL_CONTRACTIONS.flatMap(([form, lemma]): Array<readonly [string, string]> => [
		[form, lemma],
		[replaceLastFinalConsonant(form, "ㅆ") ?? form, lemma],
	]),
];

const HUMBLE_OPT_TAILS: readonly RuleSpec[] = [
	["옵나이다", "humble polite declarative"],
	["옵나이까", "humble polite question"],
	["옵소서", "humble polite request ('please')"],
	["오리이다", "humble polite future declarative"],
	["오리라", "humble future declarative"],
	["오니", "humble 'for / since'"],
	["오며", "humble 'and'"],
	["오매", "humble 'when / since'"],
	["오되", "humble 'though / saying'"],
];

const HUMBLE_SI_TAILS: readonly RuleSpec[] = [
	["옵시며", "humble -시- (hon.) + 'and'"],
	["옵시고", "humble -시- (hon.) + 'and'"],
	["옵시되", "humble -시- (hon.) + 'though / saying'"],
	["옵시니", "humble -시- (hon.) + 'so / since'"],
	["옵시매", "humble -시- (hon.) + 'when / since'"],
];

const KRV_SOLEMN_SPECS: readonly (readonly [tail: string, note: string])[] = [
	["라도", "'even though'"],
	["니라", "solemn command / 'shall'"],
	["니", "solemn connective ('shall ... for')"],
	["어다", "blessing / imperative ('let there be')"],
	["로다", "solemn praise / blessing"],
];

function dedupeSuffixRules(rules: readonly SuffixRule[]): SuffixRule[] {
	const seen = new Set<string>();
	const unique: SuffixRule[] = [];
	for (const rule of rules) {
		if (seen.has(rule.suffix)) continue;
		seen.add(rule.suffix);
		unique.push(rule);
	}
	return unique;
}

const VERB_ENDING_RULES: readonly SuffixRule[] = dedupeSuffixRules([
	...toRules("verb", HONORIFIC_SI_ENDINGS),
	...toRules(
		"verb",
		HONORIFIC_SI_ENDINGS.map(([tail, note]): RuleSpec => [`으${tail}`, note]),
	),
	...toRules("verb", [
		...HUMBLE_OPT_TAILS.map(([tail, note]): RuleSpec => [`사${tail}`, note]),
		...HUMBLE_SI_TAILS,
		...HUMBLE_OPT_TAILS,
		["삽나이까", "humble archaic question"],
		["이니이다", "polite KRV declarative"],
		["음이니이다", "nominalizer + polite 'is'"],
	]),
	...toRules(
		"verb",
		EPENTHETIC_EU_ENDINGS.map(([tail, note]): RuleSpec => [`으${tail}`, note]),
	),
	...toRules("verb", [
		["겠느니라", "future/certainty declarative"],
		["겠느냐", "future/certainty question"],
		["겠느뇨", "future/certainty archaic question"],
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
		PAST_ENDINGS.map(([tail, note]): RuleSpec => [`했${tail}`, note, "하"]),
	),
	...toRules("verb", [
		...[...HUMBLE_SI_TAILS, ...HUMBLE_OPT_TAILS].map(([tail, note]): RuleSpec => [
			`하${tail}`,
			note,
			"하",
		]),
		["한지라", "'because / since'", "하"],
		["한즉", "'since / when'", "하"],
		["한대", "'when / as'", "하"],
		["한대로", "'according to'", "하"],
		["한바", "'that which'", "하"],
		["한것", "'the thing that'", "하"],
		["할것", "'that which will'", "하"],
		["하냐", "question ('do ...?')", "하"],
		["하므로", "'because / since'", "하"],
		["된바", "'that which is'", "되"],
		...KRV_SOLEMN_SPECS.flatMap(([tail, note]): RuleSpec[] => [
			[`을찌${tail}`, `${note} (archaic KRV)`],
			[`찌${tail}`, `${note} (archaic KRV)`],
			[`지${tail}`, note],
		]),
		["을찌라", "solemn declarative ('shall') (archaic KRV)"],
		["찌라", "solemn declarative ('shall') (archaic KRV)"],
		["을지라", "solemn declarative ('shall')"],
		["지라", "'because / since'"],
		["찐대", "'if indeed / since' (archaic KRV)"],
		["을찐저", "archaic prophetic ('surely')"],
		["찐저", "archaic prophetic ('surely')"],
		["는지라", "'because / since'"],
		["은지라", "'because / since'"],
		["은즉", "'since / when'"],
		["는즉", "'since / when'"],
		["은대", "'when / as'"],
		["느니라", "timeless declarative"],
		["는도다", "poetic exclamatory"],
		["노라", "1st-person declarative"],
		["노니", "1st-person 'for I ...'"],
		["느냐", "question ('do you ...?')"],
		["느뇨", "archaic question ('do ...?')"],
		["거니와", "'indeed, yet / besides'"],
		["거나", "'whether ... or'"],
		["거든", "'if / when'"],
		["거늘", "archaic connective ('when / since')"],
		["건대", "'when considering'"],
		["는다", "present declarative"],
		["한다", "present declarative", "하"],
		["더이다", "polite past observed"],
		["더라", "observed past"],
		["더니", "'and then / since'"],
		["던", "retrospective past modifier"],
		["도다", "exclamatory"],
		["나니", "'for / since'"],
		["는데", "'while / when / and'"],
		["는대로", "'as / according to'"],
		["은대로", "'as / according to'"],
		["는바", "'that which'"],
		["은바", "'that which'"],
		["는것", "'the thing that'"],
		["은것", "'the thing that'"],
		["을것", "'that which will'"],
		["기가", "nominalized subject"],
		["기에", "'for / at doing'"],
		["기를", "nominalized object"],
		["기로", "'by / to do'"],
		["기는", "nominalized topic"],
		["기도", "nominalized + 'also'"],
		["기만", "nominalized + 'only'"],
		["기까지", "nominalized + 'until'"],
		["지도", "'nor / even'"],
		["지는", "negative/connective + topic"],
		["고자", "'wishing to / intending to'"],
		["고도", "'even after / although'"],
		["고는", "'after doing'"],
		["는구나", "exclamatory ('how ...!')"],
		["구나", "exclamatory ('how ...!')"],
		["을꼬", "archaic question ('what shall ...?')"],
		["꼬", "archaic question ('what shall ...?')"],
		["고", "'and / then'"],
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
		["자", "hortative ('let us ...')"],
		["을까", "'lest / might'"],
		["까", "'lest / might'"],
		["즉", "'when / since' (after -ㄴ)"],
		["대", "'when / as' (after -ㄴ)"],
		["는", "present modifier"],
		["은", "past/adj modifier"],
		["을", "future modifier"],
		["음", "nominalizer"],
		["서", "'and then / so'"],
		["여", "connective"],
		["아", "connective"],
		["어", "connective"],
		["라", "imperative / declarative"],
	]),
	...toRules("verb", EPENTHETIC_EU_ENDINGS),
]);

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
	"찌니",
	"지니",
	"찌라",
	"지라",
	"찌어다",
	"지어다",
	"찌로다",
	"지로다",
	"까",
	"꼬",
	"것",
]);

const NIEUN_MODIFIER_ENDINGS = new Set(["지라", "즉", "대", "바", "대로", "것"]);

/** Endings that only attach after a -ㄹ/-ㄴ modifier coda, never directly to a bare verb stem. */
const MODIFIER_ONLY_ENDINGS = new Set(["까", "즉", "대"]);

const CODA_MODIFIER_NOTES: Readonly<Record<string, string>> = {
	ㄴ: "-ㄴ (modifier)",
	ㄹ: "-ㄹ (future modifier)",
	ㅁ: "-ㅁ (nominalizer)",
};

/** Pre-noun determiners that never take case particles or copulas. */
const DETERMINER_ONLY = new Set([
	"한",
	"두",
	"세",
	"온",
	"각",
	"첫",
	"내",
	"네",
	"옛",
	"뭇",
	"모든",
	"어느",
	"어떤",
	"무슨",
]);

/** Bare 1-char forms that are primarily verb modifiers (while inflected forms like 선을 are nouns). */
const BARE_VERB_MODIFIER_PREFER = new Set(["선"]);

/** 1-char noun + particle forms that resolve to predicates in KRV (keeps 나와 = "with me"). */
const ONE_CHAR_VERB_PREFER = new Set([
	"입은",
	"숨은",
	"낮은",
	"남은",
	"벗은",
	"검은",
	"굽은",
	"품은",
	"가는",
	"사는",
	"오는",
	"대는",
	"매는",
	"도와",
]);

/** Suffixes on 1-char nouns where predicate parsing takes precedence. */
const AMBIGUOUS_ONE_CHAR_NOMINAL_SUFFIXES = new Set(["아", "가", "들", "이고", "이며", "이니"]);

/** High-frequency ㄹ-deletion surface overrides over rarer homographs (사는 = 살다 over 사다). */
const PREFERRED_VERB_SURFACE: Readonly<Record<string, readonly [lemma: string, note: string]>> = {
	사는: ["살다", "-는 (present modifier)"],
};

/** 1-char nouns whose bare copula forms must not yield to homograph verbs. */
const BARE_COPULA_NOUN_PREFER = new Set(["자", "때"]);

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

function isNominalHit(entry: LexiconEntry, stem: string): boolean {
	if (DETERMINER_ONLY.has(stem)) return false;
	return (
		entry.pos !== "verb" &&
		entry.pos !== "adj" &&
		entry.pos !== "adv" &&
		entry.pos !== "interj" &&
		entry.pos !== "particle"
	);
}

function matchesCodaReq(stem: string, req?: CodaReq): boolean {
	if (!req) return true;
	const coda = stripLastFinalConsonant(stem);
	if (req === "consonant") return coda !== null;
	if (req === "vowel") return coda === null;
	// vowelOrRieul (로/로부터/로서/로써 attach after open vowels or ㄹ)
	return coda === null || coda.final === "ㄹ";
}

function startsWithVowelEnding(suffix: string): boolean {
	return getFirstInitialConsonant(suffix) === "ㅇ";
}

function allowsRieulDeletion(suffix: string): boolean {
	const lead = getFirstInitialConsonant(suffix);
	return lead === "ㄴ" || lead === "ㅅ" || lead === "ㅂ" || startsWithOpenOVowel(suffix);
}

function isEuInitialEnding(suffix: string): boolean {
	if (!suffix) return false;
	const first = suffix[0];
	return first === "으" || first === "은" || first === "을" || first === "음";
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

function getBIrregularLemma(stem: string): string | null {
	if (stem.length < 2) return null;
	const last = stem[stem.length - 1];
	// Modern 우/워/웠 plus 1961 KRV archaic 와/왔
	if (last !== "우" && last !== "워" && last !== "와" && last !== "웠" && last !== "왔") {
		return null;
	}
	const prefix = stem.slice(0, -1);
	// Preceding syllable must have lost its ㅂ coda; only 돕다/곱다 take 1-syllable -와.
	if (hasFinalConsonant(prefix)) return null;
	if (
		(last === "와" || last === "왔") &&
		prefix.length === 1 &&
		prefix !== "도" &&
		prefix !== "고"
	) {
		return null;
	}
	const patched = replaceLastFinalConsonant(prefix, "ㅂ");
	return patched ? `${patched}다` : null;
}

function generateRegularPredicateCandidates(
	rawStem: string,
	suffix: string,
	allowHaSuffix = false,
): string[] {
	if (!rawStem) return [];
	const candidates: string[] = [];
	const push = (val: string | null | undefined) => {
		if (val && !candidates.includes(val)) candidates.push(val);
	};

	// 으/은/을/음 endings only attach directly to consonant-final (non-ㄹ) stems.
	const lastCoda = stripLastFinalConsonant(rawStem);
	const blockedBeforeEu =
		isEuInitialEnding(suffix) && (lastCoda === null || lastCoda.final === "ㄹ");
	if (!blockedBeforeEu) {
		push(`${rawStem}다`);
	}

	for (const [tail, replacement] of STEM_CONTRACTIONS) {
		if (rawStem.endsWith(tail)) push(`${rawStem.slice(0, -tail.length)}${replacement}`);
	}

	// Contracted past ㅆ: check ㅡ-irregular before open-vowel stem.
	if (lastCoda?.final === "ㅆ") {
		const euRestored = restoreEuIrregularStem(rawStem);
		if (euRestored) push(`${euRestored}다`);
		push(`${lastCoda.stem}다`);
	}

	if (allowHaSuffix && !rawStem.endsWith("하")) push(`${rawStem}하다`);
	return candidates;
}

function generateIrregularPredicateCandidates(rawStem: string, suffix: string): string[] {
	if (!rawStem) return [];
	const candidates: string[] = [];
	const push = (val: string | null | undefined) => {
		if (val && !candidates.includes(val)) candidates.push(val);
	};

	const vowelEnding = startsWithVowelEnding(suffix);
	const lastCoda = stripLastFinalConsonant(rawStem);

	push(getBIrregularLemma(rawStem));

	// 르-irregular
	const lastChar = rawStem[rawStem.length - 1];
	if (lastChar === "러" || lastChar === "라" || lastChar === "렀" || lastChar === "랐") {
		const prev = stripLastFinalConsonant(rawStem.slice(0, -1));
		if (prev && prev.final === "ㄹ") push(`${prev.stem}르다`);
	}

	// 러-irregular
	if (
		rawStem.length >= 3 &&
		(lastChar === "러" || lastChar === "렀") &&
		rawStem[rawStem.length - 2] === "르"
	) {
		push(`${rawStem.slice(0, -1)}다`);
	}

	// ㅡ-irregular
	if (
		vowelEnding ||
		lastCoda?.final === "ㅆ" ||
		suffix === "" ||
		suffix.startsWith("서") ||
		suffix.startsWith("도") ||
		suffix.startsWith("야") ||
		suffix.startsWith("다가")
	) {
		const euRestored = restoreEuIrregularStem(rawStem);
		if (euRestored) push(`${euRestored}다`);
		if (!hasFinalConsonant(rawStem) && vowelEnding) {
			push(`${rawStem}으다`);
		}
	}

	// ㄷ-irregular (before vowel-initial endings only)
	if (vowelEnding && lastCoda?.final === "ㄹ") {
		const withDigeut = replaceLastFinalConsonant(rawStem, "ㄷ");
		if (withDigeut) push(`${withDigeut}다`);
	}

	// ㅅ-irregular (before vowel-initial endings only)
	if (vowelEnding && !hasFinalConsonant(rawStem)) {
		const withSiot = replaceLastFinalConsonant(rawStem, "ㅅ");
		if (withSiot) push(`${withSiot}다`);
	}

	// ㄹ-deletion (before ㄴ/ㅅ/ㅂ/오 endings only)
	if (allowsRieulDeletion(suffix) && !hasFinalConsonant(rawStem)) {
		const withRieul = replaceLastFinalConsonant(rawStem, "ㄹ");
		if (withRieul) push(`${withRieul}다`);
	}

	return candidates;
}

function matchFirstPredicate(
	raw: string,
	parts: TokenParts,
	candidates: readonly (string | null | undefined)[],
	lookup: EntryLookup,
	grammarNote: string,
): GlossToken | null {
	for (const candidate of candidates) {
		if (!candidate) continue;
		const hit = lookup(candidate);
		if (hit && isPredicateHit(hit)) return makeToken(parts, raw, candidate, hit, grammarNote);
	}
	return null;
}

function findPredicateToken(
	raw: string,
	parts: TokenParts,
	stem: string,
	suffix: string,
	lookup: EntryLookup,
	grammarNote: string,
	mode: "regular" | "irregular" | "both",
	allowHaSuffix = false,
): GlossToken | null {
	if (mode !== "irregular") {
		const hit = matchFirstPredicate(
			raw,
			parts,
			generateRegularPredicateCandidates(stem, suffix, allowHaSuffix),
			lookup,
			grammarNote,
		);
		if (hit) return hit;
	}
	if (mode !== "regular") {
		return matchFirstPredicate(
			raw,
			parts,
			generateIrregularPredicateCandidates(stem, suffix),
			lookup,
			grammarNote,
		);
	}
	return null;
}

function lookupNominalStem(
	raw: string,
	parts: TokenParts,
	stem: string,
	rule: SuffixRule,
	lookup: EntryLookup,
	allowSingleCharNoun: boolean,
	combinedLookup: EntryLookup,
): GlossToken | null {
	const checkDirect = (candidateStem: string, notePrefix = ""): GlossToken | null => {
		if (!allowSingleCharNoun && !isSafeLexiconNounStem(candidateStem)) return null;
		const hit = lookup(candidateStem);
		if (!hit || !isNominalHit(hit, candidateStem)) return null;

		// Prevent 1-char nouns + ambiguous suffixes (아/가/들/이고/...) from stealing valid verbs
		if (
			candidateStem.length === 1 &&
			!notePrefix &&
			(AMBIGUOUS_ONE_CHAR_NOMINAL_SUFFIXES.has(rule.suffix) || ONE_CHAR_VERB_PREFER.has(parts.word))
		) {
			if (matchVerbOrModifier(raw, parts, combinedLookup)) return null;
		}
		return makeToken(parts, raw, candidateStem, hit, `${notePrefix}${rule.suffix} (${rule.note})`);
	};

	const direct = checkDirect(stem);
	if (direct) return direct;

	// Generic plural 들 + any particle/copula (성읍들에, 자들로, 방백들이, 제자들에게)
	if (stem.endsWith("들") && stem.length >= 2) {
		const singular = stem.slice(0, -1);
		const pluralHit = checkDirect(singular, "들 (plural) + ");
		if (pluralHit) return pluralHit;
	}

	return null;
}

function matchNominalRules(
	raw: string,
	parts: TokenParts,
	lookup: EntryLookup,
	allowSingleCharNoun: boolean,
	combinedLookup: EntryLookup,
): GlossToken | null {
	const { word } = parts;
	for (const rule of SORTED_NOMINAL_RULES) {
		if (!word.endsWith(rule.suffix) || word.length <= rule.suffix.length) continue;
		const stem = word.slice(0, -rule.suffix.length);
		if (!matchesCodaReq(stem, rule.codaReq)) continue;

		const isBareVowelCopula = rule.kind === "copula" && !rule.suffix.startsWith("이");
		if (
			isBareVowelCopula &&
			stem.length === 1 &&
			!BARE_COPULA_NOUN_PREFER.has(stem) &&
			matchVerbOrModifier(raw, parts, combinedLookup)
		) {
			continue;
		}

		// Prevent obscure lexicon homograph nouns (보이, 이기, 거두, 그치, 기울) + copula/는 from stealing regular verbs
		if (!allowSingleCharNoun && (rule.kind === "copula" || rule.suffix === "는")) {
			const directVerb =
				combinedLookup(`${stem}다`) ??
				(rule.suffix.startsWith("이") ? combinedLookup(`${stem}이다`) : undefined);
			if (directVerb && isPredicateHit(directVerb)) continue;
		}

		const nominalHit = lookupNominalStem(
			raw,
			parts,
			stem,
			rule,
			lookup,
			allowSingleCharNoun,
			combinedLookup,
		);
		if (nominalHit) return nominalHit;

		for (const [nomSuffix, nomDesc] of [
			["으심", "-으심 (-시- hon. nominalizer)"],
			["심", "-심 (-시- hon. nominalizer)"],
			["음", "-음 (nominalizer)"],
		] as const) {
			if (stem.endsWith(nomSuffix) && stem.length > nomSuffix.length) {
				const hit = findPredicateToken(
					raw,
					parts,
					stem.slice(0, -nomSuffix.length),
					nomSuffix,
					lookup,
					`${nomDesc} + ${rule.suffix} (${rule.note})`,
					"both",
				);
				if (hit) return hit;
			}
		}

		// Coda nominalizer/modifier (-ㅁ, -ㄻ, and 2+ char -ㄴ/-ㄹ) + particle/copula
		const coda = stripLastFinalConsonant(stem);
		if (coda?.final === "ㄻ") {
			// Skip when stem itself is a real ㄻ-final verb/adj (e.g. 젊은 -> 젊다, not 절다 + -ㅁ + 은)
			const directLmPred = combinedLookup(`${stem}다`);
			if (!directLmPred || !isPredicateHit(directLmPred)) {
				// ㄹ-stem nominalizer (앎이라 -> 알다, 삶이 -> 살다, 베풂을 -> 베풀다)
				const withRieul = replaceLastFinalConsonant(stem, "ㄹ");
				if (withRieul) {
					const hit = findPredicateToken(
						raw,
						parts,
						withRieul,
						"ㅁ",
						lookup,
						`-ㅁ (nominalizer) + ${rule.suffix} (${rule.note})`,
						"regular",
					);
					if (hit) return hit;
				}
			}
		}

		const allowCoda =
			coda &&
			coda.final in CODA_MODIFIER_NOTES &&
			rule.suffix !== "아" &&
			(rule.kind === "particle"
				? coda.stem.length >= 2 || (allowSingleCharNoun && coda.final === "ㅁ")
				: coda.final === "ㅁ" && (coda.stem.length >= 2 || allowSingleCharNoun));
		if (coda && allowCoda) {
			// Skip -ㅁ nominalizer when the unstripped stem itself is a real predicate (남은 -> 남다, 삼아 -> 삼다, 참아 -> 참다)
			const directStemPred = combinedLookup(`${stem}다`);
			const blocksCodaNominal =
				coda.final === "ㅁ" &&
				directStemPred &&
				isPredicateHit(directStemPred) &&
				(rule.suffix === "은" || rule.suffix === "을" || rule.suffix === "아");
			if (!blocksCodaNominal) {
				const hit = findPredicateToken(
					raw,
					parts,
					coda.stem,
					coda.final,
					lookup,
					`-${coda.final} + ${rule.suffix} (${rule.note})`,
					"regular",
				);
				if (hit) return hit;
			}
		}
	}
	return null;
}

function matchBareConnectivePredicate(
	raw: string,
	parts: TokenParts,
	lookup: EntryLookup,
): GlossToken | null {
	const { word } = parts;
	const candidates: string[] = [];
	for (const [tail, replacement] of STEM_CONTRACTIONS) {
		if (word.endsWith(tail)) candidates.push(`${word.slice(0, -tail.length)}${replacement}`);
	}
	if (word.length >= 2 && endsWithOpenAEoVowel(word)) {
		candidates.push(`${word}다`);
	}
	candidates.push(...generateIrregularPredicateCandidates(word, ""));
	return matchFirstPredicate(raw, parts, candidates, lookup, "-아/-어 (connective)");
}

function withRieulLemma(stem: string): string | null {
	const withRieul = replaceLastFinalConsonant(stem, "ㄹ");
	return withRieul ? `${withRieul}다` : null;
}

function matchVerbOrModifier(
	raw: string,
	parts: TokenParts,
	lookup: EntryLookup,
): GlossToken | null {
	const { word } = parts;

	if (Object.hasOwn(PREFERRED_VERB_SURFACE, word)) {
		const [prefLemma, prefNote] = PREFERRED_VERB_SURFACE[word];
		const hit = matchFirstPredicate(raw, parts, [prefLemma], lookup, prefNote);
		if (hit) return hit;
	}

	const bareConnective = matchBareConnectivePredicate(raw, parts, lookup);
	if (bareConnective) return bareConnective;

	// Direct -ㄴ/-ㄹ/-ㅁ modifier/nominalizer on vowel/ㅂ-irregular stems
	const strippedTail = stripLastFinalConsonant(word);
	const tailModNote = strippedTail ? CODA_MODIFIER_NOTES[strippedTail.final] : undefined;
	if (strippedTail && tailModNote && !/(?:었|았|였|겠|했|던)$/.test(strippedTail.stem)) {
		const hit = matchFirstPredicate(
			raw,
			parts,
			[`${strippedTail.stem}다`, getBIrregularLemma(strippedTail.stem)],
			lookup,
			tailModNote,
		);
		if (hit) return hit;
	}

	// Try ALL regular verb suffix splits before irregular stems so regular verbs beat irregular steals.
	const matchedRules: Array<{ rule: SuffixRule; stem: string }> = [];
	for (const rule of SORTED_VERB_ENDING_RULES) {
		if (!word.endsWith(rule.suffix) || word.length <= rule.suffix.length) continue;
		const stem = `${word.slice(0, -rule.suffix.length)}${rule.stemPatch ?? ""}`;
		matchedRules.push({ rule, stem });

		if (!MODIFIER_ONLY_ENDINGS.has(rule.suffix)) {
			const hit = findPredicateToken(
				raw,
				parts,
				stem,
				rule.suffix,
				lookup,
				`-${rule.suffix} (${rule.note})`,
				"regular",
				rule.suffix === "지",
			);
			if (hit) return hit;
		}
	}

	for (const { rule, stem } of matchedRules) {
		if (!MODIFIER_ONLY_ENDINGS.has(rule.suffix)) {
			const hit = findPredicateToken(
				raw,
				parts,
				stem,
				rule.suffix,
				lookup,
				`-${rule.suffix} (${rule.note})`,
				"irregular",
			);
			if (hit) return hit;
		}

		for (const [endings, codaChar] of [
			[RIEUL_MODIFIER_ENDINGS, "ㄹ"],
			[NIEUN_MODIFIER_ENDINGS, "ㄴ"],
		] as const) {
			if (!endings.has(rule.suffix)) continue;
			const stripped = stripLastFinalConsonant(stem);
			if (stripped?.final === codaChar) {
				const hit = findPredicateToken(
					raw,
					parts,
					stripped.stem,
					codaChar,
					lookup,
					`-${codaChar}${rule.suffix} (${rule.note})`,
					"both",
				);
				if (hit) return hit;
			}
		}
	}

	// Fallback bare consonant modifier/nominalizer including ㄹ-deletion (만든 -> 만들다, 앎 -> 알다)
	if (strippedTail?.final === "ㄻ") {
		const hit = matchFirstPredicate(
			raw,
			parts,
			[withRieulLemma(word)],
			lookup,
			"-ㅁ (nominalizer)",
		);
		if (hit) return hit;
	}
	if (strippedTail && tailModNote) {
		return matchFirstPredicate(
			raw,
			parts,
			[withRieulLemma(strippedTail.stem)],
			lookup,
			tailModNote,
		);
	}

	return null;
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
			if (hit && isNominalHit(hit, nounRoot)) {
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

function ownEntry(map: LexiconMap): EntryLookup {
	return (key) => (Object.hasOwn(map, key) ? map[key] : undefined);
}

const GLOSSARY_LOOKUP = ownEntry(BIBLICAL_GLOSSARY);

export function analyzeKoreanWord(raw: string, lexicon: LexiconMap = {}): GlossToken {
	const parts = splitPunctuation(raw);
	const { word } = parts;

	if (!word || !containsHangul(word)) {
		return { raw, ...parts, lemma: word, gloss: "", matched: false };
	}

	const lexiconLookup = ownEntry(lexicon);
	const combinedLookup: EntryLookup = (key) => GLOSSARY_LOOKUP(key) ?? lexiconLookup(key);

	if (BARE_VERB_MODIFIER_PREFER.has(word)) {
		const bareMod = matchVerbOrModifier(raw, parts, combinedLookup);
		if (bareMod) return bareMod;
	}

	// Curated biblical glossary takes priority (including 1-char stems); general lexicon skips 1-char noise.
	const passes: ReadonlyArray<{ lookup: EntryLookup; allowSingleChar: boolean }> = [
		{ lookup: GLOSSARY_LOOKUP, allowSingleChar: true },
		{ lookup: lexiconLookup, allowSingleChar: false },
	];

	for (const { lookup, allowSingleChar } of passes) {
		if (allowSingleChar || word.length >= 2) {
			const exact = lookup(word);
			if (exact) return makeToken(parts, raw, word, exact);
		}
		const nominal = matchNominalRules(raw, parts, lookup, allowSingleChar, combinedLookup);
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
			if (!matchesCodaReq(stem, rule.codaReq)) continue;
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
