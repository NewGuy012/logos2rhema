import { Window } from "happy-dom";

if (typeof document === "undefined") {
	const win = new Window({ url: "http://localhost/" });
	Object.assign(globalThis, {
		window: win,
		document: win.document,
		navigator: win.navigator,
		HTMLElement: win.HTMLElement,
		HTMLButtonElement: win.HTMLButtonElement,
		HTMLInputElement: win.HTMLInputElement,
		HTMLFormElement: win.HTMLFormElement,
		Element: win.Element,
		Node: win.Node,
		Event: win.Event,
		MouseEvent: win.MouseEvent,
		KeyboardEvent: win.KeyboardEvent,
		localStorage: win.localStorage,
		requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
		cancelAnimationFrame: (id: number) => clearTimeout(id),
	});
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
