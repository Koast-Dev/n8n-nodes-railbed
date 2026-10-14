// The From List fields' search methods (Railbed.methods.listSearch) against the fake /v1 in fake-n8n.mjs: what each
// list shows, how search uses Railbed's filters, paging with next_cursor, the key's mode, and Railbed's refusals.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Railbed } from '../dist/nodes/Railbed/Railbed.node.js';
import { PAGE_SIZE, SEARCH_SIZE, idIn } from '../dist/nodes/Railbed/listSearch.js';
import { whenText } from '../dist/nodes/shared/records.js';
import { customerRecord, fakeRailbed, loadOptionsContext, NOW, orderRecord, paymentRecord } from './fake-n8n.mjs';

const { listSearch } = new Railbed().methods;
const search = (railbed, method, filter, token, options) => listSearch[method].call(loadOptionsContext(railbed, options), filter, token);
const id = (prefix, n) => `${prefix}_${String(n).padStart(20, '0')}`;
const qs = (railbed) => railbed.requests.map((r) => r.qs);
const when = (tz = 'UTC') => whenText(NOW, tz);

test('every From List field names a search method the node has', () => {
	const { description, methods } = new Railbed();
	const used = new Set();
	const visit = (properties) => {
		for (const p of properties) {
			if (p.type === 'resourceLocator') for (const m of p.modes) if (m.typeOptions?.searchListMethod) used.add(m.typeOptions.searchListMethod);
			if (Array.isArray(p.options)) visit(p.options.filter((o) => o && typeof o === 'object' && 'type' in o));
		}
	};
	visit(description.properties);
	assert.deepEqual([...used].sort(), Object.keys(methods.listSearch).sort());
});

test('payments list newest first, labelled as the dashboard shows them, with a link to each', async () => {
	const railbed = fakeRailbed();
	railbed.add(
		'payment',
		paymentRecord({ id: id('pay', 1), created: NOW - 60 }),
		paymentRecord({ id: id('pay', 2), status: 'held', hold_acceptable: true, customer_email: null, amount: '12480.5', currency: 'EUR' }),
	);
	const { results, paginationToken } = await search(railbed, 'searchPayments', undefined, undefined, { timeZone: 'America/New_York' });
	assert.equal(paginationToken, undefined, 'one page, nothing more to load');
	assert.deepEqual(results, [
		{
			name: `€12,480.50 · Pro membership · Needs your decision · ${when('America/New_York')} · Test`,
			value: id('pay', 2),
			url: `https://app.railbed.io/payments?open=${id('pay', 2)}&mode=test`,
		},
		{
			name: `$49.00 · nathan@example.com · Paid · ${whenText(NOW - 60, 'America/New_York')} · Test`,
			value: id('pay', 1),
			url: `https://app.railbed.io/payments?open=${id('pay', 1)}&mode=test`,
		},
	]);
	assert.deepEqual(qs(railbed), [{ limit: PAGE_SIZE }]);
});

test('scrolling a list follows Railbed’s cursor until the last page', async () => {
	const railbed = fakeRailbed();
	for (let n = 1; n <= 120; n++) railbed.add('payment', paymentRecord({ id: id('pay', n), created: NOW + n }));
	const first = await search(railbed, 'searchPayments');
	assert.equal(first.results.length, PAGE_SIZE);
	assert.equal(first.results[0].value, id('pay', 120));
	assert.equal(first.paginationToken, id('pay', 71));
	const second = await search(railbed, 'searchPayments', '', first.paginationToken);
	assert.equal(second.results[0].value, id('pay', 70));
	const third = await search(railbed, 'searchPayments', '', second.paginationToken);
	assert.equal(third.results.length, 20);
	assert.equal(third.paginationToken, undefined);
	assert.deepEqual(qs(railbed), [
		{ limit: PAGE_SIZE },
		{ limit: PAGE_SIZE, starting_after: id('pay', 71) },
		{ limit: PAGE_SIZE, starting_after: id('pay', 21) },
	]);
});

