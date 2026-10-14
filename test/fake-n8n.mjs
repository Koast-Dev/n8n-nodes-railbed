// A small stand-in for n8n's node contexts and for Railbed's /v1, so the nodes' code runs without either. The fake
// Railbed keeps webhook endpoints the way Railbed does (address normalised with URL, fragment and bare "?" removed,
// unique per mode, paged newest first), lists payments, orders and customers with /v1's filters, limits and cursors
// (worker/routes/v1.ts), and records every request. The execute context reads parameters as n8n does, including
// `extractValue` for resource locators (n8n-core's extract-value.js, mirrored below). Not a test file: node --test only
// runs *.test.mjs.
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { Railbed } from '../dist/nodes/Railbed/Railbed.node.js';

// n8n-workflow's ESM build can't be imported by Node directly; the nodes load its CommonJS build, and so does this.
const { NodeHelpers, safeRegex } = createRequire(import.meta.url)('n8n-workflow');

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

/** A /v1 list page as Railbed answers it: limit 1–100 (20 by default), a cursor that must be a listed record's id. */
function listPage(records, q, prefix, noun) {
	const raw = q.limit === undefined ? undefined : String(q.limit);
	const limit = raw === undefined ? 20 : Number(raw);
	if ((raw !== undefined && !/^\d+$/.test(raw)) || limit < 1 || limit > 100)
		return railbedError(400, 'invalid_limit', 'limit must be an integer between 1 and 100.');
	const sorted = [...records].sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1));
	let start = 0;
	if (q.starting_after !== undefined) {
		start = sorted.findIndex((r) => r.id === q.starting_after) + 1;
		if (!String(q.starting_after).startsWith(prefix) || start === 0)
			return railbedError(400, 'invalid_cursor', `starting_after must be a ${noun} id from this merchant and mode.`);
	}
	const page = sorted.slice(start, start + limit);
	const hasMore = sorted.length > start + limit;
	return { statusCode: 200, headers: {}, body: { data: page, has_more: hasMore, next_cursor: hasMore ? page.at(-1).id : null } };
}

const NOW = Math.floor(Date.UTC(2026, 9, 12, 19, 4) / 1000); // Oct 12 2026, 19:04 UTC

/** A payment as GET /v1/payments/:id answers, with fields to override. */
export const paymentRecord = (over = {}) => ({
	id: 'pay_7AAiYH0Ykt11ED4hmfiN',
	object: 'payment',
	url: 'https://pay.railbed.io/p/pay_7AAiYH0Ykt11ED4hmfiN',
	status: 'paid',
	livemode: false,
	amount: '49.00',
	currency: 'USD',
	description: 'Pro membership',
	reference: null,
	customer_email: 'nathan@example.com',
	created: NOW,
	expires_at: NOW + 86400,
	started_at: NOW,
	metadata: null,
	order_id: null,
	collect: null,
	paid_at: NOW + 60,
	provider: null,
	hold_reason: null,
	hold_acceptable: false,
	canceled_at: null,
	method: 'card',
	settlement: {},
	...over,
});

/** An order as GET /v1/orders/:id answers. */
export const orderRecord = (over = {}) => ({
	id: 'ord_M4tQx8ZkP1vRn6WcLs2B',
	object: 'order',
	livemode: false,
	number: 1042,
	status: 'paid',
	needs_review: false,
	fulfillment: 'unfulfilled',
	fulfilled_at: null,
	customer_id: 'cus_Hc7nQ2wVz9KpT4mRb1Ye',
	currency: 'USD',
	total: '49.00',
	amount_paid: '49.00',
	items: [{ name: 'Mug', variant: null, sku: null, quantity: 1, unit_amount: '49.00', amount: '49.00' }],
	store: null,
	payment_ids: [],
	created: NOW,
	paid_at: NOW,
	...over,
});

/** A customer as GET /v1/customers/:id answers. */
export const customerRecord = (over = {}) => ({
	id: 'cus_Hc7nQ2wVz9KpT4mRb1Ye',
	object: 'customer',
	livemode: false,
	email: 'nathan@example.com',
	name: 'Nathan Smith',
	phone: null,
	orders_count: 1,
	paid_orders_count: 1,
	spent: { USD: '49.00' },
	created: NOW,
	last_order_at: NOW,
	erased: false,
	...over,
});

export { NOW };

