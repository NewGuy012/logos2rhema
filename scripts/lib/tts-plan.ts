import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { SUPERTONIC_TRACK_ID } from "../../src/shared/audio-timings";
import { BIBLE_BOOKS, getBookByUsfm } from "../../src/shared/books";
import type { BookMeta } from "../../src/shared/types";
import {
	atomicCopyFile,
	atomicWriteJson,
	isFileNonEmpty,
	KRV_AUDIO_REL_DIR,
	KRV_TIMINGS_REL_DIR,
	readJsonIfExists,
} from "./common";
import type { CliOptions, OutputPaths } from "./tts-cli";

export interface JobPlan {
	books: BookMeta[];
	chaptersByBook: Record<string, number[]>;
	totalSelectedChapters: number;
	pendingChapters: number;
	skippedChapters: number;
}

interface WeightedChapter {
	book: BookMeta;
	chapter: number;
	weight: number;
}

const VALID_USFM_SET = new Set(BIBLE_BOOKS.map((b) => b.usfm));
const MP3_NAME_RE = /^(\d+)\.mp3$/;
const TIMINGS_FILE_RE = /^([A-Z0-9]+)\.json$/;

export function chooseOptimalShards(pendingChapters: number): number {
	if (pendingChapters <= 25) return 1;
	if (pendingChapters <= 150) return 2;
	return 4;
}

export function selectBooksForOptions(options: CliOptions): BookMeta[] {
	if (options.testament) {
		return BIBLE_BOOKS.filter((b) => b.testament === options.testament);
	}
	if (options.books && options.books.length > 0) {
		return options.books.map((usfm) => {
			const found = getBookByUsfm(usfm);
			if (!found) throw new Error(`Unknown USFM book code: "${usfm}"`);
			return found;
		});
	}
	return [...BIBLE_BOOKS];
}

async function loadExistingTimingsChapters(path: string): Promise<Set<string>> {
	const parsed = await readJsonIfExists<{ chapters?: Record<string, unknown> }>(path);
	if (parsed && typeof parsed.chapters === "object" && parsed.chapters !== null) {
		return new Set(Object.keys(parsed.chapters));
	}
	return new Set();
}

export async function buildPendingJobPlan(
	options: CliOptions,
	paths: OutputPaths,
): Promise<JobPlan> {
	const books = selectBooksForOptions(options);
	const chapterSet = options.chapters ? new Set(options.chapters) : null;
	const chaptersByBook: Record<string, number[]> = {};
	let totalSelectedChapters = 0;
	let pendingChapters = 0;
	let skippedChapters = 0;

	for (const book of books) {
		const timingPath = join(paths.localTimingsDir, `${book.usfm}.json`);
		const existingChapters = options.force
			? new Set<string>()
			: await loadExistingTimingsChapters(timingPath);
		const pendingForBook: number[] = [];

		for (let ch = 1; ch <= book.chapters; ch++) {
			if (chapterSet && !chapterSet.has(ch)) continue;
			totalSelectedChapters++;
			if (!options.force && !options.dryRun) {
				const mp3Path = join(paths.localAudioDir, book.usfm, `${ch}.mp3`);
				if ((await isFileNonEmpty(mp3Path, 1025)) && existingChapters.has(String(ch))) {
					skippedChapters++;
					continue;
				}
			}
			pendingForBook.push(ch);
			pendingChapters++;
		}

		if (pendingForBook.length > 0) {
			chaptersByBook[book.usfm] = pendingForBook;
		}
	}

	return { books, chaptersByBook, totalSelectedChapters, pendingChapters, skippedChapters };
}

async function loadBookChapterWeights(
	usfm: string,
	rootDir?: string,
): Promise<Map<number, number>> {
	const weights = new Map<number, number>();
	if (!rootDir) return weights;
	const raw = await readJsonIfExists<{ chapters?: Record<string, Array<{ text?: string }>> }>(
		join(rootDir, "public", "data", "bibles", "krv", `${usfm}.json`),
	);
	if (raw && typeof raw.chapters === "object" && raw.chapters !== null) {
		for (const [chKey, verses] of Object.entries(raw.chapters)) {
			const ch = Number.parseInt(chKey, 10);
			if (!Number.isFinite(ch) || !Array.isArray(verses)) continue;
			let chars = 0;
			for (const v of verses) {
				if (typeof v?.text === "string") chars += v.text.length;
			}
			weights.set(ch, Math.max(100, chars));
		}
	}
	return weights;
}

