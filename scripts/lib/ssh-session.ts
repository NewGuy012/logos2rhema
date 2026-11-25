import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { isFileNonEmpty } from "./common";
import type { ThunderInstanceInfo } from "./thunder";

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
			logPrefix?: string;
		},
	): Promise<{ exitCode: number }>;
}

export interface SshEndpoint {
	target: string;
	port?: number;
	keyPath?: string;
	strictHostKeyChecking: string;
}

export interface RemoteHardwareProbe {
	os: string;
	arch: string;
	cpuCount: number;
	gpuName?: string;
	cudaMajor?: number;
	hasNvidiaGpu: boolean;
	hasRsync: boolean;
}

export interface RemoteSession {
	endpoint: SshEndpoint;
	exec(script: string): Promise<CommandResult>;
	execStreaming(
		script: string,
		opts?: { onChild?: (kill: () => void) => void; logPrefix?: string },
	): Promise<{ exitCode: number }>;
	probe(): Promise<RemoteHardwareProbe>;
	uploadDir(localDir: string, remoteDir: string): Promise<void>;
	downloadDir(remoteDir: string, localDir: string, opts?: { compress?: boolean }): Promise<void>;
}

export const SAFE_UUID_RE = /^[a-zA-Z0-9-]+$/;
const SAFE_HOST_RE = /^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/;

function expandLocalHome(rawPath: string, homeDir = homedir()): string {
	if (rawPath === "~") return homeDir;
	if (rawPath.startsWith("~/")) return join(homeDir, rawPath.slice(2));
	return rawPath;
}

export function quotePosix(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function remoteDirBashExpr(remotePath: string): string {
	if (remotePath === "~") return `"$HOME"`;
	if (remotePath.startsWith("~/")) return `"$HOME"/${quotePosix(remotePath.slice(2))}`;
	return quotePosix(remotePath);
}

export function remoteDirTransferPath(remotePath: string): string {
	if (remotePath === "~") return ".";
	if (remotePath.startsWith("~/")) return remotePath.slice(2);
	return remotePath;
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
			const prefix = opts?.logPrefix;
			const proc = Bun.spawn([cmd, ...args], {
				cwd: opts?.cwd,
				env: opts?.env ? { ...process.env, ...opts.env } : process.env,
				stdin: "ignore",
				stdout: prefix ? "pipe" : "inherit",
				stderr: prefix ? "pipe" : "inherit",
			});
			opts?.onChild?.(() => {
				try {
					proc.kill("SIGTERM");
				} catch {
					// process may already have exited
				}
			});
			if (prefix && proc.stdout && proc.stderr) {
				const pump = async (
					stream: ReadableStream<Uint8Array>,
					target: NodeJS.WriteStream,
				): Promise<void> => {
					const reader = stream.getReader();
					const decoder = new TextDecoder();
					let carry = "";
					try {
						while (true) {
							const { value, done } = await reader.read();
							if (done) break;
							carry += decoder.decode(value, { stream: true });
							const lines = carry.split(/\r?\n/);
							carry = lines.pop() ?? "";
							for (const line of lines) {
								if (line.length > 0) target.write(`${prefix}${line}\n`);
							}
						}
						carry += decoder.decode();
						if (carry.length > 0) target.write(`${prefix}${carry}\n`);
					} finally {
						reader.releaseLock();
					}
				};
				const [exitCode] = await Promise.all([
					proc.exited,
					pump(proc.stdout, process.stdout),
					pump(proc.stderr, process.stderr),
				]);
				return { exitCode };
			}
			return { exitCode: await proc.exited };
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
		try {
			const expanded = expandLocalHome(candidate);
			accessSync(expanded, constants.X_OK);
			return expanded;
		} catch {
			// not executable
		}
	}
	return null;
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
	return args;
}

export function buildRsyncRshCommand(endpoint: SshEndpoint, controlPath?: string): string {
	return ["ssh", ...buildSshBaseArgs(endpoint, controlPath)].map(quotePosix).join(" ");
}

export async function resolveThunderEndpoint(
	instance: ThunderInstanceInfo,
	homeDir = homedir(),
): Promise<SshEndpoint> {
	if (!instance.ip) {
		throw new Error(
			`Could not resolve IP address for Thunder instance ${instance.id}. Run \`tnr connect ${instance.id}\` first.`,
		);
	}
	if (!SAFE_HOST_RE.test(instance.ip)) {
		throw new Error(`Unsafe host address reported for Thunder instance ${instance.id}`);
	}

	const keyCandidates: string[] = [];
	if (instance.uuid && SAFE_UUID_RE.test(instance.uuid)) {
		keyCandidates.push(join(homeDir, ".thunder", "keys", instance.uuid));
	}
	keyCandidates.push(join(homeDir, ".ssh", "id_ed25519"), join(homeDir, ".ssh", "id_rsa"));

	let keyPath: string | undefined;
	for (const candidate of keyCandidates) {
		if (await isFileNonEmpty(candidate)) {
			keyPath = candidate;
			break;
		}
	}

	return {
		target: `ubuntu@${instance.ip}`,
		port: instance.port,
		keyPath,
		strictHostKeyChecking: "accept-new",
	};
}

export function parseProbeOutput(stdout: string): RemoteHardwareProbe {
	const map = new Map<string, string>();
	for (const line of stdout.split(/\r?\n/)) {
		const eqIdx = line.indexOf("=");
		if (eqIdx <= 0) continue;
		map.set(line.slice(0, eqIdx).trim(), line.slice(eqIdx + 1).trim());
	}
	const cudaMatch = /(\d+)\./.exec(map.get("CUDA_VER") ?? "");
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
	};
}

