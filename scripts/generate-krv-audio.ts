import { join } from "node:path";

import {
	type CliOptions,
	type CommandRunner,
	createDefaultCommandRunner,
	getUsageText,
	loadDevVarsRecord,
	parseCliOptions,
	resolveOutputPaths,
	resolveUvBinary,
	runRemoteWorkflow,
	selectBooksForOptions,
} from "./lib/remote-tts";

const ROOT_DIR = join(import.meta.dir, "..");
const PYTHON_SCRIPT_PATH = join(ROOT_DIR, "scripts", "generate-krv-audio.py");
const UPLOAD_SCRIPT_PATH = join(ROOT_DIR, "scripts", "upload-krv-audio.ts");

function buildLocalPythonArgs(options: CliOptions, rootDir: string): string[] {
	const args = ["run", PYTHON_SCRIPT_PATH];

	if (options.books && options.books.length > 0) {
		args.push("--books", options.books.join(","));
	} else if (options.testament) {
		args.push("--testament", options.testament);
	} else if (options.all) {
		args.push("--all");
	}

	if (options.chapters && options.chapters.length > 0) {
		args.push("--chapters", options.chapters.join(","));
	}

	args.push(
		"--device",
		options.device,
		"--voice",
		options.voice,
		"--speed",
		String(options.speed),
		"--steps",
		String(options.steps),
		"--pause",
		String(options.pause),
		"--header-pause",
		String(options.headerPause),
		"--bitrate",
		String(options.bitrate),
		"--workers",
		String(options.workers),
		"--threads",
		String(options.threads),
	);

	if (options.staging !== undefined || options.outDir !== undefined) {
		const paths = resolveOutputPaths(options, rootDir);
		args.push(
			"--audio-dir",
			paths.localAudioDir,
			"--timings-dir",
			paths.localTimingsDir,
			"--report-path",
			paths.localReportPath,
		);
	}

	if (options.force) args.push("--force");
	if (options.dryRun) args.push("--dry-run");
	return args;
}

function buildUploadArgs(options: CliOptions): string[] {
	const args = ["run", UPLOAD_SCRIPT_PATH];
	if (options.books && options.books.length > 0) {
		args.push("--books", options.books.join(","));
	} else if (options.testament) {
		const usfms = selectBooksForOptions(options).map((b) => b.usfm);
		args.push("--books", usfms.join(","));
	}
	if (options.r2Bucket) {
		args.push("--bucket", options.r2Bucket);
	}
	return args;
}

export async function runCli(
	argv: readonly string[],
	rootDir = ROOT_DIR,
	runner: CommandRunner = createDefaultCommandRunner(),
): Promise<number> {
	const devVars = await loadDevVarsRecord(join(rootDir, ".dev.vars"));
	const mergedEnv: Record<string, string | undefined> = { ...devVars, ...process.env };

	let options: CliOptions;
	try {
		options = parseCliOptions(argv, mergedEnv);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		console.error("");
		console.error(getUsageText());
		return 1;
	}

	if (options.help) {
		console.log(getUsageText());
		return 0;
	}

	let exitCode: number;
	if (options.remote) {
		try {
			exitCode = await runRemoteWorkflow(options, rootDir, runner);
		} catch (err) {
			console.error(err instanceof Error ? err.message : String(err));
			return 1;
		}
	} else {
		if (options.deleteAfter || options.gpu || options.template || options.mode) {
			console.error(
				"Thunder Compute VM options (--delete-after, --gpu, --template, --mode) require --thunder <id>, --ssh <target>, or --remote.",
			);
			return 1;
		}
		const uvBin = resolveUvBinary(runner);
		if (!uvBin) {
			console.error("`uv` not found in PATH. Install uv (e.g. `brew install uv`) first.");
			return 1;
		}
		const res = await runner.runStreaming(uvBin, buildLocalPythonArgs(options, rootDir), {
			cwd: rootDir,
		});
		exitCode = res.exitCode;
	}

	if (exitCode === 0 && options.upload) {
		console.log("\nRunning explicit R2 upload (`--upload`)...");
		const uploadRes = await runner.runStreaming(process.execPath, buildUploadArgs(options), {
			cwd: rootDir,
		});
		return uploadRes.exitCode;
	}

	return exitCode;
}

if (import.meta.main) {
	process.exitCode = await runCli(process.argv.slice(2));
}
