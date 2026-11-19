import type { BookMeta, ParsedReference, Testament } from "./types";

type BookRow = readonly [
	usfm: string,
	en: string,
	ko: string,
	enShort: string,
	koShort: string,
	chapters: number,
];

const BOOK_ROWS: readonly BookRow[] = [
	["GEN", "Genesis", "창세기", "Gen", "창", 50],
	["EXO", "Exodus", "출애굽기", "Exod", "출", 40],
	["LEV", "Leviticus", "레위기", "Lev", "레", 27],
	["NUM", "Numbers", "민수기", "Num", "민", 36],
	["DEU", "Deuteronomy", "신명기", "Deut", "신", 34],
	["JOS", "Joshua", "여호수아", "Josh", "수", 24],
	["JDG", "Judges", "사사기", "Judg", "삿", 21],
	["RUT", "Ruth", "룻기", "Ruth", "룻", 4],
	["1SA", "1 Samuel", "사무엘상", "1Sam", "삼상", 31],
	["2SA", "2 Samuel", "사무엘하", "2Sam", "삼하", 24],
	["1KI", "1 Kings", "열왕기상", "1Kgs", "왕상", 22],
	["2KI", "2 Kings", "열왕기하", "2Kgs", "왕하", 25],
	["1CH", "1 Chronicles", "역대상", "1Chr", "대상", 29],
	["2CH", "2 Chronicles", "역대하", "2Chr", "대하", 36],
	["EZR", "Ezra", "에스라", "Ezra", "스", 10],
	["NEH", "Nehemiah", "느헤미야", "Neh", "느", 13],
	["EST", "Esther", "에스더", "Esth", "에", 10],
	["JOB", "Job", "욥기", "Job", "욥", 42],
	["PSA", "Psalms", "시편", "Ps", "시", 150],
	["PRO", "Proverbs", "잠언", "Prov", "잠", 31],
	["ECC", "Ecclesiastes", "전도서", "Eccl", "전", 12],
	["SNG", "Song of Solomon", "아가", "Song", "아", 8],
	["ISA", "Isaiah", "이사야", "Isa", "사", 66],
	["JER", "Jeremiah", "예레미야", "Jer", "렘", 52],
	["LAM", "Lamentations", "예레미야애가", "Lam", "애", 5],
	["EZK", "Ezekiel", "에스겔", "Ezek", "겔", 48],
	["DAN", "Daniel", "다니엘", "Dan", "단", 12],
	["HOS", "Hosea", "호세아", "Hos", "호", 14],
	["JOL", "Joel", "요엘", "Joel", "욜", 3],
	["AMO", "Amos", "아모스", "Amos", "암", 9],
	["OBA", "Obadiah", "오바댜", "Obad", "옵", 1],
	["JON", "Jonah", "요나", "Jonah", "욘", 4],
	["MIC", "Micah", "미가", "Mic", "미", 7],
	["NAM", "Nahum", "나훔", "Nah", "나", 3],
	["HAB", "Habakkuk", "하박국", "Hab", "합", 3],
	["ZEP", "Zephaniah", "스바냐", "Zeph", "습", 3],
	["HAG", "Haggai", "학개", "Hag", "학", 2],
	["ZEC", "Zechariah", "스가랴", "Zech", "슥", 14],
	["MAL", "Malachi", "말라기", "Mal", "말", 4],
	["MAT", "Matthew", "마태복음", "Matt", "마", 28],
	["MRK", "Mark", "마가복음", "Mark", "막", 16],
	["LUK", "Luke", "누가복음", "Luke", "눅", 24],
	["JHN", "John", "요한복음", "John", "요", 21],
	["ACT", "Acts", "사도행전", "Acts", "행", 28],
	["ROM", "Romans", "로마서", "Rom", "롬", 16],
	["1CO", "1 Corinthians", "고린도전서", "1Cor", "고전", 16],
	["2CO", "2 Corinthians", "고린도후서", "2Cor", "고후", 13],
	["GAL", "Galatians", "갈라디아서", "Gal", "갈", 6],
	["EPH", "Ephesians", "에베소서", "Eph", "엡", 6],
	["PHP", "Philippians", "빌립보서", "Phil", "빌", 4],
	["COL", "Colossians", "골로새서", "Col", "골", 4],
	["1TH", "1 Thessalonians", "데살로니가전서", "1Thess", "살전", 5],
	["2TH", "2 Thessalonians", "데살로니가후서", "2Thess", "살후", 3],
	["1TI", "1 Timothy", "디모데전서", "1Tim", "딤전", 6],
	["2TI", "2 Timothy", "디모데후서", "2Tim", "딤후", 4],
	["TIT", "Titus", "디도서", "Titus", "딛", 3],
	["PHM", "Philemon", "빌레몬서", "Phlm", "몬", 1],
	["HEB", "Hebrews", "히브리서", "Heb", "히", 13],
	["JAS", "James", "야고보서", "Jas", "약", 5],
	["1PE", "1 Peter", "베드로전서", "1Pet", "벧전", 5],
	["2PE", "2 Peter", "베드로후서", "2Pet", "벧후", 3],
	["1JN", "1 John", "요한일서", "1John", "요일", 5],
	["2JN", "2 John", "요한이서", "2John", "요이", 1],
	["3JN", "3 John", "요한삼서", "3John", "요삼", 1],
	["JUD", "Jude", "유다서", "Jude", "유", 1],
	["REV", "Revelation", "요한계시록", "Rev", "계", 22],
];

