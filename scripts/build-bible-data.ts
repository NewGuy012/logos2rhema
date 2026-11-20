import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { BIBLICAL_GLOSSARY } from "../src/shared/biblical-glossary";
import { BIBLE_BOOKS, getBookByNumber } from "../src/shared/books";
import { containsHangul, romanizeHangul } from "../src/shared/hangul";
import { analyzeKoreanVerse } from "../src/shared/korean-morphology";
import type { BookBibleData, LexiconEntry, LexiconMap, VerseEntry } from "../src/shared/types";
import { parseSpbContent } from "./spb-parser";

type WordPos = NonNullable<LexiconEntry["pos"]>;

const ROOT_DIR = join(import.meta.dir, "..");
const DATA_SOURCES_DIR = join(ROOT_DIR, "data-sources");
const PUBLIC_DATA_DIR = join(ROOT_DIR, "public", "data");
const LOCAL_ESV_CACHE_DIR = join(ROOT_DIR, ".cache", "esv-local");

const KRV_SOURCE_URL =
	"https://raw.githubusercontent.com/bluesaurel/Korean-Bible-1961-KRV/2fdb91e77d323b99bacaa9b61fc18f318b703240/bible_1961_krv.json";
const KRDICT_SOURCE_URL =
	"https://github.com/Lyroxide/yomitan-ko-dic/releases/download/1.0.0/KO-EN.KRDICT.No.Examples.zip";
const KAIKKI_SOURCE_URL =
	"https://kaikki.org/dictionary/Korean/kaikki.org-dictionary-Korean.jsonl.gz";
const KENGDIC_SOURCE_URL =
	"https://raw.githubusercontent.com/garfieldnate/kengdic/793de2369c9a98b944154eb4695d26854d2de59b/kengdic.tsv";

interface RawKrvBook {
	book: string;
	chapters: Array<{
		chapter: number;
		verses: Array<{
			verse: number;
			text: string;
		}>;
	}>;
}

interface DictCandidate {
	entry: LexiconEntry;
	source: "krdict" | "wiktionary" | "kengdic";
	definition?: string;
	stars?: number;
	grade?: string;
	tags?: string[];
}

interface EsvLemmaContext {
	total: number;
	words: Map<string, number>;
}

const MAX_ZIP_ENTRY_BYTES = 64 * 1024 * 1024;

async function ensureSourceFile(filename: string, url?: string): Promise<string> {
	const targetPath = join(DATA_SOURCES_DIR, filename);
	const file = Bun.file(targetPath);
	if (await file.exists()) {
		return targetPath;
	}
	if (!url) {
		throw new Error(`Required source file missing: ${targetPath}`);
	}
	console.log(`Downloading ${filename} from ${url}...`);
	const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
	if (!res.ok) {
		throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
	}
	await mkdir(DATA_SOURCES_DIR, { recursive: true });
	const tmpPath = `${targetPath}.${process.pid}.tmp`;
	try {
		await Bun.write(tmpPath, await res.arrayBuffer());
		await rename(tmpPath, targetPath);
	} catch (err) {
		await rm(tmpPath, { force: true }).catch(() => {});
		throw err;
	}
	return targetPath;
}

/** Minimal zero-dependency ZIP reader for KRDICT Yomitan term banks. */
function readZipJsonEntries(
	bytes: Uint8Array,
	prefix: string,
): Array<{ name: string; text: string }> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const decoder = new TextDecoder("utf-8");

	// Locate End of Central Directory (0x06054b50)
	let eocdOffset = -1;
	const minOffset = Math.max(0, bytes.length - 65_557);
	for (let i = bytes.length - 22; i >= minOffset; i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset < 0) throw new Error("Invalid ZIP archive: EOCD not found");

	const entryCount = view.getUint16(eocdOffset + 10, true);
	let cdOffset = view.getUint32(eocdOffset + 16, true);
	const results: Array<{ name: string; text: string }> = [];

	for (let i = 0; i < entryCount; i++) {
		if (cdOffset + 46 > eocdOffset || view.getUint32(cdOffset, true) !== 0x02014b50) break;
		const method = view.getUint16(cdOffset + 10, true);
		const compSize = view.getUint32(cdOffset + 20, true);
		const nameLen = view.getUint16(cdOffset + 28, true);
		const extraLen = view.getUint16(cdOffset + 30, true);
		const commentLen = view.getUint16(cdOffset + 32, true);
		const localHeaderOffset = view.getUint32(cdOffset + 42, true);
		if (cdOffset + 46 + nameLen + extraLen + commentLen > eocdOffset) break;
		const name = decoder.decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
		cdOffset += 46 + nameLen + extraLen + commentLen;

		if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
		if (method !== 0 && method !== 8) {
			throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
		}
		if (
			localHeaderOffset + 30 > bytes.length ||
			view.getUint32(localHeaderOffset, true) !== 0x04034b50
		) {
			continue;
		}
		const localNameLen = view.getUint16(localHeaderOffset + 26, true);
		const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
		const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
		if (dataStart + compSize > bytes.length || compSize > MAX_ZIP_ENTRY_BYTES) {
			throw new Error(`ZIP entry ${name} exceeds bounds or size limit`);
		}
		const compressed = bytes.subarray(dataStart, dataStart + compSize);
		const raw =
			method === 0
				? compressed
				: inflateRawSync(compressed, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
		results.push({ name, text: decoder.decode(raw) });
	}
	return results;
}

