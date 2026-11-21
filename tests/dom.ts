import { Window } from "happy-dom";

const pendingRafTimers = new Set<ReturnType<typeof setTimeout>>();

export function clearPendingAnimationFrames(): void {
	for (const id of pendingRafTimers) clearTimeout(id);
	pendingRafTimers.clear();
}

if (typeof document === "undefined") {
	const win = new Window({ url: "http://localhost/" });
	Object.assign(globalThis, {
		window: win,
		document: win.document,
		navigator: win.navigator,
		HTMLElement: win.HTMLElement,
		HTMLButtonElement: win.HTMLButtonElement,
		HTMLInputElement: win.HTMLInputElement,
		HTMLSelectElement: win.HTMLSelectElement,
		HTMLFormElement: win.HTMLFormElement,
		Element: win.Element,
		Node: win.Node,
		Range: win.Range,
		Event: win.Event,
		MouseEvent: win.MouseEvent,
		KeyboardEvent: win.KeyboardEvent,
		FocusEvent: win.FocusEvent,
		WheelEvent: win.WheelEvent,
		localStorage: win.localStorage,
		requestAnimationFrame: (cb: FrameRequestCallback) => {
			const id = setTimeout(() => {
				pendingRafTimers.delete(id);
				cb(Date.now());
			}, 0);
			pendingRafTimers.add(id);
			return id as unknown as number;
		},
		cancelAnimationFrame: (id: number) => {
			const timer = id as unknown as ReturnType<typeof setTimeout>;
			pendingRafTimers.delete(timer);
			clearTimeout(timer);
		},
	});
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
