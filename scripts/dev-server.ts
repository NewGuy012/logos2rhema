import { stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import indexHtml from "../index.html";
import {
	createApp,
	type R2BucketLike,
	type R2ObjectBodyLike,
	type WorkerBindings,
} from "../src/worker/index";

const ROOT_DIR = join(import.meta.dir, "..");
const PUBLIC_DIR = join(ROOT_DIR, "public");
const DIST_CLIENT_DIR = join(ROOT_DIR, "dist", "client");
const DEV_VARS_PATH = join(ROOT_DIR, ".dev.vars");
const HEADERS_PATH = join(PUBLIC_DIR, "_headers");
const LOCAL_AUDIO_DIR = join(ROOT_DIR, ".cache", "krv-supertonic-audio");

function stripOptionalQuotes(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

async function loadDevVars(): Promise<WorkerBindings> {
	const file = Bun.file(DEV_VARS_PATH);
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
		bindings[key] = value;
	}
	return {
		ESV_API_KEY: bindings.ESV_API_KEY,
		AUDIO_BASE_URL: bindings.AUDIO_BASE_URL,
	};
}

async function loadStaticHeaders(): Promise<Array<[string, string]>> {
	const file = Bun.file(HEADERS_PATH);
	if (!(await file.exists())) {
		return [];
	}
	const headers: Array<[string, string]> = [];
	let inRootRule = false;
	for (const rawLine of (await file.text()).split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		if (!rawLine.startsWith(" ") && !rawLine.startsWith("\t")) {
			inRootRule = trimmed === "/*";
			continue;
		}
		if (!inRootRule) continue;
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx <= 0) continue;
		const name = trimmed.slice(0, colonIdx).trim();
		const value = trimmed.slice(colonIdx + 1).trim();
		if (name && value) {
			headers.push([name, value]);
		}
	}
	return headers;
}

function applyHeaders(headers: Headers, extra: Array<[string, string]>): Headers {
	for (const [name, value] of extra) {
		headers.set(name, value);
	}
	return headers;
}

function resolveSafeStaticPath(baseDir: string, requestPath: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(requestPath);
	} catch {
		return null;
	}
	if (decoded.includes("\0")) return null;
	const rel = decoded.replace(/^\/+/, "");
	const root = resolve(baseDir);
	const candidate = resolve(root, rel);
	if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
		return null;
	}
	return candidate;
}

async function serveStaticFile(
	filePath: string,
	staticHeaders: Array<[string, string]>,
	method = "GET",
	contentType?: string,
): Promise<Response | null> {
	try {
		if (!(await stat(filePath)).isFile()) return null;
	} catch {
		return null;
	}
	const file = Bun.file(filePath);
	const headers = applyHeaders(new Headers(), staticHeaders);
	if (contentType) {
		headers.set("Content-Type", contentType);
	} else if (file.type) {
		headers.set("Content-Type", file.type);
	}
	return new Response(method === "HEAD" ? null : file, { headers });
}

async function isDirectory(dirPath: string): Promise<boolean> {
	try {
		return (await stat(dirPath)).isDirectory();
	} catch {
		return false;
	}
}

function createLocalAudioBucket(baseDir: string): R2BucketLike {
	async function resolveAudioFile(key: string) {
		const filePath = resolveSafeStaticPath(baseDir, key);
		if (!filePath) return null;
		const file = Bun.file(filePath);
		if (!(await file.exists())) return null;
		const size = file.size;
		const contentType = filePath.toLowerCase().endsWith(".mp3")
			? "audio/mpeg"
			: file.type || "application/octet-stream";
		const httpEtag = `"local-${size}-${file.lastModified}"`;
		return { file, size, contentType, httpEtag };
	}

	return {
		async head(key): Promise<R2ObjectBodyLike | null> {
			const entry = await resolveAudioFile(key);
			if (!entry) return null;
			return {
				size: entry.size,
				httpEtag: entry.httpEtag,
				httpMetadata: { contentType: entry.contentType },
			};
		},
		async get(key, options): Promise<R2ObjectBodyLike | null> {
			const entry = await resolveAudioFile(key);
			if (!entry) return null;
			const { file, size, contentType, httpEtag } = entry;
			const range = options?.range;
			if (!range) {
				return {
					size,
					httpEtag,
					httpMetadata: { contentType },
					body: file.stream(),
				};
			}

			let offset = 0;
			let length = 0;
			if ("suffix" in range && range.suffix !== undefined) {
				length = size > 0 && range.suffix > 0 ? Math.min(range.suffix, size) : 0;
				offset = size - length;
			} else {
				const rawOffset = "offset" in range && range.offset !== undefined ? range.offset : 0;
				if (rawOffset >= 0 && rawOffset < size) {
					offset = rawOffset;
					const maxLen = size - offset;
					length =
						"length" in range && range.length !== undefined
							? Math.max(0, Math.min(range.length, maxLen))
							: maxLen;
				} else {
					offset = rawOffset;
					length = 0;
				}
			}

			const body =
				length > 0
					? file.slice(offset, offset + length).stream()
					: new ReadableStream<Uint8Array>({
							start(controller) {
								controller.close();
							},
						});

			return {
				size,
				httpEtag,
				httpMetadata: { contentType },
				range: { offset, length },
				body,
			};
		},
	};
}