export async function partitionJobPlan(
	jobPlan: JobPlan,
	shardCount: number,
	rootDir?: string,
): Promise<JobPlan[]> {
	const bookByUsfm = new Map(jobPlan.books.map((b) => [b.usfm, b]));
	const items: WeightedChapter[] = [];

	for (const book of jobPlan.books) {
		const chapters = jobPlan.chaptersByBook[book.usfm];
		if (!chapters || chapters.length === 0) continue;
		const weights = await loadBookChapterWeights(book.usfm, rootDir);
		for (const ch of chapters) {
			items.push({ book, chapter: ch, weight: weights.get(ch) ?? 1 });
		}
	}

	if (items.length === 0) return [];
	const effectiveShards = Math.max(1, Math.min(shardCount, items.length));
	if (effectiveShards === 1) return [jobPlan];

	const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
	const buckets: WeightedChapter[][] = Array.from({ length: effectiveShards }, () => []);
	let shardIdx = 0;
	let cumWeight = 0;

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const remainingItems = items.length - i;
		const remainingShardsAfterCurrent = effectiveShards - 1 - shardIdx;

		if (
			shardIdx < effectiveShards - 1 &&
			buckets[shardIdx].length > 0 &&
			(remainingItems <= remainingShardsAfterCurrent ||
				cumWeight + item.weight / 2 >= ((shardIdx + 1) * totalWeight) / effectiveShards)
		) {
			shardIdx++;
		}
		buckets[shardIdx].push(item);
		cumWeight += item.weight;
	}

	return buckets
		.filter((bucket) => bucket.length > 0)
		.map((bucket) => {
			const chaptersByBook: Record<string, number[]> = {};
			const books: BookMeta[] = [];
			const seenBooks = new Set<string>();
			for (const entry of bucket) {
				const usfm = entry.book.usfm;
				if (!seenBooks.has(usfm)) {
					seenBooks.add(usfm);
					books.push(bookByUsfm.get(usfm) ?? entry.book);
					chaptersByBook[usfm] = [];
				}
				chaptersByBook[usfm].push(entry.chapter);
			}
			return {
				books,
				chaptersByBook,
				totalSelectedChapters: bucket.length,
				pendingChapters: bucket.length,
				skippedChapters: 0,
			};
		});
}

export function formatShardSummary(shard: JobPlan): string {
	const usfms = Object.keys(shard.chaptersByBook);
	if (usfms.length === 0) return "0 chapters";
	if (usfms.length === 1) {
		const usfm = usfms[0];
		const chs = shard.chaptersByBook[usfm];
		const range = chs.length === 1 ? `${chs[0]}` : `${chs[0]}-${chs[chs.length - 1]}`;
		return `${shard.pendingChapters} ch (${usfm} ${range})`;
	}
	const firstUsfm = usfms[0];
	const lastUsfm = usfms[usfms.length - 1];
	const firstChs = shard.chaptersByBook[firstUsfm];
	const lastChs = shard.chaptersByBook[lastUsfm];
	return `${shard.pendingChapters} ch across ${usfms.length} book(s) (${firstUsfm}:${firstChs[0]}..${lastUsfm}:${lastChs[lastChs.length - 1]})`;
}

