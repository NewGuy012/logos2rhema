import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export const ROOT_DIR = join(import.meta.dir, "..", "..");
export const CACHE_DIR = join(ROOT_DIR, ".cache");
export const KRV_AUDIO_REL_DIR = join(".cache", "krv-supertonic-audio");
export const KRV_TIMINGS_REL_DIR = join("public", "data", "timings", "krv-supertonic");
export const KRV_REPORT_REL_PATH = join(".cache", "krv-supertonic-report.json");
export const AUDIO_CACHE_DIR = join(ROOT_DIR, KRV_AUDIO_REL_DIR);
export const TIMINGS_OUT_DIR = join(ROOT_DIR, KRV_TIMINGS_REL_DIR);

export function stripOptionalQuotes(value: string): string {
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
	if (!(await file.exists())) return {};
	const bindings: Record<string, string> = {};
	for (const line of (await file.text()).split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
		const eqIdx = normalized.indexOf("=");
		if (eqIdx <= 0) continue;
		const key = normalized.slice(0, eqIdx).trim();
		if (key) bindings[key] = stripOptionalQuotes(normalized.slice(eqIdx + 1).trim());
	}
	return bindings;
}

export function parseNumberInRange(
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

export async function atomicWriteFile(
	path: string,
	data: string | Uint8Array | ArrayBuffer,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await Bun.write(tmpPath, data);
		await rename(tmpPath, path);
	} catch (err) {
		await rm(tmpPath, { force: true }).catch(() => {});
		throw err;
	}
}

export function atomicWriteJson(path: string, data: unknown, pretty = false): Promise<void> {
	const body = pretty ? `${JSON.stringify(data, null, 2)}\n` : JSON.stringify(data);
	return atomicWriteFile(path, body);
}

export async function atomicCopyFile(src: string, dst: string): Promise<void> {
	await mkdir(dirname(dst), { recursive: true });
	const tmpPath = `${dst}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await cp(src, tmpPath);
		await rename(tmpPath, dst);
	} catch (err) {
		await rm(tmpPath, { force: true }).catch(() => {});
		throw err;
	}
}

export async function readJsonIfExists<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch {
		return null;
	}
}

export function createSerialLock(): <T>(fn: () => Promise<T>) => Promise<T> {
	let chain: Promise<void> = Promise.resolve();
	return async <T>(fn: () => Promise<T>): Promise<T> => {
		const prev = chain;
		let release!: () => void;
		chain = new Promise<void>((res) => {
			release = res;
		});
		await prev;
		try {
			return await fn();
		} finally {
			release();
		}
	};
}

export async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
		throw err;
	}
}

export async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

export async function isFileNonEmpty(path: string, minBytes = 1): Promise<boolean> {
	try {
		const info = await stat(path);
		return info.isFile() && info.size >= minBytes;
	} catch {
		return false;
	}
}
