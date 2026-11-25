import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createSerialLock, ROOT_DIR } from "./common";
import {
	type CommandRunner,
	createDefaultCommandRunner,
	quotePosix,
	remoteDirBashExpr,
	type RemoteHardwareProbe,
	type RemoteSession,
	resolveThunderEndpoint,
	selectOnnxGpuSpec,
	type SshEndpoint,
	withRemoteSession,
} from "./ssh-session";
import {
	deleteThunderInstance,
	requireTnrBinary,
	resolveThunderInstances,
	THUNDER_VM_SPEC,
	type ThunderInstanceInfo,
} from "./thunder";
import {
	type CliOptions,
	makeRemoteRunPaths,
	type OutputPaths,
	parseCommaList,
	resolveOutputPaths,
} from "./tts-cli";
import {
	buildPendingJobPlan,
	chooseOptimalShards,
	formatShardSummary,
	type JobPlan,
	mergePulledOutputs,
	partitionJobPlan,
	verifyAndSummarizeOutputs,
} from "./tts-plan";

interface ShardExecutionResult {
	exitCode: number;
	pullCompletedCleanly: boolean;
	synthesisErrors: boolean;
	mp3Count: number;
	timingCount: number;
}

const NOOP_SHARD_RESULT: ShardExecutionResult = {
	exitCode: 0,
	pullCompletedCleanly: true,
	synthesisErrors: false,
	mp3Count: 0,
	timingCount: 0,
};

function deriveShardOutputPaths(basePaths: OutputPaths, shardNumber: number): OutputPaths {
	return {
		...basePaths,
		...makeRemoteRunPaths(
			basePaths.remoteBaseDir,
			`${basePaths.remoteRunDir}/shard-${shardNumber}`,
		),
	};
}

async function stageAndUploadInputs(
	session: RemoteSession,
	jobPlan: JobPlan,
	paths: OutputPaths,
	rootDir: string,
	logPrefix: string,
): Promise<void> {
	const remoteRunExpr = remoteDirBashExpr(paths.remoteRunDir);
	const prep = await session.exec(
		`mkdir -p ${remoteRunExpr}/scripts ${remoteRunExpr}/src/shared ${remoteRunExpr}/public/data/bibles/krv ${remoteRunExpr}/out/audio ${remoteRunExpr}/out/timings`,
	);
	if (prep.exitCode !== 0) {
		throw new Error(
			`${logPrefix}Failed to prepare remote run directory ${paths.remoteRunDir}: ${prep.stderr.trim()}`,
		);
	}

	const cacheParent = join(rootDir, ".cache");
	await mkdir(cacheParent, { recursive: true });
	const inputStageDir = await mkdtemp(join(cacheParent, ".remote-push-"));
	try {
		await mkdir(join(inputStageDir, "scripts"), { recursive: true });
		await mkdir(join(inputStageDir, "src", "shared"), { recursive: true });
		await mkdir(join(inputStageDir, "public", "data", "bibles", "krv"), { recursive: true });

		await cp(
			join(rootDir, "scripts", "generate-krv-audio.py"),
			join(inputStageDir, "scripts", "generate-krv-audio.py"),
		);
		await cp(
			join(rootDir, "src", "shared", "books.ts"),
			join(inputStageDir, "src", "shared", "books.ts"),
		);
		for (const usfm of Object.keys(jobPlan.chaptersByBook)) {
			await cp(
				join(rootDir, "public", "data", "bibles", "krv", `${usfm}.json`),
				join(inputStageDir, "public", "data", "bibles", "krv", `${usfm}.json`),
			);
		}
		await writeFile(
			join(inputStageDir, "job-manifest.json"),
			`${JSON.stringify({ books: jobPlan.chaptersByBook }, null, 2)}\n`,
			"utf8",
		);

		console.log(
			`${logPrefix}Uploading ${Object.keys(jobPlan.chaptersByBook).length} book JSON(s) + generator to ${paths.remoteRunDir} (rsync)...`,
		);
		await session.uploadDir(inputStageDir, paths.remoteRunDir);
	} finally {
		await rm(inputStageDir, { recursive: true, force: true }).catch(() => {});
	}
}