export function selectOnnxGpuSpec(cudaMajor?: number): string {
	// ONNX Runtime >=1.27 targets CUDA 13; <=1.26 targets CUDA 12 (Thunder cuda12-8/cuda12-9).
	if (cudaMajor !== undefined && cudaMajor >= 13) {
		return "onnxruntime-gpu[cuda,cudnn]>=1.27.0";
	}
	return "onnxruntime-gpu[cuda,cudnn]>=1.24.0,<1.27";
}

async function openSshControlMasterWithRetry(
	runner: CommandRunner,
	endpoint: SshEndpoint,
	controlPath: string,
	instanceId: string,
	maxAttempts: number,
	logPrefix: string,
): Promise<void> {
	let lastErr = "";
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
		if (masterRes.exitCode === 0) return;
		lastErr = masterRes.stderr.trim() || masterRes.stdout.trim();
		const retryable =
			attempt < maxAttempts &&
			/Connection refused|Connection closed|Operation timed out|Connection reset/i.test(lastErr);
		if (!retryable) break;
		console.log(
			`${logPrefix}SSH not ready yet on ${endpoint.target} (attempt ${attempt}/${maxAttempts}), retrying in 4s...`,
		);
		await Bun.sleep(4_000);
	}
	throw new Error(
		`${logPrefix}Failed to establish SSH connection to ${endpoint.target}: ${lastErr}. ` +
			`If needed, run \`tnr connect ${instanceId}\` once or attach your SSH key via \`tnr ssh-keys add\`.`,
	);
}

const PROBE_SCRIPT = `
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
`;

export async function withRemoteSession<T>(
	params: {
		runner: CommandRunner;
		endpoint: SshEndpoint;
		instanceId: string;
		freshVm: boolean;
		logPrefix?: string;
	},
	fn: (session: RemoteSession) => Promise<T>,
): Promise<T> {
	const { runner, endpoint, instanceId, freshVm, logPrefix = "" } = params;
	// Short socket path under /tmp to stay well within macOS 104-byte Unix socket limit.
	const socketParent = await mkdtemp("/tmp/l2r-ssh-");
	const controlPath = join(socketParent, "cm");
	let controlOpen = false;

	const sshExec = (script: string) =>
		runner.run(
			"ssh",
			[
				...buildSshBaseArgs(endpoint, controlPath),
				endpoint.target,
				`bash -c ${quotePosix(script)}`,
			],
			{ stdin: "ignore" },
		);

	const session: RemoteSession = {
		endpoint,
		exec: sshExec,
		execStreaming(script, opts) {
			return runner.runStreaming(
				"ssh",
				[
					...buildSshBaseArgs(endpoint, controlPath),
					endpoint.target,
					`bash -c ${quotePosix(script)}`,
				],
				opts,
			);
		},
		async probe() {
			const res = await sshExec(PROBE_SCRIPT);
			if (res.exitCode !== 0) {
				throw new Error(
					`SSH probe failed for ${endpoint.target} (exit ${res.exitCode}): ${res.stderr.trim() || res.stdout.trim()}`,
				);
			}
			const hw = parseProbeOutput(res.stdout);
			if (!hw.hasRsync) {
				throw new Error(`Remote host ${endpoint.target} does not have rsync installed.`);
			}
			return hw;
		},
		async uploadDir(localDir, remoteDir) {
			const rsh = buildRsyncRshCommand(endpoint, controlPath);
			const dest = `${endpoint.target}:${remoteDirTransferPath(remoteDir)}/`;
			const res = await runner.run(
				"rsync",
				["-az", "-s", "--no-links", "-e", rsh, `${localDir}/`, dest],
				{ stdin: "ignore" },
			);
			if (res.exitCode !== 0) {
				throw new Error(`rsync upload failed: ${res.stderr.trim() || res.stdout.trim()}`);
			}
		},
		async downloadDir(remoteDir, localDir, opts) {
			await mkdir(localDir, { recursive: true });
			const remoteExpr = remoteDirBashExpr(remoteDir);
			const existsCheck = await sshExec(`[ -d ${remoteExpr} ] && echo PRESENT || echo MISSING`);
			if (existsCheck.exitCode === 0 && existsCheck.stdout.trim() === "MISSING") return;

			const compress = opts?.compress ?? true;
			const rsh = buildRsyncRshCommand(endpoint, controlPath);
			const src = `${endpoint.target}:${remoteDirTransferPath(remoteDir)}/`;
			const res = await runner.run(
				"rsync",
				[compress ? "-az" : "-a", "-s", "--no-links", "--partial", "-e", rsh, src, `${localDir}/`],
				{ stdin: "ignore" },
			);
			if (res.exitCode !== 0) {
				throw new Error(
					`rsync download failed for ${remoteDir}: ${res.stderr.trim() || res.stdout.trim()}`,
				);
			}
		},
	};

	try {
		console.log(
			`${logPrefix}Opening SSH ControlMaster to ${endpoint.target}${endpoint.port ? `:${endpoint.port}` : ""}...`,
		);
		await openSshControlMasterWithRetry(
			runner,
			endpoint,
			controlPath,
			instanceId,
			freshVm ? 5 : 1,
			logPrefix,
		);
		controlOpen = true;
		return await fn(session);
	} finally {
		if (controlOpen) {
			await runner
				.run("ssh", ["-o", `ControlPath=${controlPath}`, "-O", "exit", endpoint.target], {
					stdin: "ignore",
				})
				.catch(() => {});
		}
		await rm(socketParent, { recursive: true, force: true }).catch(() => {});
	}
}
