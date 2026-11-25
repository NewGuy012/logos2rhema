import { afterEach, beforeEach } from "bun:test";

export async function withMockFetch(
	handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
	fn: () => Promise<void> | void,
): Promise<void> {
	const original = globalThis.fetch;
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
		Promise.resolve(handler(String(input), init))) as unknown as typeof fetch;
	try {
		await fn();
	} finally {
		globalThis.fetch = original;
	}
}

export function createMemoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		get length() {
			return store.size;
		},
		clear: () => store.clear(),
		getItem: (k: string) => store.get(k) ?? null,
		key: (i: number) => Array.from(store.keys())[i] ?? null,
		removeItem: (k: string) => {
			store.delete(k);
		},
		setItem: (k: string, v: string) => {
			store.set(k, v);
		},
	};
}

export function installMemoryStorage(onReset?: () => void): void {
	const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

	beforeEach(() => {
		onReset?.();
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: createMemoryStorage(),
		});
	});

	afterEach(() => {
		onReset?.();
		if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
		else delete (globalThis as { localStorage?: unknown }).localStorage;
	});
}