async function bootstrapRemoteEnv(
	session: RemoteSession,
	paths: OutputPaths,
	probe: RemoteHardwareProbe,
	verbose: boolean,
	logPrefix: string,
): Promise<void> {
	if (!probe.hasNvidiaGpu) {
		throw new Error(
			`${logPrefix}Expected an NVIDIA CUDA GPU on ${session.endpoint.target}, but \`nvidia-smi\` found none.`,
		);
	}

	const ortGpuSpec = selectOnnxGpuSpec(probe.cudaMajor);
	const fingerprint = JSON.stringify({
		ortGpuSpec,
		supertonic: "supertonic>=1.3",
		lameenc: "lameenc>=1.7",
		numpy: "numpy>=1.26",
	});
	const baseExpr = remoteDirBashExpr(paths.remoteBaseDir);
	const runExpr = remoteDirBashExpr(paths.remoteRunDir);
	const verboseFlag = verbose ? " --verbose" : "";

	const bootstrapScript = `
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
BASE_DIR=${baseExpr}
VENV_DIR="$BASE_DIR/.venv"
STAMP_FILE="$VENV_DIR/.logos-bootstrap.json"
WANT_FINGERPRINT=${quotePosix(fingerprint)}

mkdir -p "$BASE_DIR"

if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv on remote VM..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
fi

if [ -x "$VENV_DIR/bin/python" ] && [ -f "$STAMP_FILE" ] && [ "$(cat "$STAMP_FILE")" = "$WANT_FINGERPRINT" ]; then
  echo "Remote Python environment cache hit ($VENV_DIR)."
  CACHE_HIT=1
else
  CACHE_HIT=0
  echo "Provisioning remote Supertonic 3 CUDA environment..."
  uv venv --python 3.12 --allow-existing "$VENV_DIR" || uv venv --python 3.13 --allow-existing "$VENV_DIR" || uv venv --allow-existing "$VENV_DIR"
  uv pip install --python "$VENV_DIR/bin/python" --upgrade "supertonic>=1.3" "lameenc>=1.7" "numpy>=1.26"
  uv pip uninstall --python "$VENV_DIR/bin/python" onnxruntime || true
  uv pip install --python "$VENV_DIR/bin/python" --upgrade ${quotePosix(ortGpuSpec)}
  printf '%s' "$WANT_FINGERPRINT" > "$STAMP_FILE"
fi

MODEL_CACHE_DIR="\${SUPERTONIC_CACHE_DIR:-$HOME/.cache/supertonic3}"
if [ "$CACHE_HIT" -eq 0 ] || [ ! -f "$MODEL_CACHE_DIR/onnx/vocoder.onnx" ]; then
  echo "Verifying remote CUDA ONNX Runtime & Supertonic 3 weights..."
  "$VENV_DIR/bin/python" -u ${runExpr}/scripts/generate-krv-audio.py --verify-env --device cuda${verboseFlag}
fi
`;

	console.log(
		`${logPrefix}Bootstrapping remote environment at ${paths.remoteBaseDir} (CUDA (${ortGpuSpec}))...`,
	);
	const res = await session.execStreaming(bootstrapScript, {
		logPrefix: logPrefix || undefined,
	});
	if (res.exitCode !== 0) {
		throw new Error(`${logPrefix}Remote CUDA bootstrap failed (exit ${res.exitCode}).`);
	}
}