test('an empty list is empty, not an error', async () => {
	for (const method of Object.keys(listSearch)) {
		const result = await search(fakeRailbed(), method, undefined, undefined, { parameters: { operation: 'get' } });
		assert.deepEqual(result, { results: [] }, method);
		const searched = await search(fakeRailbed(), method, 'nothing like this', undefined, { parameters: { operation: 'get' } });
		assert.deepEqual(searched, { results: [] }, `${method} with a search`);
	}
});

test('a payment search reads an ID or a pasted link directly, in one request', async () => {
	const railbed = fakeRailbed();
	const target = id('pay', 7);
	railbed.add('payment', paymentRecord({ id: target }), paymentRecord({ id: id('pay', 8) }));
	for (const typed of [target, ` ${target} `, `https://app.railbed.io/payments?status=paid&open=${target}`, `https://pay.railbed.io/p/${target}`]) {
		railbed.requests.length = 0;
		const { results } = await search(railbed, 'searchPayments', typed);
		assert.deepEqual(results.map((r) => r.value), [target], typed);
		assert.deepEqual(railbed.requests.map((r) => `${r.method} ${r.path}`), [`GET /payments/${target}`]);
	}
});

test('a payment search matches recent labels and your exact reference, in at most two requests', async () => {
	const railbed = fakeRailbed();
	railbed.add(
		'payment',
		paymentRecord({ id: id('pay', 1), customer_email: 'nathan@example.com', created: NOW - 10 }),
		paymentRecord({ id: id('pay', 2), customer_email: 'ada@example.com', amount: '18.00', created: NOW - 20 }),
		paymentRecord({ id: id('pay', 3), customer_email: 'grace@example.com', reference: 'order_1042', created: NOW - 30 }),
	);
	const names = async (typed) => (await search(railbed, 'searchPayments', typed)).results.map((r) => r.value);
	assert.deepEqual(await names('NATHAN'), [id('pay', 1)]);
	assert.deepEqual(await names('$18'), [id('pay', 2)]);
	assert.deepEqual(await names('order_1042'), [id('pay', 3)]);
	assert.deepEqual(await names('Paid'), [id('pay', 1), id('pay', 2), id('pay', 3)], 'newest first');
	railbed.requests.length = 0;
	await names('order_1042');
	assert.deepEqual(qs(railbed), [{ limit: SEARCH_SIZE }, { reference: 'order_1042', limit: SEARCH_SIZE }]);

	// A reference older than the newest 100 is still found through Railbed's own filter.
	for (let n = 10; n < 120; n++) railbed.add('payment', paymentRecord({ id: id('pay', n), created: NOW + n }));
	assert.deepEqual(await names('order_1042'), [id('pay', 3)]);
	// An ID-looking reference that isn't a payment's ID still searches as text.
	railbed.add('payment', paymentRecord({ id: id('pay', 4), reference: 'pay_from_my_shop', created: NOW - 40 }));
	assert.deepEqual(await names('pay_from_my_shop'), [id('pay', 4)]);
});

test('Checkout Session lists every session for Get, and only open ones for Start', async () => {
	const railbed = fakeRailbed();
	railbed.add('payment', paymentRecord({ id: id('pay', 1), status: 'open' }), paymentRecord({ id: id('pay', 2), status: 'paid' }));
	const get = await search(railbed, 'searchCheckoutSessions', '', undefined, { parameters: { operation: 'get' } });
	assert.equal(get.results.length, 2);
	const start = await search(railbed, 'searchCheckoutSessions', '', undefined, { parameters: { operation: 'start' } });
	assert.deepEqual(start.results.map((r) => r.value), [id('pay', 1)]);
	assert.deepEqual(qs(railbed).at(-1), { status: 'open', limit: PAGE_SIZE });
	const typed = await search(railbed, 'searchCheckoutSessions', 'nathan', undefined, { parameters: { operation: 'start' } });
	assert.deepEqual(typed.results.map((r) => r.value), [id('pay', 1)]);
});

