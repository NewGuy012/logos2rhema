import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { type CommandRunner, resolveExecutable, SAFE_UUID_RE } from "./ssh-session";
import { parseCommaList, type RemoteOptions } from "./tts-cli";

export const THUNDER_VM_SPEC = {
	mode: "prototyping",
	gpu: "a6000",
	numGpus: 1,
	vcpus: 8,
	template: "cuda12-8",
	diskSizeGb: 100,
} as const;

export interface ThunderInstanceInfo {
	id: string;
	uuid?: string;
	name?: string;
	status: string;
	gpuType?: string;
	ip?: string;
	port?: number;
}

const SAFE_INSTANCE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

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

function extractJsonValue(rawText: string): unknown {
	const trimmed = rawText.trim();
	if (!trimmed) throw new Error("Empty JSON output from tnr CLI.");
	try {
		return JSON.parse(trimmed);
	} catch {
		const candidates = [trimmed.indexOf("["), trimmed.indexOf("{")]
			.filter((idx) => idx >= 0)
			.sort((a, b) => a - b);
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

function normalizeThunderRecord(raw: Record<string, unknown>): ThunderInstanceInfo {
	const id =
		asOptionalString(raw.id) ?? asOptionalString(raw.index) ?? asOptionalString(raw.uuid) ?? "0";
	if (!SAFE_INSTANCE_ID_RE.test(id)) {
		throw new Error(`Unsafe Thunder instance ID: "${id}"`);
	}
	const rawUuid = asOptionalString(raw.uuid);
	return {
		id,
		uuid: rawUuid && SAFE_UUID_RE.test(rawUuid) ? rawUuid : undefined,
		name: asOptionalString(raw.name),
		status: (asOptionalString(raw.status) ?? "UNKNOWN").toUpperCase(),
		gpuType: asOptionalString(raw.gpuType ?? raw.gpu_type ?? raw.gpu),
		ip: asOptionalString(raw.ip ?? raw.address ?? raw.host),
		port: asOptionalPort(raw.port ?? raw.sshPort ?? raw.ssh_port),
	};
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

export function requireTnrBinary(runner: CommandRunner): string {
	const tnrBin = resolveExecutable(runner, "tnr", [
		"/usr/local/bin/tnr",
		"/opt/homebrew/bin/tnr",
		"~/.local/bin/tnr",
	]);
	if (!tnrBin) {
		throw new Error(
			"Thunder Compute CLI (`tnr`) not found in PATH.\n" +
				"Install it with `brew tap Thunder-Compute/tnr && brew install tnr` and run `tnr login`.",
		);
	}
	return tnrBin;
}

export function buildTnrCreateArgs(): string[] {
	return [
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
	];
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

async function persistCreatedThunderKey(
	rawCreateStdout: string,
): Promise<{ uuid?: string; id?: string }> {
	try {
		const parsed = extractJsonValue(rawCreateStdout) as {
			uuid?: unknown;
			identifier?: unknown;
			id?: unknown;
			key?: unknown;
		} | null;
		const rawUuid = typeof parsed?.uuid === "string" ? parsed.uuid.trim() : "";
		const uuid = SAFE_UUID_RE.test(rawUuid) ? rawUuid : undefined;
		const rawId = parsed?.identifier ?? parsed?.id;
		const idStr =
			typeof rawId === "number" || typeof rawId === "string" ? String(rawId).trim() : "";
		const id = idStr && SAFE_INSTANCE_ID_RE.test(idStr) ? idStr : undefined;
		if (uuid && typeof parsed?.key === "string" && parsed.key.includes("PRIVATE KEY")) {
			const keysDir = join(homedir(), ".thunder", "keys");
			await mkdir(keysDir, { recursive: true, mode: 0o700 });
			const keyPath = join(keysDir, uuid);
			await writeFile(keyPath, parsed.key, { mode: 0o600 });
			await chmod(keyPath, 0o600);
		}
		return { uuid, id };
	} catch {
		return {};
	}
}

async function fetchThunderInstances(
	tnrBin: string,
	runner: CommandRunner,
): Promise<ThunderInstanceInfo[]> {
	const res = await runner.run(tnrBin, ["--json", "status", "--no-wait"], { stdin: "ignore" });
	if (res.exitCode !== 0) {
		const msg = res.stderr.trim() || res.stdout.trim();
		throw new Error(
			`\`tnr --json status --no-wait\` failed (exit ${res.exitCode}): ${msg}\nRun \`tnr login\` if you are not signed in.`,
		);
	}
	return parseThunderStatusOutput(res.stdout);
}

async function waitForThunderInstancesRunning(
	tnrBin: string,
	initialTargets: ThunderInstanceInfo[],
	runner: CommandRunner,
): Promise<ThunderInstanceInfo[]> {
	let targets = [...initialTargets];
	const deadline = Date.now() + 240_000;
	while (targets.some((t) => t.status !== "RUNNING" || !t.ip) && Date.now() < deadline) {
		const pending = targets
			.filter((t) => t.status !== "RUNNING" || !t.ip)
			.map((t) => `${t.id}(${t.status})`)
			.join(", ");
		console.log(`Waiting for Thunder instance(s) to become RUNNING: ${pending}...`);
		await Bun.sleep(4_000);
		const latest = await fetchThunderInstances(tnrBin, runner);
		targets = targets.map(
			(t) =>
				(t.uuid ? findMatchingInstance(latest, t.uuid) : undefined) ??
				findMatchingInstance(latest, t.id) ??
				t,
		);
	}

	const unready = targets.filter((t) => t.status !== "RUNNING" || !t.ip);
	if (unready.length > 0) {
		const summary = unready
			.map((t) => `${t.id} (status=${t.status}, ip=${t.ip ?? "none"})`)
			.join(", ");
		throw new Error(`Thunder instance(s) did not become ready in time: ${summary}.`);
	}
	return targets;
}

export async function deleteThunderInstance(
	tnrBin: string,
	instanceId: string,
	runner: CommandRunner,
	reason = "auto-cleanup",
): Promise<boolean> {
	if (!SAFE_INSTANCE_ID_RE.test(instanceId)) {
		throw new Error(`Invalid Thunder instance ID: "${instanceId}"`);
	}
	console.log(`Deleting Thunder Compute instance ${instanceId} (${reason})...`);
	const delRes = await runner.run(tnrBin, ["--json", "-y", "delete", instanceId], {
		stdin: "ignore",
	});
	if (delRes.exitCode !== 0) {
		console.error(
			`Warning: \`tnr delete ${instanceId}\` failed: ${delRes.stderr.trim() || delRes.stdout.trim()}`,
		);
		return false;
	}
	return true;
}

async function cleanupPartialCreatedVms(
	tnrBin: string,
	hints: ReadonlyArray<{ uuid?: string; id?: string }>,
	preExistingKeys: ReadonlySet<string>,
	keepVms: boolean,
	runner: CommandRunner,
): Promise<string[]> {
	const unresolved: string[] = [];
	const toDeleteIds: string[] = [];

	try {
		const latest = await fetchThunderInstances(tnrBin, runner);
		const matchedKeys = new Set<string>();
		for (const hint of hints) {
			const match =
				(hint.uuid ? findMatchingInstance(latest, hint.uuid) : undefined) ??
				(hint.id ? findMatchingInstance(latest, hint.id) : undefined) ??
				latest.find((inst) => {
					const key = inst.uuid || inst.id;
					return !preExistingKeys.has(key) && !matchedKeys.has(key);
				});
			if (match) {
				matchedKeys.add(match.uuid || match.id);
				toDeleteIds.push(match.id);
			} else if (hint.id || hint.uuid) {
				unresolved.push(hint.id ?? hint.uuid ?? "unknown");
			}
		}
	} catch {
		for (const hint of hints) {
			if (hint.id) toDeleteIds.push(hint.id);
			else if (hint.uuid) unresolved.push(hint.uuid);
		}
	}

	if (keepVms) {
		return [...toDeleteIds, ...unresolved];
	}

	const remaining: string[] = [...unresolved];
	for (const id of toDeleteIds) {
		const deleted = await deleteThunderInstance(tnrBin, id, runner, "cleanup after create error");
		if (!deleted) remaining.push(id);
	}
	return remaining;
}

export async function resolveThunderInstances(
	tnrBin: string,
	remote: RemoteOptions,
	neededCount: number,
	runner: CommandRunner,
): Promise<{ instances: ThunderInstanceInfo[]; createdIds: Set<string> }> {
	let instances = await fetchThunderInstances(tnrBin, runner);
	const explicitSelectors = remote.thunder ? parseCommaList(remote.thunder) : [];
	const selected: ThunderInstanceInfo[] = [];
	const seenKeys = new Set<string>();
	const createdIds = new Set<string>();
	const instanceKey = (inst: ThunderInstanceInfo) => inst.uuid || inst.id;

	for (const selector of explicitSelectors) {
		const match = findMatchingInstance(instances, selector);
		if (!match) {
			const available = instances
				.map((i) => `${i.id} (${i.status}${i.gpuType ? `, ${i.gpuType}` : ""})`)
				.join(", ");
			throw new Error(
				`Thunder instance "${selector}" not found. Available: ${available || "none"}`,
			);
		}
		const key = instanceKey(match);
		if (seenKeys.has(key)) {
			throw new Error(`Duplicate Thunder instance "${selector}" in --thunder list.`);
		}
		seenKeys.add(key);
		selected.push(match);
	}

	const shortfall = neededCount - selected.length;
	if (shortfall > 0) {
		if (remote.create) {
			const args = buildTnrCreateArgs();
			const createdHints: Array<{ uuid?: string; id?: string }> = [];
			const preExistingKeys = new Set(instances.map(instanceKey));

			for (let i = 0; i < shortfall; i++) {
				const label = shortfall > 1 ? `shard VM ${i + 1}/${shortfall}` : "instance";
				console.log(`Provisioning Thunder Compute ${label}: tnr ${args.join(" ")}`);
				const res = await runner.run(tnrBin, args, { stdin: "ignore" });
				if (res.exitCode !== 0) {
					const errDetail = res.stderr.trim() || res.stdout.trim();
					let orphanNote = "";
					if (createdHints.length > 0) {
						const remaining = await cleanupPartialCreatedVms(
							tnrBin,
							createdHints,
							preExistingKeys,
							remote.keepVms,
							runner,
						);
						if (remaining.length > 0) {
							orphanNote = ` Remaining VM(s) to check/delete: ${remaining.join(", ")} (\`tnr --json status --no-wait\`).`;
						}
					}
					throw new Error(
						`\`tnr create\` failed for ${label} (exit ${res.exitCode}): ${errDetail}${orphanNote}`,
					);
				}
				createdHints.push(await persistCreatedThunderKey(res.stdout));
			}

			instances = await fetchThunderInstances(tnrBin, runner);
			for (const hint of createdHints) {
				const match =
					(hint.uuid ? findMatchingInstance(instances, hint.uuid) : undefined) ??
					(hint.id ? findMatchingInstance(instances, hint.id) : undefined) ??
					instances.find(
						(inst) => !preExistingKeys.has(instanceKey(inst)) && !seenKeys.has(instanceKey(inst)),
					);
				if (!match) {
					const remaining = await cleanupPartialCreatedVms(
						tnrBin,
						createdHints,
						preExistingKeys,
						remote.keepVms,
						runner,
					);
					const note = remaining.length > 0 ? ` Created VM hints: ${remaining.join(", ")}.` : "";
					throw new Error(
						`Created a Thunder instance via \`tnr create\`, but could not locate it in \`tnr --json status --no-wait\`.${note}`,
					);
				}
				seenKeys.add(instanceKey(match));
				createdIds.add(match.id);
				selected.push(match);
			}
		} else if (explicitSelectors.length === 0) {
			const running = instances.filter((i) => i.status === "RUNNING");
			if (running.length === neededCount) {
				for (const inst of running) {
					seenKeys.add(instanceKey(inst));
					selected.push(inst);
				}
				console.log(
					neededCount === 1
						? `Auto-selected Thunder instance ${running[0].id} (${running[0].gpuType ?? "GPU"}, ${running[0].status}).`
						: `Auto-selected ${running.length} running Thunder instance(s): ${running.map((i) => i.id).join(", ")}.`,
				);
			} else if (neededCount === 1 && instances.length === 1) {
				selected.push(instances[0]);
			} else if (instances.length === 0) {
				throw new Error(
					"No Thunder Compute instances found (`tnr --json status --no-wait` returned []). Pass `--create` to auto-provision.",
				);
			} else {
				const available = instances.map((i) => `${i.id} (${i.status})`).join(", ");
				throw new Error(
					neededCount === 1
						? `Multiple Thunder instances found (${available}). Specify one with --thunder <id> or set THUNDER_INSTANCE in .dev.vars.`
						: `${neededCount} Thunder shard(s) needed, found ${running.length} running (${available}). Pass --create or --thunder id1,id2,...`,
				);
			}
		} else {
			throw new Error(
				`Specified ${explicitSelectors.length} --thunder instance(s), but ${neededCount} shard(s) needed. Pass --create to provision the remaining ${shortfall} VM(s).`,
			);
		}
	}

	const ready = await waitForThunderInstancesRunning(tnrBin, selected, runner);
	return { instances: ready, createdIds };
}
