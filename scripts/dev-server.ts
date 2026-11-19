import { join, resolve, sep } from "node:path";

import indexHtml from "../index.html";
import { createApp, type WorkerBindings } from "../src/worker/index";

const ROOT_DIR = join(import.meta.dir, "..");
const PUBLIC_DIR = join(ROOT_DIR, "public");
const DIST_CLIENT_DIR = join(ROOT_DIR, "dist", "client");
const DEV_VARS_PATH = join(ROOT_DIR, ".dev.vars");
const HEADERS_PATH = join(PUBLIC_DIR, "_headers");

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
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		return null;
	}
	const headers = applyHeaders(new Headers(), staticHeaders);
	if (contentType) {
		headers.set("Content-Type", contentType);
	} else if (file.type) {
		headers.set("Content-Type", file.type);
	}
	return new Response(method === "HEAD" ? null : file, { headers });
}

const isPreview = process.argv.includes("--preview");
const port = Number.parseInt(process.env.PORT ?? "", 10) || (isPreview ? 4173 : 5173);
const devVars = await loadDevVars();
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
				return fetch(`http://127.0.0.1:${devPort}/`, { method: req.method });
			}
			return new Response("Not Found", { status: 404 });
		},
	});
	devPort = server.port ?? port;

	console.log(`Dev server running at ${server.url}`);
}
