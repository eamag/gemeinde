export type FetchTextSuccess = {
	ok: true;
	text: string;
	/** Final URL after redirects — use it as the base for relative links. */
	url: string;
	status: number;
};

export type FetchTextFailure = {
	ok: false;
	status: number | undefined;
	error: string;
};

export type FetchTextResult = FetchTextSuccess | FetchTextFailure;

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

type FetchTextOptions = {
	userAgent: string;
	timeoutMs: number;
	/** Number of retries *after* the first attempt. */
	retries: number;
	retryDelayMs: number;
	/** Retry once over https when the plain http fetch failed. */
	retryWithHttps?: boolean;
	/** Sent as a POST body when present. Overpass rejects a bare GET without `?data=`. */
	body?: string;
	contentType?: string;
};

/**
 * Fetches a URL as text with a hard timeout and a bounded retry.
 *
 * Never rejects: transport errors, timeouts and non-2xx responses all come back
 * as a `FetchTextFailure`, so one unresponsive municipal server can never hang
 * or abort the pipeline.
 */
export async function fetchTextWithRetry(
	url: string,
	options: FetchTextOptions
): Promise<FetchTextResult> {
	const attempt = async (targetUrl: string): Promise<FetchTextResult> => {
		let status: number | undefined;
		let error = `HTTP request to ${targetUrl} failed`;

		for (let retry = 0; retry <= options.retries; retry++) {
			try {
				const response = await fetch(targetUrl, {
					method: options.body ? 'POST' : 'GET',
					headers: {
						'user-agent': options.userAgent,
						...(options.body
							? { 'content-type': options.contentType ?? 'application/x-www-form-urlencoded' }
							: {})
					},
					redirect: 'follow',
					body: options.body,
					signal: AbortSignal.timeout(options.timeoutMs)
				});
				if (response.ok) {
					return {
						ok: true,
						text: await response.text(),
						url: response.url,
						status: response.status
					};
				}

				error = `HTTP ${response.status}`;
				// 429 is the shared Overpass instance shedding load, which is exactly the
				// case where waiting beats giving up. Anything else 4xx is a real answer.
				const retryable = response.status >= 500 || response.status === 429;
				if (!retryable || retry >= options.retries) return { ok: false, status, error };
			} catch (caught) {
				status = undefined;
				error = caught instanceof Error ? caught.message : String(caught);
				if (retry >= options.retries) return { ok: false, status, error };
			}

			await sleep(options.retryDelayMs * (retry + 1));
		}

		return { ok: false, status, error };
	};

	const result = await attempt(url);
	if (result.ok || !options.retryWithHttps || !url.startsWith('http://')) return result;

	return await attempt(`${url.replace('http://', 'https://')}`);
}