export const BIBLE_BOOKS: readonly BookMeta[] = BOOK_ROWS.map(
	([usfm, en, ko, enShort, koShort, chapters], idx) => ({
		number: idx + 1,
		usfm,
		en,
		ko,
		enShort,
		koShort,
		chapters,
		testament: idx < 39 ? "OT" : "NT",
	}),
);

interface BibleGenre {
	id: string;
	nameEn: string;
	nameKo: string;
	testament: Testament;
	bookNumbers: readonly number[];
}

type GenreSpec = readonly [
	id: string,
	nameEn: string,
	nameKo: string,
	testament: Testament,
	startBook: number,
	endBook: number,
];

const GENRE_SPECS: readonly GenreSpec[] = [
	["law", "Law (Pentateuch)", "모세오경", "OT", 1, 5],
	["ot-history", "History", "역사서", "OT", 6, 17],
	["poetry-wisdom", "Poetry & Wisdom", "시가서", "OT", 18, 22],
	["major-prophets", "Major Prophets", "대선지서", "OT", 23, 27],
	["minor-prophets", "Minor Prophets", "소선지서", "OT", 28, 39],
	["gospels", "Gospels", "복음서", "NT", 40, 43],
	["nt-history", "Church History", "역사서 (사도행전)", "NT", 44, 44],
	["pauline-epistles", "Pauline Epistles", "바울서신", "NT", 45, 57],
	["general-epistles", "General Epistles", "공동서신", "NT", 58, 65],
	["prophecy", "Prophecy (Apocalyptic)", "예언서 (계시록)", "NT", 66, 66],
];

export const BIBLE_GENRES: readonly BibleGenre[] = GENRE_SPECS.map(
	([id, nameEn, nameKo, testament, startBook, endBook]) => ({
		id,
		nameEn,
		nameKo,
		testament,
		bookNumbers: Array.from({ length: endBook - startBook + 1 }, (_, i) => startBook + i),
	}),
);

const BOOKS_BY_NUMBER = new Map<number, BookMeta>(BIBLE_BOOKS.map((b) => [b.number, b]));
const BOOKS_BY_USFM = new Map<string, BookMeta>(BIBLE_BOOKS.map((b) => [b.usfm, b]));