export function mergeBookTimingsPayload(
	existing: Record<string, unknown> | null,
	incoming: Record<string, unknown>,
	usfm: string,
): Record<string, unknown> {
	const existingChapters =
		existing && typeof existing.chapters === "object" && existing.chapters !== null
			? (existing.chapters as Record<string, unknown>)
			: {};
	const incomingChapters =
		typeof incoming.chapters === "object" && incoming.chapters !== null
			? (incoming.chapters as Record<string, unknown>)
			: {};

	const mergedChapters: Record<string, unknown> = { ...existingChapters, ...incomingChapters };
	const sortedChapters: Record<string, unknown> = {};
	for (const key of Object.keys(mergedChapters).sort((a, b) => Number(a) - Number(b))) {
		sortedChapters[key] = mergedChapters[key];
	}

	return {
		translationId: "krv",
		audioSource: SUPERTONIC_TRACK_ID,
		usfm,
		chapters: sortedChapters,
	};
}

export function mergeGenerationReportPayload(
	existing: Record<string, unknown> | null,
	incoming: Record<string, unknown>,
): Record<string, unknown> {
	const base = existing && typeof existing === "object" ? { ...existing } : {};
	const existingChapters =
		typeof base.chapters === "object" && base.chapters !== null
			? (base.chapters as Record<string, unknown>)
			: {};
	const incomingChapters =
		typeof incoming.chapters === "object" && incoming.chapters !== null
			? (incoming.chapters as Record<string, unknown>)
			: {};

	const merged: Record<string, unknown> = {
		...base,
		chapters: { ...existingChapters, ...incomingChapters },
	};
	if (incoming.summary !== undefined) merged.summary = incoming.summary;
	return merged;
}

export async function mergePulledOutputs(
	pullRoot: string,
	paths: OutputPaths,
	allowedUsfms: ReadonlySet<string>,
	mergeExistingReport: boolean,
): Promise<{ mp3Count: number; timingCount: number; mergedReport: boolean }> {
	let mp3Count = 0;
	let timingCount = 0;
	let mergedReport = false;

	const pulledAudioDir = join(pullRoot, "audio");
	try {
		for (const entry of await readdir(pulledAudioDir, { withFileTypes: true })) {
			if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
			const usfm = entry.name.toUpperCase();
			if (!VALID_USFM_SET.has(usfm) || !allowedUsfms.has(usfm)) continue;

			const srcBookDir = join(pulledAudioDir, entry.name);
			const dstBookDir = join(paths.localAudioDir, usfm);
			for (const fileEntry of await readdir(srcBookDir, { withFileTypes: true })) {
				if (fileEntry.isSymbolicLink() || !fileEntry.isFile()) continue;
				const match = MP3_NAME_RE.exec(fileEntry.name);
				if (!match) continue;
				await atomicCopyFile(join(srcBookDir, fileEntry.name), join(dstBookDir, `${match[1]}.mp3`));
				mp3Count++;
			}
		}
	} catch {
		// no audio dir pulled
	}

	const pulledTimingsDir = join(pullRoot, "timings");
	try {
		for (const entry of await readdir(pulledTimingsDir, { withFileTypes: true })) {
			if (entry.isSymbolicLink() || !entry.isFile()) continue;
			const match = TIMINGS_FILE_RE.exec(entry.name);
			if (!match) continue;
			const usfm = match[1];
			if (!VALID_USFM_SET.has(usfm) || !allowedUsfms.has(usfm)) continue;

			const incoming = JSON.parse(
				await readFile(join(pulledTimingsDir, entry.name), "utf8"),
			) as Record<string, unknown>;
			const dstPath = join(paths.localTimingsDir, `${usfm}.json`);
			const existing = await readJsonIfExists<Record<string, unknown>>(dstPath);
			await atomicWriteJson(dstPath, mergeBookTimingsPayload(existing, incoming, usfm), false);
			timingCount++;
		}
	} catch {
		// no timings dir pulled
	}

	const pulledReportFile = join(pullRoot, "report.json");
	const incomingReport = await readJsonIfExists<Record<string, unknown>>(pulledReportFile);
	if (incomingReport) {
		const existingReport =
			paths.mode === "production" || mergeExistingReport
				? await readJsonIfExists<Record<string, unknown>>(paths.localReportPath)
				: null;
		await atomicWriteJson(
			paths.localReportPath,
			mergeGenerationReportPayload(existingReport, incomingReport),
			true,
		);
		mergedReport = true;
	}

	return { mp3Count, timingCount, mergedReport };
}

