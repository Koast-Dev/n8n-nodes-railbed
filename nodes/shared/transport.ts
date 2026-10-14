import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import { DEFAULT_BASE_URL, RAILBED_CREDENTIAL } from './constants';
import { describeRailbedError } from './errors';

type RailbedContext =
	| IExecuteFunctions
	| IHookFunctions
	| ILoadOptionsFunctions
	| IWebhookFunctions;

/** Hosts a Railbed server on this machine answers on: the only ones plain http is accepted for. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * The API root for a credential's Base URL: its origin plus /v1 (so a pasted ".../v1" or any other path is ignored).
 * Production is https; plain http is accepted only for a Railbed server on this machine (local testing), so a secret
 * key never travels unencrypted. Returns what's wrong instead when the address can't be used. The credential's test
 * request applies the same rules (credentials/RailbedApi.credentials.ts).
 */
export function apiRoot(baseUrl: unknown): { root: string } | { problem: string } {
	const text = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : DEFAULT_BASE_URL;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return { problem: `The Base URL in the Railbed credential isn’t a web address: ${text}` };
	}
	const local = LOCAL_HOSTS.includes(url.hostname);
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
		return { problem: 'The Base URL in the Railbed credential must start with https://' };
	}
	return { root: `${url.origin}/v1` };
}

export interface RailbedRequest {
	qs?: IDataObject;
	body?: IDataObject;
	headers?: IDataObject;
	itemIndex?: number;
}

/**
 * Railbed's error code (`invalid_url`, `duplicate_url`, `rate_limited`, …) on an error railbedApiRequest threw, or null
 * for anything else. Kept in the error's context so callers can branch on the code, never on the wording.
 */
export function railbedErrorCode(error: unknown): string | null {
	const context = (error as { context?: IDataObject } | null)?.context;
	return typeof context?.railbedCode === 'string' ? context.railbedCode : null;
}

/** The HTTP status on an error railbedApiRequest threw, or null when Railbed never answered. */
export function railbedHttpStatus(error: unknown): number | null {
	const code = Number((error as { httpCode?: string | number } | null)?.httpCode);
	return Number.isFinite(code) && code > 0 ? code : null;
}

/**
 * The output item for a failed request when the node's On Error setting continues: Railbed's message, its error code,
 * the HTTP status and what to do next, so a later node can branch on `code` instead of parsing the message.
 */
export function errorItem(error: unknown): IDataObject {
	const e = (error ?? {}) as { message?: unknown; description?: unknown };
	return {
		error: typeof e.message === 'string' && e.message ? e.message : String(error),
		code: railbedErrorCode(error),
		httpCode: railbedHttpStatus(error),
		description: typeof e.description === 'string' && e.description ? e.description : null,
	};
}

/**
 * One authenticated call to the merchant API. Railbed's error body becomes an n8n error that says what happened and
 * what to do, with Railbed's code and the field at fault; the code and any Retry-After are also kept in the error's
 * context (railbedErrorCode).
 */