const isPreview = process.argv.includes("--preview");
const hostname = process.env.HOST?.trim() || "127.0.0.1";
const rawLoopbackHost = hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname;
const loopbackHost = rawLoopbackHost.includes(":") ? `[${rawLoopbackHost}]` : rawLoopbackHost;
const port = Number.parseInt(process.env.PORT ?? "", 10) || (isPreview ? 4173 : 5173);
const devVars = await loadDevVars();
if (!devVars.AUDIO_BASE_URL?.trim() && (await isDirectory(LOCAL_AUDIO_DIR))) {
	devVars.AUDIO_BUCKET = createLocalAudioBucket(LOCAL_AUDIO_DIR);
}
const workerApp = createApp();

if (isPreview) {
	const indexExists = await Bun.file(join(DIST_CLIENT_DIR, "index.html")).exists();
	if (!indexExists) {
		throw new Error(`Missing ${join(DIST_CLIENT_DIR, "index.html")}. Run 'bun run build' first.`);
	}
	const staticHeaders = await loadStaticHeaders();
	const respondPreview = async (
		req: Request,
		filePath: string | null,
		contentType?: string,
	): Promise<Response> => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			const headers = applyHeaders(new Headers({ Allow: "GET, HEAD" }), staticHeaders);
			return new Response("Method Not Allowed", { status: 405, headers });
		}
		const res = filePath
			? await serveStaticFile(filePath, staticHeaders, req.method, contentType)
			: null;
		return (
			res ??
			new Response(req.method === "HEAD" ? null : "Not Found", {
				status: 404,
				headers: applyHeaders(new Headers(), staticHeaders),
			})
		);
	};
	const serveDistAsset = (req: Request): Promise<Response> =>
		respondPreview(req, resolveSafeStaticPath(DIST_CLIENT_DIR, new URL(req.url).pathname));

	const server = Bun.serve({
		hostname,
		port,
		routes: {
			"/api/*": (req) => workerApp.fetch(req, devVars),
			"/assets/*": serveDistAsset,
			"/data/*": serveDistAsset,
			"/favicon.svg": (req) =>
				respondPreview(req, join(DIST_CLIENT_DIR, "favicon.svg"), "image/svg+xml"),
			"/*": (req) =>
				respondPreview(req, join(DIST_CLIENT_DIR, "index.html"), "text/html; charset=utf-8"),
		},
	});

	console.log(`Preview server running at ${server.url}`);
} else {
	let devPort = port;
	const server = Bun.serve({
		hostname,
		port,
		development: {
			hmr: true,
			console: true,
		},
		routes: {
			"/api/*": (req) => workerApp.fetch(req, devVars),
			"/data/*": { dir: join(PUBLIC_DIR, "data") },
			"/favicon.svg": async () => {
				const file = Bun.file(join(PUBLIC_DIR, "favicon.svg"));
				return new Response(file, {
					headers: { "Content-Type": "image/svg+xml" },
				});
			},
			"/": indexHtml,
		},
		async fetch(req) {
			const url = new URL(req.url);
			if (
				(req.method === "GET" || req.method === "HEAD") &&
				!url.pathname.startsWith("/api/") &&
				!url.pathname.startsWith("/data/") &&
				!url.pathname.startsWith("/_bun/")
			) {
				return fetch(`http://${loopbackHost}:${devPort}/`, { method: req.method });
			}
			return new Response("Not Found", { status: 404 });
		},
	});
	devPort = server.port ?? port;

	console.log(`Dev server running at ${server.url}`);
}