async function printStagingComparison(
	jobPlan: JobPlan,
	paths: OutputPaths,
	rootDir: string,
): Promise<void> {
	const prodTimingsDir = join(rootDir, KRV_TIMINGS_REL_DIR);
	const prodAudioDir = join(rootDir, KRV_AUDIO_REL_DIR);

	console.log(
		`\nStaging Parity Summary (${paths.stagingName ?? "staging"}) — production untouched:`,
	);
	for (const [usfm, chapters] of Object.entries(jobPlan.chaptersByBook)) {
		const readChapters = async (dir: string) =>
			(
				await readJsonIfExists<{ chapters?: Record<string, Record<string, number>> }>(
					join(dir, `${usfm}.json`),
				)
			)?.chapters ?? {};
		const [stagedMap, prodMap] = await Promise.all([
			readChapters(paths.localTimingsDir),
			readChapters(prodTimingsDir),
		]);

		for (const ch of chapters) {
			const stagedCh = stagedMap[String(ch)] ?? {};
			const prodCh = prodMap[String(ch)];
			const stagedCount = Object.keys(stagedCh).length;
			const stagedV1 = stagedCh["1"];
			const readSize = async (dir: string) => {
				try {
					return (await stat(join(dir, usfm, `${ch}.mp3`))).size;
				} catch {
					return 0;
				}
			};
			const stagedBytes = await readSize(paths.localAudioDir);
			if (prodCh) {
				const prodCount = Object.keys(prodCh).length;
				const prodV1 = prodCh["1"];
				const prodBytes = await readSize(prodAudioDir);
				const v1Delta =
					typeof stagedV1 === "number" && typeof prodV1 === "number"
						? `${(stagedV1 - prodV1).toFixed(3)}s`
						: "n/a";
				console.log(
					`  ${usfm}:${ch} — verses=${stagedCount}/${prodCount}, v1=${stagedV1 ?? "?"}s (delta ${v1Delta}), size=${Math.round(stagedBytes / 1024)} KB (prod ${Math.round(prodBytes / 1024)} KB)`,
				);
			} else {
				console.log(
					`  ${usfm}:${ch} — verses=${stagedCount}, v1=${stagedV1 ?? "?"}s, size=${Math.round(stagedBytes / 1024)} KB (no prod baseline)`,
				);
			}
		}
	}
}

export async function verifyAndSummarizeOutputs(
	jobPlan: JobPlan,
	paths: OutputPaths,
	rootDir: string,
): Promise<{ ok: boolean; errors: string[] }> {
	const errors: string[] = [];

	for (const [usfm, chapters] of Object.entries(jobPlan.chaptersByBook)) {
		const timingPath = join(paths.localTimingsDir, `${usfm}.json`);
		const parsed = await readJsonIfExists<{
			chapters?: Record<string, Record<string, number>>;
		}>(timingPath);
		if (!parsed) {
			errors.push(`Missing or unreadable timing file: ${timingPath}`);
			continue;
		}
		const timingChapters = parsed.chapters ?? {};

		for (const ch of chapters) {
			const mp3Path = join(paths.localAudioDir, usfm, `${ch}.mp3`);
			if (!(await isFileNonEmpty(mp3Path, 1025))) {
				errors.push(`Missing or too-small MP3: ${mp3Path}`);
			}
			const chTimings = timingChapters[String(ch)];
			if (!chTimings || Object.keys(chTimings).length === 0) {
				errors.push(`Missing verse timings for ${usfm}:${ch} in ${timingPath}`);
				continue;
			}
			let prev = -1;
			for (const verseKey of Object.keys(chTimings).sort((a, b) => Number(a) - Number(b))) {
				const sec = chTimings[verseKey];
				if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= prev) {
					errors.push(`Non-monotonic timing in ${usfm}:${ch} v.${verseKey}: ${sec}`);
					break;
				}
				prev = sec;
			}
		}
	}

	if (paths.mode === "staging") {
		await printStagingComparison(jobPlan, paths, rootDir);
	}

	return { ok: errors.length === 0, errors };
}
