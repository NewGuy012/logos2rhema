import { join } from "node:path";

import { loadDevVarsRecord, ROOT_DIR } from "./lib/common";
import { runRemoteWorkflow } from "./lib/remote-tts";
import { type CommandRunner, createDefaultCommandRunner, resolveUvBinary } from "./lib/ssh-session";
import { type CliOptions, getUsageText, parseCliOptions, resolveOutputPaths } from "./lib/tts-cli";

const PYTHON_SCRIPT_PATH = join(ROOT_DIR, "scripts", "generate-krv-audio.py");

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

	args.push("--device", "cpu", ...options.synthArgs);

	if (options.staging !== undefined) {
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

export async function runCli(
	argv: readonly string[],
	rootDir = ROOT_DIR,
	runner: CommandRunner = createDefaultCommandRunner(),
): Promise<number> {
	const devVars = await loadDevVarsRecord(join(rootDir, ".dev.vars"));
	const mergedEnv: Record<string, string | undefined> = { ...devVars, ...process.env };

	let options: CliOptions | null;
	try {
		options = parseCliOptions(argv, mergedEnv);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		console.error("");
		console.error(getUsageText());
		return 1;
	}

	if (!options) {
		console.log(getUsageText());
		return 0;
	}

	if (options.remote) {
		try {
			return await runRemoteWorkflow(options, rootDir, runner);
		} catch (err) {
			console.error(err instanceof Error ? err.message : String(err));
			return 1;
		}
	}

	const uvBin = resolveUvBinary(runner);
	if (!uvBin) {
		console.error("`uv` not found in PATH. Install uv (e.g. `brew install uv`) first.");
		return 1;
	}
	const res = await runner.runStreaming(uvBin, buildLocalPythonArgs(options, rootDir), {
		cwd: rootDir,
	});
	return res.exitCode;
}

if (import.meta.main) {
	process.exitCode = await runCli(process.argv.slice(2));
}
