import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
	loadDevVarsRecord,
	mergeBookTimingsPayload,
	mergeGenerationReportPayload,
	normalizePreArgs,
	parseCliOptions,
	parseProbeOutput,
	parseSshTarget,
	parseThunderStatusOutput,
	quotePosix,
	remoteDirBashExpr,
	remoteDirTransferPath,
	resolveOutputPaths,
	selectOnnxGpuSpec,
	verifyAndSummarizeOutputs,
} from "../scripts/lib/remote-tts";
import { parseUploadArgs } from "../scripts/upload-krv-audio";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			await rm(dir, { recursive: true, force: true }).catch(() => {});
		}
	}
});

async function seedMockWorkspace(
	rootDir: string,
	books: string[] = ["RUT", "PHM", "JUD"],
): Promise<void> {
	await mkdir(join(rootDir, "scripts"), { recursive: true });
	await mkdir(join(rootDir, "src", "shared"), { recursive: true });
	await mkdir(join(rootDir, "public", "data", "bibles", "krv"), { recursive: true });
	await mkdir(join(rootDir, "public", "data", "timings", "krv-supertonic"), { recursive: true });

	await writeFile(join(rootDir, "scripts", "generate-krv-audio.py"), "# mock python\n", "utf8");
	await writeFile(join(rootDir, "src", "shared", "books.ts"), "// mock books\n", "utf8");

	for (const usfm of books) {
		await writeFile(
			join(rootDir, "public", "data", "bibles", "krv", `${usfm}.json`),
			JSON.stringify({ usfm, chapters: { "1": [{ verse: 1, text: "테스트" }] } }),
			"utf8",
		);
	}
}

describe("book-selection", () => {
	it("resolves single and multiple books across USFM, English, and Korean names with deduplication", () => {
		expect(resolveBookToken("rut").usfm).toBe("RUT");
		expect(resolveBookToken("Ruth").usfm).toBe("RUT");
		expect(resolveBookToken("룻기").usfm).toBe("RUT");
		expect(resolveBookToken("요한1서").usfm).toBe("1JN");

		const resolved = resolveBookList(["RUT,PHM", "빌레몬서,John,rut"]);
		expect(resolved.map((b) => b.usfm)).toEqual(["RUT", "PHM", "JHN"]);
	});

	it("rejects unknown and ambiguous book identifiers", () => {
		expect(() => resolveBookToken("toString")).toThrow("Unknown book identifier");
		expect(() => resolveBookToken("Jo")).toThrow("Ambiguous book identifier");
	});
});

