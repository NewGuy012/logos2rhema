import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli } from "../scripts/generate-krv-audio";
import { resolveBookList, resolveBookToken } from "../scripts/lib/book-selection";
import { loadDevVarsRecord } from "../scripts/lib/common";
import { runRemoteWorkflow } from "../scripts/lib/remote-tts";
import {
	buildRsyncRshCommand,
	type CommandResult,
	type CommandRunner,
	parseProbeOutput,
	quotePosix,
	remoteDirBashExpr,
	remoteDirTransferPath,
	resolveThunderEndpoint,
	selectOnnxGpuSpec,
	withRemoteSession,
} from "../scripts/lib/ssh-session";
import {
	buildTnrCreateArgs,
	deleteThunderInstance,
	parseThunderStatusOutput,
	THUNDER_VM_SPEC,
} from "../scripts/lib/thunder";
import { normalizePreArgs, parseCliOptions, resolveOutputPaths } from "../scripts/lib/tts-cli";
import {
	buildPendingJobPlan,
	chooseOptimalShards,
	formatShardSummary,
	mergeBookTimingsPayload,
	mergeGenerationReportPayload,
	partitionJobPlan,
	verifyAndSummarizeOutputs,
} from "../scripts/lib/tts-plan";
import { parseUploadArgs } from "../scripts/upload-krv-audio";

const parseOpts = (argv: readonly string[], env?: Record<string, string | undefined>) => {
	const opts = parseCliOptions(argv, env);
	if (!opts) throw new Error("Expected parsed CliOptions");
	return opts;
};

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

async function seedMockWorkspace(
	rootDir: string,
	books: Record<string, number[]> = { RUT: [1, 2, 3, 4], PHM: [1], JUD: [1] },
): Promise<void> {
	await mkdir(join(rootDir, "scripts"), { recursive: true });
	await mkdir(join(rootDir, "src", "shared"), { recursive: true });
	await mkdir(join(rootDir, "public", "data", "bibles", "krv"), { recursive: true });
	await mkdir(join(rootDir, "public", "data", "timings", "krv-supertonic"), { recursive: true });
	await writeFile(join(rootDir, "scripts", "generate-krv-audio.py"), "# mock\n", "utf8");
	await writeFile(join(rootDir, "src", "shared", "books.ts"), "// mock\n", "utf8");
	for (const [usfm, chapters] of Object.entries(books)) {
		const chObj: Record<string, Array<{ verse: number; text: string }>> = {};
		for (const ch of chapters) chObj[String(ch)] = [{ verse: 1, text: "가나다라마바사아자차" }];
		await writeFile(
			join(rootDir, "public", "data", "bibles", "krv", `${usfm}.json`),
			JSON.stringify({ usfm, chapters: chObj }),
			"utf8",
		);
	}
}

function createMockRunner(handlers: {
	hasTnr?: boolean;
	onRun?: (cmd: string, args: string[]) => Promise<CommandResult | undefined>;
	onStream?: (
		cmd: string,
		args: string[],
		opts?: { logPrefix?: string },
	) => Promise<{ exitCode: number } | undefined>;
}): CommandRunner {
	return {
		which: (bin) => (bin === "tnr" && handlers.hasTnr !== false ? "/usr/local/bin/tnr" : null),
		async run(cmd, args) {
			const res = await handlers.onRun?.(cmd, args);
			return res ?? { exitCode: 0, stdout: "", stderr: "" };
		},
		async runStreaming(cmd, args, opts) {
			const res = await handlers.onStream?.(cmd, args, opts);
			return res ?? { exitCode: 0 };
		},
	};
}

