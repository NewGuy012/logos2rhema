import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs as parseCliArgs } from "node:util";

import { BIBLE_BOOKS, getBookByUsfm } from "../src/shared/books";

const ROOT_DIR = join(import.meta.dir, "..");
const CACHE_DIR = join(ROOT_DIR, ".cache");
const AUDIO_CACHE_DIR = join(CACHE_DIR, "krv-supertonic-audio");
const CHECKPOINT_PATH = join(CACHE_DIR, "krv-r2-uploaded.json");

const DEFAULT_BUCKET = "logos-krv-audio";
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_RETRIES = 2;
const CACHE_CONTROL_VALUE = "public, max-age=31536000, immutable";
const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

interface UploadOptions {
	bucket: string;
	book?: string;
	concurrency: number;
	retries: number;
	dryRun: boolean;
	force: boolean;
}

interface AudioUploadItem {
	key: string;
	filePath: string;
	size: number;
	mtimeMs: number;
}

interface CheckpointEntry {
	size: number;
	mtimeMs: number;
	uploadedAt: string;
}

interface CheckpointData {
	version: 1;
	buckets: Record<string, Record<string, CheckpointEntry>>;
}

function printUsage(): void {
	console.log(`Usage: bun run audio:upload-krv [options]

Options:
  --dry-run             Show what would be uploaded without calling Wrangler
  --book <USFM>         Upload a single canonical book (e.g. PHM, GEN, PSA)
  --bucket <name>       Target R2 bucket name (default: ${DEFAULT_BUCKET})
  --concurrency <N>     Max parallel wrangler uploads, 1-32 (default: ${DEFAULT_CONCURRENCY})
  --retries <N>         Retries per failed upload, 0-10 (default: ${DEFAULT_RETRIES})
  --force               Re-upload files even if recorded in ${CHECKPOINT_PATH}
  -h, --help            Show this help message`);
}

function parseIntInRange(raw: string, flag: string, min: number, max: number): number {
	if (!/^\d+$/.test(raw)) {
		throw new Error(`Invalid value for ${flag}: "${raw}" (expected integer ${min}-${max})`);
	}
	const value = Number.parseInt(raw, 10);
	if (value < min || value > max) {
		throw new Error(`Out-of-range value for ${flag}: ${value} (expected ${min}-${max})`);
	}
	return value;
}

