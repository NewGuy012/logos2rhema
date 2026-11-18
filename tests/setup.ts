import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup } from "@testing-library/react";

if (typeof document === "undefined") {
	GlobalRegistrator.register();
}

afterEach(() => {
	cleanup();
});
