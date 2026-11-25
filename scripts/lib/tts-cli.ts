import { join } from "node:path";
import { parseArgs as parseCliArgs } from "node:util";

import { resolveBookList } from "./book-selection";
import {
	KRV_AUDIO_REL_DIR,
	KRV_REPORT_REL_PATH,
	KRV_TIMINGS_REL_DIR,
	parseNumberInRange,
} from "./common";
import { THUNDER_VM_SPEC } from "./thunder";

export const DEFAULT_REMOTE_DIR = "~/logos2rhema-krv-tts";
export const MAX_SHARDS = 8;

export interface RemoteOptions {
	thunder?: string;
	create: boolean;
	shards?: number;
	keepVms: boolean;
	deleteAfter: boolean;
}

export interface CliOptions {
	books?: string[];
	testament?: "OT" | "NT";
	all: boolean;
	chapters?: number[];
	force: boolean;
	dryRun: boolean;
	staging?: string;
	synthArgs: string[];
	remote?: RemoteOptions;
}

export interface OutputPaths {
	mode: "production" | "staging";
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

const STAGING_NAME_RE = /^[a-zA-Z0-9._-]+$/;

const SYNTH_NUMBER_SPECS = [
	{ opt: "speed", flag: "--speed", min: 0.7, max: 2.0, isInt: false },
	{ opt: "steps", flag: "--steps", min: 1, max: 100, isInt: true },
	{ opt: "mp3-quality", flag: "--mp3-quality", min: 0, max: 9, isInt: true },
	{ opt: "bitrate", flag: "--bitrate", min: 32, max: 320, isInt: true },
	{ opt: "pause", flag: "--pause", min: 0, max: 10, isInt: false },
	{ opt: "header-pause", flag: "--header-pause", min: 0, max: 10, isInt: false },
] as const;

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

export function parseCommaList(raw: string): string[] {
	return raw
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
}

function parseChapterList(raw: string): number[] {
	const seen = new Set<number>();
	const chapters: number[] = [];
	for (const token of parseCommaList(raw)) {
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

Thunder Compute Multi-GPU (1x ${THUNDER_VM_SPEC.gpu.toUpperCase()}, ${THUNDER_VM_SPEC.vcpus} vCPUs, ${THUNDER_VM_SPEC.mode}):
  --create                  Provision fresh Thunder VM(s) if needed (auto-sized 1/2/4 shards, auto-deleted on clean sync)
  --shards <N>              Override parallel Thunder VM shards (1-${MAX_SHARDS}; implies remote)
  --thunder <ID[,ID...]>    Use specific existing Thunder instance ID/name(s) via tnr CLI
  --remote                  Use THUNDER_INSTANCE from .dev.vars/env or single running tnr instance
  --keep-vms                Keep newly created --create VM(s) running after sync instead of auto-deleting
  --delete-after            Delete pre-existing --thunder/--remote VM(s) after clean sync

Run Control & Isolation:
  --staging [NAME]          Isolate remote (<remote-dir>/staging/<NAME>) and local (.cache/krv-supertonic-staging/<NAME>) outputs
  --force                   Regenerate chapters even if outputs already exist
  --dry-run                 Validate scope and preview shard/cost plan without provisioning or synthesizing

Optional Audio Overrides (Python defaults tuned to matrix sweet spot):
  --voice <NAME>            Voice style name or alias (default: Daniel -> M5)
  --speed <FLOAT>           Speech speed 0.7-2.0 (default: 0.95)
  --steps <INT>             Flow-matching inference steps 1-100 (default: 10)
  --mp3-quality <INT>       LAME MP3 quality 0 (best/slowest) to 9 (fastest) (default: 5)
  --bitrate <INT>           CBR MP3 bitrate in kbps 32-320 (default: 96)
  --pause <FLOAT>           Inter-verse silence pause in seconds (default: 0.30)
  --header-pause <FLOAT>    Pause after chapter header in seconds (default: 0.60)
  --verbose                 Show ONNX Runtime startup warnings
  -h, --help                Show this help message`;
}

export function parseCliOptions(
	argv: readonly string[],
	env: Record<string, string | undefined> = process.env,
): CliOptions | null {
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
			"mp3-quality": { type: "string" },
			verbose: { type: "boolean" },
			force: { type: "boolean" },
			"dry-run": { type: "boolean" },
			remote: { type: "boolean" },
			thunder: { type: "string" },
			create: { type: "boolean" },
			shards: { type: "string" },
			"keep-vms": { type: "boolean" },
			"delete-after": { type: "boolean" },
			staging: { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});

	if (values.help) return null;

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
	if (Number(Boolean(books)) + Number(Boolean(testament)) + Number(all) > 1) {
		throw new Error("Options --book/--books, --testament, and --all are mutually exclusive.");
	}

	const rawChapters = values.chapters ?? values.chapter;
	if (values.chapters !== undefined && values.chapter !== undefined) {
		throw new Error("Pass either --chapters or --chapter, not both.");
	}
	const chapters = rawChapters !== undefined ? parseChapterList(rawChapters) : undefined;

	const staging = values.staging !== undefined ? values.staging.trim() : undefined;
	if (staging !== undefined && !STAGING_NAME_RE.test(staging)) {
		throw new Error(
			`Invalid --staging name "${staging}". Use only letters, digits, '.', '_', or '-'.`,
		);
	}

	const synthArgs: string[] = [];
	if (values.voice !== undefined) {
		const voice = values.voice.trim();
		if (!voice) throw new Error("Expected a non-empty voice name for --voice.");
		synthArgs.push("--voice", voice);
	}
	for (const spec of SYNTH_NUMBER_SPECS) {
		const raw = values[spec.opt];
		if (raw !== undefined) {
			const num = parseNumberInRange(raw, spec.flag, spec.min, spec.max, spec.isInt);
			synthArgs.push(spec.flag, String(num));
		}
	}
	if (values.verbose) synthArgs.push("--verbose");

	const explicitRemote = Boolean(
		values.remote || values.thunder !== undefined || values.create || values.shards !== undefined,
	);

	if ((values["delete-after"] || values["keep-vms"]) && !explicitRemote) {
		throw new Error(
			"Options --delete-after and --keep-vms require --create, --shards <N>, --thunder <ID>, or --remote.",
		);
	}
	if (values["keep-vms"] && values["delete-after"]) {
		throw new Error("Options --keep-vms and --delete-after are mutually exclusive.");
	}

	let remote: RemoteOptions | undefined;
	if (explicitRemote) {
		if (values.thunder !== undefined && !values.thunder.trim()) {
			throw new Error("Expected at least one instance ID/name after --thunder.");
		}
		const shards =
			values.shards !== undefined
				? parseNumberInRange(values.shards, "--shards", 1, MAX_SHARDS, true)
				: undefined;
		const thunder =
			values.thunder?.trim() ||
			(!values.create && shards === undefined
				? env.THUNDER_INSTANCE?.trim() || undefined
				: undefined);
		const thunderTargets = thunder ? parseCommaList(thunder) : [];
		if (shards !== undefined && thunderTargets.length > shards) {
			throw new Error(
				`Received ${thunderTargets.length} --thunder instance(s), which exceeds --shards ${shards}.`,
			);
		}
		remote = {
			thunder,
			create: Boolean(values.create),
			shards,
			keepVms: Boolean(values["keep-vms"]),
			deleteAfter: Boolean(values["delete-after"]),
		};
	}

	return {
		books,
		testament,
		all,
		chapters,
		force: Boolean(values.force),
		dryRun: Boolean(values["dry-run"]),
		staging,
		synthArgs,
		remote,
	};
}

export function makeRemoteRunPaths(
	remoteBaseDir: string,
	remoteRunDir: string,
): Pick<
	OutputPaths,
	"remoteBaseDir" | "remoteRunDir" | "remoteAudioDir" | "remoteTimingsDir" | "remoteReportPath"
> {
	return {
		remoteBaseDir,
		remoteRunDir,
		remoteAudioDir: `${remoteRunDir}/out/audio`,
		remoteTimingsDir: `${remoteRunDir}/out/timings`,
		remoteReportPath: `${remoteRunDir}/out/report.json`,
	};
}

export function resolveOutputPaths(options: CliOptions, rootDir: string): OutputPaths {
	if (options.staging !== undefined) {
		const localStageRoot = join(rootDir, ".cache", "krv-supertonic-staging", options.staging);
		return {
			mode: "staging",
			stagingName: options.staging,
			localAudioDir: join(localStageRoot, "audio"),
			localTimingsDir: join(localStageRoot, "timings"),
			localReportPath: join(localStageRoot, "report.json"),
			...makeRemoteRunPaths(DEFAULT_REMOTE_DIR, `${DEFAULT_REMOTE_DIR}/staging/${options.staging}`),
		};
	}

	return {
		mode: "production",
		localAudioDir: join(rootDir, KRV_AUDIO_REL_DIR),
		localTimingsDir: join(rootDir, KRV_TIMINGS_REL_DIR),
		localReportPath: join(rootDir, KRV_REPORT_REL_PATH),
		...makeRemoteRunPaths(DEFAULT_REMOTE_DIR, `${DEFAULT_REMOTE_DIR}/prod`),
	};
}