const ENGLISH_STOPWORDS = new Set([
	"the",
	"and",
	"that",
	"for",
	"with",
	"his",
	"her",
	"was",
	"were",
	"are",
	"not",
	"but",
	"they",
	"them",
	"their",
	"you",
	"your",
	"our",
	"all",
	"who",
	"from",
	"into",
	"unto",
	"shall",
	"will",
	"have",
	"had",
	"has",
	"this",
	"then",
	"said",
	"when",
	"upon",
	"out",
	"one",
	"there",
	"she",
	"him",
	"sth",
	"etc",
	"some",
	"something",
	"someone",
	"person",
	"state",
	"being",
	"make",
	"making",
	"used",
]);

function extractEnglishKeywords(text: string): string[] {
	const matches = text.toLowerCase().match(/[a-z]{3,}/g);
	if (!matches) return [];
	return matches.filter((w) => !ENGLISH_STOPWORDS.has(w));
}

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&quot;/g, '"')
		.replace(/&apos;|&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

function balanceParens(text: string): string {
	let result = text.replace(/^\)\s*/, "");
	if (result.startsWith("(") && !result.includes(")")) {
		result = result.slice(1).trim();
	}
	const openParens = (result.match(/\(/g) ?? []).length;
	const closeParens = (result.match(/\)/g) ?? []).length;
	if (openParens > closeParens) {
		result = `${result})`;
	} else if (closeParens > openParens) {
		result = result.replace(/\)+$/, "");
	}
	return result;
}

