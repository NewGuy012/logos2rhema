const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

function safeDecodePercent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value.replace(/%[0-9a-fA-F]{2}/g, (seq) => {
			try {
				return decodeURIComponent(seq);
			} catch {
				return seq;
			}
		});
	}
}

export function isSafeHttpsUrl(
	rawUrl: string,
	options?: { allowedHostSuffix?: string; forbiddenSubstring?: string },
): boolean {
	if (!rawUrl || CONTROL_CHAR_RE.test(rawUrl)) return false;
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
			const needle = options.forbiddenSubstring.toLowerCase();
			const encodedNeedle = encodeURIComponent(options.forbiddenSubstring).toLowerCase();
			const baseUrls = [rawUrl, parsed.href];
			const candidates = [...baseUrls, ...baseUrls.map(safeDecodePercent)];
			if (
				candidates.some((value) => {
					const lower = value.toLowerCase();
					return lower.includes(needle) || lower.includes(encodedNeedle);
				})
			) {
				return false;
			}
		}
		return true;
	} catch {
		return false;
	}
}

export function isSafeAudioSrc(url: string): boolean {
	if (!url || CONTROL_CHAR_RE.test(url)) return false;
	if (url.startsWith("/")) {
		try {
			const parsed = new URL(url, "https://app.local");
			return parsed.origin === "https://app.local" && parsed.pathname.startsWith("/api/audio/");
		} catch {
			return false;
		}
	}
	return isSafeHttpsUrl(url);
}
