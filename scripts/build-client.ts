import { cp, mkdir, rm, stat } from "node:fs/promises";
import { basename, join, sep } from "node:path";

const ROOT_DIR = join(import.meta.dir, "..");
const ENTRY_HTML = join(ROOT_DIR, "index.html");
const PUBLIC_DIR = join(ROOT_DIR, "public");
const PUBLIC_ESV_DIR = join(PUBLIC_DIR, "data", "bibles", "esv");
const DIST_CLIENT_DIR = join(ROOT_DIR, "dist", "client");

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
			return false;
		}
		throw err;
	}
}

async function buildClient(): Promise<void> {
	if (await pathExists(PUBLIC_ESV_DIR)) {
		throw new Error(
			`Refusing to build client assets: ${PUBLIC_ESV_DIR} must not exist in static public assets.`,
		);
	}

	await rm(DIST_CLIENT_DIR, { recursive: true, force: true });
	await mkdir(DIST_CLIENT_DIR, { recursive: true });

	const result = await Bun.build({
		entrypoints: [ENTRY_HTML],
		outdir: DIST_CLIENT_DIR,
		target: "browser",
		minify: true,
		splitting: true,
		publicPath: "/",
		define: {
			"process.env.NODE_ENV": JSON.stringify("production"),
		},
		naming: {
			entry: "[dir]/[name].[ext]",
			chunk: "assets/[name]-[hash].[ext]",
			asset: "assets/[name]-[hash].[ext]",
		},
	});

	if (!result.success) {
		for (const log of result.logs) {
			console.error(log);
		}
		throw new Error("Client build failed");
	}

	await cp(PUBLIC_DIR, DIST_CLIENT_DIR, {
		recursive: true,
		filter: (src) =>
			basename(src) !== ".DS_Store" &&
			src !== PUBLIC_ESV_DIR &&
			!src.startsWith(`${PUBLIC_ESV_DIR}${sep}`),
	});
	await Bun.write(join(DIST_CLIENT_DIR, ".assetsignore"), ".dev.vars\nwrangler.json\n");

	console.log(`Built ${result.outputs.length} client bundle output(s) into ${DIST_CLIENT_DIR}`);
}

await buildClient();