describe("remote-tts CLI parsing & isolation", () => {
	it("normalizes optional --staging value and blocks --upload in staging or custom out-dir", () => {
		expect(normalizePreArgs(["--book", "RUT", "--staging"])).toEqual([
			"--book",
			"RUT",
			"--staging=default",
		]);
		expect(normalizePreArgs(["--book", "RUT", "--staging", "rut-test", "--force"])).toEqual([
			"--book",
			"RUT",
			"--staging",
			"rut-test",
			"--force",
		]);

		const stageOpts = parseCliOptions([
			"--thunder",
			"0",
			"--book",
			"RUT",
			"--staging",
			"rut-test",
			"--batch-size",
			"32",
			"--verbose",
		]);
		expect(stageOpts.remote).toBe(true);
		expect(stageOpts.thunder).toBe("0");
		expect(stageOpts.books).toEqual(["RUT"]);
		expect(stageOpts.staging).toBe("rut-test");
		expect(stageOpts.batchSize).toBe(32);
		expect(stageOpts.verbose).toBe(true);
		expect(stageOpts.upload).toBe(false);

		expect(() =>
			parseCliOptions(["--thunder", "0", "--book", "RUT", "--staging", "rut-test", "--upload"]),
		).toThrow("Refusing to upload to R2");
		expect(() =>
			parseCliOptions(["--thunder", "0", "--book", "RUT", "--out-dir", "/tmp/out", "--upload"]),
		).toThrow("Refusing to upload to R2");
		expect(() => parseCliOptions(["--staging", "../escape"])).toThrow("Invalid --staging name");
		expect(() => parseCliOptions(["--remote-dir", "~/../escape"])).toThrow("Unsafe --remote-dir");
	});

	it("keeps local runs local even when THUNDER_* defaults exist, and applies them for --remote", async () => {
		const dir = await makeTempDir("l2r-devvars-");
		const devVarsPath = join(dir, ".dev.vars");
		await writeFile(
			devVarsPath,
			[
				"# comment",
				"THUNDER_INSTANCE=0",
				'THUNDER_SSH_TARGET="tnr-0"',
				"THUNDER_SSH_PORT=2222",
				"THUNDER_REMOTE_DIR=~/custom-tts",
				"THUNDER_DEVICE=cuda",
			].join("\n"),
			"utf8",
		);
		const loaded = await loadDevVarsRecord(devVarsPath);
		expect(loaded.THUNDER_INSTANCE).toBe("0");
		expect(loaded.THUNDER_SSH_TARGET).toBe("tnr-0");

		const localOpts = parseCliOptions(["--book", "RUT"], loaded);
		expect(localOpts.remote).toBe(false);
		expect(localOpts.thunder).toBeUndefined();
		expect(localOpts.ssh).toBeUndefined();

		const remoteOpts = parseCliOptions(["--remote", "--books", "RUT,PHM"], loaded);
		expect(remoteOpts.remote).toBe(true);
		expect(remoteOpts.thunder).toBe("0");
		expect(remoteOpts.ssh).toBe("tnr-0");
		expect(remoteOpts.sshPort).toBe(2222);
		expect(remoteOpts.remoteDir).toBe("~/custom-tts");
		expect(remoteOpts.device).toBe("cuda");
		expect(remoteOpts.books).toEqual(["RUT", "PHM"]);
		expect(remoteOpts.upload).toBe(false);
		expect(remoteOpts.gpu).toBe(DEFAULT_THUNDER_VM_SPEC.gpu);
		expect(remoteOpts.mode).toBe(DEFAULT_THUNDER_VM_SPEC.mode);
		expect(remoteOpts.numGpus).toBe(DEFAULT_THUNDER_VM_SPEC.numGpus);
		expect(remoteOpts.vcpus).toBe(DEFAULT_THUNDER_VM_SPEC.vcpus);
		expect(remoteOpts.template).toBe(DEFAULT_THUNDER_VM_SPEC.template);
		expect(remoteOpts.diskSizeGb).toBe(DEFAULT_THUNDER_VM_SPEC.diskSizeGb);

		expect(buildTnrCreateArgs(parseCliOptions(["--create", "--book", "RUT"]))).toEqual([
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
				parseCliOptions(["--create", "--mode", "production", "--gpu", "a100", "--num-gpus", "2"]),
			),
		).toEqual([
			"--json",
			"-y",
			"create",
			"--mode",
			"production",
			"--gpu",
			"a100",
			"--num-gpus",
			"2",
			"--template",
			"cuda12-8",
			"--disk-size-gb",
			"100",
		]);
	});

	it("resolves isolated staging vs production output paths", () => {
		const root = "/workspace/logos2rhema";
		const prodOpts = parseCliOptions(["--thunder", "0", "--book", "RUT"]);
		const prodPaths = resolveOutputPaths(prodOpts, root);
		expect(prodPaths.mode).toBe("production");
		expect(prodPaths.localAudioDir).toBe(join(root, ".cache", "krv-supertonic-audio"));
		expect(prodPaths.localTimingsDir).toBe(
			join(root, "public", "data", "timings", "krv-supertonic"),
		);
		expect(prodPaths.remoteRunDir).toBe("~/logos2rhema-krv-tts/prod");

		const stageOpts = parseCliOptions(["--thunder", "0", "--book", "RUT", "--staging", "rut-test"]);
		const stagePaths = resolveOutputPaths(stageOpts, root);
		expect(stagePaths.mode).toBe("staging");
		expect(stagePaths.stagingName).toBe("rut-test");
		expect(stagePaths.localAudioDir).toBe(
			join(root, ".cache", "krv-supertonic-staging", "rut-test", "audio"),
		);
		expect(stagePaths.localTimingsDir).toBe(
			join(root, ".cache", "krv-supertonic-staging", "rut-test", "timings"),
		);
		expect(stagePaths.localReportPath).toBe(
			join(root, ".cache", "krv-supertonic-staging", "rut-test", "report.json"),
		);
		expect(stagePaths.remoteRunDir).toBe("~/logos2rhema-krv-tts/staging/rut-test");
	});
});

