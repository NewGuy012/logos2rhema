import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs as parseCliArgs } from "node:util";

import { BIBLE_BOOKS } from "../../src/shared/books";
import type { BookMeta } from "../../src/shared/types";
import { resolveBookList } from "./book-selection";

export type DevicePreference = "auto" | "cuda" | "cpu";
export type TransferMethod = "auto" | "rsync" | "tnr-scp" | "tar";

export interface CliOptions {
	books?: string[];
	testament?: "OT" | "NT";
	all: boolean;
	chapters?: number[];
	voice: string;
	speed: number;
	steps: number;
	pause: number;
	headerPause: number;
	bitrate: number;
	device: DevicePreference;
	workers: number;
	threads: number;
	batchSize: number;
	mp3Quality: number;
	verbose: boolean;
	force: boolean;
	dryRun: boolean;
	remote: boolean;
	thunder?: string;
	ssh?: string;
	sshPort?: number;
	sshKey?: string;
	sshOptions: string[];
	remoteDir: string;
	transfer: TransferMethod;
	staging?: string;
	outDir?: string;
	setupOnly: boolean;
	shell: boolean;
	pullOnly: boolean;
	create: boolean;
	deleteAfter: boolean;
	gpu?: string;
	mode?: string;
	numGpus?: number;
	vcpus?: number;
	diskSizeGb?: number;
	template?: string;
	tnrSshKey?: string;
	upload: boolean;
	r2Bucket?: string;
	help: boolean;
}

export interface SshEndpoint {
	target: string;
	port?: number;
	keyPath?: string;
	options: string[];
	strictHostKeyChecking: string;
}

export interface ThunderInstanceInfo {
	id: string;
	uuid?: string;
	name?: string;
	status: string;
	gpuType?: string;
	numGpus?: string;
	cpuCores?: string;
	memory?: string;
	ip?: string;
	port?: number;
	mode?: string;
	template?: string;
}

export interface RemoteHardwareProbe {
	os: string;
	arch: string;
	cpuCount: number;
	gpuName?: string;
	cudaMajor?: number;
	hasNvidiaGpu: boolean;
	hasRsync: boolean;
	hasUv: boolean;
	pythonPath?: string;
}

export interface OutputPaths {
	mode: "production" | "staging" | "custom";
	stagingName?: string;
	localAudioDir: string;
	localTimingsDir: string;
	localReportPath: string;
	remoteBaseDir: string;
	remoteRunDir: string;
	remoteAudioDir: string;
	remoteTimingsDir: string;
	remoteReportPath: string;
}

export interface JobPlan {
	books: BookMeta[];
	chaptersByBook: Record<string, number[]>;
	totalSelectedChapters: number;
	pendingChapters: number;
	skippedChapters: number;
}

export interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface CommandRunner {
	which(bin: string): string | null;
	run(
		cmd: string,
		args: string[],
		opts?: { cwd?: string; env?: Record<string, string | undefined>; stdin?: "ignore" },
	): Promise<CommandResult>;
	runStreaming(
		cmd: string,
		args: string[],
		opts?: {
			cwd?: string;
			env?: Record<string, string | undefined>;
			onChild?: (kill: () => void) => void;
		},
	): Promise<{ exitCode: number }>;
	runInteractive(
		cmd: string,
		args: string[],
		opts?: { cwd?: string; env?: Record<string, string | undefined> },
	): Promise<number>;
}

const DEFAULT_REMOTE_DIR = "~/logos2rhema-krv-tts";
export const DEFAULT_THUNDER_VM_SPEC = {
	mode: "prototyping",
	gpu: "a6000",
	numGpus: 1,
	vcpus: 8,
	template: "cuda12-8",
	diskSizeGb: 100,
} as const;
const STAGING_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const SAFE_SSH_TARGET_RE = /^[^\s\x00-\x1f\x7f]+$/;
const VALID_USFM_SET = new Set(BIBLE_BOOKS.map((b) => b.usfm));
const MP3_NAME_RE = /^(\d+)\.mp3$/;
const TIMINGS_FILE_RE = /^([A-Z0-9]+)\.json$/;
const AUDIO_SOURCE_ID = "custom:krv:supertonic";

function stripOptionalQuotes(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

export async function loadDevVarsRecord(devVarsPath: string): Promise<Record<string, string>> {
	const file = Bun.file(devVarsPath);
	if (!(await file.exists())) {
		return {};
	}
	const raw = await file.text();
	const bindings: Record<string, string> = {};
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
		const eqIdx = normalized.indexOf("=");
		if (eqIdx <= 0) continue;
		const key = normalized.slice(0, eqIdx).trim();
		const value = stripOptionalQuotes(normalized.slice(eqIdx + 1).trim());
		if (key) {
			bindings[key] = value;
		}
	}
	return bindings;
}

export function expandLocalHome(rawPath: string): string {
	if (rawPath === "~") return homedir();
	if (rawPath.startsWith("~/")) return join(homedir(), rawPath.slice(2));
	return rawPath;
}

export function normalizePreArgs(argv: readonly string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--staging") {
			const next = argv[i + 1];
			if (!next || next.startsWith("-")) {
				out.push("--staging=default");
			} else {
				out.push("--staging", next);
				i++;
			}
			continue;
		}
		out.push(arg);
	}
	return out;
}

function parseNumberInRange(
	raw: string,
	flag: string,
	min: number,
	max: number,
	isInt: boolean,
): number {
	const trimmed = raw.trim();
	const valid = isInt ? /^\d+$/.test(trimmed) : /^-?\d+(?:\.\d+)?$/.test(trimmed);
	if (!valid) {
		throw new Error(`Invalid value for ${flag}: "${raw}"`);
	}
	const parsed = isInt ? Number.parseInt(trimmed, 10) : Number.parseFloat(trimmed);
	if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
		throw new Error(`Out-of-range value for ${flag}: ${parsed} (expected ${min}..${max})`);
	}
	return parsed;
}

function parseChapterList(raw: string): number[] {
	const seen = new Set<number>();
	const chapters: number[] = [];
	for (const part of raw.split(",")) {
		const token = part.trim();
		if (!token) continue;
		const ch = parseNumberInRange(token, "--chapters", 1, 150, true);
		if (!seen.has(ch)) {
			seen.add(ch);
			chapters.push(ch);
		}
	}
	if (chapters.length === 0) {
		throw new Error("Expected at least one chapter number for --chapters.");
	}
	return chapters;
}

export function getUsageText(): string {
	return `Usage: bun run audio:generate-krv [options]

Book & Chapter Scope:
  --book, --books <LIST>    Book name(s) or USFM codes (e.g. RUT or RUT,PHM or "룻기")
  --testament <OT|NT>       Generate all Old or New Testament books
  --all                     Generate all 66 books (default when no scope flag is passed)
  --chapters <LIST>         Optional comma-separated chapter numbers (e.g. 1,3)

Thunder Compute (tnr CLI) & SSH Offload:
  --thunder <ID>            Run on Thunder Compute instance ID/name via tnr CLI
  --ssh <TARGET>            Run via explicit SSH target (alias, user@host, or user@host:port)
  --remote                  Use THUNDER_INSTANCE / THUNDER_SSH_TARGET from .dev.vars or env
  --ssh-port <PORT>         Override SSH port (1-65535)
  --ssh-key <PATH>          Override SSH private key path
  --ssh-option <OPT>        Extra OpenSSH -o option (repeatable)
  --remote-dir <PATH>       Remote base directory (default: ${DEFAULT_REMOTE_DIR})
  --transfer <MODE>         File transfer mode: auto | rsync | tnr-scp | tar (default: auto)

Staging Isolation & Lifecycle:
  --staging [NAME]          Isolate remote (<remote-dir>/staging/<NAME>) and local (.cache/krv-supertonic-staging/<NAME>) outputs
  --out-dir <DIR>           Write outputs to a custom local directory (also isolated remotely)
  --setup-only              Bootstrap remote venv + Supertonic 3 weights without synthesizing
  --shell                   Open interactive remote shell (tnr connect or ssh)
  --pull-only               Pull existing remote outputs into local staging/prod without synthesizing
  --create                  Provision a new Thunder instance via 'tnr create' if needed
  --gpu <TYPE>              GPU type for --create (default: ${DEFAULT_THUNDER_VM_SPEC.gpu})
  --mode <MODE>             Instance mode for --create (default: ${DEFAULT_THUNDER_VM_SPEC.mode})
  --num-gpus <N>            GPU count for --create (default: ${DEFAULT_THUNDER_VM_SPEC.numGpus})
  --vcpus <N>               vCPU count for --create (default: ${DEFAULT_THUNDER_VM_SPEC.vcpus})
  --disk-size-gb <GB>       Disk size in GB for --create (default: ${DEFAULT_THUNDER_VM_SPEC.diskSizeGb})
  --template <NAME>         Template for --create (default: ${DEFAULT_THUNDER_VM_SPEC.template})
  --tnr-ssh-key <NAME>      Saved Thunder SSH key name for --create
  --delete-after            Delete the Thunder instance via 'tnr delete' after clean sync

Synthesis & Upload Options:
  --device <MODE>           ONNX execution device: auto | cuda | cpu (default: auto)
  --voice <NAME>            Voice style name or alias (default: Daniel -> M5)
  --speed <FLOAT>           Speech speed 0.7-2.0 (default: 0.95)
  --steps <INT>             Flow-matching inference steps 1-100 (default: 10)
  --pause <FLOAT>           Inter-verse silence pause in seconds (default: 0.30)
  --header-pause <FLOAT>    Pause after chapter header in seconds (default: 0.60)
  --bitrate <INT>           CBR MP3 bitrate in kbps (default: 96)
  --workers <INT>           Worker processes (0 = auto)
  --threads <INT>           ONNX intra-op threads per worker (default: 2)
  --batch-size <INT>        Chunks per ONNX call (0 = auto: 64 on CUDA, 1 on CPU)
  --mp3-quality <INT>       LAME MP3 quality 0 (best/slowest) to 9 (fastest) (default: 2)
  --verbose                 Show ONNX Runtime startup warnings
  --force                   Regenerate chapters even if outputs already exist
  --dry-run                 Validate scope and probe remote VM without synthesizing
  --upload                  Opt-in R2 upload after generation (OFF by default; blocked in staging)
  --r2-bucket <NAME>        Target R2 bucket when --upload is set
  -h, --help                Show this help message`;
}

