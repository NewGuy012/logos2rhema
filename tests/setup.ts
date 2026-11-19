import { afterEach } from "bun:test";

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const activeRoots = new Set<{ root: Root; container: HTMLElement }>();

afterEach(() => {
	act(() => {
		for (const entry of activeRoots) {
			entry.root.unmount();
			entry.container.remove();
		}
		activeRoots.clear();
	});
});

export function render(ui: ReactNode) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const entry = { root, container };
	activeRoots.add(entry);

	act(() => {
		root.render(ui);
	});

	return {
		container,
		rerender(nextUi: ReactNode) {
			act(() => {
				root.render(nextUi);
			});
		},
		unmount() {
			act(() => {
				root.unmount();
			});
			container.remove();
			activeRoots.delete(entry);
		},
	};
}

export function renderHook<T>(useHook: () => T): { result: { current: T } } {
	const result = { current: undefined as T };
	function Harness() {
		result.current = useHook();
		return null;
	}
	render(createElement(Harness));
	return { result };
}

export const noop = () => {};

export function flushAsync(ms = 10): Promise<void> {
	return act(async () => {
		await new Promise((r) => setTimeout(r, ms));
	});
}

export async function waitUntil(assertion: () => void, timeoutMs = 1500): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			assertion();
			return;
		} catch (err) {
			lastError = err;
			await flushAsync();
		}
	}
	throw lastError;
}

export function mockMatchMedia(matches = true): () => void {
	const original = window.matchMedia;
	window.matchMedia = ((query: string) => ({
		matches: matches && query.includes("min-width: 1024px"),
		media: query,
		onchange: null,
		addListener: noop,
		removeListener: noop,
		addEventListener: noop,
		removeEventListener: noop,
		dispatchEvent: () => false,
	})) as typeof window.matchMedia;
	return () => {
		window.matchMedia = original;
	};
}

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

export function installMockAudio(options?: {
	readyState?: number;
	initialTime?: number;
	emitTimeUpdateOnPlay?: boolean;
}) {
	const original = globalThis.Audio;
	let currentTime = options?.initialTime ?? 0;
	const readyState = options?.readyState ?? 4;
	const listeners = new Map<string, Array<() => void>>();
	const emit = (type: string) => {
		for (const fn of listeners.get(type) ?? []) fn();
	};

	class MockAudio {
		preload = "metadata";
		src = "";
		duration = 120;
		readyState = readyState;
		paused = true;
		playbackRate = 1;
		preservesPitch = true;
		get currentTime() {
			return currentTime;
		}
		set currentTime(val: number) {
			currentTime = val;
		}
		load() {}
		getAttribute(name: string) {
			return name === "src" ? this.src || null : null;
		}
		removeAttribute(name: string) {
			if (name === "src") this.src = "";
		}
		addEventListener(type: string, fn: () => void) {
			listeners.set(type, [...(listeners.get(type) ?? []), fn]);
		}
		removeEventListener() {}
		pause() {
			this.paused = true;
			emit("pause");
		}
		play() {
			this.paused = false;
			emit("play");
			if (options?.emitTimeUpdateOnPlay) emit("timeupdate");
			return Promise.resolve();
		}
	}

	globalThis.Audio = MockAudio as unknown as typeof Audio;
	return {
		getCurrentTime: () => currentTime,
		setCurrentTime: (val: number) => {
			currentTime = val;
		},
		emit,
		restore: () => {
			globalThis.Audio = original;
		},
	};
}

export function getByText(root: ParentNode, pattern: string | RegExp): HTMLElement {
	const matches = Array.from(root.querySelectorAll<HTMLElement>("*")).filter((el) => {
		const text = el.textContent ?? "";
		return typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
	});
	const leaf = matches.findLast((el) => el.children.length === 0) ?? matches[matches.length - 1];
	if (!leaf) throw new Error(`Unable to find text: ${pattern}`);
	return leaf;
}

export function getButton(root: ParentNode, labelOrText: string | RegExp): HTMLButtonElement {
	const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
	const match = buttons.find((btn) => {
		const target = `${btn.getAttribute("aria-label") ?? ""} ${btn.textContent ?? ""}`;
		return typeof labelOrText === "string"
			? target.includes(labelOrText)
			: labelOrText.test(target);
	});
	if (!match) throw new Error(`Unable to find button: ${labelOrText}`);
	return match;
}

export function fireClick(el: Element): void {
	act(() => {
		el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
	});
}

export function fireHover(el: Element, enter: boolean): void {
	act(() => {
		el.dispatchEvent(
			new window.MouseEvent(enter ? "mouseover" : "mouseout", { bubbles: true, cancelable: true }),
		);
	});
}

export function setInputValue(input: HTMLInputElement, value: string): void {
	act(() => {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
		setter?.call(input, value);
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
}

export function submitForm(form: HTMLFormElement): void {
	act(() => {
		form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
	});
}

export function fireDrag(el: Element, from: [number, number], to: [number, number]): void {
	act(() => {
		el.dispatchEvent(
			new window.MouseEvent("mousedown", {
				bubbles: true,
				button: 0,
				clientX: from[0],
				clientY: from[1],
			}),
		);
		window.dispatchEvent(
			new window.MouseEvent("mousemove", { bubbles: true, clientX: to[0], clientY: to[1] }),
		);
		window.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
	});
}