describe("SSH, POSIX quoting, and tnr parsing", () => {
	it("parses valid SSH targets and rejects option/shell injection", () => {
		expect(parseSshTarget("tnr-0")).toMatchObject({ target: "tnr-0", port: undefined });
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

		expect(() => parseSshTarget("-oProxyCommand=evil")).toThrow("Invalid SSH target");
		expect(() => parseSshTarget("ubuntu@host;rm -rf /")).toThrow("Invalid SSH target");
		expect(() => parseSshTarget("ubuntu@host\nid")).toThrow("Invalid SSH target");
		expect(() => parseSshTarget("ubuntu@host", undefined, undefined, ["bad\nopt"])).toThrow(
			"Invalid SSH option",
		);
	});

	it("quotes POSIX strings and formats remote tilde paths cleanly", () => {
		expect(quotePosix("it's clean")).toBe("'it'\"'\"'s clean'");
		expect(remoteDirBashExpr("~/logos2rhema-krv-tts/staging/rut-test")).toBe(
			"\"$HOME\"/'logos2rhema-krv-tts/staging/rut-test'",
		);
		expect(remoteDirBashExpr("/opt/tts")).toBe("'/opt/tts'");
		expect(remoteDirTransferPath("~/logos2rhema-krv-tts/prod")).toBe("logos2rhema-krv-tts/prod");
		expect(remoteDirTransferPath("/opt/tts")).toBe("/opt/tts");

		const rsh = buildRsyncRshCommand(parseSshTarget("ubuntu@198.51.100.2:2222"));
		expect(rsh).toContain("'BatchMode=yes'");
		expect(rsh).toContain("'2222'");
	});

	it("parses tnr --json status output, SSH config blocks, hardware probe, and CUDA package specs", () => {
		const rawTnr = `Fetching instances...\n[{"id":"0","uuid":"inst-abc","status":"RUNNING","gpuType":"a100","numGpus":"1","cpuCores":"8","ip":"198.51.100.42","port":22}]`;
		const instances = parseThunderStatusOutput(rawTnr);
		expect(instances).toHaveLength(1);
		expect(instances[0]).toMatchObject({
			id: "0",
			uuid: "inst-abc",
			status: "RUNNING",
			gpuType: "a100",
			ip: "198.51.100.42",
			port: 22,
		});

		const sshConfig = `
Host *
  ServerAliveInterval 60

Host tnr-0
  HostName 198.51.100.42
  User ubuntu
  Port 22
  IdentityFile ~/.ssh/thunder_key
`;
		const matched = findSshConfigMatch(sshConfig, instances[0]);
		expect(matched?.patterns[0]).toBe("tnr-0");
		expect(matched?.user).toBe("ubuntu");

		const probe = parseProbeOutput(
			[
				"OS=Linux",
				"ARCH=x86_64",
				"CPUS=8",
				"GPU=NVIDIA A100-SXM4-80GB, 81920 MiB",
				"CUDA_VER=12.8",
				"HAS_RSYNC=1",
				"HAS_UV=1",
				"PY_BIN=/usr/bin/python3",
			].join("\n"),
		);
		expect(probe).toMatchObject({
			os: "Linux",
			cpuCount: 8,
			cudaMajor: 12,
			hasNvidiaGpu: true,
			hasRsync: true,
		});

		expect(selectOnnxGpuSpec(12)).toBe("onnxruntime-gpu[cuda,cudnn]>=1.24.0,<1.27");
		expect(selectOnnxGpuSpec(13)).toBe("onnxruntime-gpu[cuda,cudnn]>=1.27.0");
	});
});

