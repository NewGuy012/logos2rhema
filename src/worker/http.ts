export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 6000;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function isSafeHttpsUrl(
	rawUrl: string,
	options?: { allowedHostSuffix?: string; forbiddenSubstring?: string },
): boolean {
	try {
		const parsed = new URL(rawUrl);
		const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
		if (
			parsed.protocol !== "https:" ||
			parsed.username ||
			parsed.password ||
			parsed.port !== "" ||
			!host ||
			!host.includes(".") ||
			host.includes(":") ||
			host.startsWith("[") ||
			IPV4_RE.test(host) ||
			host === "localhost" ||
			host.endsWith(".localhost") ||
			host.endsWith(".local") ||
			host.endsWith(".internal") ||
			host.endsWith(".arpa")
		) {
			return false;
		}
		if (options?.allowedHostSuffix) {
			const rootDomain = options.allowedHostSuffix.toLowerCase().replace(/^\.+|\.+$/g, "");
			if (host !== rootDomain && !host.endsWith(`.${rootDomain}`)) {
				return false;
			}
		}
		if (options?.forbiddenSubstring) {
			const encoded = encodeURIComponent(options.forbiddenSubstring);
			if (
				rawUrl.includes(options.forbiddenSubstring) ||
				parsed.href.includes(options.forbiddenSubstring) ||
				rawUrl.includes(encoded) ||
				parsed.href.includes(encoded)
			) {
				return false;
			}
		}
		return true;
	} catch {
		return false;
	}
}

export function fetchWithTimeout(
	fetcher: FetchLike,
	input: string | URL,
	init: RequestInit = {},
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
	const signal =
		init.signal ??
		(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
			? AbortSignal.timeout(timeoutMs)
			: undefined);
	return fetcher(input, signal ? { ...init, signal } : init);
}
