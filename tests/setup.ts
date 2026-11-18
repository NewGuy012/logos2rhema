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
				await new Promise((r) => setTimeout(r, 10));
			});
		}
	}
	throw lastError;
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