describe("safe local merging & upload multi-book parsing", () => {
	it("merges partial chapter timings and report entries without clobbering unrelated books", () => {
		const mergedBook = mergeBookTimingsPayload(
			{
				translationId: "krv",
				audioSource: "custom:krv:supertonic",
				usfm: "RUT",
				chapters: { "1": { "1": 1.1 }, "2": { "1": 2.2 }, "4": { "1": 4.4 } },
			},
			{
				chapters: { "3": { "1": 3.3 }, "1": { "1": 1.5 } },
			},
			"RUT",
		);
		expect(Object.keys(mergedBook.chapters as Record<string, unknown>)).toEqual([
			"1",
			"2",
			"3",
			"4",
		]);
		expect((mergedBook.chapters as Record<string, Record<string, number>>)["1"]["1"]).toBe(1.5);
		expect((mergedBook.chapters as Record<string, Record<string, number>>)["2"]["1"]).toBe(2.2);

		const mergedReport = mergeGenerationReportPayload(
			{
				chapters: {
					"GEN:1": { status: "ok", duration: 244.71 },
					"RUT:1": { status: "ok", duration: 90.0 },
				},
			},
			{
				chapters: {
					"RUT:1": { status: "ok", duration: 91.2 },
				},
				summary: { device: "cuda", completedInRun: 1 },
			},
		);
		const chapters = mergedReport.chapters as Record<string, { duration: number }>;
		expect(chapters["GEN:1"].duration).toBe(244.71);
		expect(chapters["RUT:1"].duration).toBe(91.2);
	});

	it("supports --books in upload-krv-audio.ts", () => {
		const single = parseUploadArgs(["--book", "PHM", "--dry-run"]);
		expect(single?.books).toEqual(["PHM"]);

		const multi = parseUploadArgs(["--books", "RUT,빌레몬서,JUD", "--dry-run"]);
		expect(multi?.books).toEqual(["RUT", "PHM", "JUD"]);
	});
});

