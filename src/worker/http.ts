export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 6000;

export function cancelBody(
	target: { body?: ReadableStream<Uint8Array> | null } | null | undefined,
): void {
	target?.body?.cancel?.().catch(() => {});
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

export async function readJsonWithLimit(response: Response, maxBytes: number): Promise<unknown> {
	const rawLen = response.headers.get("content-length");
	const contentLen = rawLen !== null && rawLen.trim() !== "" ? Number(rawLen) : Number.NaN;
	if (Number.isFinite(contentLen) && contentLen > maxBytes) {
		cancelBody(response);
		throw new Error("Upstream response exceeded size limit");
	}
	if (!response.body) {
		const text = await response.text();
		if (new TextEncoder().encode(text).byteLength > maxBytes) {
			throw new Error("Upstream response exceeded size limit");
		}
		return JSON.parse(text) as unknown;
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			reader.cancel().catch(() => {});
			throw new Error("Upstream response exceeded size limit");
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder().decode(merged)) as unknown;
}

export type FetchJsonResult =
	| { status: "ok"; data: Record<string, unknown> }
	| { status: "not_found" }
	| { status: "rate_limited" }
	| { status: "error" };

export async function fetchJsonObject(
	fetcher: FetchLike,
	url: string,
	options: {
		headers?: HeadersInit;
		maxBytes: number;
		timeoutMs?: number;
	},
): Promise<FetchJsonResult> {
	try {
		const response = await fetchWithTimeout(
			fetcher,
			url,
			{
				headers: options.headers,
				// Workers rejects redirect: "error" with TypeError; manual + !response.ok rejects 3xx safely.
				redirect: "manual",
			},
			options.timeoutMs,
		);
		if (response.status === 404) {
			cancelBody(response);
			return { status: "not_found" };
		}
		if (response.status === 429) {
			cancelBody(response);
			return { status: "rate_limited" };
		}
		if (!response.ok) {
			cancelBody(response);
			return { status: "error" };
		}
		const payload = await readJsonWithLimit(response, options.maxBytes);
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			return { status: "error" };
		}
		return { status: "ok", data: payload as Record<string, unknown> };
	} catch {
		return { status: "error" };
	}
}