function parseArgs(argv: string[]): UploadOptions | null {
	const { values } = parseCliArgs({
		args: argv,
		options: {
			help: { type: "boolean", short: "h" },
			"dry-run": { type: "boolean" },
			force: { type: "boolean" },
			book: { type: "string" },
			bucket: { type: "string" },
			concurrency: { type: "string" },
			retries: { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});
	if (values.help) {
		printUsage();
		return null;
	}

	let book: string | undefined;
	if (values.book !== undefined) {
		const found = getBookByUsfm(values.book.trim());
		if (!found) throw new Error(`Unknown book USFM code: "${values.book}"`);
		book = found.usfm;
	}

	const bucket = values.bucket !== undefined ? values.bucket.trim() : DEFAULT_BUCKET;
	if (!BUCKET_NAME_RE.test(bucket)) {
		throw new Error(`Invalid R2 bucket name: "${bucket}"`);
	}

	return {
		bucket,
		book,
		concurrency:
			values.concurrency !== undefined
				? parseIntInRange(values.concurrency.trim(), "--concurrency", 1, 32)
				: DEFAULT_CONCURRENCY,
		retries:
			values.retries !== undefined
				? parseIntInRange(values.retries.trim(), "--retries", 0, 10)
				: DEFAULT_RETRIES,
		dryRun: Boolean(values["dry-run"]),
		force: Boolean(values.force),
	};
}

function formatBytes(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
	if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${bytes} B`;
}

async function scanAudioFiles(bookFilter?: string): Promise<{
	items: AudioUploadItem[];
	expectedCount: number;
	missingKeys: string[];
}> {
	const books = bookFilter ? BIBLE_BOOKS.filter((b) => b.usfm === bookFilter) : BIBLE_BOOKS;
	const items: AudioUploadItem[] = [];
	const missingKeys: string[] = [];
	let expectedCount = 0;

	for (const book of books) {
		for (let chapter = 1; chapter <= book.chapters; chapter++) {
			expectedCount++;
			const key = `${book.usfm}/${chapter}.mp3`;
			const filePath = join(AUDIO_CACHE_DIR, book.usfm, `${chapter}.mp3`);
			try {
				const info = await stat(filePath);
				if (info.isFile() && info.size > 0) {
					items.push({ key, filePath, size: info.size, mtimeMs: Math.trunc(info.mtimeMs) });
					continue;
				}
			} catch {}
			missingKeys.push(key);
		}
	}

	return { items, expectedCount, missingKeys };
}

async function loadCheckpoint(): Promise<CheckpointData> {
	const file = Bun.file(CHECKPOINT_PATH);
	if (!(await file.exists())) {
		return { version: 1, buckets: {} };
	}
	try {
		const parsed = (await file.json()) as Partial<CheckpointData>;
		if (
			parsed &&
			parsed.version === 1 &&
			parsed.buckets &&
			typeof parsed.buckets === "object" &&
			!Array.isArray(parsed.buckets)
		) {
			return { version: 1, buckets: parsed.buckets };
		}
	} catch {
		console.warn(`Warning: ignoring unreadable checkpoint at ${CHECKPOINT_PATH}`);
	}
	return { version: 1, buckets: {} };
}

let checkpointSaveChain: Promise<void> = Promise.resolve();

function saveCheckpoint(data: CheckpointData): Promise<void> {
	checkpointSaveChain = checkpointSaveChain
		.catch(() => {})
		.then(async () => {
			await mkdir(CACHE_DIR, { recursive: true });
			const tmpPath = `${CHECKPOINT_PATH}.${process.pid}.tmp`;
			try {
				await Bun.write(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
				await rename(tmpPath, CHECKPOINT_PATH);
			} catch (err) {
				await rm(tmpPath, { force: true }).catch(() => {});
				throw err;
			}
		});
	return checkpointSaveChain;
}

async function resolveWranglerRunner(): Promise<{ cmd: string[]; env: Record<string, string> }> {
	const bunDir = dirname(process.execPath);
	const currentPath = process.env.PATH ?? "";
	const pathWithBun = currentPath.split(":").includes(bunDir)
		? currentPath
		: `${bunDir}:${currentPath}`;
	const env = { ...process.env, PATH: pathWithBun } as Record<string, string>;

	const bunxInSameDir = join(bunDir, "bunx");
	const bunxBin =
		Bun.which("bunx") ?? ((await Bun.file(bunxInSameDir).exists()) ? bunxInSameDir : "");
	const cmd = bunxBin ? [bunxBin, "wrangler"] : [process.execPath, "x", "wrangler"];
	return { cmd, env };
}

function buildWranglerPutArgs(bucket: string, item: AudioUploadItem): string[] {
	return [
		"r2",
		"object",
		"put",
		`${bucket}/${item.key}`,
		"--file",
		item.filePath,
		"--remote",
		"--content-type",
		"audio/mpeg",
		"--cache-control",
		CACHE_CONTROL_VALUE,
	];
}

function isAuthError(output: string): boolean {
	const lower = output.toLowerCase();
	return (
		lower.includes("wrangler login") ||
		lower.includes("not authenticated") ||
		lower.includes("not logged in") ||
		lower.includes("authentication error")
	);
}

async function putObjectOnce(
	runner: { cmd: string[]; env: Record<string, string> },
	bucket: string,
	item: AudioUploadItem,
): Promise<{ ok: boolean; output: string }> {
	const proc = Bun.spawn([...runner.cmd, ...buildWranglerPutArgs(bucket, item)], {
		cwd: ROOT_DIR,
		env: runner.env,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
	return { ok: exitCode === 0, output };
}

async function putObjectWithRetries(
	runner: { cmd: string[]; env: Record<string, string> },
	bucket: string,
	item: AudioUploadItem,
	retries: number,
): Promise<{ ok: boolean; attempts: number; output: string; authError: boolean }> {
	let lastOutput = "";
	for (let attempt = 1; attempt <= retries + 1; attempt++) {
		const res = await putObjectOnce(runner, bucket, item);
		if (res.ok) {
			return { ok: true, attempts: attempt, output: res.output, authError: false };
		}
		lastOutput = res.output;
		if (isAuthError(lastOutput)) {
			return { ok: false, attempts: attempt, output: lastOutput, authError: true };
		}
		if (attempt <= retries) {
			await Bun.sleep(attempt * 500);
		}
	}
	return { ok: false, attempts: retries + 1, output: lastOutput, authError: false };
}

async function main(): Promise<void> {
	let options: UploadOptions | null;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		printUsage();
		process.exitCode = 1;
		return;
	}
	if (!options) return;

	const { items, expectedCount, missingKeys } = await scanAudioFiles(options.book);
	if (items.length === 0) {
		console.error(`No MP3 files found under ${AUDIO_CACHE_DIR}.`);
		process.exitCode = 1;
		return;
	}

	const checkpoint = await loadCheckpoint();
	const bucketMap = Object.hasOwn(checkpoint.buckets, options.bucket)
		? checkpoint.buckets[options.bucket]
		: (checkpoint.buckets[options.bucket] = {});

	const pending = options.force
		? items
		: items.filter((item) => {
				const recorded = Object.hasOwn(bucketMap, item.key) ? bucketMap[item.key] : undefined;
				return !recorded || recorded.size !== item.size || recorded.mtimeMs !== item.mtimeMs;
			});

	const skippedCount = items.length - pending.length;
	const pendingBytes = pending.reduce((sum, item) => sum + item.size, 0);
	const totalBytes = items.reduce((sum, item) => sum + item.size, 0);

	console.log(
		`Bucket: ${options.bucket} | Found: ${items.length}/${expectedCount} MP3s (${formatBytes(totalBytes)}) | Skipped (checkpoint): ${skippedCount} | Pending: ${pending.length} (${formatBytes(pendingBytes)})`,
	);
	if (missingKeys.length > 0) {
		console.warn(
			`Warning: ${missingKeys.length} expected chapter(s) missing locally (first: ${missingKeys.slice(0, 5).join(", ")})`,
		);
	}

	if (pending.length === 0) {
		console.log("All found chapters are already uploaded in the local checkpoint.");
		return;
	}

	if (options.dryRun) {
		const sampleCount = options.book ? pending.length : Math.min(5, pending.length);
		console.log(
			`Dry run (concurrency=${options.concurrency}, retries=${options.retries}). Sample command(s):`,
		);
		for (const item of pending.slice(0, sampleCount)) {
			const formattedArgs = buildWranglerPutArgs(options.bucket, item).map((part) =>
				/\s/.test(part) ? JSON.stringify(part) : part,
			);
			console.log(`  bunx wrangler ${formattedArgs.join(" ")}`);
		}
		if (pending.length > sampleCount) {
			console.log(`  ...and ${pending.length - sampleCount} more file(s).`);
		}
		return;
	}

	const runner = await resolveWranglerRunner();
	let nextIdx = 0;
	let uploadedCount = 0;
	let failedCount = 0;
	let stopRequested = false;
	let authAborted = false;

	const handleSignal = () => {
		if (!stopRequested) {
			stopRequested = true;
			console.warn("\nStopping gracefully after in-flight uploads and saving checkpoint...");
		}
	};
	process.on("SIGINT", handleSignal);
	process.on("SIGTERM", handleSignal);

	const runWorker = async () => {
		while (!stopRequested) {
			const idx = nextIdx++;
			if (idx >= pending.length) return;
			const item = pending[idx];
			const result = await putObjectWithRetries(runner, options.bucket, item, options.retries);
			if (result.ok) {
				uploadedCount++;
				bucketMap[item.key] = {
					size: item.size,
					mtimeMs: item.mtimeMs,
					uploadedAt: new Date().toISOString(),
				};
				if (uploadedCount % 10 === 0) {
					await saveCheckpoint(checkpoint);
				}
				console.log(
					`[${uploadedCount + failedCount}/${pending.length}] Uploaded ${item.key} (${formatBytes(item.size)})`,
				);
			} else {
				failedCount++;
				console.error(
					`[${uploadedCount + failedCount}/${pending.length}] Failed ${item.key} after ${result.attempts} attempt(s):\n${result.output}`,
				);
				if (result.authError) {
					authAborted = true;
					stopRequested = true;
					return;
				}
			}
		}
	};

	try {
		const workerCount = Math.min(options.concurrency, pending.length);
		await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
	} finally {
		process.off("SIGINT", handleSignal);
		process.off("SIGTERM", handleSignal);
		await saveCheckpoint(checkpoint);
	}

	console.log(
		`Done: ${uploadedCount} uploaded, ${failedCount} failed, ${skippedCount} skipped via checkpoint.`,
	);
	if (authAborted) {
		console.error("Run `bunx wrangler login` first, then re-run `bun run audio:upload-krv`.");
	}
	if (failedCount > 0 || stopRequested) {
		process.exitCode = 1;
	}
}

await main();
