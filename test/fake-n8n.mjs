// A small stand-in for n8n's node contexts and for Railbed's /v1, so the nodes' code runs without either. The fake
// Railbed keeps webhook endpoints the way Railbed does (address normalised with URL, fragment and bare "?" removed,
// unique per mode, paged newest first) and records every request. Not a test file: node --test only runs *.test.mjs.
import { createHmac } from 'node:crypto';

export const NODE = { id: 'node-1', name: 'Railbed', type: 'railbed', typeVersion: 1, position: [0, 0], parameters: {} };

const railbedError = (statusCode, code, message, headers = {}) => ({
	statusCode,
	headers,
	body: { error: { code, message } },
});

/** Railbed's stored form of an endpoint address (worker/webhooks.ts endpointUrlInput). */
export const stored = (raw) => {
	const url = new URL(raw.trim());
	url.hash = '';
	if (!url.search) url.search = '';
	return url.toString();
};

export function fakeRailbed({ live = false } = {}) {
	const endpoints = []; // newest first, as GET /v1/webhook_endpoints lists them
	const payments = new Map();
	const requests = [];
	const queued = []; // canned answers for the next requests, ahead of the fake's own logic
	let next = 1;

	const endpointShape = (e) => ({
		id: e.id,
		object: 'webhook_endpoint',
		url: e.url,
		description: e.description ?? null,
		events: e.events,
		livemode: live,
		mode: live ? 'live' : 'test',
		previous_secret_expires_at: e.rolledUntil ?? null,
		created: 1790380800 + e.n,
	});

	function answer(method, path, options) {
		const q = options.qs ?? {};
		if (method === 'POST' && path === '/webhook_endpoints') {
			const body = options.body;
			let url;
			try {
				url = stored(body.url);
			} catch {
				return railbedError(400, 'invalid_url', 'Enter a full web address that starts with https://.');
			}
			if (live && /^http:|\/\/(localhost|127\.)/.test(url))
				return railbedError(400, 'invalid_url', 'Webhook endpoints must use https://.');
			if (endpoints.some((e) => e.url === url))
				return railbedError(409, 'duplicate_url', 'That address is already one of your endpoints.');
			if (endpoints.length >= 10) return railbedError(409, 'too_many', 'Ten endpoints already.');
			const n = next++;
			const e = { id: `we_${n}`, n, url, events: body.events, description: body.description, secret: `whsec_${n}` };
			endpoints.unshift(e);
			return { statusCode: 201, headers: {}, body: { ...endpointShape(e), secret: e.secret } };
		}
		if (method === 'GET' && path === '/webhook_endpoints') {
			let start = 0;
			if (q.starting_after) start = endpoints.findIndex((e) => e.id === q.starting_after) + 1;
			const limit = Number(q.limit ?? 20);
			const page = endpoints.slice(start, start + limit);
			const hasMore = endpoints.length > start + limit;
			return {
				statusCode: 200,
				headers: {},
				body: { data: page.map(endpointShape), has_more: hasMore, next_cursor: hasMore ? page.at(-1).id : null },
			};
		}
		let m = /^\/webhook_endpoints\/([^/]+)$/.exec(path);
		if (m) {
			const index = endpoints.findIndex((e) => e.id === decodeURIComponent(m[1]));
			if (index < 0) return railbedError(404, 'not_found', 'No such webhook endpoint.');
			if (method === 'GET') return { statusCode: 200, headers: {}, body: endpointShape(endpoints[index]) };
			if (method === 'DELETE') {
				const [e] = endpoints.splice(index, 1);
				return { statusCode: 200, headers: {}, body: { id: e.id, object: 'webhook_endpoint', deleted: true } };
			}
		}
		m = /^\/payments\/([^/]+)$/.exec(path);
		if (m && method === 'GET') {
			const payment = payments.get(decodeURIComponent(m[1]));
			return payment
				? { statusCode: 200, headers: {}, body: payment }
				: railbedError(404, 'not_found', 'No such payment.');
		}
		return railbedError(404, 'not_found', `No route for ${method} ${path}.`);
	}

	return {
		endpoints,
		payments,
		requests,
		/** Answer the next request with this response instead (an error, a page, a network failure). */
		queue(response) {
			queued.push(response);
		},
		/** The endpoint as Developers would show it after Roll secret: a 24-hour overlap with the previous secret. */
		roll(id) {
			const e = endpoints.find((x) => x.id === id);
			e.secret = `${e.secret}_rolled`;
			e.rolledUntil = Math.floor(Date.now() / 1000) + 86400;
		},
		/** Stands in for this.helpers.httpRequestWithAuthentication. */
		async httpRequestWithAuthentication(credentialName, options) {
			const url = new URL(options.url);
			const path = url.pathname.replace(/^\/v1/, '');
			requests.push({ credentialName, method: options.method, path, qs: options.qs, body: options.body, headers: options.headers });
			if (queued.length) {
				const canned = queued.shift();
				if (canned instanceof Error) throw canned;
				return canned;
			}
			return answer(options.method, path, options);
		},
	};
}

function base(railbed, extra = {}) {
	const logs = [];
	return {
		logs,
		getNode: () => NODE,
		getCredentials: async () => ({ apiKey: 'rb_test_x', baseUrl: 'https://pay.railbed.io' }),
		logger: { info: (message, meta) => logs.push([message, meta]), warn() {}, error() {}, debug() {} },
		helpers: {
			httpRequestWithAuthentication: railbed.httpRequestWithAuthentication,
			returnJsonArray: (items) => items.map((json) => ({ json })),
		},
		...extra,
	};
}

/** The context n8n gives a trigger's webhookMethods (checkExists, create, delete). */
export function hookContext(railbed, { url, events = ['payment.paid'], staticData = {}, workflow = { id: 'wf_1', name: 'Fulfil orders' } } = {}) {
	return {
		...base(railbed),
		staticData,
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => url,
		getNodeParameter: (name, fallback) => (name === 'events' ? events : fallback),
		getWorkflow: () => workflow,
	};
}

/** The context n8n gives webhook(), with a delivery signed by `secret` (or a header of your own). */
export function webhookContext(railbed, { body, secret, header, staticData, events = ['payment.paid'], options = {}, now = Math.floor(Date.now() / 1000) }) {
	const raw = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
	const signature =
		header ?? (secret ? `t=${now},v1=${createHmac('sha256', secret).update(`${now}.`).update(raw).digest('hex')}` : undefined);
	const response = { statusCode: null, body: null };
	return {
		...base(railbed),
		response,
		getWorkflowStaticData: () => staticData,
		getRequestObject: () => ({ rawBody: raw, readRawBody: async () => {} }),
		getResponseObject: () => ({
			status(code) {
				response.statusCode = code;
				return this;
			},
			json(value) {
				response.body = value;
				return this;
			},
		}),
		getHeaderData: () => (signature === undefined ? {} : { 'railbed-signature': signature }),
		getNodeParameter: (name, fallback) => (name === 'events' ? events : name === 'options' ? options : fallback),
	};
}

/** The context n8n gives the action node's execute(), with one input item and these parameters. */
export function executeContext(railbed, parameters, { continueOnFail = false, timeZone = 'UTC' } = {}) {
	return {
		...base(railbed),
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _i, fallback) => (name in parameters ? parameters[name] : fallback),
		continueOnFail: () => continueOnFail,
		getTimezone: () => timeZone,
		getExecutionCancelSignal: () => undefined,
	};
}