export function parseCliOptions(
	argv: readonly string[],
	env: Record<string, string | undefined> = process.env,
): CliOptions {
	const normalizedArgv = normalizePreArgs(argv);
	const { values } = parseCliArgs({
		args: normalizedArgv,
		options: {
			help: { type: "boolean", short: "h" },
			book: { type: "string", multiple: true },
			books: { type: "string", multiple: true },
			testament: { type: "string" },
			all: { type: "boolean" },
			chapters: { type: "string" },
			chapter: { type: "string" },
			voice: { type: "string" },
			speed: { type: "string" },
			steps: { type: "string" },
			pause: { type: "string" },
			"header-pause": { type: "string" },
			bitrate: { type: "string" },
			device: { type: "string" },
			workers: { type: "string" },
			threads: { type: "string" },
			"batch-size": { type: "string" },
			"mp3-quality": { type: "string" },
			verbose: { type: "boolean" },
			force: { type: "boolean" },
			"dry-run": { type: "boolean" },
			remote: { type: "boolean" },
			thunder: { type: "string" },
			ssh: { type: "string" },
			"ssh-port": { type: "string" },
			"ssh-key": { type: "string" },
			"ssh-option": { type: "string", multiple: true },
			"remote-dir": { type: "string" },
			transfer: { type: "string" },
			staging: { type: "string" },
			"out-dir": { type: "string" },
			"setup-only": { type: "boolean" },
			shell: { type: "boolean" },
			"pull-only": { type: "boolean" },
			create: { type: "boolean" },
			"delete-after": { type: "boolean" },
			gpu: { type: "string" },
			mode: { type: "string" },
			"num-gpus": { type: "string" },
			vcpus: { type: "string" },
			"disk-size-gb": { type: "string" },
			template: { type: "string" },
			"tnr-ssh-key": { type: "string" },
			upload: { type: "boolean" },
			"r2-bucket": { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});

	if (values.help) {
		return {
			all: false,
			voice: "Daniel",
			speed: 0.95,
			steps: 10,
			pause: 0.3,
			headerPause: 0.6,
			bitrate: 96,
			device: "auto",
			workers: 0,
			threads: 2,
			batchSize: 0,
			mp3Quality: 2,
			verbose: false,
			force: false,
			dryRun: false,
			remote: false,
			sshOptions: [],
			remoteDir: DEFAULT_REMOTE_DIR,
			transfer: "auto",
			setupOnly: false,
			shell: false,
			pullOnly: false,
			create: false,
			deleteAfter: false,
			upload: false,
			help: true,
		};
	}

	const rawBooks = [...(values.book ?? []), ...(values.books ?? [])];
	const books = rawBooks.length > 0 ? resolveBookList(rawBooks).map((b) => b.usfm) : undefined;

	let testament: "OT" | "NT" | undefined;
	if (values.testament !== undefined) {
		const norm = values.testament.trim().toUpperCase();
		if (norm !== "OT" && norm !== "NT") {
			throw new Error(`Invalid --testament value: "${values.testament}" (expected OT or NT)`);
		}
		testament = norm;
	}

	const all = Boolean(values.all);
	const scopeCount = Number(Boolean(books)) + Number(Boolean(testament)) + Number(all);
	if (scopeCount > 1) {
		throw new Error("Options --book/--books, --testament, and --all are mutually exclusive.");
	}

	const rawChapters = values.chapters ?? values.chapter;
	if (values.chapters !== undefined && values.chapter !== undefined) {
		throw new Error("Pass either --chapters or --chapter, not both.");
	}
	const chapters = rawChapters !== undefined ? parseChapterList(rawChapters) : undefined;

	const rawDevice = (values.device ?? env.THUNDER_DEVICE ?? "auto").trim().toLowerCase();
	if (rawDevice !== "auto" && rawDevice !== "cuda" && rawDevice !== "cpu") {
		throw new Error(`Invalid --device value: "${rawDevice}" (expected auto, cuda, or cpu)`);
	}
	const device: DevicePreference = rawDevice;

	const rawTransfer = (values.transfer ?? "auto").trim().toLowerCase();
	if (
		rawTransfer !== "auto" &&
		rawTransfer !== "rsync" &&
		rawTransfer !== "tnr-scp" &&
		rawTransfer !== "tar"
	) {
		throw new Error(
			`Invalid --transfer value: "${rawTransfer}" (expected auto, rsync, tnr-scp, or tar)`,
		);
	}
	const transfer: TransferMethod = rawTransfer;

	const explicitRemote =
		Boolean(values.remote) ||
		values.thunder !== undefined ||
		values.ssh !== undefined ||
		Boolean(values.create) ||
		Boolean(values["setup-only"]) ||
		Boolean(values.shell) ||
		Boolean(values["pull-only"]);

	const thunder =
		values.thunder?.trim() ||
		(explicitRemote ? env.THUNDER_INSTANCE?.trim() : undefined) ||
		undefined;
	const ssh =
		values.ssh?.trim() ||
		(explicitRemote ? env.THUNDER_SSH_TARGET?.trim() : undefined) ||
		undefined;

	const rawPort = values["ssh-port"] ?? (explicitRemote ? env.THUNDER_SSH_PORT : undefined);
	const sshPort =
		rawPort !== undefined && rawPort.trim() !== ""
			? parseNumberInRange(rawPort, "--ssh-port", 1, 65535, true)
			: undefined;

	const rawKey = values["ssh-key"] ?? (explicitRemote ? env.THUNDER_SSH_KEY : undefined);
	const sshKey = rawKey?.trim() ? expandLocalHome(rawKey.trim()) : undefined;

	const remoteDir =
		values["remote-dir"]?.trim() ||
		(explicitRemote ? env.THUNDER_REMOTE_DIR?.trim() : undefined) ||
		DEFAULT_REMOTE_DIR;
	if (/[\x00-\x1f\x7f]/.test(remoteDir) || remoteDir.split("/").includes("..")) {
		throw new Error(`Unsafe --remote-dir path: "${remoteDir}"`);
	}

	const staging = values.staging !== undefined ? values.staging.trim() : undefined;
	if (staging !== undefined && !STAGING_NAME_RE.test(staging)) {
		throw new Error(
			`Invalid --staging name "${staging}". Use only letters, digits, '.', '_', or '-'.`,
		);
	}

	const outDir = values["out-dir"]?.trim() || undefined;
	if (staging !== undefined && outDir !== undefined) {
		throw new Error("Options --staging and --out-dir are mutually exclusive.");
	}

	const upload = Boolean(values.upload);
	if (upload && (staging !== undefined || outDir !== undefined)) {
		throw new Error(
			"Refusing to upload to R2 while --staging or --out-dir is active. Generate in production mode or run `bun run audio:upload-krv` separately.",
		);
	}
	if (
		upload &&
		(values["dry-run"] || values["setup-only"] || values.shell || values["pull-only"])
	) {
		throw new Error(
			"--upload cannot be combined with --dry-run, --setup-only, --shell, or --pull-only.",
		);
	}

	const utilityCount =
		Number(Boolean(values["setup-only"])) +
		Number(Boolean(values.shell)) +
		Number(Boolean(values["pull-only"]));
	if (utilityCount > 1) {
		throw new Error("Options --setup-only, --shell, and --pull-only are mutually exclusive.");
	}

	return {
		books,
		testament,
		all,
		chapters,
		voice: values.voice?.trim() || "Daniel",
		speed:
			values.speed !== undefined
				? parseNumberInRange(values.speed, "--speed", 0.7, 2.0, false)
				: 0.95,
		steps:
			values.steps !== undefined ? parseNumberInRange(values.steps, "--steps", 1, 100, true) : 10,
		pause:
			values.pause !== undefined ? parseNumberInRange(values.pause, "--pause", 0, 10, false) : 0.3,
		headerPause:
			values["header-pause"] !== undefined
				? parseNumberInRange(values["header-pause"], "--header-pause", 0, 10, false)
				: 0.6,
		bitrate:
			values.bitrate !== undefined
				? parseNumberInRange(values.bitrate, "--bitrate", 32, 320, true)
				: 96,
		device,
		workers:
			values.workers !== undefined
				? parseNumberInRange(values.workers, "--workers", 0, 64, true)
				: 0,
		threads:
			values.threads !== undefined
				? parseNumberInRange(values.threads, "--threads", 1, 32, true)
				: 2,
		batchSize:
			values["batch-size"] !== undefined
				? parseNumberInRange(values["batch-size"], "--batch-size", 0, 128, true)
				: 0,
		mp3Quality:
			values["mp3-quality"] !== undefined
				? parseNumberInRange(values["mp3-quality"], "--mp3-quality", 0, 9, true)
				: 2,
		verbose: Boolean(values.verbose),
		force: Boolean(values.force),
		dryRun: Boolean(values["dry-run"]),
		remote: explicitRemote,
		thunder,
		ssh,
		sshPort,
		sshKey,
		sshOptions: values["ssh-option"] ?? [],
		remoteDir,
		transfer,
		staging,
		outDir,
		setupOnly: Boolean(values["setup-only"]),
		shell: Boolean(values.shell),
		pullOnly: Boolean(values["pull-only"]),
		create: Boolean(values.create),
		deleteAfter: Boolean(values["delete-after"]),
		gpu:
			values.gpu?.trim() ||
			(explicitRemote ? env.THUNDER_GPU?.trim() || DEFAULT_THUNDER_VM_SPEC.gpu : undefined),
		mode:
			values.mode?.trim() ||
			(explicitRemote ? env.THUNDER_MODE?.trim() || DEFAULT_THUNDER_VM_SPEC.mode : undefined),
		numGpus:
			values["num-gpus"] !== undefined
				? parseNumberInRange(values["num-gpus"], "--num-gpus", 1, 8, true)
				: explicitRemote
					? env.THUNDER_NUM_GPUS?.trim()
						? parseNumberInRange(env.THUNDER_NUM_GPUS, "THUNDER_NUM_GPUS", 1, 8, true)
						: DEFAULT_THUNDER_VM_SPEC.numGpus
					: undefined,
		vcpus:
			values.vcpus !== undefined
				? parseNumberInRange(values.vcpus, "--vcpus", 1, 256, true)
				: explicitRemote
					? env.THUNDER_VCPUS?.trim()
						? parseNumberInRange(env.THUNDER_VCPUS, "THUNDER_VCPUS", 1, 256, true)
						: DEFAULT_THUNDER_VM_SPEC.vcpus
					: undefined,
		diskSizeGb:
			values["disk-size-gb"] !== undefined
				? parseNumberInRange(values["disk-size-gb"], "--disk-size-gb", 20, 4000, true)
				: explicitRemote
					? env.THUNDER_DISK_SIZE_GB?.trim()
						? parseNumberInRange(env.THUNDER_DISK_SIZE_GB, "THUNDER_DISK_SIZE_GB", 20, 4000, true)
						: DEFAULT_THUNDER_VM_SPEC.diskSizeGb
					: undefined,
		template:
			values.template?.trim() ||
			(explicitRemote
				? env.THUNDER_TEMPLATE?.trim() || DEFAULT_THUNDER_VM_SPEC.template
				: undefined),
		tnrSshKey: values["tnr-ssh-key"]?.trim() || undefined,
		upload,
		r2Bucket: values["r2-bucket"]?.trim() || undefined,
		help: false,
	};
}

export function resolveOutputPaths(options: CliOptions, rootDir: string): OutputPaths {
	const cleanBase = options.remoteDir.replace(/\/+$/, "") || DEFAULT_REMOTE_DIR;

	if (options.staging !== undefined) {
		const localStageRoot = join(rootDir, ".cache", "krv-supertonic-staging", options.staging);
		const remoteRunDir = `${cleanBase}/staging/${options.staging}`;
		return {
			mode: "staging",
			stagingName: options.staging,
			localAudioDir: join(localStageRoot, "audio"),
			localTimingsDir: join(localStageRoot, "timings"),
			localReportPath: join(localStageRoot, "report.json"),
			remoteBaseDir: cleanBase,
			remoteRunDir,
			remoteAudioDir: `${remoteRunDir}/out/audio`,
			remoteTimingsDir: `${remoteRunDir}/out/timings`,
			remoteReportPath: `${remoteRunDir}/out/report.json`,
		};
	}

	if (options.outDir !== undefined) {
		const customRoot = resolve(rootDir, expandLocalHome(options.outDir));
		const hash = createHash("sha256").update(customRoot).digest("hex").slice(0, 10);
		const remoteRunDir = `${cleanBase}/staging/out-${hash}`;
		return {
			mode: "custom",
			localAudioDir: join(customRoot, "audio"),
			localTimingsDir: join(customRoot, "timings"),
			localReportPath: join(customRoot, "report.json"),
			remoteBaseDir: cleanBase,
			remoteRunDir,
			remoteAudioDir: `${remoteRunDir}/out/audio`,
			remoteTimingsDir: `${remoteRunDir}/out/timings`,
			remoteReportPath: `${remoteRunDir}/out/report.json`,
		};
	}

	const remoteRunDir = `${cleanBase}/prod`;
	return {
		mode: "production",
		localAudioDir: join(rootDir, ".cache", "krv-supertonic-audio"),
		localTimingsDir: join(rootDir, "public", "data", "timings", "krv-supertonic"),
		localReportPath: join(rootDir, ".cache", "krv-supertonic-report.json"),
		remoteBaseDir: cleanBase,
		remoteRunDir,
		remoteAudioDir: `${remoteRunDir}/out/audio`,
		remoteTimingsDir: `${remoteRunDir}/out/timings`,
		remoteReportPath: `${remoteRunDir}/out/report.json`,
	};
}

export function quotePosix(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function remoteDirBashExpr(remotePath: string): string {
	if (remotePath === "~") return `"$HOME"`;
	if (remotePath.startsWith("~/")) {
		const rest = remotePath.slice(2);
		return `"$HOME"/${quotePosix(rest)}`;
	}
	return quotePosix(remotePath);
}

export function remoteDirTransferPath(remotePath: string): string {
	if (remotePath === "~") return ".";
	if (remotePath.startsWith("~/")) return remotePath.slice(2);
	return remotePath;
}

export function parseSshTarget(
	rawTarget: string,
	portOverride?: number,
	keyPath?: string,
	extraOptions: readonly string[] = [],
): SshEndpoint {
	const trimmed = rawTarget.trim();
	if (!trimmed || trimmed.startsWith("-") || !SAFE_SSH_TARGET_RE.test(trimmed)) {
		throw new Error(`Invalid SSH target: "${rawTarget}"`);
	}

	for (const opt of extraOptions) {
		if (!opt.trim() || /[\x00-\x1f\x7f]/.test(opt)) {
			throw new Error(`Invalid SSH option: "${opt}"`);
		}
	}

	let target = trimmed;
	let parsedPort: number | undefined;

	if (trimmed.startsWith("ssh://")) {
		const url = new URL(trimmed);
		if (!url.hostname || (url.pathname !== "" && url.pathname !== "/")) {
			throw new Error(`Unsupported ssh:// target format: "${rawTarget}"`);
		}
		target = url.username ? `${url.username}@${url.hostname}` : url.hostname;
		if (url.port) {
			parsedPort = parseNumberInRange(url.port, "--ssh port", 1, 65535, true);
		}
	} else {
		const bracketMatch = /^((?:[^@]+@)?\[[^\]]+\]):(\d+)$/.exec(trimmed);
		if (bracketMatch) {
			target = bracketMatch[1];
			parsedPort = parseNumberInRange(bracketMatch[2], "--ssh port", 1, 65535, true);
		} else {
			const colonParts = trimmed.split(":");
			if (colonParts.length === 2 && /^\d+$/.test(colonParts[1]) && !trimmed.includes("[")) {
				target = colonParts[0];
				parsedPort = parseNumberInRange(colonParts[1], "--ssh port", 1, 65535, true);
			}
		}
	}

	if (!target || target.startsWith("-") || !SAFE_SSH_TARGET_RE.test(target)) {
		throw new Error(`Invalid SSH host target parsed from "${rawTarget}"`);
	}

	return {
		target,
		port: portOverride ?? parsedPort,
		keyPath: keyPath ? expandLocalHome(keyPath) : undefined,
		options: [...extraOptions],
		strictHostKeyChecking: "accept-new",
	};
}

function asOptionalString(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return undefined;
}

function asOptionalPort(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535) {
		return value;
	}
	if (typeof value === "string" && /^\d+$/.test(value.trim())) {
		const p = Number.parseInt(value.trim(), 10);
		if (p >= 1 && p <= 65535) return p;
	}
	return undefined;
}

function normalizeThunderRecord(raw: Record<string, unknown>): ThunderInstanceInfo {
	const id =
		asOptionalString(raw.id) ?? asOptionalString(raw.index) ?? asOptionalString(raw.uuid) ?? "0";
	return {
		id,
		uuid: asOptionalString(raw.uuid),
		name: asOptionalString(raw.name),
		status: (asOptionalString(raw.status) ?? "UNKNOWN").toUpperCase(),
		gpuType: asOptionalString(raw.gpuType ?? raw.gpu_type ?? raw.gpu),
		numGpus: asOptionalString(raw.numGpus ?? raw.num_gpus),
		cpuCores: asOptionalString(raw.cpuCores ?? raw.cpu_cores ?? raw.vcpus),
		memory: asOptionalString(raw.memory ?? raw.ram),
		ip: asOptionalString(raw.ip ?? raw.address ?? raw.host),
		port: asOptionalPort(raw.port ?? raw.sshPort ?? raw.ssh_port),
		mode: asOptionalString(raw.mode),
		template: asOptionalString(raw.template),
	};
}

export function extractJsonValue(rawText: string): unknown {
	const trimmed = rawText.trim();
	if (!trimmed) throw new Error("Empty JSON output from tnr CLI.");
	try {
		return JSON.parse(trimmed);
	} catch {
		const arrayIdx = trimmed.indexOf("[");
		const objIdx = trimmed.indexOf("{");
		const candidates = [arrayIdx, objIdx].filter((idx) => idx >= 0).sort((a, b) => a - b);
		for (const idx of candidates) {
			try {
				return JSON.parse(trimmed.slice(idx));
			} catch {
				// continue scanning
			}
		}
		throw new Error(`Failed to parse JSON output from tnr CLI: ${trimmed.slice(0, 200)}`);
	}
}

export function parseThunderStatusOutput(stdout: string): ThunderInstanceInfo[] {
	const parsed = extractJsonValue(stdout);
	const list = Array.isArray(parsed)
		? parsed
		: parsed &&
			  typeof parsed === "object" &&
			  Array.isArray((parsed as { instances?: unknown }).instances)
			? (parsed as { instances: unknown[] }).instances
			: null;
	if (!list) {
		throw new Error("Unexpected JSON shape from `tnr --json status --no-wait`.");
	}
	return list
		.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
		.map(normalizeThunderRecord);
}

export interface SshConfigHostBlock {
	patterns: string[];
	hostName?: string;
	user?: string;
	port?: number;
	identityFile?: string;
}

export function parseSshConfig(configText: string): SshConfigHostBlock[] {
	const blocks: SshConfigHostBlock[] = [];
	let current: SshConfigHostBlock | null = null;

	for (const rawLine of configText.split(/\r?\n/)) {
		const withoutComment = rawLine.replace(/#.*$/, "").trim();
		if (!withoutComment) continue;
		const match = /^([A-Za-z]+)\s+(.+)$/.exec(withoutComment);
		if (!match) continue;
		const key = match[1].toLowerCase();
		const value = stripOptionalQuotes(match[2].trim());

		if (key === "host") {
			current = { patterns: value.split(/\s+/).filter(Boolean) };
			blocks.push(current);
			continue;
		}
		if (!current) continue;
		if (key === "hostname") current.hostName = value;
		else if (key === "user") current.user = value;
		else if (key === "port" && /^\d+$/.test(value)) {
			current.port = Number.parseInt(value, 10);
		} else if (key === "identityfile") {
			current.identityFile = expandLocalHome(value);
		}
	}
	return blocks;
}

export function findSshConfigMatch(
	configText: string,
	instance: ThunderInstanceInfo,
): SshConfigHostBlock | undefined {
	const blocks = parseSshConfig(configText);
	const candidateAliases = new Set(
		[
			`tnr-${instance.id}`,
			`tnr_${instance.id}`,
			`thunder-${instance.id}`,
			`thunder_${instance.id}`,
			instance.name,
			instance.uuid,
		]
			.filter((v): v is string => Boolean(v))
			.map((v) => v.toLowerCase()),
	);

	// 1. Exact IP + optional port match (ignore wildcard-only patterns like `*`)
	if (instance.ip) {
		const ipMatch = blocks.find(
			(b) =>
				b.hostName === instance.ip &&
				(!instance.port || !b.port || b.port === instance.port) &&
				b.patterns.some((p) => !p.includes("*") && !p.includes("?")),
		);
		if (ipMatch) return ipMatch;
	}

	// 2. Alias match by Thunder conventions
	return blocks.find((b) =>
		b.patterns.some(
			(p) => !p.includes("*") && !p.includes("?") && candidateAliases.has(p.toLowerCase()),
		),
	);
}

export function selectBooksForOptions(options: CliOptions): BookMeta[] {
	if (options.testament === "OT") {
		return BIBLE_BOOKS.filter((b) => b.testament === "OT");
	}
	if (options.testament === "NT") {
		return BIBLE_BOOKS.filter((b) => b.testament === "NT");
	}
	if (options.books && options.books.length > 0) {
		const byUsfm = new Map(BIBLE_BOOKS.map((b) => [b.usfm, b]));
		return options.books.map((usfm) => {
			const found = byUsfm.get(usfm);
			if (!found) throw new Error(`Unknown USFM book code: "${usfm}"`);
			return found;
		});
	}
	return [...BIBLE_BOOKS];
}

async function fileExistsNonEmpty(path: string, minBytes = 1): Promise<boolean> {
	try {
		const info = await stat(path);
		return info.isFile() && info.size >= minBytes;
	} catch {
		return false;
	}
}

async function loadExistingTimingsChapters(path: string): Promise<Set<string>> {
	const file = Bun.file(path);
	if (!(await file.exists())) return new Set();
	try {
		const parsed = (await file.json()) as { chapters?: Record<string, unknown> };
		if (parsed && typeof parsed.chapters === "object" && parsed.chapters !== null) {
			return new Set(Object.keys(parsed.chapters));
		}
	} catch {
		// treat unreadable JSON as empty so chapters regenerate
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
				const hasMp3 = await fileExistsNonEmpty(mp3Path, 1025);
				const hasTiming = existingChapters.has(String(ch));
				if (hasMp3 && hasTiming) {
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

	return {
		books,
		chaptersByBook,
		totalSelectedChapters,
		pendingChapters,
		skippedChapters,
	};
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
		audioSource: AUDIO_SOURCE_ID,
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
		chapters: {
			...existingChapters,
			...incomingChapters,
		},
	};
	if (incoming.summary !== undefined) {
		merged.summary = incoming.summary;
	}
	return merged;
}

async function atomicWriteJsonFile(path: string, data: unknown, pretty = false): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	const body = pretty ? `${JSON.stringify(data, null, 2)}\n` : JSON.stringify(data);
	try {
		await writeFile(tmpPath, body, "utf8");
		await rename(tmpPath, path);
	} catch (err) {
		await rm(tmpPath, { force: true }).catch(() => {});
		throw err;
	}
}

export function createDefaultCommandRunner(): CommandRunner {
	return {
		which(bin) {
			return Bun.which(bin);
		},
		async run(cmd, args, opts) {
			const proc = Bun.spawn([cmd, ...args], {
				cwd: opts?.cwd,
				env: opts?.env ? { ...process.env, ...opts.env } : process.env,
				stdin: opts?.stdin === "ignore" ? "ignore" : undefined,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			return { exitCode, stdout, stderr };
		},
		async runStreaming(cmd, args, opts) {
			const proc = Bun.spawn([cmd, ...args], {
				cwd: opts?.cwd,
				env: opts?.env ? { ...process.env, ...opts.env } : process.env,
				stdin: "ignore",
				stdout: "inherit",
				stderr: "inherit",
			});
			opts?.onChild?.(() => {
				try {
					proc.kill("SIGTERM");
				} catch {
					// process may already have exited
				}
			});
			const exitCode = await proc.exited;
			return { exitCode };
		},
		async runInteractive(cmd, args, opts) {
			const proc = Bun.spawn([cmd, ...args], {
				cwd: opts?.cwd,
				env: opts?.env ? { ...process.env, ...opts.env } : process.env,
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			});
			return proc.exited;
		},
	};
}

export function resolveExecutable(
	runner: CommandRunner,
	name: string,
	fallbacks: readonly string[],
): string | null {
	const found = runner.which(name);
	if (found) return found;
	for (const candidate of fallbacks) {
		const expanded = expandLocalHome(candidate);
		const check = spawnSync("test", ["-x", expanded]);
		if (check.status === 0) return expanded;
	}
	return null;
}

export function resolveTnrBinary(runner: CommandRunner): string | null {
	return resolveExecutable(runner, "tnr", [
		"/usr/local/bin/tnr",
		"/opt/homebrew/bin/tnr",
		"~/.local/bin/tnr",
	]);
}

export function resolveUvBinary(runner: CommandRunner): string | null {
	return resolveExecutable(runner, "uv", [
		"/opt/homebrew/bin/uv",
		"~/.local/bin/uv",
		"/usr/local/bin/uv",
	]);
}

function buildSshBaseArgs(endpoint: SshEndpoint, controlPath?: string): string[] {
	const args: string[] = [
		"-o",
		"BatchMode=yes",
		"-o",
		`StrictHostKeyChecking=${endpoint.strictHostKeyChecking}`,
		"-o",
		"ServerAliveInterval=30",
		"-o",
		"ServerAliveCountMax=6",
		"-o",
		"ConnectTimeout=15",
	];
	if (controlPath) {
		args.push("-o", `ControlPath=${controlPath}`, "-o", "ControlPersist=60");
	}
	if (endpoint.port !== undefined) {
		args.push("-p", String(endpoint.port));
	}
	if (endpoint.keyPath) {
		args.push("-i", endpoint.keyPath, "-o", "IdentitiesOnly=yes");
	}
	for (const opt of endpoint.options) {
		args.push("-o", opt);
	}
	return args;
}

export function buildRsyncRshCommand(endpoint: SshEndpoint, controlPath?: string): string {
	return ["ssh", ...buildSshBaseArgs(endpoint, controlPath)].map(quotePosix).join(" ");
}

async function runRemoteBash(
	runner: CommandRunner,
	endpoint: SshEndpoint,
	controlPath: string | undefined,
	script: string,
	opts?: { streaming?: boolean; onChild?: (kill: () => void) => void },
): Promise<CommandResult> {
	const args = [
		...buildSshBaseArgs(endpoint, controlPath),
		endpoint.target,
		`bash -c ${quotePosix(script)}`,
	];
	if (opts?.streaming) {
		const res = await runner.runStreaming("ssh", args, { onChild: opts.onChild });
		return { exitCode: res.exitCode, stdout: "", stderr: "" };
	}
	return runner.run("ssh", args, { stdin: "ignore" });
}

function findMatchingInstance(
	instances: readonly ThunderInstanceInfo[],
	selector: string,
): ThunderInstanceInfo | undefined {
	const lower = selector.trim().toLowerCase();
	return instances.find(
		(inst) =>
			inst.id.toLowerCase() === lower ||
			inst.uuid?.toLowerCase() === lower ||
			inst.name?.toLowerCase() === lower,
	);
}

export function buildTnrCreateArgs(options: CliOptions): string[] {
	const args = ["--json", "-y", "create"];
	if (options.mode) args.push("--mode", options.mode);
	if (options.gpu) args.push("--gpu", options.gpu);
	if (
		options.numGpus !== undefined &&
		(options.numGpus > 1 || options.mode === "production" || options.gpu !== "a6000")
	) {
		args.push("--num-gpus", String(options.numGpus));
	}
	if (options.vcpus !== undefined && options.mode !== "production") {
		args.push("--vcpus", String(options.vcpus));
	}
	if (options.template) args.push("--template", options.template);
	if (options.diskSizeGb !== undefined) args.push("--disk-size-gb", String(options.diskSizeGb));
	if (options.tnrSshKey) args.push("--ssh-key", options.tnrSshKey);
	return args;
}

async function persistCreatedThunderKey(rawCreateStdout: string): Promise<void> {
	try {
		const parsed = extractJsonValue(rawCreateStdout) as { uuid?: unknown; key?: unknown } | null;
		if (
			parsed &&
			typeof parsed.uuid === "string" &&
			parsed.uuid.trim() &&
			typeof parsed.key === "string" &&
			parsed.key.includes("PRIVATE KEY")
		) {
			const keysDir = join(homedir(), ".thunder", "keys");
			await mkdir(keysDir, { recursive: true, mode: 0o700 });
			const keyPath = join(keysDir, parsed.uuid.trim());
			await writeFile(keyPath, parsed.key, { mode: 0o600 });
		}
	} catch {
		// ignore if non-JSON or key already managed via tnr connect
	}
}

async function createThunderInstance(
	tnrBin: string,
	options: CliOptions,
	runner: CommandRunner,
): Promise<ThunderInstanceInfo[]> {
	const args = buildTnrCreateArgs(options);

	console.log(`Provisioning Thunder Compute instance: tnr ${args.join(" ")}`);
	const created = await runner.run(tnrBin, args, { stdin: "ignore" });
	if (created.exitCode !== 0) {
		throw new Error(
			`\`tnr create\` failed (exit ${created.exitCode}): ${created.stderr.trim() || created.stdout.trim()}`,
		);
	}
	await persistCreatedThunderKey(created.stdout);
	const after = await runner.run(tnrBin, ["--json", "status", "--no-wait"], { stdin: "ignore" });
	if (after.exitCode !== 0) {
		throw new Error(
			`\`tnr status\` failed after create: ${after.stderr.trim() || after.stdout.trim()}`,
		);
	}
	return parseThunderStatusOutput(after.stdout);
}

async function resolveThunderInstance(
	tnrBin: string,
	options: CliOptions,
	runner: CommandRunner,
): Promise<ThunderInstanceInfo> {
	const fetchStatus = async (): Promise<ThunderInstanceInfo[]> => {
		const res = await runner.run(tnrBin, ["--json", "status", "--no-wait"], { stdin: "ignore" });
		if (res.exitCode !== 0) {
			const msg = res.stderr.trim() || res.stdout.trim();
			throw new Error(
				`\`tnr --json status --no-wait\` failed (exit ${res.exitCode}): ${msg}\nRun \`tnr login\` if you are not signed in.`,
			);
		}
		return parseThunderStatusOutput(res.stdout);
	};

	let instances = await fetchStatus();
	if (options.create && (!options.thunder || !findMatchingInstance(instances, options.thunder))) {
		instances = await createThunderInstance(tnrBin, options, runner);
	}

	if (instances.length === 0) {
		throw new Error(
			"No Thunder Compute instances found (`tnr --json status --no-wait` returned []). Create one with `tnr create` or pass `--create` (or use `--ssh <target>`).",
		);
	}

	let target: ThunderInstanceInfo | undefined;
	if (options.thunder) {
		target = findMatchingInstance(instances, options.thunder);
		if (!target) {
			const available = instances
				.map((i) => `${i.id} (${i.status}${i.gpuType ? `, ${i.gpuType}` : ""})`)
				.join(", ");
			throw new Error(`Thunder instance "${options.thunder}" not found. Available: ${available}`);
		}
	} else {
		const running = instances.filter((i) => i.status === "RUNNING");
		if (running.length === 1) {
			target = running[0];
			console.log(
				`Auto-selected Thunder instance ${target.id} (${target.gpuType ?? "GPU"}, ${target.status}).`,
			);
		} else if (instances.length === 1) {
			target = instances[0];
		} else {
			const available = instances.map((i) => `${i.id} (${i.status})`).join(", ");
			throw new Error(
				`Multiple Thunder instances found (${available}). Specify one with --thunder <id> or set THUNDER_INSTANCE in .dev.vars.`,
			);
		}
	}

	// Wait if instance is still starting/provisioning.
	const deadline = Date.now() + 180_000;
	while ((target.status !== "RUNNING" || !target.ip) && Date.now() < deadline) {
		console.log(
			`Waiting for Thunder instance ${target.id} (status=${target.status}) to become RUNNING...`,
		);
		await Bun.sleep(4_000);
		instances = await fetchStatus();
		target = findMatchingInstance(instances, target.id) ?? target;
	}

	if (target.status !== "RUNNING" || !target.ip) {
		throw new Error(
			`Thunder instance ${target.id} is not ready (status=${target.status}, ip=${target.ip ?? "none"}).`,
		);
	}

	return target;
}

async function resolveEndpointForRun(
	options: CliOptions,
	tnrBin: string | null,
	instance: ThunderInstanceInfo | undefined,
): Promise<SshEndpoint> {
	if (options.ssh) {
		return parseSshTarget(options.ssh, options.sshPort, options.sshKey, options.sshOptions);
	}

	if (!instance) {
		throw new Error("Remote mode requires either --thunder <id> or --ssh <target>.");
	}

	const sshConfigPath = join(homedir(), ".ssh", "config");
	let sshConfigMatch: SshConfigHostBlock | undefined;
	try {
		const configText = await readFile(sshConfigPath, "utf8");
		sshConfigMatch = findSshConfigMatch(configText, instance);
	} catch {
		// ~/.ssh/config optional
	}

	if (sshConfigMatch && sshConfigMatch.patterns[0]) {
		return {
			target: sshConfigMatch.patterns[0],
			port: options.sshPort ?? sshConfigMatch.port,
			keyPath: options.sshKey ?? sshConfigMatch.identityFile,
			options: [...options.sshOptions],
			strictHostKeyChecking: "accept-new",
		};
	}

	if (instance.ip) {
		let fallbackKey = options.sshKey;
		if (!fallbackKey && instance.uuid) {
			const thunderKey = join(homedir(), ".thunder", "keys", instance.uuid);
			if (await fileExistsNonEmpty(thunderKey)) fallbackKey = thunderKey;
		}
		if (!fallbackKey) {
			const defaultEd25519 = join(homedir(), ".ssh", "id_ed25519");
			const defaultRsa = join(homedir(), ".ssh", "id_rsa");
			if (await fileExistsNonEmpty(defaultEd25519)) fallbackKey = defaultEd25519;
			else if (await fileExistsNonEmpty(defaultRsa)) fallbackKey = defaultRsa;
		}
		return {
			target: `ubuntu@${instance.ip}`,
			port: options.sshPort ?? instance.port,
			keyPath: fallbackKey,
			options: [...options.sshOptions],
			strictHostKeyChecking: "accept-new",
		};
	}

	const tnrHint = tnrBin
		? `Run \`tnr connect ${instance.id}\` once`
		: "Provide `--ssh <user@host>`";
	throw new Error(
		`Could not resolve SSH endpoint for Thunder instance ${instance.id}. ${tnrHint}.`,
	);
}

export function parseProbeOutput(stdout: string): RemoteHardwareProbe {
	const map = new Map<string, string>();
	for (const line of stdout.split(/\r?\n/)) {
		const eqIdx = line.indexOf("=");
		if (eqIdx <= 0) continue;
		map.set(line.slice(0, eqIdx).trim(), line.slice(eqIdx + 1).trim());
	}
	const cudaRaw = map.get("CUDA_VER") ?? "";
	const cudaMatch = /(\d+)\./.exec(cudaRaw);
	const cpuRaw = map.get("CPUS") ?? "1";
	const cpuCount = /^\d+$/.test(cpuRaw) ? Math.max(1, Number.parseInt(cpuRaw, 10)) : 1;
	const gpuName = map.get("GPU") || undefined;

	return {
		os: map.get("OS") || "Linux",
		arch: map.get("ARCH") || "x86_64",
		cpuCount,
		gpuName,
		cudaMajor: cudaMatch ? Number.parseInt(cudaMatch[1], 10) : undefined,
		hasNvidiaGpu: Boolean(gpuName),
		hasRsync: map.get("HAS_RSYNC") === "1",
		hasUv: map.get("HAS_UV") === "1",
		pythonPath: map.get("PY_BIN") || undefined,
	};
}

async function probeRemoteHost(
	runner: CommandRunner,
	endpoint: SshEndpoint,
	controlPath: string | undefined,
): Promise<RemoteHardwareProbe> {
	const script = `
set -e
echo "OS=$(uname -s)"
echo "ARCH=$(uname -m)"
echo "CPUS=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN || echo 1)"
if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_LINE=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -n1 || true)
  CUDA_LINE=$(nvidia-smi 2>/dev/null | sed -n 's/.*CUDA[^:]*Version: *\\([0-9][0-9.]*\\).*/\\1/p' | head -n1 || true)
  echo "GPU=$GPU_LINE"
  echo "CUDA_VER=$CUDA_LINE"
else
  echo "GPU="
  echo "CUDA_VER="
fi
echo "HAS_RSYNC=$(command -v rsync >/dev/null 2>&1 && echo 1 || echo 0)"
echo "HAS_UV=$( (command -v uv >/dev/null 2>&1 || [ -x "$HOME/.local/bin/uv" ]) && echo 1 || echo 0)"
echo "PY_BIN=$(command -v python3 || true)"
`;
	const res = await runRemoteBash(runner, endpoint, controlPath, script);
	if (res.exitCode !== 0) {
		throw new Error(
			`SSH probe failed for ${endpoint.target} (exit ${res.exitCode}): ${res.stderr.trim() || res.stdout.trim()}`,
		);
	}
	return parseProbeOutput(res.stdout);
}

export function selectOnnxGpuSpec(cudaMajor?: number): string {
	// ONNX Runtime >=1.27 targets CUDA 13; <=1.26 targets CUDA 12 (Thunder cuda12-8/cuda12-9).
	if (cudaMajor !== undefined && cudaMajor >= 13) {
		return "onnxruntime-gpu[cuda,cudnn]>=1.27.0";
	}
	return "onnxruntime-gpu[cuda,cudnn]>=1.24.0,<1.27";
}

async function bootstrapRemoteEnv(
	runner: CommandRunner,
	endpoint: SshEndpoint,
	controlPath: string | undefined,
	paths: OutputPaths,
	probe: RemoteHardwareProbe,
	requestedDevice: DevicePreference,
	forceVerify = false,
	verbose = false,
): Promise<{ activeDevice: "cuda" | "cpu" }> {
	const wantCuda = requestedDevice === "cuda" || (requestedDevice === "auto" && probe.hasNvidiaGpu);
	if (requestedDevice === "cuda" && !probe.hasNvidiaGpu) {
		throw new Error(
			`--device cuda was requested, but \`nvidia-smi\` found no GPU on ${endpoint.target}.`,
		);
	}

	const ortGpuSpec = selectOnnxGpuSpec(probe.cudaMajor);
	const fingerprint = JSON.stringify({
		wantCuda,
		ortGpuSpec: wantCuda ? ortGpuSpec : "cpu",
		supertonic: "supertonic>=1.3",
		lameenc: "lameenc>=1.7",
		numpy: "numpy>=1.26",
	});
	const baseExpr = remoteDirBashExpr(paths.remoteBaseDir);

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
  echo "Provisioning remote Supertonic 3 Python environment..."
  uv venv --python 3.12 --allow-existing "$VENV_DIR" || uv venv --python 3.13 --allow-existing "$VENV_DIR" || uv venv --allow-existing "$VENV_DIR"
  if [ ${wantCuda ? "1" : "0"} -eq 1 ]; then
    uv pip uninstall --python "$VENV_DIR/bin/python" onnxruntime || true
    uv pip install --python "$VENV_DIR/bin/python" --upgrade "supertonic>=1.3" "lameenc>=1.7" "numpy>=1.26"
    uv pip uninstall --python "$VENV_DIR/bin/python" onnxruntime || true
    uv pip install --python "$VENV_DIR/bin/python" --upgrade ${quotePosix(ortGpuSpec)}
  else
    uv pip uninstall --python "$VENV_DIR/bin/python" onnxruntime-gpu || true
    uv pip install --python "$VENV_DIR/bin/python" --upgrade "supertonic>=1.3" "lameenc>=1.7" "numpy>=1.26"
  fi
  printf '%s' "$WANT_FINGERPRINT" > "$STAMP_FILE"
fi

MODEL_CACHE_DIR="\${SUPERTONIC_CACHE_DIR:-$HOME/.cache/supertonic3}"
if [ "$CACHE_HIT" -eq 0 ] || [ ${forceVerify ? "1" : "0"} -eq 1 ] || [ ! -f "$MODEL_CACHE_DIR/onnx/vocoder.onnx" ]; then
  echo "Verifying remote ONNX Runtime & Supertonic 3 weights..."
  "$VENV_DIR/bin/python" - << 'PYEOF'
import onnxruntime as ort
from supertonic.loader import download_model, get_cache_dir, has_all_onnx_modules, list_available_voice_style_names
if ${verbose ? "False" : "True"} and hasattr(ort, "set_default_logger_severity"):
    ort.set_default_logger_severity(3)
want_cuda = ${wantCuda ? "True" : "False"}
if want_cuda and hasattr(ort, "preload_dlls"):
    ort.preload_dlls()
providers = ort.get_available_providers()
print("REMOTE_PROVIDERS=" + ",".join(providers))
if want_cuda and "CUDAExecutionProvider" not in providers:
    raise SystemExit("CUDAExecutionProvider not available in remote onnxruntime-gpu")
model_dir = get_cache_dir("supertonic-3")
if not has_all_onnx_modules(model_dir):
    download_model(model_dir, "supertonic-3")
print("REMOTE_VOICES=" + ",".join(list_available_voice_style_names(model_dir)))
PYEOF
fi
`;

	console.log(
		`Bootstrapping remote environment at ${paths.remoteBaseDir} (${wantCuda ? `CUDA (${ortGpuSpec})` : "CPU"})...`,
	);
	const res = await runRemoteBash(runner, endpoint, controlPath, bootstrapScript, {
		streaming: true,
	});
	if (res.exitCode !== 0) {
		if (requestedDevice === "auto" && wantCuda) {
			console.warn(
				"CUDA bootstrap failed under --device auto; retrying remote environment in CPU mode...",
			);
			return bootstrapRemoteEnv(runner, endpoint, controlPath, paths, probe, "cpu");
		}
		throw new Error(`Remote bootstrap failed (exit ${res.exitCode}).`);
	}

	return { activeDevice: wantCuda ? "cuda" : "cpu" };
}

function chooseTransferMethod(
	requested: TransferMethod,
	probe: RemoteHardwareProbe,
	tnrBin: string | null,
	instance: ThunderInstanceInfo | undefined,
	explicitSsh: boolean,
): "rsync" | "tnr-scp" | "tar" {
	if (requested === "rsync") return "rsync";
	if (requested === "tar") return "tar";
	if (requested === "tnr-scp") {
		if (!tnrBin || !instance) {
			throw new Error("--transfer tnr-scp requires a Thunder instance (--thunder <id>).");
		}
		return "tnr-scp";
	}
	if (probe.hasRsync) return "rsync";
	if (!explicitSsh && tnrBin && instance) return "tnr-scp";
	return "tar";
}

async function uploadPayload(
	runner: CommandRunner,
	endpoint: SshEndpoint,
	controlPath: string | undefined,
	method: "rsync" | "tnr-scp" | "tar",
	tnrBin: string | null,
	instance: ThunderInstanceInfo | undefined,
	localStageDir: string,
	remoteRunDir: string,
): Promise<void> {
	const remoteRunExpr = remoteDirBashExpr(remoteRunDir);
	const prep = await runRemoteBash(
		runner,
		endpoint,
		controlPath,
		`mkdir -p ${remoteRunExpr}/scripts ${remoteRunExpr}/src/shared ${remoteRunExpr}/public/data/bibles/krv ${remoteRunExpr}/out/audio ${remoteRunExpr}/out/timings`,
	);
	if (prep.exitCode !== 0) {
		throw new Error(
			`Failed to prepare remote run directory ${remoteRunDir}: ${prep.stderr.trim()}`,
		);
	}

	if (method === "rsync") {
		const dest = `${endpoint.target}:${remoteDirTransferPath(remoteRunDir)}/`;
		const rsh = buildRsyncRshCommand(endpoint, controlPath);
		const res = await runner.run("rsync", ["-az", "-e", rsh, `${localStageDir}/`, dest], {
			stdin: "ignore",
		});
		if (res.exitCode !== 0) {
			throw new Error(`rsync upload failed: ${res.stderr.trim() || res.stdout.trim()}`);
		}
		return;
	}

	if (method === "tnr-scp" && tnrBin && instance) {
		const archiveLocal = join(dirname(localStageDir), `push-${process.pid}.tar.gz`);
		const pack = await runner.run("tar", ["-C", localStageDir, "-czf", archiveLocal, "."], {
			stdin: "ignore",
		});
		if (pack.exitCode !== 0) {
			throw new Error(`tar pack failed: ${pack.stderr.trim() || pack.stdout.trim()}`);
		}
		try {
			const scpRes = await runner.run(
				tnrBin,
				["scp", archiveLocal, `${instance.id}:${remoteRunDir}/payload.tar.gz`],
				{ stdin: "ignore" },
			);
			if (scpRes.exitCode !== 0) {
				throw new Error(`tnr scp upload failed: ${scpRes.stderr.trim() || scpRes.stdout.trim()}`);
			}
			const unpack = await runRemoteBash(
				runner,
				endpoint,
				controlPath,
				`tar -C ${remoteRunExpr} -xzf ${remoteRunExpr}/payload.tar.gz && rm -f ${remoteRunExpr}/payload.tar.gz`,
			);
			if (unpack.exitCode !== 0) {
				throw new Error(`Remote unpack failed: ${unpack.stderr.trim() || unpack.stdout.trim()}`);
			}
		} finally {
			await rm(archiveLocal, { force: true }).catch(() => {});
		}
		return;
	}

	// tar-over-SSH fallback when rsync is unavailable
	const sshArgs = buildSshBaseArgs(endpoint, controlPath);
	const tarProc = Bun.spawn(["tar", "-C", localStageDir, "-cf", "-", "."], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const sshProc = Bun.spawn(
		["ssh", ...sshArgs, endpoint.target, `bash -c ${quotePosix(`tar -C ${remoteRunExpr} -xf -`)}`],
		{
			stdin: tarProc.stdout,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [tarErr, sshErr, tarExit, sshExit] = await Promise.all([
		new Response(tarProc.stderr).text(),
		new Response(sshProc.stderr).text(),
		tarProc.exited,
		sshProc.exited,
	]);
	if (tarExit !== 0 || sshExit !== 0) {
		throw new Error(`tar-over-SSH upload failed: ${tarErr.trim()} ${sshErr.trim()}`.trim());
	}
}

async function downloadDirectory(
	runner: CommandRunner,
	endpoint: SshEndpoint,
	controlPath: string | undefined,
	method: "rsync" | "tnr-scp" | "tar",
	tnrBin: string | null,
	instance: ThunderInstanceInfo | undefined,
	remoteSubdir: string,
	localDestDir: string,
): Promise<void> {
	await mkdir(localDestDir, { recursive: true });
	const remoteExpr = remoteDirBashExpr(remoteSubdir);
	const existsCheck = await runRemoteBash(
		runner,
		endpoint,
		controlPath,
		`[ -d ${remoteExpr} ] && echo PRESENT || echo MISSING`,
	);
	if (existsCheck.exitCode === 0 && existsCheck.stdout.trim() === "MISSING") {
		return;
	}

	if (method === "rsync") {
		const src = `${endpoint.target}:${remoteDirTransferPath(remoteSubdir)}/`;
		const rsh = buildRsyncRshCommand(endpoint, controlPath);
		const res = await runner.run(
			"rsync",
			["-az", "--skip-compress=mp3", "--partial", "-e", rsh, src, `${localDestDir}/`],
			{ stdin: "ignore" },
		);
		if (res.exitCode !== 0) {
			throw new Error(
				`rsync download failed for ${remoteSubdir}: ${res.stderr.trim() || res.stdout.trim()}`,
			);
		}
		return;
	}

	if (method === "tnr-scp" && tnrBin && instance) {
		const archiveLocal = join(dirname(localDestDir), `pull-${process.pid}-${Date.now()}.tar.gz`);
		const remoteArchive = `${remoteSubdir}.tar.gz`;
		const pack = await runRemoteBash(
			runner,
			endpoint,
			controlPath,
			`tar -C ${remoteExpr} -czf ${remoteDirBashExpr(remoteArchive)} .`,
		);
		if (pack.exitCode !== 0) {
			throw new Error(
				`Remote archive failed for ${remoteSubdir}: ${pack.stderr.trim() || pack.stdout.trim()}`,
			);
		}
		try {
			const scpRes = await runner.run(
				tnrBin,
				["scp", `${instance.id}:${remoteArchive}`, archiveLocal],
				{ stdin: "ignore" },
			);
			if (scpRes.exitCode !== 0) {
				throw new Error(
					`tnr scp download failed for ${remoteSubdir}: ${scpRes.stderr.trim() || scpRes.stdout.trim()}`,
				);
			}
			const unpack = await runner.run("tar", ["-C", localDestDir, "-xzf", archiveLocal], {
				stdin: "ignore",
			});
			if (unpack.exitCode !== 0) {
				throw new Error(
					`Local unpack failed for ${remoteSubdir}: ${unpack.stderr.trim() || unpack.stdout.trim()}`,
				);
			}
		} finally {
			await rm(archiveLocal, { force: true }).catch(() => {});
			await runRemoteBash(
				runner,
				endpoint,
				controlPath,
				`rm -f ${remoteDirBashExpr(remoteArchive)}`,
			).catch(() => {});
		}
		return;
	}

	const sshArgs = buildSshBaseArgs(endpoint, controlPath);
	const sshProc = Bun.spawn(
		["ssh", ...sshArgs, endpoint.target, `bash -c ${quotePosix(`tar -C ${remoteExpr} -cf - .`)}`],
		{
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const tarProc = Bun.spawn(["tar", "-C", localDestDir, "-xf", "-"], {
		stdin: sshProc.stdout,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [sshErr, tarErr, sshExit, tarExit] = await Promise.all([
		new Response(sshProc.stderr).text(),
		new Response(tarProc.stderr).text(),
		sshProc.exited,
		tarProc.exited,
	]);
	if (sshExit !== 0 || tarExit !== 0) {
		throw new Error(`tar-over-SSH download failed: ${sshErr.trim()} ${tarErr.trim()}`.trim());
	}
}

async function mergePulledOutputs(
	pullRoot: string,
	paths: OutputPaths,
	allowedUsfms?: ReadonlySet<string>,
): Promise<{ mp3Count: number; timingCount: number; mergedReport: boolean }> {
	let mp3Count = 0;
	let timingCount = 0;
	let mergedReport = false;

	const pulledAudioDir = join(pullRoot, "audio");
	try {
		const entries = await readdir(pulledAudioDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
			const usfm = entry.name.toUpperCase();
			if (!VALID_USFM_SET.has(usfm) || (allowedUsfms && !allowedUsfms.has(usfm))) continue;

			const srcBookDir = join(pulledAudioDir, entry.name);
			const dstBookDir = join(paths.localAudioDir, usfm);
			await mkdir(dstBookDir, { recursive: true });

			const files = await readdir(srcBookDir, { withFileTypes: true });
			for (const fileEntry of files) {
				if (fileEntry.isSymbolicLink() || !fileEntry.isFile()) continue;
				const match = MP3_NAME_RE.exec(fileEntry.name);
				if (!match) continue;
				const srcFile = join(srcBookDir, fileEntry.name);
				const dstFile = join(dstBookDir, `${match[1]}.mp3`);
				const tmpDst = `${dstFile}.${process.pid}.tmp`;
				await cp(srcFile, tmpDst);
				await rename(tmpDst, dstFile);
				mp3Count++;
			}
		}
	} catch {
		// no audio dir pulled
	}

	const pulledTimingsDir = join(pullRoot, "timings");
	try {
		const entries = await readdir(pulledTimingsDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isSymbolicLink() || !entry.isFile()) continue;
			const match = TIMINGS_FILE_RE.exec(entry.name);
			if (!match) continue;
			const usfm = match[1];
			if (!VALID_USFM_SET.has(usfm) || (allowedUsfms && !allowedUsfms.has(usfm))) continue;

			const incoming = JSON.parse(
				await readFile(join(pulledTimingsDir, entry.name), "utf8"),
			) as Record<string, unknown>;
			const dstPath = join(paths.localTimingsDir, `${usfm}.json`);

			let existing: Record<string, unknown> | null = null;
			try {
				const st = await lstat(dstPath);
				if (st.isFile()) {
					existing = JSON.parse(await readFile(dstPath, "utf8")) as Record<string, unknown>;
				}
			} catch {
				// new file
			}

			const payload = mergeBookTimingsPayload(existing, incoming, usfm);
			await atomicWriteJsonFile(dstPath, payload, false);
			timingCount++;
		}
	} catch {
		// no timings dir pulled
	}

	const pulledReportFile = join(pullRoot, "report.json");
	if (await fileExistsNonEmpty(pulledReportFile, 2)) {
		const incomingReport = extractJsonValue(await readFile(pulledReportFile, "utf8")) as Record<
			string,
			unknown
		>;
		let existingReport: Record<string, unknown> | null = null;
		if (paths.mode === "production") {
			try {
				existingReport = JSON.parse(await readFile(paths.localReportPath, "utf8")) as Record<
					string,
					unknown
				>;
			} catch {
				// fresh report
			}
		}
		const merged = mergeGenerationReportPayload(existingReport, incomingReport);
		await atomicWriteJsonFile(paths.localReportPath, merged, true);
		mergedReport = true;
	}

	return { mp3Count, timingCount, mergedReport };
}

export async function verifyAndSummarizeOutputs(
	jobPlan: JobPlan,
	paths: OutputPaths,
	rootDir: string,
): Promise<{ ok: boolean; errors: string[] }> {
	const errors: string[] = [];

	for (const [usfm, chapters] of Object.entries(jobPlan.chaptersByBook)) {
		const timingPath = join(paths.localTimingsDir, `${usfm}.json`);
		let timingChapters: Record<string, Record<string, number>> = {};
		try {
			const parsed = JSON.parse(await readFile(timingPath, "utf8")) as {
				chapters?: Record<string, Record<string, number>>;
			};
			timingChapters = parsed.chapters ?? {};
		} catch {
			errors.push(`Missing or unreadable timing file: ${timingPath}`);
			continue;
		}

		for (const ch of chapters) {
			const mp3Path = join(paths.localAudioDir, usfm, `${ch}.mp3`);
			if (!(await fileExistsNonEmpty(mp3Path, 1025))) {
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

async function pullAndMergeOutputs(
	runner: CommandRunner,
	endpoint: SshEndpoint,
	controlPath: string | undefined,
	transferMethod: "rsync" | "tnr-scp" | "tar",
	tnrBin: string | null,
	instance: ThunderInstanceInfo | undefined,
	paths: OutputPaths,
	rootDir: string,
	allowedUsfms: ReadonlySet<string>,
): Promise<{ mp3Count: number; timingCount: number; mergedReport: boolean }> {
	const cacheParent = join(rootDir, ".cache");
	await mkdir(cacheParent, { recursive: true });
	const pullTmp = await mkdtemp(join(cacheParent, ".remote-pull-"));
	try {
		await downloadDirectory(
			runner,
			endpoint,
			controlPath,
			transferMethod,
			tnrBin,
			instance,
			paths.remoteAudioDir,
			join(pullTmp, "audio"),
		);
		await downloadDirectory(
			runner,
			endpoint,
			controlPath,
			transferMethod,
			tnrBin,
			instance,
			paths.remoteTimingsDir,
			join(pullTmp, "timings"),
		);
		const reportRes = await runRemoteBash(
			runner,
			endpoint,
			controlPath,
			`[ -f ${remoteDirBashExpr(paths.remoteReportPath)} ] && cat ${remoteDirBashExpr(paths.remoteReportPath)} || true`,
		);
		if (reportRes.exitCode === 0 && reportRes.stdout.trim()) {
			await writeFile(join(pullTmp, "report.json"), reportRes.stdout, "utf8");
		}
		return await mergePulledOutputs(pullTmp, paths, allowedUsfms);
	} finally {
		await rm(pullTmp, { recursive: true, force: true }).catch(() => {});
	}
}

async function printStagingComparison(
	jobPlan: JobPlan,
	paths: OutputPaths,
	rootDir: string,
): Promise<void> {
	const prodTimingsDir = join(rootDir, "public", "data", "timings", "krv-supertonic");
	const prodAudioDir = join(rootDir, ".cache", "krv-supertonic-audio");

	console.log(
		`\nStaging Parity Summary (${paths.stagingName ?? "custom"}) — production untouched:`,
	);
	for (const [usfm, chapters] of Object.entries(jobPlan.chaptersByBook)) {
		let stagedMap: Record<string, Record<string, number>> = {};
		let prodMap: Record<string, Record<string, number>> = {};
		try {
			stagedMap =
				(
					JSON.parse(await readFile(join(paths.localTimingsDir, `${usfm}.json`), "utf8")) as {
						chapters?: Record<string, Record<string, number>>;
					}
				).chapters ?? {};
		} catch {
			// skip
		}
		try {
			prodMap =
				(
					JSON.parse(await readFile(join(prodTimingsDir, `${usfm}.json`), "utf8")) as {
						chapters?: Record<string, Record<string, number>>;
					}
				).chapters ?? {};
		} catch {
			// no prod baseline for this book
		}

		for (const ch of chapters) {
			const stagedCh = stagedMap[String(ch)] ?? {};
			const prodCh = prodMap[String(ch)];
			const stagedCount = Object.keys(stagedCh).length;
			const stagedV1 = stagedCh["1"];
			let stagedBytes = 0;
			try {
				stagedBytes = (await stat(join(paths.localAudioDir, usfm, `${ch}.mp3`))).size;
			} catch {
				// ignore
			}
			if (prodCh) {
				const prodCount = Object.keys(prodCh).length;
				const prodV1 = prodCh["1"];
				let prodBytes = 0;
				try {
					prodBytes = (await stat(join(prodAudioDir, usfm, `${ch}.mp3`))).size;
				} catch {
					// ignore
				}
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

export async function runRemoteWorkflow(
	options: CliOptions,
	rootDir: string,
	runner: CommandRunner = createDefaultCommandRunner(),
): Promise<number> {
	const paths = resolveOutputPaths(options, rootDir);
	const tnrBin = resolveTnrBinary(runner);

	if ((options.thunder || options.create) && !tnrBin) {
		throw new Error(
			"Thunder Compute CLI (`tnr`) not found in PATH.\nInstall it with `brew tap Thunder-Compute/tnr && brew install tnr` and run `tnr login`, or use `--ssh <target>` directly.",
		);
	}

	let instance: ThunderInstanceInfo | undefined;
	const useThunderCli = Boolean(options.thunder || options.create || (!options.ssh && tnrBin));
	if (useThunderCli && tnrBin) {
		instance = await resolveThunderInstance(tnrBin, options, runner);
	}

	const endpoint = await resolveEndpointForRun(options, tnrBin, instance);

	if (options.shell) {
		if (!options.ssh && tnrBin && instance) {
			console.log(`Opening Thunder interactive shell for instance ${instance.id}...`);
			return runner.runInteractive(tnrBin, ["connect", instance.id]);
		}
		console.log(`Opening SSH shell to ${endpoint.target}...`);
		const args = [...buildSshBaseArgs(endpoint), "-o", "BatchMode=no", endpoint.target];
		return runner.runInteractive("ssh", args);
	}

	const jobPlan = await buildPendingJobPlan(options, paths);
	console.log(
		`Plan [${paths.mode}${paths.stagingName ? `:${paths.stagingName}` : ""}]: ` +
			`${jobPlan.books.length} book(s), ${jobPlan.totalSelectedChapters} chapter(s) ` +
			`(${jobPlan.pendingChapters} pending, ${jobPlan.skippedChapters} already local).`,
	);

	// Short socket path under /tmp to stay well within macOS 104-byte Unix socket limit.
	const socketParent = await mkdtemp("/tmp/l2r-ssh-");
	const controlPath = join(socketParent, "cm");
	let controlOpen = false;
	let pullCompletedCleanly = false;
	let synthesisErrors = false;

	const closeControlSocket = async () => {
		if (!controlOpen) return;
		controlOpen = false;
		await runner.run("ssh", ["-o", `ControlPath=${controlPath}`, "-O", "exit", endpoint.target], {
			stdin: "ignore",
		});
	};

	try {
		console.log(
			`Opening SSH ControlMaster to ${endpoint.target}${endpoint.port ? `:${endpoint.port}` : ""}...`,
		);
		const masterRes = await runner.run(
			"ssh",
			[
				...buildSshBaseArgs(endpoint),
				"-M",
				"-N",
				"-f",
				"-o",
				`ControlPath=${controlPath}`,
				"-o",
				"ControlPersist=60",
				endpoint.target,
			],
			{ stdin: "ignore" },
		);
		if (masterRes.exitCode !== 0) {
			const hint = instance
				? ` If using tnr, run \`tnr connect ${instance.id}\` once or attach your SSH key via \`tnr ssh-keys add\`.`
				: "";
			throw new Error(
				`Failed to establish SSH connection to ${endpoint.target}: ${masterRes.stderr.trim() || masterRes.stdout.trim()}.${hint}`,
			);
		}
		controlOpen = true;

		const probe = await probeRemoteHost(runner, endpoint, controlPath);
		console.log(
			`Remote host: ${probe.os} ${probe.arch}, ${probe.cpuCount} vCPU(s), ` +
				`GPU=${probe.gpuName ?? "none"}${probe.cudaMajor ? ` (CUDA ${probe.cudaMajor}.x)` : ""}, ` +
				`rsync=${probe.hasRsync ? "yes" : "no"}`,
		);

		const transferMethod = chooseTransferMethod(
			options.transfer,
			probe,
			tnrBin,
			instance,
			Boolean(options.ssh),
		);

		if (options.dryRun && !options.setupOnly && !options.pullOnly) {
			console.log(
				`Dry-run complete. Transport=${endpoint.target}, transfer=${transferMethod}, ` +
					`remoteDir=${paths.remoteRunDir}, localAudioDir=${paths.localAudioDir}.`,
			);
			return 0;
		}

		if (options.pullOnly) {
			const allowedUsfms = new Set(jobPlan.books.map((b) => b.usfm));
			const merged = await pullAndMergeOutputs(
				runner,
				endpoint,
				controlPath,
				transferMethod,
				tnrBin,
				instance,
				paths,
				rootDir,
				allowedUsfms,
			);
			console.log(
				`Pulled ${merged.mp3Count} MP3(s), ${merged.timingCount} timing file(s)` +
					`${merged.mergedReport ? ", and report" : ""} into ${paths.localAudioDir}.`,
			);
			pullCompletedCleanly = true;
			const verified = await verifyAndSummarizeOutputs(jobPlan, paths, rootDir);
			if (!verified.ok) {
				for (const err of verified.errors) console.error(`Verification error: ${err}`);
				return 1;
			}
			return 0;
		}

		const { activeDevice } = await bootstrapRemoteEnv(
			runner,
			endpoint,
			controlPath,
			paths,
			probe,
			options.device,
			options.setupOnly,
			options.verbose,
		);
		if (options.setupOnly) {
			console.log(`Remote environment ready (device=${activeDevice}).`);
			return 0;
		}

		if (jobPlan.pendingChapters === 0) {
			console.log(
				"All selected chapters are already generated locally. Use --force to regenerate.",
			);
			return 0;
		}

		// Stage minimal inputs locally and push to remoteRunDir
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
				`Uploading ${Object.keys(jobPlan.chaptersByBook).length} book JSON(s) + generator to ${paths.remoteRunDir} (${transferMethod})...`,
			);
			await uploadPayload(
				runner,
				endpoint,
				controlPath,
				transferMethod,
				tnrBin,
				instance,
				inputStageDir,
				paths.remoteRunDir,
			);
		} finally {
			await rm(inputStageDir, { recursive: true, force: true }).catch(() => {});
		}

		const runExpr = remoteDirBashExpr(paths.remoteRunDir);
		const baseExpr = remoteDirBashExpr(paths.remoteBaseDir);
		const remoteAudioExpr = remoteDirBashExpr(paths.remoteAudioDir);
		const remoteTimingsExpr = remoteDirBashExpr(paths.remoteTimingsDir);
		const remoteReportExpr = remoteDirBashExpr(paths.remoteReportPath);

		const pythonArgs = [
			`${runExpr}/scripts/generate-krv-audio.py`,
			"--job-manifest",
			`${runExpr}/job-manifest.json`,
			"--audio-dir",
			remoteAudioExpr,
			"--timings-dir",
			remoteTimingsExpr,
			"--report-path",
			remoteReportExpr,
			"--device",
			quotePosix(activeDevice),
			"--voice",
			quotePosix(options.voice),
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
			"--batch-size",
			String(options.batchSize),
			"--mp3-quality",
			String(options.mp3Quality),
			...(options.verbose ? ["--verbose"] : []),
			...(options.force ? ["--force"] : []),
		];

		const remoteRunScript = `
set -euo pipefail
export PYTHONUNBUFFERED=1
exec ${baseExpr}/.venv/bin/python -u ${pythonArgs.join(" ")}
`;

		let interrupted = false;
		let killRemote: (() => void) | undefined;
		const onSignal = () => {
			if (!interrupted) {
				interrupted = true;
				console.warn("\nInterrupted — stopping remote synthesis and pulling completed chapters...");
				killRemote?.();
			}
		};
		process.on("SIGINT", onSignal);
		process.on("SIGTERM", onSignal);

		let runExit = 0;
		try {
			const res = await runRemoteBash(runner, endpoint, controlPath, remoteRunScript, {
				streaming: true,
				onChild: (kill) => {
					killRemote = kill;
				},
			});
			runExit = res.exitCode;
			if (runExit !== 0) {
				synthesisErrors = true;
			}
		} finally {
			process.off("SIGINT", onSignal);
			process.off("SIGTERM", onSignal);
		}

		// Pull outputs even on partial/interrupted runs so finished chapters aren't lost.
		console.log(`Pulling generated MP3s and timings from ${paths.remoteRunDir}...`);
		const allowedUsfms = new Set(Object.keys(jobPlan.chaptersByBook));
		const merged = await pullAndMergeOutputs(
			runner,
			endpoint,
			controlPath,
			transferMethod,
			tnrBin,
			instance,
			paths,
			rootDir,
			allowedUsfms,
		);
		console.log(
			`Synced ${merged.mp3Count} MP3(s), ${merged.timingCount} timing file(s)` +
				`${merged.mergedReport ? ", and report" : ""} to ${paths.localAudioDir}.`,
		);
		pullCompletedCleanly = true;

		if (interrupted || runExit !== 0) {
			return runExit || 1;
		}

		const verification = await verifyAndSummarizeOutputs(jobPlan, paths, rootDir);
		if (!verification.ok) {
			for (const err of verification.errors) {
				console.error(`Verification error: ${err}`);
			}
			return 1;
		}

		console.log("Integrity verification passed.");
		return 0;
	} finally {
		await closeControlSocket().catch(() => {});
		await rm(socketParent, { recursive: true, force: true }).catch(() => {});

		if (options.deleteAfter && instance && tnrBin) {
			if (pullCompletedCleanly && !synthesisErrors) {
				console.log(`Deleting Thunder Compute instance ${instance.id} (--delete-after)...`);
				const delRes = await runner.run(tnrBin, ["--json", "-y", "delete", instance.id], {
					stdin: "ignore",
				});
				if (delRes.exitCode !== 0) {
					console.error(
						`Warning: \`tnr delete ${instance.id}\` failed: ${delRes.stderr.trim() || delRes.stdout.trim()}`,
					);
				}
			} else {
				console.warn(
					`Skipping \`tnr delete ${instance.id}\` because synthesis/sync did not complete cleanly. Delete manually when ready: \`tnr delete ${instance.id}\`.`,
				);
			}
		}
	}
}
