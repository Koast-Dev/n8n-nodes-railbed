// The record fields as n8n resource locators: their modes and checks through n8n-workflow's own parameter validation,
// and what the node sends for each mode once n8n's extractValue has run (mirrored in fake-n8n.mjs).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { Railbed } from '../dist/nodes/Railbed/Railbed.node.js';
import { executeContext, extractLocatorValue, fakeRailbed, locator, NODE, orderRecord, paymentRecord } from './fake-n8n.mjs';

const { NodeHelpers } = createRequire(import.meta.url)('n8n-workflow');
const { description } = new Railbed();

/** Every resource locator, with the resource and operations it shows on (or the collection it sits in). */
function locators() {
	const found = [];
	for (const p of description.properties) {
		if (p.type === 'resourceLocator') found.push({ p, path: p.name, show: p.displayOptions.show });
		if (p.type === 'collection')
			for (const o of p.options) if (o.type === 'resourceLocator') found.push({ p: o, path: `${p.name}.${o.name}`, show: p.displayOptions.show });
	}
	return found;
}

test('every record field is a resource locator, From List first', () => {
	const fields = locators();
	assert.deepEqual(
		[...new Set(fields.map((f) => `${f.show.resource[0]}:${f.path}`))].sort(),
		['checkoutSession:sessionId', 'customer:customerId', 'order:filters.customerId', 'order:orderId', 'payment:paymentId', 'webhookEndpoint:endpointId'],
	);
	for (const { p, path } of fields) {
		assert.deepEqual(p.default, { mode: 'list', value: '' }, path);
		assert.deepEqual(p.modes.map((m) => [m.displayName, m.name]), [['From List', 'list'], ['By ID', 'id'], ['By URL', 'url']], path);
		const [list, byId, byUrl] = p.modes;
		assert.equal(list.typeOptions.searchable, true, path);
		assert.ok(list.typeOptions.searchListMethod in new Railbed().methods.listSearch, path);
		assert.equal(list.extractValue, undefined, `${path}: From List keeps the value, so an AI's $fromAI value passes through`);
		assert.equal(byId.extractValue, undefined, path);
		assert.equal(byUrl.extractValue.type, 'regex', path);
		assert.match(byId.placeholder, /^e\.g\. /);
		assert.match(byUrl.placeholder, /^e\.g\. https:\/\//);
		assert.match(p.description, /Test keys find Test records/, path);
		assert.equal(p.required, path !== 'filters.customerId', path);
	}
	assert.ok(!JSON.stringify(description).includes('Session ID'), 'no plain ID fields left');
});

/** n8n's issues for a node with these parameters (what the editor shows and what stops a manual run). */
const issues = (parameters) =>
	NodeHelpers.getNodeParametersIssues(description.properties, { ...NODE, type: 'railbed', parameters }, description)?.parameters ?? {};

test('n8n checks By ID and By URL values, but not expressions (which is how $fromAI fills them)', () => {
	const get = (paymentId) => issues({ resource: 'payment', operation: 'get', paymentId, simplify: true });
	assert.deepEqual(get(locator('id', 'pay_7AAiYH0Ykt11ED4hmfiN')), {});
	assert.deepEqual(get(locator('id', ' pay_7AAiYH0Ykt11ED4hmfiN ')), {}, 'a pasted ID with spaces');
	assert.deepEqual(get(locator('id', '1042')), {
		paymentId: ['Enter a payment ID: it starts with pay_, such as pay_7AAiYH0Ykt11ED4hmfiN'],
	});
	assert.deepEqual(get(locator('url', 'https://pay.railbed.io/p/pay_7AAiYH0Ykt11ED4hmfiN')), {});
	assert.match(get(locator('url', 'https://app.railbed.io/orders?order=ord_1')).paymentId[0], /^Paste a payment’s link/);
	assert.deepEqual(get(locator('id', "={{ $fromAI('Payment', 'The payment ID', 'string') }}")), {});
	assert.deepEqual(get(locator('list', "={{ $fromAI('Payment') }}")), {});
	assert.deepEqual(get(locator('list', 'pay_7AAiYH0Ykt11ED4hmfiN')), {});
	assert.deepEqual(get(locator('list', '')), { paymentId: ['Parameter "Payment" is required.'] });

	const order = (orderId) => issues({ resource: 'order', operation: 'update', orderId, fulfillment: 'fulfilled', simplify: true });
	assert.deepEqual(order(locator('id', 'ord_M4tQx8ZkP1vRn6WcLs2B')), {});
	assert.ok(order(locator('id', 'pay_7AAiYH0Ykt11ED4hmfiN')).orderId);
	const endpoint = (endpointId) => issues({ resource: 'webhookEndpoint', operation: 'delete', endpointId });
	assert.deepEqual(endpoint(locator('url', 'https://app.railbed.io/developers?endpoint=we_N8nQ4vRx7KtZ2mLp9WcB&mode=live#webhooks')), {});
	// n8n (2.42) doesn't check a locator inside a collection, so the Orders filter's value is checked when the node runs
	// (the last tests below); an empty one is fine.
	const filtered = (customerId) => issues({ resource: 'order', operation: 'getAll', returnAll: true, filters: { customerId }, simplify: true });
	assert.deepEqual(filtered(locator('list', '')), {});
	assert.deepEqual(filtered(locator('id', 'nathan@example.com')), {});
});

test('n8n’s extractValue takes the ID out of a link and leaves the other modes as they are', () => {
	const property = description.properties.find((p) => p.name === 'paymentId');
	assert.equal(extractLocatorValue(locator('url', 'https://app.railbed.io/payments?status=held&open=pay_abc&mode=test'), property, 'paymentId'), 'pay_abc');
	assert.equal(extractLocatorValue(locator('id', ' pay_abc '), property, 'paymentId'), ' pay_abc ');
	assert.equal(extractLocatorValue(locator('list', 'pay_abc'), property, 'paymentId'), 'pay_abc');
	assert.equal(extractLocatorValue('pay_abc', property, 'paymentId'), 'pay_abc', 'a plain value from an older workflow');
	assert.throws(() => extractLocatorValue(locator('url', 'https://example.com/'), property, 'paymentId'), /URL entered is incorrect/);
});

const run = (railbed, parameters, options) => new Railbed().execute.call(executeContext(railbed, parameters, options));

test('each mode reaches the same record', async () => {
	const target = 'pay_7AAiYH0Ykt11ED4hmfiN';
	for (const value of [
		locator('list', target),
		locator('id', ` ${target} `),
		locator('url', `https://app.railbed.io/payments?open=${target}&mode=test`),
		locator('url', `https://pay.railbed.io/p/${target}`),
		target,
	]) {
		const railbed = fakeRailbed();
		railbed.add('payment', paymentRecord({ id: target }));
		const [[item]] = await run(railbed, { resource: 'payment', operation: 'get', paymentId: value, simplify: true });
		assert.equal(item.json.id, target, JSON.stringify(value));
		assert.deepEqual(railbed.requests.map((r) => `${r.method} ${r.path}`), [`GET /payments/${target}`]);
	}
});

test('every operation with a record field reads it through the locator', async () => {
	const cases = [
		[{ resource: 'checkoutSession', operation: 'get', sessionId: locator('url', 'https://pay.railbed.io/p/pay_1') }, 'GET /checkout_sessions/pay_1'],
		[{ resource: 'checkoutSession', operation: 'start', sessionId: locator('list', 'pay_1'), startFields: {} }, 'POST /checkout_sessions/pay_1/start'],
		[{ resource: 'payment', operation: 'simulate', paymentId: locator('id', 'pay_1'), outcome: 'paid' }, 'POST /payments/pay_1/simulate'],
		[{ resource: 'order', operation: 'get', orderId: locator('url', 'https://app.railbed.io/orders?order=ord_1') }, 'GET /orders/ord_1'],
		[{ resource: 'order', operation: 'update', orderId: locator('list', 'ord_1'), fulfillment: 'fulfilled' }, 'PATCH /orders/ord_1'],
		[{ resource: 'order', operation: 'recordEvent', orderId: locator('id', 'ord_1'), eventType: 'canceled', storeEventId: 'c_1' }, 'POST /orders/ord_1/events'],
		[{ resource: 'customer', operation: 'get', customerId: locator('url', 'https://app.railbed.io/customers/cus_1?mode=live') }, 'GET /customers/cus_1'],
		[{ resource: 'webhookEndpoint', operation: 'get', endpointId: locator('list', 'we_1') }, 'GET /webhook_endpoints/we_1'],
		[{ resource: 'webhookEndpoint', operation: 'delete', endpointId: locator('url', 'https://app.railbed.io/developers?endpoint=we_1') }, 'DELETE /webhook_endpoints/we_1'],
	];
	for (const [parameters, call] of cases) {
		const railbed = fakeRailbed();
		railbed.queue({ statusCode: 200, headers: {}, body: { id: 'x' } });
		await run(railbed, { simplify: false, ...parameters });
		assert.deepEqual(railbed.requests.map((r) => `${r.method} ${r.path}`), [call]);
	}
});

test('the Orders filter takes a customer from any mode, and an empty one lists every order', async () => {
	const railbed = fakeRailbed();
	railbed.add('order', orderRecord({ id: 'ord_1', customer_id: 'cus_1' }), orderRecord({ id: 'ord_2', customer_id: 'cus_2', created: 1 }));
	const list = (customerId) =>
		run(railbed, { resource: 'order', operation: 'getAll', returnAll: true, simplify: true, filters: customerId === undefined ? {} : { customerId } });
	assert.deepEqual((await list(locator('url', 'https://app.railbed.io/customers/cus_2')))[0].map((i) => i.json.id), ['ord_2']);
	assert.deepEqual(railbed.requests.at(-1).qs, { customer_id: 'cus_2', limit: 100 });
	assert.equal((await list(locator('list', '')))[0].length, 2);
	assert.equal((await list(undefined))[0].length, 2);
	assert.deepEqual(railbed.requests.at(-1).qs, { limit: 100 });
	await assert.rejects(list(locator('id', 'nathan@example.com')), (error) => {
		assert.equal(error.message, '“nathan@example.com” isn’t a customer ID');
		assert.match(error.description, /Email filter/);
		return true;
	});
});

test('a value that isn’t this kind of ID stops before Railbed is asked, naming the field and the fix', async () => {
	const railbed = fakeRailbed();
	await assert.rejects(run(railbed, { resource: 'order', operation: 'get', orderId: locator('list', '1042'), simplify: true }), (error) => {
		assert.equal(error.message, '“1042” isn’t an order ID');
		assert.match(error.description, /Order IDs start with ord_, such as ord_M4tQx8ZkP1vRn6WcLs2B\. To find an order by your store’s order ID/);
		assert.equal(error.context.itemIndex, 0);
		return true;
	});
	await assert.rejects(run(railbed, { resource: 'customer', operation: 'get', customerId: locator('list', '  '), simplify: true }), {
		message: '‘Customer’ is empty',
	});
	await assert.rejects(run(railbed, { resource: 'webhookEndpoint', operation: 'delete', endpointId: locator('id', '..') }), /isn’t a webhook endpoint ID/);
	assert.equal(railbed.requests.length, 0);
});
