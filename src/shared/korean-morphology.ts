import { BIBLICAL_GLOSSARY, detectKrvGrammarNotes } from "./biblical-glossary";
import { containsHangul, replaceLastFinalConsonant, stripLastFinalConsonant } from "./hangul";
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
	{ suffix: "으로", note: "'because of / by'", kind: "verb" },
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

	// Past tense endings (including KRV -였음이라 / -었으므로 / -었나니 / -었으나 / -었노라)
	{ suffix: "였음이라", note: "past nominalizer + 'is'", kind: "verb" },
	{ suffix: "였으므로", note: "past + 'because'", kind: "verb" },
	{ suffix: "였느니라", note: "past declarative", kind: "verb" },
	{ suffix: "였노라", note: "1st-person past declarative", kind: "verb" },
	{ suffix: "였나니", note: "past + 'for / since'", kind: "verb" },
	{ suffix: "였더라", note: "past observed", kind: "verb" },
	{ suffix: "였더니", note: "past + 'and then'", kind: "verb" },
	{ suffix: "였으니", note: "past + 'so / since'", kind: "verb" },
	{ suffix: "였으나", note: "past + 'but / though'", kind: "verb" },
	{ suffix: "였으며", note: "past + 'and'", kind: "verb" },
	{ suffix: "였고", note: "past + 'and'", kind: "verb" },
	{ suffix: "였다", note: "past tense", kind: "verb" },
	{ suffix: "었음이라", note: "past nominalizer + 'is'", kind: "verb" },
	{ suffix: "었으므로", note: "past + 'because'", kind: "verb" },
	{ suffix: "었느니라", note: "past declarative", kind: "verb" },
	{ suffix: "었노라", note: "1st-person past declarative", kind: "verb" },
	{ suffix: "었나니", note: "past + 'for / since'", kind: "verb" },
	{ suffix: "었더라", note: "past observed", kind: "verb" },
	{ suffix: "었더니", note: "past + 'and then'", kind: "verb" },
	{ suffix: "었으니", note: "past + 'so / since'", kind: "verb" },
	{ suffix: "었으나", note: "past + 'but / though'", kind: "verb" },
	{ suffix: "었으매", note: "past + 'when / since'", kind: "verb" },
	{ suffix: "었으되", note: "past + 'though'", kind: "verb" },
	{ suffix: "었으며", note: "past + 'and'", kind: "verb" },
	{ suffix: "었고", note: "past + 'and'", kind: "verb" },
	{ suffix: "었다", note: "past tense", kind: "verb" },
	{ suffix: "았음이라", note: "past nominalizer + 'is'", kind: "verb" },
	{ suffix: "았으므로", note: "past + 'because'", kind: "verb" },
	{ suffix: "았느니라", note: "past declarative", kind: "verb" },
	{ suffix: "았노라", note: "1st-person past declarative", kind: "verb" },
	{ suffix: "았나니", note: "past + 'for / since'", kind: "verb" },
	{ suffix: "았더라", note: "past observed", kind: "verb" },
	{ suffix: "았더니", note: "past + 'and then'", kind: "verb" },
	{ suffix: "았으니", note: "past + 'so / since'", kind: "verb" },
	{ suffix: "았으나", note: "past + 'but / though'", kind: "verb" },
	{ suffix: "았으며", note: "past + 'and'", kind: "verb" },
	{ suffix: "았고", note: "past + 'and'", kind: "verb" },
	{ suffix: "았다", note: "past tense", kind: "verb" },
	{ suffix: "았다가", note: "past + 'and then'", kind: "verb" },
	{ suffix: "었다가", note: "past + 'and then'", kind: "verb" },
	{ suffix: "했느니라", note: "past declarative", kind: "verb", stemPatch: "하" },
	{ suffix: "했더라", note: "past observed", kind: "verb", stemPatch: "하" },
	{ suffix: "했으니", note: "past + 'so / since'", kind: "verb", stemPatch: "하" },
	{ suffix: "했고", note: "past + 'and'", kind: "verb", stemPatch: "하" },
	{ suffix: "했다", note: "past tense", kind: "verb", stemPatch: "하" },

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
	{ suffix: "어야", note: "'must / only if'", kind: "verb" },
	{ suffix: "아야", note: "'must / only if'", kind: "verb" },
	{ suffix: "여야", note: "'must / only if'", kind: "verb" },
	{ suffix: "어도", note: "'even if / though'", kind: "verb" },
	{ suffix: "아도", note: "'even if / though'", kind: "verb" },
	{ suffix: "여도", note: "'even if / though'", kind: "verb" },
	{ suffix: "어서", note: "'because / and then'", kind: "verb" },
	{ suffix: "아서", note: "'because / and then'", kind: "verb" },
	{ suffix: "여서", note: "'because / and then'", kind: "verb" },
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
	{ suffix: "ㄹ까", note: "'lest / might'", kind: "verb" },
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

