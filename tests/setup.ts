import "./dom";

import { act, createElement, type ReactNode } from "react";
import type { Root } from "react-dom/client";

import { clearLoaderCaches } from "../src/react-app/lib/bible-loader";
import {
	SUPERTONIC_TRACK_ATTRIBUTION,
	SUPERTONIC_TRACK_ID,
	SUPERTONIC_TRACK_LABEL,
} from "../src/shared/audio-timings";
import { clearPendingAnimationFrames } from "./dom";

// Load react-dom/client after ./dom installs global document/window (CJS static imports link before ESM bodies).
const { createRoot } = await import("react-dom/client");

const activeRoots = new Set<{ root: Root; container: HTMLElement }>();

export function cleanupDom(): void {
	clearPendingAnimationFrames();
	act(() => {
		for (const entry of activeRoots) {
			entry.root.unmount();
			entry.container.remove();
		}
		activeRoots.clear();
	});
	window.getSelection()?.removeAllRanges();
	window.location.hash = "";
	localStorage.clear();
	clearLoaderCaches();
}

export function render(ui: ReactNode) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	activeRoots.add({ root, container });

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
	};
}

export function renderHook<T, P = void>(
	useHook: (props: P) => T,
	initialProps?: P,
): { result: { current: T }; rerender: (nextProps: P) => void } {
	const result = { current: undefined as T };
	function Harness({ hookProps }: { hookProps: P }) {
		result.current = useHook(hookProps);
		return null;
	}
	const rendered = render(createElement(Harness, { hookProps: initialProps as P }));
	return {
		result,
		rerender: (nextProps: P) => rendered.rerender(createElement(Harness, { hookProps: nextProps })),
	};
}

export const noop = () => {};

export function makeBookResponse(
	translationId: string,
	bookNumber: number,
	usfm: string,
	chapters: Record<string, Array<{ verse: number; text: string }>>,
) {
	return Response.json({ translationId, bookNumber, usfm, chapters });
}

export function makeChapterResponse(
	translationId: string,
	bookNumber: number,
	usfm: string,
	chapter: number,
	verses: Array<{ verse: number; text: string; heading?: string }>,
) {
	return Response.json({ translationId, bookNumber, usfm, chapter, verses });
}

export function createReaderFetchHandler(
	options: {
		lexicon?: Record<string, unknown>;
		esv?: (url: string) => Response | Promise<Response>;
		krv?: (url: string) => Response | Promise<Response>;
		audio?: (url: string) => Response | Promise<Response>;
		timings?: (url: string) => Response | Promise<Response>;
		commentary?: (url: string) => Response | Promise<Response>;
	} = {},
) {
	return (url: string) => {
		if (url.includes("/data/lexicon.json")) return Response.json(options.lexicon ?? {});
		if (url.includes("/data/bibles/krv/") && options.krv) return options.krv(url);
		if (url.startsWith("/api/esv/") && options.esv) return options.esv(url);
		if (url.startsWith("/api/audio/")) {
			return options.audio ? options.audio(url) : Response.json({ tracks: [] });
		}
		if (url.includes("/data/timings/krv-supertonic/") && options.timings) {
			return options.timings(url);
		}
		if (url.startsWith("/api/commentary/")) {
			return options.commentary ? options.commentary(url) : Response.json({ entries: [] });
		}
		return new Response("Not Found", { status: 404 });
	};
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
			await act(async () => {
				await new Promise((r) => setTimeout(r, 8));
			});
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

export { withMockFetch } from "./helpers";

export interface MockAudioInstance {
	preload: string;
	src: string;
	duration: number;
	readyState: number;
	paused: boolean;
	playbackRate: number;
	defaultPlaybackRate: number;
	preservesPitch: boolean;
	error: { code: number } | null;
	currentTime: number;
	playCalls: number;
	emit(type: string): void;
}

export function installMockAudio(options?: {
	readyState?: number;
	initialTime?: number;
	emitTimeUpdateOnPlay?: boolean;
}) {
	const original = globalThis.Audio;
	const instances: MockAudioInstance[] = [];

	class MockAudio implements MockAudioInstance {
		preload = "metadata";
		src = "";
		duration = 120;
		readyState = options?.readyState ?? 4;
		paused = true;
		playbackRate = 1;
		defaultPlaybackRate = 1;
		preservesPitch = true;
		error: { code: number } | null = null;
		currentTime = options?.initialTime ?? 0;
		playCalls = 0;
		private listeners = new Map<string, Set<() => void>>();

		constructor() {
			instances.push(this);
		}
		emit(type: string) {
			for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
		}
		load() {}
		getAttribute(name: string) {
			return name === "src" ? this.src || null : null;
		}
		removeAttribute(name: string) {
			if (name === "src") this.src = "";
		}
		addEventListener(type: string, fn: () => void) {
			let set = this.listeners.get(type);
			if (!set) {
				set = new Set();
				this.listeners.set(type, set);
			}
			set.add(fn);
		}
		removeEventListener(type: string, fn: () => void) {
			this.listeners.get(type)?.delete(fn);
		}
		pause() {
			this.paused = true;
			this.emit("pause");
		}
		play() {
			this.playCalls++;
			this.paused = false;
			this.emit("play");
			if (options?.emitTimeUpdateOnPlay) this.emit("timeupdate");
			return Promise.resolve();
		}
	}

	globalThis.Audio = MockAudio as unknown as typeof Audio;
	const latest = () => instances[instances.length - 1];
	return {
		instances,
		latest,
		getCurrentTime: () => latest()?.currentTime ?? 0,
		emit: (type: string) => latest()?.emit(type),
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

export function makeSupertonicTrack(url: string, verseTimings?: Record<number, number>) {
	return {
		id: SUPERTONIC_TRACK_ID,
		label: SUPERTONIC_TRACK_LABEL,
		language: "ko" as const,
		url,
		isAiGenerated: true as const,
		attribution: SUPERTONIC_TRACK_ATTRIBUTION,
		...(verseTimings ? { verseTimings } : {}),
	};
}