describe("book selection, CLI options, and .dev.vars", () => {
	it("resolves USFM, English, Korean, aliases, and rejects ambiguous/unknown tokens", () => {
		expect(resolveBookToken("RUT").usfm).toBe("RUT");
		expect(resolveBookToken("Ruth").usfm).toBe("RUT");
		expect(resolveBookToken("룻기").usfm).toBe("RUT");
		expect(resolveBookToken("시").usfm).toBe("PSA");
		expect(resolveBookToken("요한1서").usfm).toBe("1JN");
		expect(resolveBookList(["RUT,PHM", "빌레몬서", "유다서"]).map((b) => b.usfm)).toEqual([
			"RUT",
			"PHM",
			"JUD",
		]);
		expect(() => resolveBookToken("Jo")).toThrow("Ambiguous book identifier");
		expect(() => resolveBookToken("Narnia")).toThrow("Unknown book identifier");
	});

	it("parses lean CLI options, guards staging & remote-only flags, and respects .dev.vars", async () => {
		expect(normalizePreArgs(["--book", "RUT", "--staging", "--force"])).toEqual([
			"--book",
			"RUT",
			"--staging=default",
			"--force",
		]);
		expect(parseCliOptions(["--help"])).toBeNull();

		const stageOpts = parseOpts([
			"--thunder",
			"0",
			"--book",
			"RUT",
			"--staging",
			"rut-test",
			"--mp3-quality",
			"2",
			"--speed",
			"1.05",
			"--voice",
			"M5",
			"--verbose",
		]);
		expect(stageOpts).toMatchObject({
			books: ["RUT"],
			staging: "rut-test",
			synthArgs: ["--voice", "M5", "--speed", "1.05", "--mp3-quality", "2", "--verbose"],
			remote: {
				thunder: "0",
				create: false,
				keepVms: false,
				deleteAfter: false,
			},
		});

		expect(() => parseCliOptions(["--staging", "../escape"])).toThrow("Invalid --staging name");
		expect(() => parseCliOptions(["--shards", "0", "--create"])).toThrow("Out-of-range");
		expect(() => parseCliOptions(["--shards", "9", "--create"])).toThrow("Out-of-range");
		expect(() => parseCliOptions(["--shards", "2", "--thunder", "0,1,2"])).toThrow(
			"exceeds --shards 2",
		);
		expect(() => parseCliOptions(["--create", "--keep-vms", "--delete-after"])).toThrow(
			"mutually exclusive",
		);

		// Local mode keeps THUNDER_INSTANCE dormant and rejects remote-only flags
		const dir = await makeTempDir("l2r-devvars-");
		const devVarsPath = join(dir, ".dev.vars");
		await writeFile(devVarsPath, "THUNDER_INSTANCE=0\n", "utf8");
		const loaded = await loadDevVarsRecord(devVarsPath);

		expect(parseOpts(["--book", "RUT"], loaded).remote).toBeUndefined();
		expect(parseOpts(["--remote", "--books", "RUT,PHM"], loaded).remote).toMatchObject({
			thunder: "0",
			create: false,
		});
		// --create ignores .dev.vars THUNDER_INSTANCE unless --thunder is explicitly passed
		expect(parseOpts(["--create", "--all"], loaded).remote?.thunder).toBeUndefined();
		expect(parseOpts(["--remote", "--create", "--all"], loaded).remote?.thunder).toBeUndefined();

		const mockLocal = createMockRunner({});
		expect(await runCli(["--book", "RUT", "--delete-after"], dir, mockLocal)).toBe(1);
		expect(await runCli(["--book", "RUT", "--keep-vms"], dir, mockLocal)).toBe(1);

		expect(buildTnrCreateArgs()).toEqual([
			"--json",
			"-y",
			"create",
			"--mode",
			THUNDER_VM_SPEC.mode,
			"--gpu",
			THUNDER_VM_SPEC.gpu,
			"--vcpus",
			String(THUNDER_VM_SPEC.vcpus),
			"--template",
			THUNDER_VM_SPEC.template,
			"--disk-size-gb",
			String(THUNDER_VM_SPEC.diskSizeGb),
		]);

		const prodPaths = resolveOutputPaths(parseOpts(["--thunder", "0", "--book", "RUT"]), "/ws");
		const stagePaths = resolveOutputPaths(
			parseOpts(["--thunder", "0", "--book", "RUT", "--staging", "rut-test"]),
			"/ws",
		);
		expect(prodPaths.remoteRunDir).toBe("~/logos2rhema-krv-tts/prod");
		expect(stagePaths.remoteRunDir).toBe("~/logos2rhema-krv-tts/staging/rut-test");
		expect(stagePaths.localAudioDir).toBe(
			join("/ws", ".cache", "krv-supertonic-staging", "rut-test", "audio"),
		);
	});

	it("handles POSIX quoting, tnr parsing, direct Thunder SSH endpoint resolution, probes, and upload args", async () => {
		expect(quotePosix("it's clean")).toBe("'it'\"'\"'s clean'");
		expect(remoteDirBashExpr("~/dir/sub")).toBe("\"$HOME\"/'dir/sub'");
		expect(remoteDirTransferPath("~/dir/sub")).toBe("dir/sub");
		expect(
			buildRsyncRshCommand({
				target: "ubuntu@198.51.100.2",
				port: 2222,
				strictHostKeyChecking: "accept-new",
			}),
		).toContain("'2222'");

		const instances = parseThunderStatusOutput(
			`Fetching...\n[{"id":"0","uuid":"inst-abc","status":"RUNNING","gpuType":"a6000","ip":"198.51.100.42","port":22}]`,
		);
		expect(instances[0]).toMatchObject({ id: "0", status: "RUNNING", ip: "198.51.100.42" });
		expect(() => parseThunderStatusOutput('[{"id":"-y","status":"RUNNING"}]')).toThrow(
			"Unsafe Thunder instance ID",
		);
		await expect(
			deleteThunderInstance("/usr/local/bin/tnr", "-y", createMockRunner({})),
		).rejects.toThrow("Invalid Thunder instance ID");

		// Endpoint prefers ~/.thunder/keys/<uuid> and connects directly to ubuntu@<ip>
		const fakeHome = await makeTempDir("l2r-home-");
		const keyDir = join(fakeHome, ".thunder", "keys");
		await mkdir(keyDir, { recursive: true });
		const thunderKeyPath = join(keyDir, "inst-abc");
		await writeFile(thunderKeyPath, "FAKE-KEY", "utf8");
		expect(await resolveThunderEndpoint(instances[0], fakeHome)).toMatchObject({
			target: "ubuntu@198.51.100.42",
			port: 22,
			keyPath: thunderKeyPath,
		});
		await expect(resolveThunderEndpoint({ id: "0", status: "RUNNING" }, fakeHome)).rejects.toThrow(
			"Could not resolve IP address",
		);

		expect(
			parseProbeOutput(
				"OS=Linux\nARCH=x86_64\nCPUS=8\nGPU=NVIDIA RTX A6000\nCUDA_VER=12.8\nHAS_RSYNC=1",
			),
		).toMatchObject({
			cpuCount: 8,
			cudaMajor: 12,
			hasNvidiaGpu: true,
			hasRsync: true,
		});
		expect(selectOnnxGpuSpec(12)).toBe("onnxruntime-gpu[cuda,cudnn]>=1.24.0,<1.27");
		expect(selectOnnxGpuSpec(13)).toBe("onnxruntime-gpu[cuda,cudnn]>=1.27.0");

		// Upload CLI validation
		expect(parseUploadArgs(["--books", "RUT,빌레몬서,JUD", "--dry-run"])?.books).toEqual([
			"RUT",
			"PHM",
			"JUD",
		]);
		expect(() => parseUploadArgs(["--bucket", "INVALID_BUCKET"])).toThrow("Invalid R2 bucket name");
		expect(() => parseUploadArgs(["--concurrency", "0"])).toThrow("Out-of-range");
		expect(() => parseUploadArgs(["--retries", "99"])).toThrow("Out-of-range");
	});

	it("auto-sizes shards to matrix sweet spots, merges timings/reports, and partitions 1,189 chapters", async () => {
		expect(chooseOptimalShards(4)).toBe(1);
		expect(chooseOptimalShards(25)).toBe(1);
		expect(chooseOptimalShards(26)).toBe(2);
		expect(chooseOptimalShards(150)).toBe(2);
		expect(chooseOptimalShards(151)).toBe(4);
		expect(chooseOptimalShards(1189)).toBe(4);

		const mergedBook = mergeBookTimingsPayload(
			{ chapters: { "1": { "1": 1.1 }, "2": { "1": 2.2 }, "4": { "1": 4.4 } } },
			{ chapters: { "3": { "1": 3.3 }, "1": { "1": 1.5 } } },
			"RUT",
		);
		expect(Object.keys(mergedBook.chapters as Record<string, unknown>)).toEqual([
			"1",
			"2",
			"3",
			"4",
		]);
		expect((mergedBook.chapters as Record<string, Record<string, number>>)["1"]["1"]).toBe(1.5);

		const mergedReport = mergeGenerationReportPayload(
			{ chapters: { "GEN:1": { duration: 244.7 }, "RUT:1": { duration: 90.0 } } },
			{ chapters: { "RUT:1": { duration: 91.2 } }, summary: { completedInRun: 1 } },
		);
		expect((mergedReport.chapters as Record<string, { duration: number }>)["GEN:1"].duration).toBe(
			244.7,
		);
		expect((mergedReport.chapters as Record<string, { duration: number }>)["RUT:1"].duration).toBe(
			91.2,
		);

		const realRoot = join(import.meta.dir, "..");
		const allPaths = resolveOutputPaths(
			parseOpts(["--shards", "4", "--all"]),
			await makeTempDir("l2r-shard-plan-"),
		);
		const fullPlan = await buildPendingJobPlan(parseOpts(["--all", "--force"]), allPaths);
		const shards4 = await partitionJobPlan(fullPlan, 4, realRoot);
		expect(shards4).toHaveLength(4);
		const seen = new Set<string>();
		for (const shard of shards4) {
			expect(shard.pendingChapters).toBeGreaterThan(200);
			expect(formatShardSummary(shard)).toContain("ch");
			for (const [usfm, chs] of Object.entries(shard.chaptersByBook)) {
				for (const ch of chs) seen.add(`${usfm}:${ch}`);
			}
		}
		expect(seen.size).toBe(1189);

		const obaPlan = await buildPendingJobPlan(parseOpts(["--book", "OBA", "--force"]), allPaths);
		expect(await partitionJobPlan(obaPlan, 4, realRoot)).toHaveLength(1);
	});
});