export async function railbedApiRequest(
	this: RailbedContext,
	method: IHttpRequestMethods,
	path: string,
	request: RailbedRequest = {},
): Promise<IDataObject> {
	const credentials = await this.getCredentials(RAILBED_CREDENTIAL);
	const base = apiRoot(credentials.baseUrl);
	if ('problem' in base)
		throw new NodeOperationError(this.getNode(), base.problem, { itemIndex: request.itemIndex });
	// n8n's request layer drops an empty object body, but Railbed's writes need a JSON body (`{}` for a session start
	// that only uses the stored email), so an empty one is sent as the literal text.
	const emptyBody = !!request.body && Object.keys(request.body).length === 0;
	const options: IHttpRequestOptions = {
		method,
		url: `${base.root}${path}`,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		headers: {
			Accept: 'application/json',
			...(emptyBody ? { 'Content-Type': 'application/json' } : {}),
			...(request.headers ?? {}),
		},
		...(request.qs ? { qs: request.qs } : {}),
		...(request.body ? { body: emptyBody ? '{}' : request.body } : {}),
	};
	let response: IN8nHttpFullResponse;
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			RAILBED_CREDENTIAL,
			options,
		)) as IN8nHttpFullResponse;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, {
			message: 'Couldn’t reach Railbed',
			description:
				'Check the Base URL in the Railbed credential and this server’s internet connection, then try again.',
			itemIndex: request.itemIndex,
		});
	}
	if (response.statusCode >= 400) {
		const retryAfter = response.headers?.['retry-after'];
		const detail = describeRailbedError(response.statusCode, response.body, retryAfter);
		const error = new NodeApiError(this.getNode(), (response.body ?? {}) as JsonObject, {
			message: detail.message,
			description: detail.description,
			httpCode: String(response.statusCode),
			itemIndex: request.itemIndex,
		});
		if (detail.code) error.context.railbedCode = detail.code;
		if (retryAfter !== undefined) error.context.retryAfter = String(retryAfter);
		throw error;
	}
	return (response.body ?? {}) as IDataObject;
}

/** How many times one list read waits out Railbed's rate limit before giving up, and the longest single wait. */
export const RATE_LIMIT_WAITS = 3;
const LONGEST_WAIT_SECONDS = 60;

/** Seconds to wait before retrying a 429: Railbed's Retry-After, within 0–60, or the full minute when it's missing. */
export function retryAfterSeconds(error: unknown): number {
	const raw = (error as { context?: IDataObject } | null)?.context?.retryAfter;
	const seconds = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
	return Number.isFinite(seconds) ? Math.min(seconds, LONGEST_WAIT_SECONDS) : LONGEST_WAIT_SECONDS;
}

/**
 * Every item of a Railbed list (`{ data, has_more, next_cursor }`), page by page, newest first. With a `limit`, stops
 * once it has that many; otherwise follows `next_cursor` to the end. A long list can meet Railbed's per-minute request
 * budget, so a 429 is waited out (its Retry-After, at most a minute) up to RATE_LIMIT_WAITS times before it fails.
 */
export async function railbedApiRequestAllItems(
	this: RailbedContext,
	path: string,
	qs: IDataObject,
	limit: number | null,
	itemIndex?: number,
): Promise<IDataObject[]> {
	let wanted: number | null = null;
	if (limit !== null) {
		wanted = Math.floor(Number(limit));
		if (!Number.isFinite(wanted) || wanted < 1) {
			throw new NodeOperationError(this.getNode(), 'Limit must be a whole number of 1 or more', {
				itemIndex,
			});
		}
	}
	const signal = (this as Partial<IExecuteFunctions>).getExecutionCancelSignal?.();
	const results: IDataObject[] = [];
	let cursor: string | null = null;
	let waits = 0;
	for (;;) {
		const pageSize = wanted === null ? 100 : Math.min(100, wanted - results.length);
		let page: IDataObject;
		try {
			page = await railbedApiRequest.call(this, 'GET', path, {
				qs: { ...qs, limit: pageSize, ...(cursor ? { starting_after: cursor } : {}) },
				itemIndex,
			});
		} catch (error) {
			if (railbedHttpStatus(error) !== 429 || waits >= RATE_LIMIT_WAITS)
				throw new NodeApiError(this.getNode(), error as JsonObject);
			waits++;
			await sleep(retryAfterSeconds(error) * 1000, signal);
			continue;
		}
		const data = Array.isArray(page.data) ? (page.data as IDataObject[]) : [];
		results.push(...data);
		cursor =
			page.has_more === true && typeof page.next_cursor === 'string' ? page.next_cursor : null;
		if (!cursor || (wanted !== null && results.length >= wanted)) break;
	}
	return wanted === null ? results : results.slice(0, wanted);
}
