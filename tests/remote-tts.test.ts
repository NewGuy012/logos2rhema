import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli } from "../scripts/generate-krv-audio";
import { resolveBookList, resolveBookToken } from "../scripts/lib/book-selection";
import {
	buildPendingJobPlan,
	buildRsyncRshCommand,
	buildTnrCreateArgs,
	type CommandResult,
	type CommandRunner,
	DEFAULT_THUNDER_VM_SPEC,
	findSshConfigMatch,
	formatShardSummary,
	loadDevVarsRecord,
	mergeBookTimingsPayload,
	mergeGenerationReportPayload,
	normalizePreArgs,
	parseCliOptions,
	parseProbeOutput,
	parseSshTarget,
	parseThunderStatusOutput,
	partitionJobPlan,
	quotePosix,
	remoteDirBashExpr,
	remoteDirTransferPath,
	resolveOutputPaths,
	selectOnnxGpuSpec,
	verifyAndSummarizeOutputs,
} from "../scripts/lib/remote-tts";
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
		async runInteractive() {
			return 0;
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

	it("parses staging/remote options, guards R2 upload & unsafe paths, and respects .dev.vars defaults", async () => {
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
			"--gpus",
			"4",
			"--batch-size",
			"32",
		]);
		expect(stageOpts).toMatchObject({
			remote: true,
			thunder: "0",
			books: ["RUT"],
			staging: "rut-test",
			gpus: 4,
			batchSize: 32,
			upload: false,
		});

		expect(() =>
			parseCliOptions(["--thunder", "0", "--book", "RUT", "--staging", "t", "--upload"]),
		).toThrow("Refusing to upload to R2");
		expect(() =>
			parseCliOptions(["--thunder", "0", "--book", "RUT", "--out-dir", "/tmp/out", "--upload"]),
		).toThrow("Refusing to upload to R2");
		expect(() => parseCliOptions(["--staging", "../escape"])).toThrow("Invalid --staging name");
		for (const badDir of ["~/../escape", "~/bad;rm -rf /", "~/bad$(id)"]) {
			expect(() => parseCliOptions(["--remote-dir", badDir])).toThrow("Unsafe --remote-dir");
		}

		// Local mode keeps THUNDER_* dormant and rejects remote-only flags
		const dir = await makeTempDir("l2r-devvars-");
		const devVarsPath = join(dir, ".dev.vars");
		await writeFile(
			devVarsPath,
			'THUNDER_INSTANCE=0\nTHUNDER_SSH_TARGET="tnr-0"\nTHUNDER_SSH_PORT=2222\nTHUNDER_REMOTE_DIR=~/custom-tts\nTHUNDER_DEVICE=cuda\n',
			"utf8",
		);
		const loaded = await loadDevVarsRecord(devVarsPath);
		expect(parseOpts(["--book", "RUT"], loaded)).toMatchObject({
			remote: false,
			thunder: undefined,
			ssh: undefined,
		});
		expect(parseOpts(["--remote", "--books", "RUT,PHM"], loaded)).toMatchObject({
			remote: true,
			thunder: "0",
			ssh: "tnr-0",
			sshPort: 2222,
			remoteDir: "~/custom-tts",
			device: "cuda",
			gpu: DEFAULT_THUNDER_VM_SPEC.gpu,
		});
		// Explicit --ssh overrides .dev.vars THUNDER_INSTANCE
		expect(parseOpts(["--ssh", "ubuntu@h1", "--book", "RUT"], loaded).thunder).toBeUndefined();

		const mockLocal = createMockRunner({});
		for (const badLocal of [
			["--book", "RUT", "--ssh-port", "2222"],
			["--book", "RUT", "--remote-dir", "~/custom"],
			["--book", "RUT", "--transfer", "tar"],
		]) {
			expect(await runCli(badLocal, dir, mockLocal)).toBe(1);
		}

		expect(buildTnrCreateArgs(parseOpts(["--create", "--book", "RUT"]))).toEqual([
			"--json",
			"-y",
			"create",
			"--mode",
			"prototyping",
			"--gpu",
			"a6000",
			"--vcpus",
			"8",
			"--template",
			"cuda12-8",
			"--disk-size-gb",
			"100",
		]);
		expect(
			buildTnrCreateArgs(
				parseOpts(["--create", "--mode", "production", "--gpu", "a100", "--num-gpus", "2"]),
			),
		).toContain("--num-gpus");

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

	it("validates SSH targets, POSIX quoting, tnr parsing, SSH config wildcards, probes, and upload args", () => {
		expect(parseSshTarget("ubuntu@203.0.113.10:2222")).toMatchObject({
			target: "ubuntu@203.0.113.10",
			port: 2222,
		});
		expect(parseSshTarget("ssh://ubuntu@203.0.113.10:2200", 2222)).toMatchObject({
			target: "ubuntu@203.0.113.10",
			port: 2222,
		});
		expect(parseSshTarget("ubuntu@[2001:db8::1]:2222")).toMatchObject({
			target: "ubuntu@[2001:db8::1]",
			port: 2222,
		});
		for (const badTarget of [
			"-oProxyCommand=evil",
			"ubuntu@host;rm -rf /",
			"ubuntu@host|id",
			"ubuntu@host$(id)",
			"ubuntu@host\nid",
		]) {
			expect(() => parseSshTarget(badTarget)).toThrow("Invalid SSH target");
		}
		expect(() => parseSshTarget("ubuntu@host", undefined, undefined, ["bad\nopt"])).toThrow(
			"Invalid SSH option",
		);

		expect(quotePosix("it's clean")).toBe("'it'\"'\"'s clean'");
		expect(remoteDirBashExpr("~/dir/sub")).toBe("\"$HOME\"/'dir/sub'");
		expect(remoteDirTransferPath("~/dir/sub")).toBe("dir/sub");
		expect(buildRsyncRshCommand(parseSshTarget("ubuntu@198.51.100.2:2222"))).toContain("'2222'");

		const instances = parseThunderStatusOutput(
			`Fetching...\n[{"id":"0","uuid":"inst-abc","status":"RUNNING","gpuType":"a100","ip":"198.51.100.42","port":22}]`,
		);
		expect(instances[0]).toMatchObject({ id: "0", status: "RUNNING", ip: "198.51.100.42" });

		const matched = findSshConfigMatch(
			`Host *\n  ServerAliveInterval 60\nHost * tnr-0\n  HostName 198.51.100.42\n  User ubuntu\n`,
			instances[0],
		);
		expect(matched?.patterns).toContain("tnr-0");

		expect(
			parseProbeOutput(
				"OS=Linux\nARCH=x86_64\nCPUS=8\nGPU=NVIDIA A100\nGPU_COUNT=4\nCUDA_VER=12.8\nHAS_RSYNC=1",
			),
		).toMatchObject({
			cpuCount: 8,
			gpuCount: 4,
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

	it("merges partial chapter timings/reports safely and partitions 1,189 Bible chapters across shards", async () => {
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

		expect(() => parseCliOptions(["--shards", "4", "--shell"])).toThrow("Cannot combine --shards");
		expect(() => parseCliOptions(["--shards", "4", "--ssh", "ubuntu@onlyone"])).toThrow(
			"requires 4 comma-separated SSH target",
		);
		expect(() => parseCliOptions(["--shards", "2", "--thunder", "0,1,2"])).toThrow(
			"exceeds --shards 2",
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

describe("mocked Thunder Compute & SSH end-to-end orchestration", () => {
	it("runs isolated staging via tnr without touching prod, and verifies outputs", async () => {
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
		let remoteScriptRan = "";
		let tnrCreates = 0;

		const runner = createMockRunner({
			async onRun(cmd, args) {
				if (cmd === "/usr/local/bin/tnr" && args.includes("create")) {
					tnrCreates++;
					return { exitCode: 0, stdout: "{}", stderr: "" };
				}
				if (cmd === "/usr/local/bin/tnr" && args.includes("status")) {
					return {
						exitCode: 0,
						stdout: JSON.stringify([
							{ id: "0", status: "RUNNING", gpuType: "a100", ip: "198.51.100.99", port: 22 },
						]),
						stderr: "",
					};
				}
				if (cmd === "ssh" && args.some((a) => a.includes("nvidia-smi"))) {
					return {
						exitCode: 0,
						stdout: "OS=Linux\nARCH=x86_64\nCPUS=8\nGPU=NVIDIA A100\nCUDA_VER=12.8\nHAS_RSYNC=1\n",
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
				if (cmd === "ssh" && args.at(-1)?.includes("generate-krv-audio.py")) {
					remoteScriptRan = args.at(-1)!;
				}
				return { exitCode: 0 };
			},
		});

		// Single-VM --create --dry-run must NOT provision a billable VM
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
		expect(remoteScriptRan).toContain("staging/rut-test/out/audio");
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

	it("runs direct --ssh with opt-in --upload, and orchestrates parallel --shards 2 --create --delete-after VMs", async () => {
		const rootDir = await makeTempDir("l2r-e2e-shards-");
		await seedMockWorkspace(rootDir, { RUT: [1, 2, 3, 4], PHM: [1], JUD: [1] });

		const created: Array<{ id: string; uuid: string; status: string; ip: string; port: number }> =
			[];
		const deletedIds: string[] = [];
		const tnrCalls: string[] = [];
		const streamCmds: string[] = [];
		const streamPrefixes: string[] = [];

		const runner = createMockRunner({
			async onRun(cmd, args) {
				if (cmd === "/usr/local/bin/tnr") {
					tnrCalls.push(args.join(" "));
					if (args.includes("create")) {
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
						: script.includes("shard-2")
							? { "RUT:3": { status: "ok" }, "RUT:4": { status: "ok" } }
							: { "PHM:1": { status: "ok" }, "JUD:1": { status: "ok" } };
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
					} else if (src.includes("out/audio/")) {
						for (const usfm of ["PHM", "JUD"]) {
							await mkdir(join(dst, usfm), { recursive: true });
							await writeFile(join(dst, usfm, "1.mp3"), Buffer.alloc(1500, 1));
						}
					} else if (src.includes("out/timings/")) {
						await mkdir(dst, { recursive: true });
						for (const usfm of ["PHM", "JUD"]) {
							await writeFile(
								join(dst, `${usfm}.json`),
								JSON.stringify({ chapters: { "1": { "1": 1.4 } } }),
								"utf8",
							);
						}
					}
				}
				return undefined;
			},
			async onStream(cmd, args, opts) {
				streamCmds.push(`${cmd} ${args.join(" ")}`);
				if (opts?.logPrefix) streamPrefixes.push(opts.logPrefix);
				return { exitCode: 0 };
			},
		});

		// Direct --ssh with --upload skips tnr and triggers upload-krv-audio.ts
		expect(
			await runCli(
				["--ssh", "ubuntu@203.0.113.5:2222", "--books", "PHM,JUD", "--force", "--upload"],
				rootDir,
				runner,
			),
		).toBe(0);
		expect(tnrCalls).toHaveLength(0);
		expect(streamCmds.find((c) => c.includes("upload-krv-audio.ts"))).toContain("--books PHM,JUD");

		// Parallel 2-shard dry-run skips provisioning
		expect(
			await runCli(
				["--shards", "2", "--create", "--book", "RUT", "--staging", "shard-dry", "--dry-run"],
				rootDir,
				runner,
			),
		).toBe(0);
		expect(created).toHaveLength(0);

		// Parallel 2-shard full run creates 2 VMs, splits RUT, merges timings & report, deletes both VMs
		expect(
			await runCli(
				[
					"--shards",
					"2",
					"--create",
					"--delete-after",
					"--book",
					"RUT",
					"--staging",
					"shard-test",
					"--force",
				],
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
	});
});