async function pullAndMergeOutputs(
	session: RemoteSession,
	paths: OutputPaths,
	rootDir: string,
	allowedUsfms: ReadonlySet<string>,
	withMergeLock?: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<{ mp3Count: number; timingCount: number; mergedReport: boolean }> {
	const cacheParent = join(rootDir, ".cache");
	await mkdir(cacheParent, { recursive: true });
	const pullTmp = await mkdtemp(join(cacheParent, ".remote-pull-"));
	try {
		await session.downloadDir(paths.remoteAudioDir, join(pullTmp, "audio"), { compress: false });
		await session.downloadDir(paths.remoteTimingsDir, join(pullTmp, "timings"), { compress: true });
		const reportRes = await session.exec(
			`[ -f ${remoteDirBashExpr(paths.remoteReportPath)} ] && cat ${remoteDirBashExpr(paths.remoteReportPath)} || true`,
		);
		if (reportRes.exitCode === 0 && reportRes.stdout.trim()) {
			await writeFile(join(pullTmp, "report.json"), reportRes.stdout, "utf8");
		}
		const doMerge = () => mergePulledOutputs(pullTmp, paths, allowedUsfms, Boolean(withMergeLock));
		return withMergeLock ? await withMergeLock(doMerge) : await doMerge();
	} finally {
		await rm(pullTmp, { recursive: true, force: true }).catch(() => {});
	}
}

async function executeRemoteShard(ctx: {
	options: CliOptions;
	paths: OutputPaths;
	jobPlan: JobPlan;
	rootDir: string;
	runner: CommandRunner;
	instance: ThunderInstanceInfo;
	endpoint: SshEndpoint;
	freshVm: boolean;
	logPrefix: string;
	registerKill: (kill: () => void) => () => void;
	isInterrupted: () => boolean;
	withMergeLock?: <T>(fn: () => Promise<T>) => Promise<T>;
}): Promise<ShardExecutionResult> {
	const {
		options,
		paths,
		jobPlan,
		rootDir,
		runner,
		instance,
		endpoint,
		freshVm,
		logPrefix,
		registerKill,
		isInterrupted,
		withMergeLock,
	} = ctx;

	return withRemoteSession(
		{ runner, endpoint, instanceId: instance.id, freshVm, logPrefix },
		async (session) => {
			const probe = await session.probe();
			const gpuLabel = probe.gpuName ?? "none";
			console.log(
				`${logPrefix}Remote host: ${probe.os} ${probe.arch}, ${probe.cpuCount} vCPU(s), ` +
					`GPU=${gpuLabel}${probe.cudaMajor ? ` (CUDA ${probe.cudaMajor}.x)` : ""}`,
			);

			if (options.dryRun) {
				console.log(
					`${logPrefix}Dry-run complete. Transport=${endpoint.target}, remoteDir=${paths.remoteRunDir}, localAudioDir=${paths.localAudioDir}.`,
				);
				return NOOP_SHARD_RESULT;
			}

			await stageAndUploadInputs(session, jobPlan, paths, rootDir, logPrefix);
			await bootstrapRemoteEnv(
				session,
				paths,
				probe,
				options.synthArgs.includes("--verbose"),
				logPrefix,
			);

			const runExpr = remoteDirBashExpr(paths.remoteRunDir);
			const baseExpr = remoteDirBashExpr(paths.remoteBaseDir);
			const pythonArgs = [
				`${runExpr}/scripts/generate-krv-audio.py`,
				"--job-manifest",
				`${runExpr}/job-manifest.json`,
				"--audio-dir",
				remoteDirBashExpr(paths.remoteAudioDir),
				"--timings-dir",
				remoteDirBashExpr(paths.remoteTimingsDir),
				"--report-path",
				remoteDirBashExpr(paths.remoteReportPath),
				"--device",
				"cuda",
				...options.synthArgs.map(quotePosix),
				...(options.force ? ["--force"] : []),
			];

			const remoteRunScript = `
set -euo pipefail
export PYTHONUNBUFFERED=1
exec ${baseExpr}/.venv/bin/python -u ${pythonArgs.join(" ")}
`;

			let runExit = 0;
			let unregisterKill: (() => void) | undefined;
			try {
				const res = await session.execStreaming(remoteRunScript, {
					logPrefix: logPrefix || undefined,
					onChild: (kill) => {
						unregisterKill = registerKill(kill);
					},
				});
				runExit = res.exitCode;
			} finally {
				unregisterKill?.();
			}

			// Pull outputs even on partial/interrupted runs so finished chapters aren't lost.
			console.log(`${logPrefix}Pulling generated MP3s and timings from ${paths.remoteRunDir}...`);
			const allowedUsfms = new Set(Object.keys(jobPlan.chaptersByBook));
			const merged = await pullAndMergeOutputs(
				session,
				paths,
				rootDir,
				allowedUsfms,
				withMergeLock,
			);
			console.log(
				`${logPrefix}Synced ${merged.mp3Count} MP3(s), ${merged.timingCount} timing file(s)` +
					`${merged.mergedReport ? ", and report" : ""} to ${paths.localAudioDir}.`,
			);

			const synthesisErrors = runExit !== 0 || isInterrupted();
			return {
				exitCode: synthesisErrors ? runExit || 1 : 0,
				pullCompletedCleanly: true,
				synthesisErrors,
				mp3Count: merged.mp3Count,
				timingCount: merged.timingCount,
			};
		},
	);
}

export async function runRemoteWorkflow(
	options: CliOptions,
	rootDir = ROOT_DIR,
	runner: CommandRunner = createDefaultCommandRunner(),
): Promise<number> {
	const remote = options.remote;
	if (!remote) {
		throw new Error("runRemoteWorkflow requires remote options.");
	}

	const startedAt = Date.now();
	const paths = resolveOutputPaths(options, rootDir);

	const jobPlan = await buildPendingJobPlan(options, paths);
	console.log(
		`Plan [${paths.mode}${paths.stagingName ? `:${paths.stagingName}` : ""}]: ` +
			`${jobPlan.books.length} book(s), ${jobPlan.totalSelectedChapters} chapter(s) ` +
			`(${jobPlan.pendingChapters} pending, ${jobPlan.skippedChapters} already local).`,
	);

	if (jobPlan.pendingChapters === 0 && !options.dryRun) {
		console.log("All selected chapters are already generated locally. Use --force to regenerate.");
		return 0;
	}

	const explicitThunderCount = remote.thunder ? parseCommaList(remote.thunder).length : 0;
	const targetShardCount =
		remote.shards ??
		(explicitThunderCount > 0
			? explicitThunderCount
			: remote.create
				? chooseOptimalShards(jobPlan.pendingChapters)
				: 1);

	const shardPlans = await partitionJobPlan(jobPlan, targetShardCount, rootDir);
	if (shardPlans.length === 0) {
		console.log("No chapters to process.");
		return 0;
	}

	if (remote.shards !== undefined && shardPlans.length < remote.shards) {
		console.log(
			`Capping parallel shards from ${remote.shards} to ${shardPlans.length} to match pending chapter count.`,
		);
	}
	if (shardPlans.length > 1 || remote.create) {
		console.log(
			`Shard plan (${shardPlans.length} × 1x ${THUNDER_VM_SPEC.gpu.toUpperCase()} VM${shardPlans.length > 1 ? "s" : ""}, ~$${(shardPlans.length * 0.35).toFixed(2)}/hr):`,
		);
		for (let i = 0; i < shardPlans.length; i++) {
			console.log(`  Shard ${i + 1}/${shardPlans.length}: ${formatShardSummary(shardPlans[i])}`);
		}
	}

	// Never provision/bill new VM(s) during --dry-run.
	const newVmShortfall = Math.max(0, shardPlans.length - explicitThunderCount);
	if (options.dryRun && remote.create && newVmShortfall > 0) {
		console.log(
			`Dry-run complete (skipped provisioning ${newVmShortfall} Thunder 1x ${THUNDER_VM_SPEC.gpu.toUpperCase()} VM(s)).`,
		);
		return 0;
	}

	const tnrBin = requireTnrBinary(runner);
	const { instances, createdIds } = await resolveThunderInstances(
		tnrBin,
		remote,
		shardPlans.length,
		runner,
	);
	const shardTargets = await Promise.all(
		instances.map(async (inst) => {
			const freshVm = createdIds.has(inst.id);
			return {
				instance: inst,
				endpoint: await resolveThunderEndpoint(inst),
				freshVm,
				shouldDelete: freshVm ? !remote.keepVms : remote.deleteAfter,
			};
		}),
	);

	const isMultiShard = shardPlans.length > 1;
	const withMergeLock = isMultiShard ? createSerialLock() : undefined;

	let interrupted = false;
	const activeKills = new Set<() => void>();
	const onSignal = () => {
		if (!interrupted) {
			interrupted = true;
			console.warn(
				isMultiShard
					? `\nInterrupted — stopping synthesis on ${activeKills.size} shard VM(s) and pulling completed chapters...`
					: "\nInterrupted — stopping remote synthesis and pulling completed chapters...",
			);
			for (const kill of activeKills) kill();
		}
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);

	const results: Array<{
		target: (typeof shardTargets)[number];
		result?: ShardExecutionResult;
		error?: unknown;
	}> = [];

	try {
		const settled = await Promise.allSettled(
			shardPlans.map((shardPlan, idx) => {
				const target = shardTargets[idx];
				const shardPaths = isMultiShard ? deriveShardOutputPaths(paths, idx + 1) : paths;
				const logPrefix = isMultiShard
					? `[shard ${idx + 1}/${shardPlans.length} · tnr-${target.instance.id}] `
					: "";
				return executeRemoteShard({
					options,
					paths: shardPaths,
					jobPlan: shardPlan,
					rootDir,
					runner,
					instance: target.instance,
					endpoint: target.endpoint,
					freshVm: target.freshVm,
					logPrefix,
					withMergeLock,
					registerKill: (kill) => {
						activeKills.add(kill);
						return () => activeKills.delete(kill);
					},
					isInterrupted: () => interrupted,
				});
			}),
		);

		for (let i = 0; i < settled.length; i++) {
			const entry = settled[i];
			if (entry.status === "fulfilled") {
				results.push({ target: shardTargets[i], result: entry.value });
			} else {
				if (!isMultiShard) throw entry.reason;
				const msg = entry.reason instanceof Error ? entry.reason.message : String(entry.reason);
				console.error(`[shard ${i + 1}/${shardPlans.length}] ERROR: ${msg}`);
				results.push({ target: shardTargets[i], error: entry.reason });
			}
		}

		const allClean = results.every((r) => !r.error && r.result?.exitCode === 0);
		if (options.dryRun) {
			return allClean ? 0 : (results[0]?.result?.exitCode ?? 1);
		}

		if (isMultiShard) {
			const totalMp3s = results.reduce((sum, r) => sum + (r.result?.mp3Count ?? 0), 0);
			const totalTimings = results.reduce((sum, r) => sum + (r.result?.timingCount ?? 0), 0);
			const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
			console.log(
				`\nCompleted ${shardPlans.length} parallel shard(s) in ${elapsedSec}s ` +
					`(synced ${totalMp3s} MP3(s), ${totalTimings} timing file write(s)).`,
			);
		}

		if (!allClean) {
			return !isMultiShard ? (results[0]?.result?.exitCode ?? 1) : 1;
		}

		const verification = await verifyAndSummarizeOutputs(jobPlan, paths, rootDir);
		if (!verification.ok) {
			for (const err of verification.errors) {
				console.error(`Verification error: ${err}`);
			}
			return 1;
		}

		console.log(
			isMultiShard
				? "Integrity verification passed across all shards."
				: "Integrity verification passed.",
		);
		return 0;
	} finally {
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);

		if (!options.dryRun) {
			const remainingIds: string[] = [];
			const deleteEntries: typeof results =
				results.length > 0 ? results : shardTargets.map((target) => ({ target }));
			for (const entry of deleteEntries) {
				const inst = entry.target.instance;
				const cleanSync =
					!entry.error &&
					Boolean(entry.result?.pullCompletedCleanly) &&
					!entry.result?.synthesisErrors;
				if (entry.target.shouldDelete && cleanSync) {
					const reason = entry.target.freshVm ? "auto-delete created VM" : "--delete-after";
					const deleted = await deleteThunderInstance(tnrBin, inst.id, runner, reason);
					if (!deleted) remainingIds.push(inst.id);
				} else {
					remainingIds.push(inst.id);
				}
			}

			if (remainingIds.length > 0) {
				const deleteCmds = remainingIds.map((id) => `tnr delete ${id}`).join(" && ");
				const anyAttemptedAutoDelete = shardTargets.some((t) => t.shouldDelete);
				if (anyAttemptedAutoDelete) {
					console.warn(
						`Skipping \`${deleteCmds}\` because synthesis/sync did not finish cleanly. Delete manually when ready: \`${deleteCmds}\``,
					);
				} else if (isMultiShard || createdIds.size > 0) {
					console.log(
						`Thunder VM(s) still running (${remainingIds.join(", ")}). Stop billing when done: \`${deleteCmds}\``,
					);
				}
			}
		}
	}
}