describe("mocked Thunder Compute orchestration", () => {
	it("runs isolated staging via --thunder without touching prod or deleting existing VM, and verifies outputs", async () => {
		const rootDir = await makeTempDir("l2r-e2e-stage-");
		await seedMockWorkspace(rootDir, { RUT: [1, 2, 3, 4], PHM: [1] });

		const prodMp3 = join(rootDir, ".cache", "krv-supertonic-audio", "RUT", "1.mp3");
		await mkdir(join(rootDir, ".cache", "krv-supertonic-audio", "RUT"), { recursive: true });
		await writeFile(prodMp3, Buffer.alloc(2048, 0xaa));
		const prodTiming = join(rootDir, "public", "data", "timings", "krv-supertonic", "RUT.json");
		const prodTimingContent = JSON.stringify({ chapters: { "1": { "1": 1.11 } } });
		await writeFile(prodTiming, prodTimingContent, "utf8");

		let uploadedManifestBooks = null as Record<string, number[]> | null;
		let uploadedBookFiles: string[] = [];
		let bootstrapRanVerifyEnv = false;
		let remoteScriptRan = "";
		let tnrCreates = 0;
		let tnrDeletes = 0;

		const runner = createMockRunner({
			async onRun(cmd, args) {
				if (cmd === "/usr/local/bin/tnr" && args.includes("create")) {
					tnrCreates++;
					return { exitCode: 0, stdout: "{}", stderr: "" };
				}
				if (cmd === "/usr/local/bin/tnr" && args.includes("delete")) {
					tnrDeletes++;
					return { exitCode: 0, stdout: "{}", stderr: "" };
				}
				if (cmd === "/usr/local/bin/tnr" && args.includes("status")) {
					return {
						exitCode: 0,
						stdout: JSON.stringify([
							{ id: "0", status: "RUNNING", gpuType: "a6000", ip: "198.51.100.99", port: 22 },
						]),
						stderr: "",
					};
				}
				if (cmd === "ssh" && args.some((a) => a.includes("nvidia-smi"))) {
					return {
						exitCode: 0,
						stdout:
							"OS=Linux\nARCH=x86_64\nCPUS=8\nGPU=NVIDIA RTX A6000\nCUDA_VER=12.8\nHAS_RSYNC=1\n",
						stderr: "",
					};
				}
				if (cmd === "rsync") {
					const src = args[args.length - 2];
					const dst = args[args.length - 1];
					if (src.endsWith("/") && dst.includes("staging/rut-test")) {
						uploadedManifestBooks = JSON.parse(
							await readFile(join(src, "job-manifest.json"), "utf8"),
						).books;
						uploadedBookFiles = await readdir(join(src, "public", "data", "bibles", "krv"));
					} else if (src.includes("out/audio/")) {
						await mkdir(join(dst, "RUT"), { recursive: true });
						for (const ch of [1, 2, 3, 4]) {
							await writeFile(join(dst, "RUT", `${ch}.mp3`), Buffer.alloc(2048, ch));
						}
					} else if (src.includes("out/timings/")) {
						await mkdir(dst, { recursive: true });
						await writeFile(
							join(dst, "RUT.json"),
							JSON.stringify({
								chapters: {
									"1": { "1": 1.6 },
									"2": { "1": 1.5 },
									"3": { "1": 1.7 },
									"4": { "1": 1.6 },
								},
							}),
							"utf8",
						);
					}
				}
				if (cmd === "ssh" && args.some((a) => a.includes("report.json"))) {
					return {
						exitCode: 0,
						stdout: JSON.stringify({ chapters: { "RUT:1": { status: "ok" } } }),
						stderr: "",
					};
				}
				return undefined;
			},
			async onStream(cmd, args) {
				const script = args.at(-1) ?? "";
				if (cmd === "ssh" && script.includes("--verify-env --device cuda")) {
					bootstrapRanVerifyEnv = true;
					expect(script).toContain("--proto");
					expect(script).toContain("--tlsv1.2 -LsSf https://astral.sh/uv/install.sh");
					expect(script).toContain('"supertonic>=1.3,<2" "lameenc>=1.7,<2" "numpy>=1.26,<3"');
				}
				if (cmd === "ssh" && script.includes("--job-manifest")) {
					remoteScriptRan = script;
				}
				return { exitCode: 0 };
			},
		});

		// --create --dry-run must NOT provision any billable VM
		expect(
			await runCli(["--create", "--book", "RUT", "--staging", "dry", "--dry-run"], rootDir, runner),
		).toBe(0);
		expect(tnrCreates).toBe(0);

		expect(
			await runCli(
				["--thunder", "0", "--book", "RUT", "--staging", "rut-test", "--force"],
				rootDir,
				runner,
			),
		).toBe(0);
		expect(uploadedManifestBooks).toEqual({ RUT: [1, 2, 3, 4] });
		expect(uploadedBookFiles).toEqual(["RUT.json"]);
		expect(bootstrapRanVerifyEnv).toBe(true);
		expect(remoteScriptRan).toContain("staging/rut-test/out/audio");
		expect(remoteScriptRan).toContain("--device cuda");
		expect(tnrDeletes).toBe(0);
		expect(await readFile(prodTiming, "utf8")).toBe(prodTimingContent);
		expect(Buffer.from(await readFile(prodMp3))).toEqual(Buffer.alloc(2048, 0xaa));
		expect(
			(
				await stat(
					join(rootDir, ".cache", "krv-supertonic-staging", "rut-test", "audio", "RUT", "4.mp3"),
				)
			).size,
		).toBe(2048);

		// verifyAndSummarizeOutputs catches missing files
		const vOpts = parseOpts(["--thunder", "0", "--book", "RUT", "--staging", "missing", "--force"]);
		const vPaths = resolveOutputPaths(vOpts, rootDir);
		const bad = await verifyAndSummarizeOutputs(
			await buildPendingJobPlan(vOpts, vPaths),
			vPaths,
			rootDir,
		);
		expect(bad.ok).toBe(false);
	});

	it("auto-sizes shards, auto-deletes --create VMs by default, respects --keep-vms, and fails fast without CUDA", async () => {
		const rootDir = await makeTempDir("l2r-e2e-shards-");
		await seedMockWorkspace(rootDir, { RUT: [1, 2, 3, 4], PHM: [1], JUD: [1] });

		let created: Array<{ id: string; uuid: string; status: string; ip: string; port: number }> = [];
		let deletedIds: string[] = [];
		const streamPrefixes: string[] = [];
		let probeWithoutGpu = false;
		let failSecondCreate = false;

		const runner = createMockRunner({
			async onRun(cmd, args) {
				if (cmd === "/usr/local/bin/tnr") {
					if (args.includes("create")) {
						if (failSecondCreate && created.length === 1) {
							return { exitCode: 1, stdout: "", stderr: "quota exceeded" };
						}
						const idx = created.length;
						const uuid = `uuid-shard-${idx}`;
						created.push({
							id: String(idx),
							uuid,
							status: "RUNNING",
							ip: `198.51.100.${10 + idx}`,
							port: 40010 + idx,
						});
						return { exitCode: 0, stdout: JSON.stringify({ uuid, identifier: idx }), stderr: "" };
					}
					if (args.includes("status")) {
						return { exitCode: 0, stdout: JSON.stringify(created), stderr: "" };
					}
					if (args.includes("delete")) {
						deletedIds.push(args[args.length - 1]);
						return { exitCode: 0, stdout: "{}", stderr: "" };
					}
				}
				if (cmd === "ssh" && args.some((a) => a.includes("HAS_RSYNC"))) {
					if (probeWithoutGpu) {
						return {
							exitCode: 0,
							stdout: "OS=Linux\nARCH=x86_64\nCPUS=8\nGPU=\nCUDA_VER=\nHAS_RSYNC=1\n",
							stderr: "",
						};
					}
					return {
						exitCode: 0,
						stdout:
							"OS=Linux\nARCH=x86_64\nCPUS=8\nGPU=NVIDIA RTX A6000\nCUDA_VER=13.3\nHAS_RSYNC=1\n",
						stderr: "",
					};
				}
				if (cmd === "ssh" && args.some((a) => a.includes("report.json"))) {
					const script = args[args.length - 1];
					const chs = script.includes("shard-1")
						? { "RUT:1": { status: "ok" }, "RUT:2": { status: "ok" } }
						: { "RUT:3": { status: "ok" }, "RUT:4": { status: "ok" } };
					return { exitCode: 0, stdout: JSON.stringify({ chapters: chs }), stderr: "" };
				}
				if (cmd === "rsync") {
					const src = args[args.length - 2];
					const dst = args[args.length - 1];
					if (dst.includes(":")) return { exitCode: 0, stdout: "", stderr: "" };
					if (src.includes("shard-")) {
						const chList = src.includes("shard-1") ? [1, 2] : [3, 4];
						if (src.includes("out/audio/")) {
							await mkdir(join(dst, "RUT"), { recursive: true });
							for (const ch of chList) {
								await writeFile(join(dst, "RUT", `${ch}.mp3`), Buffer.alloc(1600, ch));
							}
						} else if (src.includes("out/timings/")) {
							await mkdir(dst, { recursive: true });
							const chapters: Record<string, Record<string, number>> = {};
							for (const ch of chList) chapters[String(ch)] = { "1": 1.2 + ch * 0.1 };
							await writeFile(join(dst, "RUT.json"), JSON.stringify({ chapters }), "utf8");
						}
					}
				}
				return undefined;
			},
			async onStream(_cmd, _args, opts) {
				if (opts?.logPrefix) streamPrefixes.push(opts.logPrefix);
				return { exitCode: 0 };
			},
		});

		// Whole-Bible --create --all --dry-run uses real rootDir books to auto-size to 4 shards, zero VMs created (even without tnr)
		expect(
			await runRemoteWorkflow(
				parseOpts(["--create", "--all", "--dry-run"]),
				join(import.meta.dir, ".."),
				createMockRunner({ hasTnr: false }),
			),
		).toBe(0);
		expect(created).toHaveLength(0);

		// Explicit --shards 2 --create auto-deletes both VMs by default after clean sync
		expect(
			await runCli(
				["--shards", "2", "--create", "--book", "RUT", "--staging", "shard-test", "--force"],
				rootDir,
				runner,
			),
		).toBe(0);
		expect(created).toHaveLength(2);
		expect(deletedIds.sort()).toEqual(["0", "1"]);
		expect(streamPrefixes.some((p) => p.includes("shard 1/2"))).toBe(true);
		expect(streamPrefixes.some((p) => p.includes("shard 2/2"))).toBe(true);

		const mergedTimings = JSON.parse(
			await readFile(
				join(rootDir, ".cache", "krv-supertonic-staging", "shard-test", "timings", "RUT.json"),
				"utf8",
			),
		) as { chapters: Record<string, unknown> };
		expect(Object.keys(mergedTimings.chapters)).toEqual(["1", "2", "3", "4"]);

		const mergedReport = JSON.parse(
			await readFile(
				join(rootDir, ".cache", "krv-supertonic-staging", "shard-test", "report.json"),
				"utf8",
			),
		) as { chapters: Record<string, unknown> };
		expect(Object.keys(mergedReport.chapters).sort()).toEqual(["RUT:1", "RUT:2", "RUT:3", "RUT:4"]);

		// --create --keep-vms leaves newly created VMs running
		created = [];
		deletedIds = [];
		expect(
			await runCli(
				[
					"--shards",
					"2",
					"--create",
					"--keep-vms",
					"--book",
					"RUT",
					"--staging",
					"shard-keep",
					"--force",
				],
				rootDir,
				runner,
			),
		).toBe(0);
		expect(created).toHaveLength(2);
		expect(deletedIds).toEqual([]);

		// Fail-fast when Thunder VM lacks CUDA GPU (no silent CPU fallback)
		probeWithoutGpu = true;
		await expect(
			runRemoteWorkflow(
				parseOpts(["--thunder", "0", "--book", "RUT", "--staging", "no-gpu", "--force"]),
				rootDir,
				runner,
			),
		).rejects.toThrow("found none");
		probeWithoutGpu = false;

		// Partial multi-shard create failure cleans up earlier created VM(s)
		created = [];
		deletedIds = [];
		failSecondCreate = true;
		await expect(
			runRemoteWorkflow(
				parseOpts(["--shards", "2", "--create", "--book", "RUT", "--staging", "partial-fail"]),
				rootDir,
				runner,
			),
		).rejects.toThrow("quota exceeded");
		expect(deletedIds).toEqual(["0"]);
		failSecondCreate = false;

		// withRemoteSession closes ControlMaster even on error
		const sshCommands: string[] = [];
		const cmRunner = createMockRunner({
			async onRun(cmd, args) {
				if (cmd === "ssh") sshCommands.push(args.join(" "));
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		});
		await expect(
			withRemoteSession(
				{
					runner: cmRunner,
					endpoint: { target: "ubuntu@198.51.100.1", strictHostKeyChecking: "accept-new" },
					instanceId: "0",
					freshVm: false,
				},
				async () => {
					throw new Error("boom");
				},
			),
		).rejects.toThrow("boom");
		expect(sshCommands.some((c) => c.includes("-M -N -f"))).toBe(true);
		expect(sshCommands.some((c) => c.includes("-O exit"))).toBe(true);
	});
});