function cleanGloss(rawGloss: string, maxParts = 2): string {
	let cleaned = decodeHtmlEntities(rawGloss)
		.replace(/[`´]/g, "'")
		.replace(/\s*\(?\d+\)\s*/g, " ")
		.replace(/\([^)]*[\uAC00-\uD7A3][^)]*\)/g, "")
		.replace(/[\uAC00-\uD7A3]+[^,;]*/g, "")
		.replace(/\s+/g, " ")
		.trim();
	cleaned = balanceParens(cleaned);
	if (!cleaned || /^\d+$/.test(cleaned) || !/[a-zA-Z]/.test(cleaned)) {
		return "";
	}
	// Strip leading article on simple noun glosses
	cleaned = cleaned.replace(/^(?:A|An|The)\s+([a-z])/i, "$1");
	const parts = cleaned
		.split(/\s*[;,]\s*/)
		.map((s) => s.replace(/^[\s.,:-]+|[\s.,:-]+$/g, "").trim())
		.filter((s) => s.length >= 2 && /[a-zA-Z]/.test(s));
	const deduped: string[] = [];
	const seen = new Set<string>();
	for (const p of parts) {
		const lower = p.toLowerCase();
		if (!seen.has(lower)) {
			seen.add(lower);
			deduped.push(p);
		}
		if (deduped.length >= maxParts) break;
	}
	return balanceParens(deduped.join(", "));
}

function isRomanizationOnly(hangul: string, gloss: string): boolean {
	const rom = romanizeHangul(hangul).toLowerCase().replace(/-/g, "");
	const clean = gloss.toLowerCase().replace(/[^a-z]/g, "");
	return rom.length >= 2 && clean === rom;
}

const SHARED_NOISY_SENSE_TERMS =
	"what the hell|obversation|footdraggng|buring|materfamilias|propria|cacod|ecdysis|handsel|imbrue|trepang|Windsor chair|rack monster|reggae|heavy water|license plate|bellboy|footboy|office boy|long tongue|aiding the enemy|shakedown|cold latitude|baby in the oven|at loggerhead|Korean language|ph\\.?d|mangily|overweening|asinine|guileless|sacrarium|grapery|northing|joss|specie|thereat|progeniture|wive|beefy|napoo|notabene|whatsis|quoth|ejaculation|petuntse|sharpbelly";

const MODERN_SECULAR_PENALTY_RE = new RegExp(
	`\\b(${SHARED_NOISY_SENSE_TERMS}|bus|train|subway|railway|airplane|car|rocket|movie|film|radio|television|TV|NASA|Samsung|software|computer|computing|internet|smartphone|baseball|soccer|golf|croquet|company|corporation|stock|dividend|parliament|communist|nazi|kimchi|hanbok|taekwondo|won|dollar|yen|euro|sewage|sewerage|postal|mail|postage|drill|March 1|Chengdu|archenemy|bale|gizzard|glottis|softshell|librarian|emasculate|nonsuit|demimondaine|bedtick|calyptra|voiceprint|samadhi|asthenosphere|bivalence|tinnitus|dementia|calcination|microcopy|acidity|backhaul|dehotative|mach one|apt complex|garage|register|slang|Hemiculter|big-time thief|kisaeng|gisaeng|demonstrators|protestors|gift-wrapping|warehousing|warehouse|eat out|applause|marine goods|marching music|death by starvation|obituary|prognosis|prominent person|my gentleman|smack one's lips|to smash|to burn oneself)\\b`,
	"i",
);

/** Inflected forms, homograph traps, and obscure headwords that must decompose morphologically instead of exact-matching. */
const BLOCKED_LEXICON_HEADWORDS = new Set([
	"것이다",
	"하였다",
	"말하였다",
	"죽었다",
	"없어졌다",
	"하옵시다",
	"입고",
	"입지",
	"지고",
	"보이",
	"드릴",
	"자니",
	"한지",
	"한대",
	"다시다",
	"거기다",
	"때다",
	"써다",
	"팓다",
	"솔다",
	"벋다",
	"고다",
	"마다",
	"나아가",
	"가까운",
	"즐거운",
	"새긴",
	"바친",
	"심한",
	"깨닫고",
	"써서",
	"기는",
	"주의하라",
	"무엇인지",
	"당신에게",
	"때에",
	"후에",
	"전에",
	"사이에",
	"배가",
	"베로",
	"떼를",
	"굽이",
	"그렇지",
	"악인의",
	"울며",
	"가증한",
	"어리석은",
	"정직한",
	"교만한",
	"살찐",
	"이제는",
	"당신은",
	"그것으로",
	"하나도",
	"기쁘게",
	"더럽게",
	"다투어",
	"이기",
	"기울",
	"거두",
	"그치",
	"부음",
	"갈고",
	"맞고",
	"일어",
	"개가",
	"세구에",
	"기가",
	"망할",
	"오려",
]);

function isValidHeadword(term: string): boolean {
	return (
		term.length >= 2 &&
		containsHangul(term) &&
		!term.includes(" ") &&
		!/^[-~]|[-~]$/.test(term) &&
		!BLOCKED_LEXICON_HEADWORDS.has(term)
	);
}

function addCandidate(
	candidates: Map<string, DictCandidate[]>,
	term: string,
	candidate: DictCandidate,
): void {
	const list = candidates.get(term);
	if (list) list.push(candidate);
	else candidates.set(term, [candidate]);
}

function extractStructuredText(node: unknown): string {
	if (typeof node === "string") return node;
	if (Array.isArray(node)) return node.map(extractStructuredText).join("");
	if (node && typeof node === "object") {
		return extractStructuredText((node as Record<string, unknown>).content);
	}
	return "";
}

function parseKrdictPos(rawPos: string): { pos?: WordPos; stars: number } {
	const stars = (rawPos.match(/⭐/g) ?? []).length;
	const lower = rawPos.toLowerCase();
	// Check "adverb" BEFORE "verb" since "adverb".includes("verb") is true!
	if (lower.includes("affix") || lower.includes("ending") || lower.includes("particle")) {
		return { pos: undefined, stars };
	}
	if (lower.includes("adverb")) return { pos: "adv", stars };
	if (lower.includes("adjective") || lower.includes("determiner")) return { pos: "adj", stars };
	if (lower.includes("verb")) return { pos: "verb", stars };
	if (lower.includes("pronoun")) return { pos: "pronoun", stars };
	if (lower.includes("numeral")) return { pos: "numeral", stars };
	if (lower.includes("interjection")) return { pos: "interj", stars };
	if (lower.includes("noun")) return { pos: "noun", stars };
	return { pos: undefined, stars };
}

function formatKrdictGloss(term: string, raw: string, pos: WordPos): string {
	// Drop KRDICT romanization-only leading parts (e.g. "gokada; wail" -> "wail", "naesi; eunuch" -> "eunuch")
	const filteredRaw = raw
		.split(/\s*[;,]\s*/)
		.filter((part) => {
			const p = part.trim();
			return p.length >= 2 && !isRomanizationOnly(term, p);
		})
		.join("; ");
	const cleaned = cleanGloss(filteredRaw || raw, 2);
	if (!cleaned || isRomanizationOnly(term, cleaned)) return "";
	if (pos === "verb" && !cleaned.toLowerCase().startsWith("to ")) {
		return `to ${cleaned}`;
	}
	return cleaned;
}

async function loadKrdictCandidates(zipPath: string): Promise<Map<string, DictCandidate[]>> {
	const bytes = new Uint8Array(await Bun.file(zipPath).arrayBuffer());
	const banks = readZipJsonEntries(bytes, "term_bank_");
	const candidates = new Map<string, DictCandidate[]>();

	for (const bank of banks) {
		const rows = JSON.parse(bank.text) as Array<unknown[]>;
		for (const row of rows) {
			const term = String(row[0] ?? "").trim();
			const rawPos = String(row[2] ?? "");
			if (!isValidHeadword(term)) continue;
			const { pos, stars } = parseKrdictPos(rawPos);
			if (!pos) continue;

			const defs = row[5] as Array<{ content?: unknown[] }>;
			if (!Array.isArray(defs)) continue;
			for (const def of defs) {
				const items = Array.isArray(def?.content) ? def.content : [];
				const headerText = items[0] ? extractStructuredText(items[0]) : "";
				const hanjaMatch = headerText.match(/〔([^〕]+)〕/);
				const rawHanja = hanjaMatch ? hanjaMatch[1].trim() : undefined;
				const hanja =
					rawHanja && !rawHanja.includes("/") ? rawHanja : rawHanja?.split("/")[0]?.trim();

				const senseContainer = items[1] as
					{ content?: Array<{ content?: unknown; lang?: string }> } | undefined;
				const senseDivs = Array.isArray(senseContainer?.content) ? senseContainer.content : [];
				for (let i = 0; i < senseDivs.length; i++) {
					const sdiv = senseDivs[i];
					if (!Array.isArray(sdiv?.content)) continue;
					const firstText = extractStructuredText(sdiv.content[0]);
					let enGloss = "";
					if (/^\d+\.\s*$/.test(firstText) && sdiv.content.length >= 2) {
						enGloss = extractStructuredText(sdiv.content[1]).trim();
					} else if (sdiv.content.length === 1 && sdiv.lang === "en") {
						enGloss = firstText.trim();
					}
					if (!enGloss || !/[a-zA-Z]/.test(enGloss)) continue;
					if (isRomanizationOnly(term, enGloss)) continue;

					const gloss = formatKrdictGloss(term, enGloss, pos);
					if (!gloss || gloss.length < 2) continue;

					const nextDiv = senseDivs[i + 1];
					const definition =
						typeof nextDiv?.content === "string"
							? decodeHtmlEntities(nextDiv.content).trim()
							: undefined;

					const entry: LexiconEntry = { gloss, pos };
					if (hanja) entry.hanja = hanja;
					addCandidate(candidates, term, { entry, source: "krdict", definition, stars });
				}
			}
		}
	}
	return candidates;
}

const WIKT_EXCLUDED_TAGS = new Set([
	"form-of",
	"alt-of",
	"slang",
	"vulgar",
	"offensive",
	"derogatory",
	"Internet",
	"neologism",
	"colloquial",
	"dialectal",
	"North-Korea",
	"nonstandard",
	"misspelling",
	"abbreviation",
	"initialism",
	"clipping",
	"eye-dialect",
	"humorous",
	"jocular",
	"childish",
]);

const WIKT_META_GLOSS_RE =
	/^(?:hanja form of|alternative (?:form|spelling) of|short for|abbreviation of|clipped form of|synonym of|antonym of|ellipsis of|contraction of|For the Korean|a surname|surname|a (?:male|female) given name|a (?:city|county|province|district|neighborhood|village|station|subprovincial|prefecture|town|island|river|mountain) (?:in|of)\b|initialism of|acronym of)/i;

function mapKaikkiPos(p: string): WordPos | undefined {
	switch (p) {
		case "noun":
			return "noun";
		case "verb":
			return "verb";
		case "adj":
		case "det":
			return "adj";
		case "adv":
			return "adv";
		case "pron":
			return "pronoun";
		case "name":
			return "name";
		case "num":
			return "numeral";
		case "intj":
			return "interj";
		default:
			return undefined;
	}
}

async function loadKaikkiCandidates(gzPath: string): Promise<Map<string, DictCandidate[]>> {
	const gzBytes = new Uint8Array(await Bun.file(gzPath).arrayBuffer());
	const text = new TextDecoder().decode(Bun.gunzipSync(gzBytes));
	const candidates = new Map<string, DictCandidate[]>();

	for (const line of text.split("\n")) {
		if (!line) continue;
		let obj: Record<string, unknown>;
		try {
			obj = JSON.parse(line);
		} catch {
			continue;
		}
		const word = String(obj.word ?? "").trim();
		if (!isValidHeadword(word)) continue;
		const pos = mapKaikkiPos(String(obj.pos ?? ""));
		if (!pos) continue;

		let hanja: string | undefined;
		const forms = obj.forms as Array<{ form?: string; tags?: string[] }> | undefined;
		if (Array.isArray(forms)) {
			const h = forms.find((f) => Array.isArray(f.tags) && f.tags.includes("hanja") && f.form);
			if (h?.form && !containsHangul(h.form)) {
				hanja = h.form.split("/")[0]?.trim();
			}
		}

		const senses = obj.senses as
			Array<{ glosses?: string[]; tags?: string[]; topics?: string[] }> | undefined;
		if (!Array.isArray(senses)) continue;

		for (const s of senses) {
			const tags = [...(s.tags ?? []), ...(s.topics ?? [])];
			if (tags.some((t) => WIKT_EXCLUDED_TAGS.has(t))) continue;
			const rawGloss = s.glosses?.[0]?.trim();
			if (!rawGloss || WIKT_META_GLOSS_RE.test(rawGloss)) continue;
			if (
				/\b(?:South Korea|North Korea|Seoul|Pyongyang|China|Chinese|Japan|Japanese|Taiwan|Sichuan|Chengdu|Hokkaido)\b/i.test(
					rawGloss,
				)
			) {
				continue;
			}
			// Trim verbose explanatory parentheticals at the end if the gloss is long
			let trimmed = rawGloss;
			if (trimmed.length > 48) {
				trimmed = trimmed.replace(/\s*\([^)]{15,}\)\s*/g, " ").trim();
			}
			const gloss = cleanGloss(trimmed, 2);
			if (!gloss || gloss.length < 2 || isRomanizationOnly(word, gloss)) continue;

			const entry: LexiconEntry = { gloss, pos };
			if (hanja) entry.hanja = hanja;
			addCandidate(candidates, word, { entry, source: "wiktionary", definition: rawGloss, tags });
		}
	}
	return candidates;
}

const KENGDIC_HARD_REJECT_RE = new RegExp(
	`\\b(${SHARED_NOISY_SENSE_TERMS}|sth|sb|s|p\\.o\\.w|dugg|in tear)\\b|\\bbale,|\\(English\\)`,
	"i",
);

function inferKengdicPos(surface: string, gloss: string): WordPos {
	const lower = gloss.toLowerCase();
	if (surface.endsWith("다")) {
		if (
			surface.endsWith("스럽다") ||
			surface.endsWith("롭다") ||
			surface.endsWith("답다") ||
			lower.startsWith("to be ") ||
			lower.startsWith("be ")
		) {
			return "adj";
		}
		if (
			surface.endsWith("하다") ||
			surface.endsWith("되다") ||
			surface.endsWith("시키다") ||
			surface.endsWith("드리다") ||
			lower.startsWith("to ")
		) {
			return "verb";
		}
		// Generic Korean verb/adj lemma ending in 다 unless gloss is clearly a single proper name
		if (/^[A-Z][a-z]+$/.test(gloss)) return "name";
		return "verb";
	}
	if (/^[A-Z][a-z]+(?:-[A-Z]?[a-z]+)?$/.test(gloss)) return "name";
	if (/(?:히|로|게|이)$/.test(surface) && /^[a-z]+ly\b/i.test(gloss)) return "adv";
	return "noun";
}

const KENGDIC_INFLECTED_SUFFIXES = [
	"의",
	"은",
	"는",
	"을",
	"를",
	"에",
	"에서",
	"으로",
	"로",
	"며",
	"게",
	"어",
	"아",
	"여",
	"한",
	"된",
	"할",
	"될",
];

function isRedundantInflectedKengdicForm(surface: string, knownHeadwords: Set<string>): boolean {
	// Skip possessive / inflected Kengdic forms when the clean base lemma already exists
	if (surface.endsWith("의") && surface.length >= 3) return true;
	if (knownHeadwords.has(surface)) return false;

	for (const suf of KENGDIC_INFLECTED_SUFFIXES) {
		if (!surface.endsWith(suf) || surface.length <= suf.length + 1) continue;
		const stem = surface.slice(0, -suf.length);
		if (
			knownHeadwords.has(stem) ||
			knownHeadwords.has(`${stem}다`) ||
			knownHeadwords.has(`${stem}하다`) ||
			Object.hasOwn(BIBLICAL_GLOSSARY, stem) ||
			Object.hasOwn(BIBLICAL_GLOSSARY, `${stem}다`) ||
			Object.hasOwn(BIBLICAL_GLOSSARY, `${stem}하다`)
		) {
			return true;
		}
	}
	if (BLOCKED_LEXICON_HEADWORDS.has(surface)) return true;
	if (/(?:었다|았다|였다|했다)$/.test(surface) && !knownHeadwords.has(surface)) return true;
	return false;
}

async function loadKengdicCandidates(
	tsvPath: string,
	knownHeadwords: Set<string>,
): Promise<Map<string, DictCandidate[]>> {
	const tsv = await Bun.file(tsvPath).text();
	const lines = tsv.split(/\r?\n/);
	const candidates = new Map<string, DictCandidate[]>();

	for (let i = 1; i < lines.length; i++) {
		const cols = lines[i].split("\t");
		if (cols.length < 4) continue;
		const surface = cols[1]?.trim() ?? "";
		const rawHanja = cols[2]?.trim() ?? "";
		const rawGloss = cols[3]?.trim() ?? "";
		const grade = cols[4]?.trim() ?? "";
		if (!rawGloss || !isValidHeadword(surface)) continue;
		if (isRedundantInflectedKengdicForm(surface, knownHeadwords)) continue;
		if (KENGDIC_HARD_REJECT_RE.test(rawGloss)) continue;

		const cleaned = cleanGloss(rawGloss, 2);
		if (!cleaned || cleaned.length < 2 || cleaned.length > 60) continue;
		if (KENGDIC_HARD_REJECT_RE.test(cleaned)) continue;

		const pos = inferKengdicPos(surface, cleaned);
		const entry: LexiconEntry = { gloss: cleaned, pos };
		if (rawHanja && !containsHangul(rawHanja)) entry.hanja = rawHanja;
		addCandidate(candidates, surface, { entry, source: "kengdic", grade });
	}
	return candidates;
}

function mergeCandidatePools(
	...pools: Array<Map<string, DictCandidate[]>>
): Map<string, DictCandidate[]> {
	const merged = new Map<string, DictCandidate[]>();
	for (const pool of pools) {
		for (const [key, list] of pool.entries()) {
			const existing = merged.get(key);
			if (existing) existing.push(...list);
			else merged.set(key, [...list]);
		}
	}
	return merged;
}

function pickPrimaryPos(list: DictCandidate[]): WordPos | undefined {
	// Prefer KRDICT or Wiktionary POS for placeholder indexing
	const preferred =
		list.find((c) => c.source === "krdict") ??
		list.find((c) => c.source === "wiktionary") ??
		list[0];
	return preferred?.entry.pos;
}

function buildEsvContextIndex(
	esvBooks: Map<number, BookBibleData>,
	krvBooks: Map<number, BookBibleData>,
	candidatesBySurface: Map<string, DictCandidate[]>,
): Map<string, EsvLemmaContext> {
	const placeholderLexicon: LexiconMap = {};
	for (const [key, list] of candidatesBySurface.entries()) {
		if (key.length >= 2 && !Object.hasOwn(BIBLICAL_GLOSSARY, key)) {
			placeholderLexicon[key] = { gloss: key, pos: pickPrimaryPos(list) };
		}
	}

	const contextMap = new Map<string, EsvLemmaContext>();

	for (const [bookNum, krvBook] of krvBooks.entries()) {
		const esvBook = esvBooks.get(bookNum);
		if (!esvBook) continue;

		for (const [chapKey, krvVerses] of Object.entries(krvBook.chapters)) {
			const esvVerses = esvBook.chapters[chapKey];
			if (!esvVerses) continue;
			const esvByNum = new Map(esvVerses.map((v) => [v.verse, v.text]));

			for (const krvVerse of krvVerses) {
				const esvText = esvByNum.get(krvVerse.verse);
				if (!esvText) continue;
				const esvWords = [...new Set(extractEnglishKeywords(esvText))];
				if (esvWords.length === 0) continue;

				const tokens = analyzeKoreanVerse(krvVerse.text, placeholderLexicon);
				for (const tok of tokens) {
					if (!tok.matched || !candidatesBySurface.has(tok.lemma)) continue;
					let ctx = contextMap.get(tok.lemma);
					if (!ctx) {
						ctx = { total: 0, words: new Map<string, number>() };
						contextMap.set(tok.lemma, ctx);
					}
					ctx.total++;
					for (const ew of esvWords) {
						ctx.words.set(ew, (ctx.words.get(ew) ?? 0) + 1);
					}
				}
			}
		}
	}

	return contextMap;
}

function hasKeywordOverlap(a: string, b: string): boolean {
	const kwA = extractEnglishKeywords(a);
	const kwB = new Set(extractEnglishKeywords(b));
	if (kwA.length === 0 || kwB.size === 0) return false;
	for (const w of kwA) {
		if (kwB.has(w)) return true;
		if (w.length >= 5) {
			const stem = w.slice(0, -1);
			for (const bw of kwB) {
				if (bw.startsWith(stem)) return true;
			}
		}
	}
	return false;
}

function scoreCandidate(
	candidate: DictCandidate,
	allCandidates: DictCandidate[],
	esvContext?: EsvLemmaContext,
): number {
	const { entry, source, definition, stars, grade, tags } = candidate;
	const gloss = entry.gloss;
	let score = 0;

	// Source reliability baseline
	if (source === "krdict") {
		score += 30 + (stars ?? 0) * 5;
	} else if (source === "wiktionary") {
		score += 26;
		if (tags?.some((t) => /^(?:biblical|Christianity|Judaism|religion|theology)$/i.test(t))) {
			score += 22;
		}
		if (tags?.some((t) => /^(?:literary|archaic|formal|dated|historical)$/i.test(t))) {
			score += 8;
		}
	} else {
		score += 10;
		if (grade === "A") score += 8;
		else if (grade === "B") score += 4;
	}

	// Cross-source consensus bonus (KRDICT <-> Wiktionary agreement)
	if (source !== "kengdic") {
		const agreesWithOther = allCandidates.some(
			(other) =>
				other.source !== source &&
				other.source !== "kengdic" &&
				hasKeywordOverlap(gloss, other.entry.gloss),
		);
		if (agreesWithOther) score += 12;
	}

	// Tooltip readability
	if (gloss.length >= 2 && gloss.length <= 32) score += 10;
	if (gloss.length > 52) score -= 12;
	if (!/[()]/.test(gloss)) score += 3;

	// Penalize anachronistic / secular / noisy senses
	if (
		MODERN_SECULAR_PENALTY_RE.test(gloss) ||
		(definition && MODERN_SECULAR_PENALTY_RE.test(definition))
	) {
		score -= 55;
	}

	// ESV parallel Bible co-occurrence boost (strongest disambiguator!)
	if (esvContext && esvContext.total > 0) {
		const glossKws = extractEnglishKeywords(gloss);
		const defKws = definition ? extractEnglishKeywords(definition) : [];
		let bestGlossHit = 0;
		let totalGlossHits = 0;
		for (const kw of glossKws) {
			const hits =
				(esvContext.words.get(kw) ?? 0) +
				(esvContext.words.get(`${kw}s`) ?? 0) +
				(esvContext.words.get(`${kw}ed`) ?? 0) +
				(esvContext.words.get(`${kw}ing`) ?? 0);
			totalGlossHits += hits;
			if (hits > bestGlossHit) bestGlossHit = hits;
		}
		let defHits = 0;
		for (const kw of defKws) {
			defHits += esvContext.words.get(kw) ?? 0;
		}

		const hitRatio = bestGlossHit / esvContext.total;
		score += Math.min(70, totalGlossHits * 8);
		score += Math.min(40, Math.round(hitRatio * 80));
		score += Math.min(20, defHits * 2);
	}

	return score;
}

function selectBestMultiSourceLexicon(
	candidatesBySurface: Map<string, DictCandidate[]>,
	contextIndex: Map<string, EsvLemmaContext>,
): { map: LexiconMap; sourceByKey: Map<string, DictCandidate["source"]> } {
	const map: LexiconMap = {};
	const sourceByKey = new Map<string, DictCandidate["source"]>();

	for (const [key, list] of candidatesBySurface.entries()) {
		if (list.length === 0) continue;
		const esvCtx = contextIndex.get(key);
		let best = list[0];
		let bestScore = scoreCandidate(best, list, esvCtx);
		for (let i = 1; i < list.length; i++) {
			const score = scoreCandidate(list[i], list, esvCtx);
			if (score > bestScore) {
				best = list[i];
				bestScore = score;
			}
		}

		// Clean final entry (normalize proper name capitalization if pos === "name")
		const entry: LexiconEntry = { gloss: best.entry.gloss };
		if (best.entry.hanja) entry.hanja = best.entry.hanja;
		if (best.entry.pos) entry.pos = best.entry.pos;
		if (entry.pos === "name" && /^[a-z]/.test(entry.gloss)) {
			entry.gloss = entry.gloss[0].toUpperCase() + entry.gloss.slice(1);
		}
		map[key] = entry;
		sourceByKey.set(key, best.source);
	}

	return { map, sourceByKey };
}

const KRV_BOOK_NAME_TO_NUMBER: Record<string, number> = Object.fromEntries(
	BIBLE_BOOKS.map((b) => [b.en.replace(/\s+/g, ""), b.number]),
);

function parseKrvBooks(rawBooks: RawKrvBook[]): Map<number, BookBibleData> {
	const result = new Map<number, BookBibleData>();

	for (const rawBook of rawBooks) {
		const bookNumber = KRV_BOOK_NAME_TO_NUMBER[rawBook.book];
		if (!bookNumber) {
			throw new Error(`Unknown KRV book key: ${rawBook.book}`);
		}
		const meta = getBookByNumber(bookNumber);
		if (!meta) continue;

		const chapters: Record<string, VerseEntry[]> = {};
		for (const chap of rawBook.chapters) {
			chapters[String(chap.chapter)] = chap.verses.map((v) => ({
				verse: v.verse,
				text: v.text.replace(/\s+/g, " ").trim(),
			}));
		}

		result.set(bookNumber, {
			translationId: "krv",
			bookNumber,
			usfm: meta.usfm,
			chapters,
		});
	}

	return result;
}

function buildCompactBibleLexicon(
	krvBooks: Map<number, BookBibleData>,
	fullLexicon: LexiconMap,
	sourceByKey: Map<string, DictCandidate["source"]>,
): {
	lexicon: LexiconMap;
	totalHangulWords: number;
	matchedWords: number;
	sourceCounts: Record<DictCandidate["source"], number>;
} {
	const compact: LexiconMap = {};
	const sourceCounts: Record<DictCandidate["source"], number> = {
		krdict: 0,
		wiktionary: 0,
		kengdic: 0,
	};
	let totalHangulWords = 0;
	let matchedWords = 0;

	// Only include lemmas that actually match across the 66-book KRV corpus (no dead fallback junk!)
	for (const book of krvBooks.values()) {
		for (const verses of Object.values(book.chapters)) {
			for (const verse of verses) {
				const tokens = analyzeKoreanVerse(verse.text, fullLexicon);
				for (const token of tokens) {
					if (!token.word || !containsHangul(token.word)) continue;
					totalHangulWords++;
					if (token.matched) {
						matchedWords++;
						if (
							token.lemma.length >= 2 &&
							!Object.hasOwn(BIBLICAL_GLOSSARY, token.lemma) &&
							Object.hasOwn(fullLexicon, token.lemma) &&
							!Object.hasOwn(compact, token.lemma)
						) {
							compact[token.lemma] = fullLexicon[token.lemma];
							const src = sourceByKey.get(token.lemma);
							if (src) sourceCounts[src]++;
						}
					}
				}
			}
		}
	}

	return { lexicon: compact, totalHangulWords, matchedWords, sourceCounts };
}

async function main() {
	console.log("Building Logos Bible data (multi-source lexicon)...");

	const esvSourcePath = join(DATA_SOURCES_DIR, "esv.spb");
	const hasEsvSource = await Bun.file(esvSourcePath).exists();
	if (!hasEsvSource) {
		console.log(
			"Optional data-sources/esv.spb not found; skipping .cache/esv-local generation and ESV lexicon context.",
		);
	}

	const [krvPath, krdictPath, kaikkiPath, kengdicPath] = await Promise.all([
		ensureSourceFile("krv_1961.json", KRV_SOURCE_URL),
		ensureSourceFile("krdict-en.zip", KRDICT_SOURCE_URL),
		ensureSourceFile("kaikki-ko.jsonl.gz", KAIKKI_SOURCE_URL),
		ensureSourceFile("kengdic.tsv", KENGDIC_SOURCE_URL),
	]);

	const [esvText, krvRaw, krdictCandidates, kaikkiCandidates] = await Promise.all([
		hasEsvSource ? Bun.file(esvSourcePath).text() : Promise.resolve(null),
		Bun.file(krvPath).json() as Promise<RawKrvBook[]>,
		loadKrdictCandidates(krdictPath),
		loadKaikkiCandidates(kaikkiPath),
	]);

	const primaryHeadwords = new Set<string>([
		...krdictCandidates.keys(),
		...kaikkiCandidates.keys(),
	]);
	const kengdicCandidates = await loadKengdicCandidates(kengdicPath, primaryHeadwords);
	const mergedCandidates = mergeCandidatePools(
		krdictCandidates,
		kaikkiCandidates,
		kengdicCandidates,
	);

	const esvParsed = esvText !== null ? parseSpbContent(esvText, "esv") : null;
	const krvBooks = parseKrvBooks(krvRaw);
	const esvContextIndex = esvParsed
		? buildEsvContextIndex(esvParsed.books, krvBooks, mergedCandidates)
		: new Map<string, EsvLemmaContext>();
	const { map: fullLexicon, sourceByKey } = selectBestMultiSourceLexicon(
		mergedCandidates,
		esvContextIndex,
	);

	if (esvParsed) {
		console.log(`Parsed ESV (local cache only): ${esvParsed.books.size} books`);
	}
	console.log(`Parsed KRV: ${krvBooks.size} books`);
	console.log(
		`Sources loaded: KRDICT=${krdictCandidates.size}, Wiktionary=${kaikkiCandidates.size}, Kengdic=${kengdicCandidates.size}, Merged=${Object.keys(fullLexicon).length}`,
	);

	const krvOutDir = join(PUBLIC_DATA_DIR, "bibles", "krv");
	await mkdir(krvOutDir, { recursive: true });
	if (esvParsed) {
		await mkdir(LOCAL_ESV_CACHE_DIR, { recursive: true });
	}

	for (const book of BIBLE_BOOKS) {
		const krvBook = krvBooks.get(book.number);
		if (!krvBook) {
			throw new Error(`Missing KRV book ${book.usfm} (${book.number})`);
		}
		const writes: Array<Promise<number>> = [
			Bun.write(join(krvOutDir, `${book.usfm}.json`), JSON.stringify(krvBook)),
		];
		if (esvParsed) {
			const esvBook = esvParsed.books.get(book.number);
			if (!esvBook) {
				throw new Error(`Missing ESV book ${book.usfm} (${book.number})`);
			}
			writes.push(
				Bun.write(join(LOCAL_ESV_CACHE_DIR, `${book.usfm}.json`), JSON.stringify(esvBook)),
			);
		}
		await Promise.all(writes);
	}

	const { lexicon, totalHangulWords, matchedWords, sourceCounts } = buildCompactBibleLexicon(
		krvBooks,
		fullLexicon,
		sourceByKey,
	);
	const lexiconJson = JSON.stringify(lexicon);
	await Bun.write(join(PUBLIC_DATA_DIR, "lexicon.json"), lexiconJson);

	const pct = ((matchedWords / totalHangulWords) * 100).toFixed(2);
	console.log(
		`Built compact Bible lexicon: ${Object.keys(lexicon).length} entries (${(lexiconJson.length / 1024).toFixed(1)} KB)`,
	);
	console.log(
		`  Breakdown: KRDICT=${sourceCounts.krdict}, Wiktionary=${sourceCounts.wiktionary}, Kengdic=${sourceCounts.kengdic}`,
	);
	console.log(`KRV word gloss coverage: ${matchedWords}/${totalHangulWords} (${pct}%)`);
	console.log("Done!");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
