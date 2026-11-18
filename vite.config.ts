import { createRequire } from "node:module";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Bun 1.4+ provides a built-in "undici" stub that shadows node_modules/undici
// and omits Pool#close() / Dispatcher#dispatch() required by Miniflare.
if ("Bun" in globalThis) {
	const require = createRequire(import.meta.url);
	const Module = require("node:module") as {
		_resolveFilename?: ((request: string, ...args: unknown[]) => string) & {
			__undiciPatched?: boolean;
		};
	};
	const origResolve = Module._resolveFilename;
	if (origResolve && !origResolve.__undiciPatched) {
		const realUndici = require.resolve("undici/index.js");
		const patchedResolve = function (this: unknown, request: string, ...args: unknown[]) {
			if (request === "undici") return realUndici;
			return origResolve.apply(this, [request, ...args]);
		};
		patchedResolve.__undiciPatched = true;
		Module._resolveFilename = patchedResolve;
	}
}

export default defineConfig(async () => {
	const { cloudflare } = await import("@cloudflare/vite-plugin");
	return {
		plugins: [react(), cloudflare()],
	};
});