describe("mocked Thunder Compute & SSH end-to-end orchestration", () => {
	it("runs RUT 4 chapters in isolated staging via tnr CLI without touching production audio or uploading to R2", async () => {
		const rootDir = await makeTempDir("l2r-e2e-stage-");
		await seedMockWorkspace(rootDir, ["RUT", "PHM"]);

		// Seed existing production audio & timings to assert they remain untouched.
		const prodMp3Path = join(rootDir, ".cache", "krv-supertonic-audio", "RUT", "1.mp3");
		await mkdir(join(rootDir, ".cache", "krv-supertonic-audio", "RUT"), { recursive: true });
		await writeFile(prodMp3Path, Buffer.alloc(2048, 0xaa));
		const prodTimingPath = join(rootDir, "public", "data", "timings", "krv-supertonic", "RUT.json");
		const prodTimingContent = JSON.stringify({
			translationId: "krv",
			audioSource: "custom:krv:supertonic",
			usfm: "RUT",
			chapters: { "1": { "1": 1.11 } },
		});
		await writeFile(prodTimingPath, prodTimingContent, "utf8");

		const commands: string[] = [];
		let uploadedManifestBooks = null as Record<string, number[]> | null;
		let uploadedBookFiles: string[] = [];
		let remoteScriptRan = "";

		const mockRunner: CommandRunner = {
			which(bin) {
				if (bin === "tnr") return "/usr/local/bin/tnr";
				return null;
			},
			async run(cmd, args): Promise<CommandResult> {
				commands.push(`${cmd} ${args.join(" ")}`);
				if (cmd === "/usr/local/bin/tnr" && args.includes("status")) {
					return {
						exitCode: 0,
						stdout: JSON.stringify([
							{
								id: "0",
								status: "RUNNING",
								gpuType: "a100",
								ip: "198.51.100.99",
								port: 22,
							},
						]),
						stderr: "Fetching instances...\n",
					};
				}
				if (cmd === "ssh" && args.some((a) => a.includes("nvidia-smi"))) {
					return {
						exitCode: 0,
						stdout: [
							"OS=Linux",
							"ARCH=x86_64",
							"CPUS=8",
							"GPU=NVIDIA A100 80GB, 81920 MiB",
							"CUDA_VER=12.8",
							"HAS_RSYNC=1",
							"HAS_UV=1",
							"PY_BIN=/usr/bin/python3",
						].join("\n"),
						stderr: "",
					};
				}
				if (cmd === "rsync") {
					const src = args[args.length - 2];
					const dst = args[args.length - 1];
					if (src.endsWith("/") && dst.includes("staging/rut-test")) {
						// Inspect staged payload
						const manifestRaw = await readFile(join(src, "job-manifest.json"), "utf8");
						uploadedManifestBooks = (JSON.parse(manifestRaw) as { books: Record<string, number[]> })
							.books;
						const krvDir = join(src, "public", "data", "bibles", "krv");
						const { readdir } = await import("node:fs/promises");
						uploadedBookFiles = await readdir(krvDir);
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
								translationId: "krv",
								audioSource: "custom:krv:supertonic",
								usfm: "RUT",
								chapters: {
									"1": { "1": 1.6, "2": 4.8 },
									"2": { "1": 1.5, "2": 5.1 },
									"3": { "1": 1.7, "2": 4.9 },
									"4": { "1": 1.6, "2": 5.0 },
								},
							}),
							"utf8",
						);
					}
					return { exitCode: 0, stdout: "", stderr: "" };
				}
				if (cmd === "ssh" && args.some((a) => a.includes("report.json"))) {
					return {
						exitCode: 0,
						stdout: JSON.stringify({
							chapters: { "RUT:1": { status: "ok", duration: 92.5 } },
							summary: { device: "cuda", completedInRun: 4, errorsInRun: 0 },
						}),
						stderr: "",
					};
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
			async runStreaming(cmd, args): Promise<{ exitCode: number }> {
				commands.push(`STREAM ${cmd} ${args.join(" ")}`);
				if (cmd === "ssh") {
					const scriptArg = args[args.length - 1];
					if (scriptArg.includes("generate-krv-audio.py")) {
						remoteScriptRan = scriptArg;
					}
				}
				return { exitCode: 0 };
			},
			async runInteractive(): Promise<number> {
				return 0;
			},
		};

		const exitCode = await runCli(
			["--thunder", "0", "--book", "RUT", "--staging", "rut-test", "--force"],
			rootDir,
			mockRunner,
		);
		expect(exitCode).toBe(0);

		// Verify only RUT.json was synced and manifest covers all 4 chapters of RUT
		expect(uploadedManifestBooks).toEqual({ RUT: [1, 2, 3, 4] });
		expect(uploadedBookFiles).toEqual(["RUT.json"]);
		expect(remoteScriptRan).toContain("staging/rut-test/out/audio");
		expect(remoteScriptRan).toContain("--device");
		expect(remoteScriptRan).toContain("cuda");

		// Verify staging outputs exist locally
		const stagedAudio1 = join(
			rootDir,
			".cache",
			"krv-supertonic-staging",
			"rut-test",
			"audio",
			"RUT",
			"4.mp3",
		);
		expect((await stat(stagedAudio1)).size).toBe(2048);
		const stagedTimings = JSON.parse(
			await readFile(
				join(rootDir, ".cache", "krv-supertonic-staging", "rut-test", "timings", "RUT.json"),
				"utf8",
			),
		) as { chapters: Record<string, unknown> };
		expect(Object.keys(stagedTimings.chapters)).toEqual(["1", "2", "3", "4"]);

		// Verify production files remained completely untouched & no R2 upload occurred
		expect(await readFile(prodTimingPath, "utf8")).toBe(prodTimingContent);
		expect(Buffer.from(await readFile(prodMp3Path))).toEqual(Buffer.alloc(2048, 0xaa));
		expect(commands.some((c) => c.includes("upload-krv-audio.ts"))).toBe(false);
	});

	it("supports direct --ssh multi-book runs without tnr, skips R2 by default, and supports explicit --upload", async () => {
		const rootDir = await makeTempDir("l2r-e2e-ssh-");
		await seedMockWorkspace(rootDir, ["PHM", "JUD"]);
		await writeFile(
			join(rootDir, ".cache", "krv-supertonic-report.json"),
			JSON.stringify({ chapters: { "GEN:1": { status: "ok", duration: 244.71 } } }),
			"utf8",
		).catch(async () => {
			await mkdir(join(rootDir, ".cache"), { recursive: true });
			await writeFile(
				join(rootDir, ".cache", "krv-supertonic-report.json"),
				JSON.stringify({ chapters: { "GEN:1": { status: "ok", duration: 244.71 } } }),
				"utf8",
			);
		});

		const streamingCommands: string[] = [];
		const tnrCalls: string[] = [];

		const runner: CommandRunner = {
			which(bin) {
				return bin === "tnr" ? "/usr/local/bin/tnr" : null;
			},
			async run(cmd, args): Promise<CommandResult> {
				if (cmd.includes("tnr")) tnrCalls.push(args.join(" "));
				if (cmd === "ssh" && args.some((a) => a.includes("nvidia-smi"))) {
					return {
						exitCode: 0,
						stdout: "OS=Linux\nARCH=x86_64\nCPUS=4\nGPU=\nCUDA_VER=\nHAS_RSYNC=1\nHAS_UV=1\n",
						stderr: "",
					};
				}
				if (cmd === "rsync") {
					const src = args[args.length - 2];
					const dst = args[args.length - 1];
					if (src.includes("out/audio/")) {
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
					return { exitCode: 0, stdout: "", stderr: "" };
				}
				if (cmd === "ssh" && args.some((a) => a.includes("report.json"))) {
					return {
						exitCode: 0,
						stdout: JSON.stringify({
							chapters: { "PHM:1": { status: "ok" }, "JUD:1": { status: "ok" } },
						}),
						stderr: "",
					};
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
			async runStreaming(cmd, args): Promise<{ exitCode: number }> {
				streamingCommands.push(`${cmd} ${args.join(" ")}`);
				return { exitCode: 0 };
			},
			async runInteractive(): Promise<number> {
				return 0;
			},
		};

		// 1. Explicit --ssh without --upload: does not call tnr and does not upload to R2
		const codeNoUpload = await runCli(
			["--ssh", "ubuntu@203.0.113.5:2222", "--books", "PHM,JUD", "--force"],
			rootDir,
			runner,
		);
		expect(codeNoUpload).toBe(0);
		expect(tnrCalls).toHaveLength(0);
		expect(streamingCommands.some((c) => c.includes("upload-krv-audio.ts"))).toBe(false);

		const mergedReport = JSON.parse(
			await readFile(join(rootDir, ".cache", "krv-supertonic-report.json"), "utf8"),
		) as { chapters: Record<string, unknown> };
		expect(Object.keys(mergedReport.chapters)).toEqual(["GEN:1", "PHM:1", "JUD:1"]);

		// 2. Explicit --upload triggers upload-krv-audio.ts with --books PHM,JUD
		const codeWithUpload = await runCli(
			["--ssh", "ubuntu@203.0.113.5:2222", "--books", "PHM,JUD", "--force", "--upload"],
			rootDir,
			runner,
		);
		expect(codeWithUpload).toBe(0);
		const uploadCmd = streamingCommands.find((c) => c.includes("upload-krv-audio.ts"));
		expect(uploadCmd).toBeDefined();
		expect(uploadCmd).toContain("--books PHM,JUD");
	});

	it("verifies staging outputs and catches corrupted or missing outputs", async () => {
		const rootDir = await makeTempDir("l2r-verify-");
		const opts = parseCliOptions([
			"--thunder",
			"0",
			"--book",
			"RUT",
			"--staging",
			"vtest",
			"--force",
		]);
		const paths = resolveOutputPaths(opts, rootDir);
		const plan = await buildPendingJobPlan(opts, paths);
		expect(plan.pendingChapters).toBe(4);

		// Before files exist, verification reports errors
		const bad = await verifyAndSummarizeOutputs(plan, paths, rootDir);
		expect(bad.ok).toBe(false);
		expect(bad.errors.length).toBeGreaterThan(0);

		// Populate valid outputs -> verification passes
		await mkdir(join(paths.localAudioDir, "RUT"), { recursive: true });
		await mkdir(paths.localTimingsDir, { recursive: true });
		for (const ch of [1, 2, 3, 4]) {
			await writeFile(join(paths.localAudioDir, "RUT", `${ch}.mp3`), Buffer.alloc(1500, ch));
		}
		await writeFile(
			join(paths.localTimingsDir, "RUT.json"),
			JSON.stringify({
				chapters: {
					"1": { "1": 1.2, "2": 3.4 },
					"2": { "1": 1.3 },
					"3": { "1": 1.4 },
					"4": { "1": 1.5 },
				},
			}),
			"utf8",
		);
		const good = await verifyAndSummarizeOutputs(plan, paths, rootDir);
		expect(good.ok).toBe(true);
		expect(good.errors).toEqual([]);
	});
});