export function fakeRailbed({ live = false } = {}) {
	const endpoints = []; // newest first, as GET /v1/webhook_endpoints lists them
	const payments = new Map();
	const orders = new Map();
	const customers = new Map();
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
		if (method === 'GET' && path === '/payments') {
			let list = [...payments.values()];
			if (q.status !== undefined) list = list.filter((p) => p.status === q.status);
			if (q.reference !== undefined) list = list.filter((p) => p.reference === String(q.reference).trim());
			if (q.created_gte !== undefined) list = list.filter((p) => p.created >= Number(q.created_gte));
			if (q.created_lte !== undefined) list = list.filter((p) => p.created <= Number(q.created_lte));
			return listPage(list, q, 'pay_', 'payment');
		}
		m = /^\/orders\/([^/]+)$/.exec(path);
		if (m && method === 'GET') {
			const order = orders.get(decodeURIComponent(m[1]));
			return order ? { statusCode: 200, headers: {}, body: order } : railbedError(404, 'not_found', 'No such order.');
		}
		if (method === 'GET' && path === '/orders') {
			let list = [...orders.values()];
			if (q.customer_id !== undefined) list = list.filter((o) => o.customer_id === q.customer_id);
			// Railbed: store_order_id pairs with store_id ('' when none was sent); store_id alone means any store order.
			// (store is null unless the order was sent with your own order ID, worker/crm.ts storeOf.)
			if (q.store_order_id !== undefined)
				list = list.filter((o) => o.store && o.store.id === (q.store_id ?? '') && o.store.order_id === q.store_order_id);
			else if (q.store_id !== undefined) list = list.filter((o) => o.store && o.store.id === q.store_id);
			return listPage(list, q, 'ord_', 'order');
		}
		m = /^\/customers\/([^/]+)$/.exec(path);
		if (m && method === 'GET') {
			const customer = customers.get(decodeURIComponent(m[1]));
			return customer
				? { statusCode: 200, headers: {}, body: customer }
				: railbedError(404, 'not_found', 'No such customer.');
		}
		if (method === 'GET' && path === '/customers') {
			let list = [...customers.values()];
			if (q.email !== undefined) list = list.filter((c) => c.email === String(q.email).trim().toLowerCase());
			return listPage(list, q, 'cus_', 'customer');
		}
		return railbedError(404, 'not_found', `No route for ${method} ${path}.`);
	}

	return {
		endpoints,
		payments,
		orders,
		customers,
		requests,
		/** Store records as Railbed would list them. Each gets its own id unless it brings one. */
		add(kind, ...records) {
			const map = { payment: payments, order: orders, customer: customers }[kind];
			for (const record of records) map.set(record.id, record);
		},
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

/**
 * n8n-core's extractValue for a resource locator (execution-engine/node-execution-context/utils/extract-value.js in
 * n8n 2.42): the mode's extractValue regex, which must return exactly one group, or the value as it is.
 */
export function extractLocatorValue(value, property, parameterName) {
	if (typeof value !== 'object' || !value || !('mode' in value) || !('value' in value)) return value;
	const mode = (property.modes ?? []).find((m) => m.name === value.mode);
	if (!mode || !mode.extractValue) return value.value;
	if (typeof value.value !== 'string') throw new Error("ERROR: This parameter's value is invalid. Please enter a valid mode.");
	const extracted = safeRegex.exec(mode.extractValue.regex, value.value);
	if (!extracted)
		throw new Error(`ERROR: ${property.displayName} parameter's value is invalid. This is likely because the URL entered is incorrect`);
	if (extracted.length !== 2)
		throw new Error(`Property "${parameterName}" has an invalid extractValue regex "${mode.extractValue.regex}". extractValue expects exactly one group to be returned.`);
	return extracted[1];
}

const RAILBED = new Railbed().description;

/** The context n8n gives the action node's execute(), with one input item and these parameters. */
export function executeContext(railbed, parameters, { continueOnFail = false, timeZone = 'UTC' } = {}) {
	const node = { ...NODE, parameters };
	return {
		...base(railbed),
		getNode: () => node,
		getInputData: () => [{ json: {} }],
		// As n8n: a dotted name reads inside a collection, and extractValue runs the field's resource locator rules.
		getNodeParameter: (name, _i, fallback, options) => {
			let value = name.split('.').reduce((at, key) => (at && typeof at === 'object' ? at[key] : undefined), parameters);
			if (value === undefined) value = fallback;
			if (!options?.extractValue) return value;
			const property = NodeHelpers.findDisplayedProperty(name, RAILBED.properties, parameters, node, RAILBED);
			if (!property) throw new Error(`Could not find property ${name}`);
			return property.type === 'resourceLocator' ? extractLocatorValue(value, property, name) : value;
		},
		continueOnFail: () => continueOnFail,
		getTimezone: () => timeZone,
		getExecutionCancelSignal: () => undefined,
	};
}

/** The context n8n gives a list search method (Railbed.methods.listSearch) while the editor shows a From List field. */
export function loadOptionsContext(railbed, { parameters = {}, timeZone = 'UTC', baseUrl = 'https://pay.railbed.io' } = {}) {
	return {
		...base(railbed),
		getCredentials: async () => ({ apiKey: 'rb_test_x', baseUrl }),
		getTimezone: () => timeZone,
		getCurrentNodeParameter: (name) => parameters[name],
		getNodeParameter: (name, fallback) => (name in parameters ? parameters[name] : fallback),
	};
}

/** A resource locator value as n8n stores it in a workflow. */
export const locator = (mode, value) => ({ __rl: true, mode, value });