const ALIASES = new Map<string, number>([
	["psalm", 19],
	["sos", 22],
	["song of songs", 22],
	["jn", 43],
	["mt", 40],
	["mk", 41],
	["lk", 42],
	["rm", 45],
	["요한1서", 62],
	["요한2서", 63],
	["요한3서", 64],
]);

export function getBookByNumber(bookNumber: number): BookMeta | undefined {
	return BOOKS_BY_NUMBER.get(bookNumber);
}

export function getBookByUsfm(usfm: string): BookMeta | undefined {
	return BOOKS_BY_USFM.get(usfm.toUpperCase());
}

export function clampChapter(book: BookMeta, chapter: number): number {
	if (!Number.isFinite(chapter)) return 1;
	return Math.max(1, Math.min(book.chapters, Math.trunc(chapter)));
}

export function resolveBookChapter(
	bookNumber: number,
	chapter: number,
): { book: BookMeta; chapter: number } {
	const book = getBookByNumber(bookNumber) ?? BIBLE_BOOKS[0];
	return { book, chapter: clampChapter(book, chapter) };
}

export function filterBooks(query: string, testament?: Testament): BookMeta[] {
	const trimmed = query.trim();
	if (!trimmed) {
		return testament ? BIBLE_BOOKS.filter((b) => b.testament === testament) : [...BIBLE_BOOKS];
	}
	const lower = trimmed.toLowerCase();
	return BIBLE_BOOKS.filter(
		(b) =>
			b.en.toLowerCase().includes(lower) ||
			b.enShort.toLowerCase().includes(lower) ||
			b.ko.includes(trimmed) ||
			b.koShort.includes(trimmed),
	);
}

export function getAdjacentChapter(
	bookNumber: number,
	chapter: number,
	delta: -1 | 1,
): { bookNumber: number; chapter: number } | null {
	const current = getBookByNumber(bookNumber);
	if (!current) return null;
	const targetChapter = chapter + delta;
	if (targetChapter >= 1 && targetChapter <= current.chapters) {
		return { bookNumber, chapter: targetChapter };
	}
	const neighbor = getBookByNumber(bookNumber + delta);
	if (!neighbor) return null;
	return {
		bookNumber: neighbor.number,
		chapter: delta > 0 ? 1 : neighbor.chapters,
	};
}

export function findBookByQuery(rawQuery: string): BookMeta | undefined {
	const trimmed = rawQuery.trim();
	const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
	if (!normalized) return undefined;

	const compact = normalized.replace(/\s+/g, "");
	const aliasNum = ALIASES.get(normalized) ?? ALIASES.get(compact);
	if (aliasNum) return getBookByNumber(aliasNum);

	for (const book of BIBLE_BOOKS) {
		if (
			book.en.toLowerCase() === normalized ||
			book.enShort.toLowerCase() === normalized ||
			book.usfm.toLowerCase() === normalized ||
			book.ko === trimmed ||
			book.koShort === trimmed
		) {
			return book;
		}
	}

	return BIBLE_BOOKS.find(
		(book) =>
			book.en.toLowerCase().replace(/\s+/g, "").startsWith(compact) || book.ko.startsWith(trimmed),
	);
}

export function parsePassageReference(input: string): ParsedReference | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	const match = trimmed.match(/^(.+?)\s*(\d+)(?:\s*[:장절.]\s*(\d+))?\s*장?$/);
	if (!match) {
		const bookOnly = findBookByQuery(trimmed);
		return bookOnly ? { bookNumber: bookOnly.number, chapter: 1 } : null;
	}

	const book = findBookByQuery(match[1]);
	const chapterNum = Number.parseInt(match[2], 10);
	const verseNum = match[3] ? Number.parseInt(match[3], 10) : undefined;
	if (!book || Number.isNaN(chapterNum)) return null;

	return {
		bookNumber: book.number,
		chapter: clampChapter(book, chapterNum),
		verse: verseNum && !Number.isNaN(verseNum) ? verseNum : undefined,
	};
}
