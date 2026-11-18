export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 6000;

export function isSafeHttpsUrl(
	rawUrl: string,
	options?: { allowedHostSuffix?: string; forbiddenSubstring?: string },
): boolean {
	try {
		const parsed = new URL(rawUrl);
		if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
			return false;
		}
		if (options?.allowedHostSuffix) {
			const rootDomain = options.allowedHostSuffix.replace(/^\./, "");
			if (parsed.hostname !== rootDomain && !parsed.hostname.endsWith(options.allowedHostSuffix)) {
				return false;
			}
		}
		if (
			options?.forbiddenSubstring &&
			(rawUrl.includes(options.forbiddenSubstring) ||
				parsed.href.includes(options.forbiddenSubstring))
		) {
			return false;
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