const ALL_LEXICON_LOOKUP = (key: string, lexicon: LexiconMap): LexiconEntry | undefined => {
	return BIBLICAL_GLOSSARY[key] ?? lexicon[key];
};

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
	if (rawStem.endsWith("하여")) {
		push(`${rawStem.slice(0, -1)}다`);
	}
	if (rawStem.endsWith("와")) {
		push(`${rawStem.slice(0, -1)}오다`);
	}
	if (rawStem.endsWith("봐")) {
		push(`${rawStem.slice(0, -1)}보다`);
	}
	if (rawStem.endsWith("줘")) {
		push(`${rawStem.slice(0, -1)}주다`);
	}
	if (rawStem.endsWith("돼")) {
		push(`${rawStem.slice(0, -1)}되다`);
	}
	if (rawStem.endsWith("쳐")) {
		push(`${rawStem.slice(0, -1)}치다`);
	}
	if (rawStem.endsWith("려")) {
		push(`${rawStem.slice(0, -1)}리다`);
	}
	if (rawStem.endsWith("렸")) {
		push(`${rawStem.slice(0, -1)}리다`);
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

	// ㄹ-deletion before -시-/-니-/-ㅂ- (만드시니라 -> 만드 -> 만들다)
	const withRieul = replaceLastFinalConsonant(rawStem, "ㄹ");
	if (withRieul) push(`${withRieul}다`);

	// ㅅ-irregular (지으시니 -> 지 -> 짓다)
	const withSiot = replaceLastFinalConsonant(rawStem, "ㅅ");
	if (withSiot) push(`${withSiot}다`);

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
	const { leadPunct, word, trailPunct } = splitPunctuation(raw);

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

	// 1. Direct exact lookup in curated biblical glossary first
	const exactGlossary = BIBLICAL_GLOSSARY[word];
	if (exactGlossary) {
		return {
			raw,
			leadPunct,
			word,
			trailPunct,
			lemma: word,
			gloss: exactGlossary.gloss,
			hanja: exactGlossary.hanja,
			pos: exactGlossary.pos,
			matched: true,
		};
	}

	// 2. Prioritize curated biblical stem + particle (avoids noisy Kengdic entries like 위에="hereinbefore")
	for (const rule of PARTICLE_RULES) {
		if (!word.endsWith(rule.suffix) || word.length <= rule.suffix.length) continue;
		const stem = word.slice(0, -rule.suffix.length);
		const glossaryStem = BIBLICAL_GLOSSARY[stem];
		if (glossaryStem) {
			return {
				raw,
				leadPunct,
				word,
				trailPunct,
				lemma: stem,
				gloss: glossaryStem.gloss,
				hanja: glossaryStem.hanja,
				pos: glossaryStem.pos,
				grammarNote: `${rule.suffix} (${rule.note})`,
				matched: true,
			};
		}
	}

	// 3. Direct exact lookup in general lexicon
	const exactLexicon = lexicon[word];
	if (exactLexicon) {
		return {
			raw,
			leadPunct,
			word,
			trailPunct,
			lemma: word,
			gloss: exactLexicon.gloss,
			hanja: exactLexicon.hanja,
			pos: exactLexicon.pos,
			matched: true,
		};
	}

	// 4. Particle & Copula stripping against full lexicon (nouns, names, nominalized forms)
	for (const rule of [...PARTICLE_RULES, ...COPULA_RULES]) {
		if (!word.endsWith(rule.suffix) || word.length <= rule.suffix.length) continue;
		const stem = word.slice(0, -rule.suffix.length);

		const directStem = ALL_LEXICON_LOOKUP(stem, lexicon);
		if (directStem) {
			return {
				raw,
				leadPunct,
				word,
				trailPunct,
				lemma: stem,
				gloss: directStem.gloss,
				hanja: directStem.hanja,
				pos: directStem.pos,
				grammarNote: `${rule.suffix} (${rule.note})`,
				matched: true,
			};
		}

		// Handle nominalized verb + particle (e.g. 부족함이 = 부족하 + -ㅁ + 이, 있음이 = 있 + -음 + 이)
		if (stem.endsWith("음") && stem.length >= 2) {
			const baseStem = stem.slice(0, -1);
			for (const candidate of generatePredicateLemmaCandidates(baseStem, false)) {
				const hit = ALL_LEXICON_LOOKUP(candidate, lexicon);
				if (hit) {
					return {
						raw,
						leadPunct,
						word,
						trailPunct,
						lemma: candidate,
						gloss: hit.gloss,
						hanja: hit.hanja,
						pos: hit.pos,
						grammarNote: `-음 (nominalizer) + ${rule.suffix} (${rule.note})`,
						matched: true,
					};
				}
			}
		}

		// Only strip -ㅁ/-ㄴ/-ㄹ from stem inside PARTICLE_RULES (e.g. 보내심을 -> 보내다), not full verb conjugation inside copula
		if (rule.kind === "particle") {
			const coda = stripLastFinalConsonant(stem);
			if (coda && ["ㅁ", "ㄴ", "ㄹ"].includes(coda.final)) {
				for (const candidate of generatePredicateLemmaCandidates(coda.stem, false)) {
					const hit = ALL_LEXICON_LOOKUP(candidate, lexicon);
					if (hit) {
						return {
							raw,
							leadPunct,
							word,
							trailPunct,
							lemma: candidate,
							gloss: hit.gloss,
							hanja: hit.hanja,
							pos: hit.pos,
							grammarNote: `-${coda.final} + ${rule.suffix} (${rule.note})`,
							matched: true,
						};
					}
				}
			}
		}
	}

	// 5. Verb / Adjective ending stripping
	for (const rule of VERB_ENDING_RULES) {
		if (!word.endsWith(rule.suffix) || word.length <= rule.suffix.length) continue;
		const stem = `${word.slice(0, -rule.suffix.length)}${rule.stemPatch ?? ""}`;

		for (const candidate of generatePredicateLemmaCandidates(stem, rule.suffix === "지")) {
			const hit = ALL_LEXICON_LOOKUP(candidate, lexicon);
			if (hit) {
				return {
					raw,
					leadPunct,
					word,
					trailPunct,
					lemma: candidate,
					gloss: hit.gloss,
					hanja: hit.hanja,
					pos: hit.pos,
					grammarNote: `-${rule.suffix} (${rule.note})`,
					matched: true,
				};
			}
		}

		// Handle -ㄹ찌라도 / -ㄹ지니라 / -ㄹ지어다 / -ㄹ찐대 / -ㄹ까 where ㄹ is the final consonant of stem
		if (["찌라도", "지라도", "찐대", "지니라", "지어다", "까"].includes(rule.suffix)) {
			const strippedRieul = stripLastFinalConsonant(stem);
			if (strippedRieul && strippedRieul.final === "ㄹ") {
				for (const candidate of generatePredicateLemmaCandidates(strippedRieul.stem, false)) {
					const hit = ALL_LEXICON_LOOKUP(candidate, lexicon);
					if (hit) {
						return {
							raw,
							leadPunct,
							word,
							trailPunct,
							lemma: candidate,
							gloss: hit.gloss,
							hanja: hit.hanja,
							pos: hit.pos,
							grammarNote: `-ㄹ${rule.suffix} (${rule.note})`,
							matched: true,
						};
					}
				}
			}
		}

		// Also allow bare noun + ending in cases like "빛이라" or compound forms
		const nounHit = ALL_LEXICON_LOOKUP(stem, lexicon);
		if (nounHit) {
			return {
				raw,
				leadPunct,
				word,
				trailPunct,
				lemma: stem,
				gloss: nounHit.gloss,
				hanja: nounHit.hanja,
				pos: nounHit.pos,
				grammarNote: `-${rule.suffix} (${rule.note})`,
				matched: true,
			};
		}
	}

	// 6. Check predicate modifiers formed purely via final consonant (-ㄴ/-ㄹ/-ㅁ) without suffix (큰 -> 크다, 됨 -> 되다)
	const strippedTail = stripLastFinalConsonant(word);
	if (strippedTail && ["ㄴ", "ㄹ", "ㅁ"].includes(strippedTail.final)) {
		for (const candidate of generatePredicateLemmaCandidates(strippedTail.stem, false)) {
			const hit = ALL_LEXICON_LOOKUP(candidate, lexicon);
			if (hit) {
				const modNote =
					strippedTail.final === "ㄴ"
						? "-ㄴ (modifier)"
						: strippedTail.final === "ㄹ"
							? "-ㄹ (future modifier)"
							: "-ㅁ (nominalizer)";
				return {
					raw,
					leadPunct,
					word,
					trailPunct,
					lemma: candidate,
					gloss: hit.gloss,
					hanja: hit.hanja,
					pos: hit.pos,
					grammarNote: modNote,
					matched: true,
				};
			}
		}
	}

	// 5. Fallback: strip the most probable particle/ending so even rare words show a clean root guess
	for (const rule of PARTICLE_RULES) {
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