test('orders show their number, total, status and fulfilment, and are found by number, customer or your own ID', async () => {
	const railbed = fakeRailbed();
	const nathan = customerRecord({ id: id('cus', 1) });
	railbed.add('customer', nathan, customerRecord({ id: id('cus', 2), email: 'ada@example.com' }));
	railbed.add(
		'order',
		orderRecord({ id: id('ord', 1), number: 1042, customer_id: id('cus', 1), created: NOW - 10 }),
		orderRecord({ id: id('ord', 2), number: 1043, customer_id: id('cus', 2), status: 'held', needs_review: true, created: NOW - 20 }),
		orderRecord({ id: id('ord', 3), number: 1044, customer_id: null, store: { id: '', order_id: 'A-77', order_number: '77' }, created: NOW - 30 }),
	);
	const listed = await search(railbed, 'searchOrders');
	assert.deepEqual(listed.results[0], {
		name: `Order #1042 · $49.00 · Paid · Not fulfilled · ${whenText(NOW - 10, 'UTC')} · Test`,
		value: id('ord', 1),
		url: `https://app.railbed.io/orders?order=${id('ord', 1)}&mode=test`,
	});
	assert.match(listed.results[1].name, /^Order #1043 · \$49\.00 · Needs your decision · /);
	assert.match(listed.results[2].name, /^Order #77 /, 'the store’s own number when it sent one');

	const values = async (typed, token) => (await search(railbed, 'searchOrders', typed, token)).results.map((r) => r.value);
	assert.deepEqual(await values('#1043'), [id('ord', 2)]);
	assert.deepEqual(await values(id('ord', 3)), [id('ord', 3)]);
	assert.deepEqual(await values('A-77'), [id('ord', 3)], 'your own order ID, through store_order_id');
	assert.deepEqual(await values('mug'), [id('ord', 1), id('ord', 2), id('ord', 3)], 'item names count too');

	railbed.requests.length = 0;
	assert.deepEqual(await values('Ada@Example.com'), [id('ord', 2)], 'a buyer’s email finds their orders');
	assert.deepEqual(railbed.requests.map((r) => [r.path, r.qs]), [
		['/customers', { email: 'Ada@Example.com', limit: 1 }],
		['/orders', { customer_id: id('cus', 2), limit: PAGE_SIZE }],
	]);
	assert.deepEqual(await values('nobody@example.com'), []);
	assert.deepEqual(await values(id('cus', 1)), [id('ord', 1)], 'a customer ID lists their orders');
	assert.deepEqual(await values(`https://app.railbed.io/orders?order=${id('ord', 2)}`), [id('ord', 2)]);
});

test('a customer’s orders page with the cursor too', async () => {
	const railbed = fakeRailbed();
	for (let n = 1; n <= 60; n++) railbed.add('order', orderRecord({ id: id('ord', n), customer_id: id('cus', 1), created: NOW + n }));
	const first = await search(railbed, 'searchOrders', id('cus', 1));
	assert.equal(first.results.length, PAGE_SIZE);
	const second = await search(railbed, 'searchOrders', id('cus', 1), first.paginationToken);
	assert.equal(second.results.length, 10);
	assert.equal(second.paginationToken, undefined);
	assert.deepEqual(qs(railbed).at(-1), { customer_id: id('cus', 1), limit: PAGE_SIZE, starting_after: first.paginationToken });
});

test('customers show name and email, and are found by ID, exact email or any part of their details', async () => {
	const railbed = fakeRailbed();
	railbed.add(
		'customer',
		customerRecord({ id: id('cus', 1), created: NOW - 10 }),
		customerRecord({ id: id('cus', 2), name: null, email: 'ada@example.com', phone: '+1 555 0100', created: NOW - 20 }),
		customerRecord({ id: id('cus', 3), name: null, email: null, erased: true, created: NOW - 30 }),
	);
	const listed = await search(railbed, 'searchCustomers', undefined, undefined, { baseUrl: 'http://localhost:5175' });
	assert.deepEqual(listed.results, [
		{ name: 'Nathan Smith · nathan@example.com · Test', value: id('cus', 1), url: `http://localhost:5175/customers/${id('cus', 1)}?mode=test` },
		{ name: 'ada@example.com · Test', value: id('cus', 2), url: `http://localhost:5175/customers/${id('cus', 2)}?mode=test` },
		{ name: 'Deleted customer · Test', value: id('cus', 3), url: `http://localhost:5175/customers/${id('cus', 3)}?mode=test` },
	]);
	const values = async (typed) => (await search(railbed, 'searchCustomers', typed)).results.map((r) => r.value);
	assert.deepEqual(await values('smith'), [id('cus', 1)]);
	assert.deepEqual(await values('0100'), [id('cus', 2)], 'a phone number');
	assert.deepEqual(await values(`https://app.railbed.io/customers/${id('cus', 2)}`), [id('cus', 2)]);
	railbed.requests.length = 0;
	assert.deepEqual(await values('ADA@example.com'), [id('cus', 2)]);
	assert.deepEqual(qs(railbed), [{ limit: SEARCH_SIZE }, { email: 'ADA@example.com', limit: 1 }]);

	// Another address for the API gets labels but no links.
	const elsewhere = await search(railbed, 'searchCustomers', undefined, undefined, { baseUrl: 'https://railbed.example.com' });
	assert.equal(elsewhere.results[0].url, undefined);
});

test('webhook endpoints are listed whole (ten at most per mode) and filtered here', async () => {
	const railbed = fakeRailbed({ live: true });
	railbed.endpoints.push(
		{ id: 'we_2', n: 2, url: 'https://n8n.example.com/webhook/a/webhook', events: ['payment.paid'], description: 'n8n: Fulfil orders' },
		{ id: 'we_1', n: 1, url: 'https://shop.example.com/hooks/railbed', events: ['payment.paid'], description: null },
	);
	const all = await search(railbed, 'searchWebhookEndpoints');
	assert.deepEqual(all.results, [
		{
			name: 'n8n: Fulfil orders · https://n8n.example.com/webhook/a/webhook',
			value: 'we_2',
			url: 'https://app.railbed.io/developers?endpoint=we_2&mode=live#webhooks',
		},
		{ name: 'https://shop.example.com/hooks/railbed', value: 'we_1', url: 'https://app.railbed.io/developers?endpoint=we_1&mode=live#webhooks' },
	]);
	assert.deepEqual((await search(railbed, 'searchWebhookEndpoints', 'SHOP')).results.map((r) => r.value), ['we_1']);
	assert.deepEqual(qs(railbed), [{ limit: SEARCH_SIZE }, { limit: SEARCH_SIZE }]);
});

test('Railbed’s refusals reach the list with what to do next', async () => {
	const railbed = fakeRailbed();
	railbed.queue({ statusCode: 401, headers: {}, body: { error: { code: 'invalid_api_key', message: 'Invalid API key.' } } });
	await assert.rejects(search(railbed, 'searchPayments'), (error) => {
		assert.equal(error.message, 'Invalid API key.');
		assert.match(error.description, /Check the secret key in the Railbed credential/);
		return true;
	});
	railbed.queue({ statusCode: 429, headers: { 'retry-after': '12' }, body: { error: { code: 'rate_limited', message: 'Too many requests.' } } });
	await assert.rejects(search(railbed, 'searchOrders', 'x'), /Too many requests/);
	railbed.queue({ statusCode: 403, headers: {}, body: { error: { code: 'insufficient_scope', message: 'This key can’t do this.' } } });
	await assert.rejects(search(railbed, 'searchWebhookEndpoints'), (error) => /Full access/.test(error.description));
	// Only a missing record is quiet: an ID that isn't there finds nothing.
	railbed.queue({ statusCode: 500, headers: {}, body: {} });
	await assert.rejects(search(railbed, 'searchCustomers', id('cus', 9)), /HTTP 500/);
});

test('finds the ID inside what was typed', () => {
	assert.equal(idIn('pay_abc', 'payment'), 'pay_abc');
	assert.equal(idIn('see https://pay.railbed.io/p/pay_abc?x=1', 'payment'), 'pay_abc');
	assert.equal(idIn('mypay_abc', 'payment'), null);
	assert.equal(idIn('ord_abc', 'payment'), null);
	assert.equal(idIn('/customers/cus_x1', 'customer'), 'cus_x1');
});
