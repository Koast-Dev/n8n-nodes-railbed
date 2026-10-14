// Pure helpers behind the nodes: event reading, inputs, simplified output and Railbed's errors.
// Runs on the built package: `npm test` builds first. No network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	endpointAddress,
	looksLocal,
	readTriggerEvent,
	sameAddress,
	sameEvents,
} from '../dist/nodes/RailbedTrigger/events.js';
import {
	compact,
	jsonObject,
	metadataFromRows,
	moneyText,
	pathId,
	simplifyCustomer,
	simplifyOrder,
	simplifyPayment,
	simplifySession,
	toUnixSeconds,
} from '../dist/nodes/shared/inputs.js';
import { describeRailbedError, readErrorBody } from '../dist/nodes/shared/errors.js';
import { apiRoot, errorItem, retryAfterSeconds } from '../dist/nodes/shared/transport.js';
import { CURRENCIES, EVENT_TYPES, PAYMENT_STATUSES } from '../dist/nodes/shared/constants.js';

const paidEvent = (over = {}) => ({
	id: 'evt_4Qm8ZsUe2VhNc7RwTb1Y',
	type: 'payment.paid',
	created: 1790381342,
	livemode: false,
	data: {
		payment: { id: 'pay_7AAiYH0Ykt11ED4hmfiN', status: 'paid', amount: '49.00', metadata: { user_id: 'player_1042' } },
		order: { id: 'ord_M4tQx8ZkP1vRn6WcLs2B' },
		customer: null,
	},
	...over,
});

test('reads a verified event and says whether it should start the workflow', () => {
	const read = readTriggerEvent(JSON.stringify(paidEvent()), 'test');
	assert.equal(read.skip, null);
	assert.equal(read.sample, false);
	assert.equal(read.paymentId, 'pay_7AAiYH0Ykt11ED4hmfiN');
	assert.equal(read.event.data.order.id, 'ord_M4tQx8ZkP1vRn6WcLs2B');
	assert.equal(readTriggerEvent(Buffer.from(JSON.stringify(paidEvent())), 'test').event.type, 'payment.paid');

	// Send test event: a ping never starts the workflow, a sample payment is flagged.
	assert.equal(readTriggerEvent(JSON.stringify({ ...paidEvent(), type: 'ping', data: { payment: null, order: null, customer: null } }), 'test').skip, 'ping');
	const sample = paidEvent();
	sample.data.payment.metadata = { order_id: '1042', sample: 'true' };
	assert.equal(readTriggerEvent(JSON.stringify(sample), 'test').sample, true);
	// A Live payment is never a sample, whatever its metadata says.
	assert.equal(readTriggerEvent(JSON.stringify({ ...sample, livemode: true }), 'live').sample, false);

	// An event for the other mode is acknowledged but skipped.
	assert.equal(readTriggerEvent(JSON.stringify(paidEvent({ livemode: true })), 'test').skip, 'other mode');
	assert.equal(readTriggerEvent(JSON.stringify(paidEvent()), undefined).skip, null);

	assert.deepEqual(readTriggerEvent('{not json', 'test'), { refusal: 'The body is not JSON.' });
	assert.deepEqual(readTriggerEvent('[]', 'test'), { refusal: 'The body is not a Railbed event.' });
	assert.deepEqual(readTriggerEvent('{"type":"payment.paid"}', 'test'), { refusal: 'The body is not a Railbed event.' });
});

test('compares chosen events in any order', () => {
	assert.equal(sameEvents(['payment.held', 'payment.paid'], ['payment.paid', 'payment.held']), true);
	assert.equal(sameEvents(['payment.paid'], ['payment.paid', 'payment.held']), false);
	assert.equal(sameEvents(['payment.paid', 'payment.held'], ['payment.paid']), false);
	assert.equal(sameEvents(undefined, ['payment.paid']), false);
});

test('compares webhook addresses as Railbed stores them', () => {
	const n8n = 'https://n8n.example.com/webhook/5f2b/webhook';
	assert.equal(endpointAddress('https://N8N.Example.com:443/webhook/5f2b/webhook'), n8n);
	assert.equal(endpointAddress(`${n8n}#top`), n8n);
	assert.equal(endpointAddress(`${n8n}?`), n8n);
	assert.equal(endpointAddress(`${n8n}?#`), n8n);
	assert.equal(endpointAddress(`${n8n}?a=1`), `${n8n}?a=1`);
	assert.equal(endpointAddress('https://bücher.example/webhook/x/webhook'), 'https://xn--bcher-kva.example/webhook/x/webhook');
	assert.equal(endpointAddress('http://localhost:5678/webhook-test/5f2b/webhook'), 'http://localhost:5678/webhook-test/5f2b/webhook');
	assert.equal(endpointAddress('not a url'), null);
	assert.equal(endpointAddress(undefined), null);
	assert.equal(sameAddress('https://n8n.example.com:443/webhook/5f2b/webhook', 'https://N8N.example.com/webhook/5f2b/webhook#x'), true);
	assert.equal(sameAddress(n8n, 'https://n8n.example.com/webhook-test/5f2b/webhook'), false);
	assert.equal(sameAddress(n8n, 'https://n8n.example.com/webhook/5F2B/webhook'), false, 'paths keep their case');
	assert.equal(sameAddress(undefined, undefined), false);
	assert.equal(looksLocal('http://n8n.example.com/webhook/x'), true);
	assert.equal(looksLocal('https://localhost:5678/webhook/x'), true);
	assert.equal(looksLocal('https://127.0.0.1/webhook/x'), true);
	assert.equal(looksLocal('https://n8n.example.com/webhook/x'), false);
});

test('sends money as decimal text and refuses a third decimal', () => {
	assert.deepEqual(moneyText('49.00'), { text: '49.00' });
	assert.deepEqual(moneyText(' 49 '), { text: '49' });
	assert.deepEqual(moneyText('49.999'), { text: '49.999' }, 'text goes as typed; Railbed checks it');
	assert.deepEqual(moneyText(49.9), { text: '49.90' });
	assert.deepEqual(moneyText(49), { text: '49.00' });
	assert.deepEqual(moneyText(0.1 + 0.2), { text: '0.30' });
	assert.deepEqual(moneyText(1.005 * 1000), { text: '1005.00' });
	assert.deepEqual(moneyText(''), { text: '' });
	assert.match(moneyText(49.999).problem, /more than two decimals/);
	assert.match(moneyText(12.345).problem, /more than two decimals/);
	assert.match(moneyText(Number.NaN).problem, /isn’t a number/);
});

test('reads dates as Unix seconds, in the workflow’s time zone when they carry none', () => {
	assert.equal(toUnixSeconds('2026-10-12T00:00:00Z'), 1791763200);
	assert.equal(toUnixSeconds('2026-10-12T00:00:00Z', 'America/New_York'), 1791763200, 'an explicit zone wins');
	assert.equal(toUnixSeconds('2026-10-12T02:00:00+02:00', 'Asia/Tokyo'), 1791763200);
	// n8n's date picker gives wall-clock text: read it where the workflow runs, not where the server does.
	assert.equal(toUnixSeconds('2026-10-12T00:00:00', 'America/New_York'), 1791763200 + 4 * 3600);
	assert.equal(toUnixSeconds('2026-10-12T00:00:00', 'Europe/London'), 1791763200 - 3600);
	assert.equal(toUnixSeconds('2026-10-12', 'Asia/Tokyo'), 1791763200 - 9 * 3600);
	assert.equal(toUnixSeconds('2026-01-12T00:00:00', 'America/New_York'), 1768194000, 'winter time');
	assert.equal(toUnixSeconds('2026-10-12T00:00:00', 'UTC'), 1791763200);
	assert.equal(toUnixSeconds('2026-10-12T00:00:00.999', 'UTC'), 1791763200);
	assert.equal(toUnixSeconds('2026-10-12T00:00:00', 'Not/A_Zone'), toUnixSeconds('2026-10-12T00:00:00'));
	assert.equal(toUnixSeconds(new Date('2026-10-12T00:00:00.999Z')), 1791763200);
	assert.equal(toUnixSeconds({ toISO: () => '2026-10-12T00:00:00Z' }), 1791763200);
	assert.equal(toUnixSeconds(''), undefined);
	assert.equal(toUnixSeconds('not a date'), undefined);
});

test('builds metadata, JSON objects and request bodies', () => {
	assert.deepEqual(metadataFromRows([{ key: ' user_id ', value: 'u_1' }, { key: '', value: 'x' }, { key: 'n', value: 5 }]), { user_id: 'u_1', n: '5' });
	assert.equal(metadataFromRows([]), undefined);
	assert.equal(metadataFromRows([{ key: '  ', value: 'x' }]), undefined);
	assert.deepEqual(jsonObject('{"id":"1042"}'), { value: { id: '1042' } });
	assert.deepEqual(jsonObject({ id: '1042' }), { value: { id: '1042' } });
	assert.equal(jsonObject(''), null);
	assert.deepEqual(jsonObject('{oops'), { problem: 'isn’t valid JSON' });
	assert.deepEqual(jsonObject('[1]'), { problem: 'must be a JSON object' });
	assert.deepEqual(compact({ a: 'x', b: '', c: undefined, d: 0, e: null, f: false }), { a: 'x', d: 0, e: null, f: false });
	assert.equal(pathId(' pay_1 '), 'pay_1');
	assert.equal(pathId('../customers'), '..%2Fcustomers');
	assert.equal(pathId('pay_1?x=1'), 'pay_1%3Fx%3D1');
	assert.equal(pathId('%2e%2e'), '%252e%252e');
	for (const bad of ['', '  ', '.', '..', undefined, null]) assert.throws(() => pathId(bad), /ID/, String(bad));
});

test('simplifies each record to ten fields', () => {
	const payment = { id: 'pay_1', status: 'paid', amount: '49.00', currency: 'USD', settlement: { coin: 'x' }, livemode: false, metadata: { user_id: 'u_1' } };
	// What the fulfilment guide says to check: id and mode, reference and metadata, price, status and why it's held.
	assert.deepEqual(Object.keys(simplifyPayment(payment)), ['id', 'status', 'livemode', 'amount', 'currency', 'reference', 'metadata', 'order_id', 'paid_at', 'hold_reason']);
	assert.equal(simplifyPayment(payment).livemode, false);
	assert.deepEqual(simplifyPayment(payment).metadata, { user_id: 'u_1' });
	assert.equal(simplifyPayment(payment).hold_reason, null);
	for (const shape of [simplifyPayment, simplifySession, simplifyOrder, simplifyCustomer]) {
		assert.equal(Object.keys(shape({})).length, 10);
	}
	assert.equal(simplifySession({ url: 'https://pay.railbed.io/p/pay_1' }).url, 'https://pay.railbed.io/p/pay_1');
});

test('turns Railbed’s error body into a message and a next step', () => {
	const scope = describeRailbedError(403, { error: { code: 'insufficient_scope', message: 'This key can’t do this.' } });
	assert.equal(scope.message, 'This key can’t do this.');
	assert.match(scope.description, /Full access/);
	assert.match(scope.description, /Railbed code: insufficient_scope/);
	const field = describeRailbedError(400, { error: { code: 'invalid_amount', message: 'amount must be…', field: 'amount' } });
	assert.match(field.description, /field: amount/);
	assert.match(describeRailbedError(429, { error: { code: 'rate_limited', message: 'Too many requests.' } }, '60').description, /Wait 60 seconds/);
	assert.match(describeRailbedError(502, 'Bad gateway').message, /HTTP 502/);
	assert.match(describeRailbedError(404, {}).description, /same mode/);
	assert.match(describeRailbedError(409, { error: { code: 'commerce_paused', message: 'Not accepting payments.' } }).description, /support@railbed\.com/);
	assert.deepEqual(readErrorBody(null), { code: null, message: null, field: null });
	assert.deepEqual(readErrorBody({ error: 'nope' }), { code: null, message: null, field: null });
});

test('turns a thrown error into an output item with Railbed’s code', () => {
	const error = Object.assign(new Error('No such order.'), { description: 'Check the ID…', httpCode: '404', context: { railbedCode: 'not_found' } });
	assert.deepEqual(errorItem(error), { error: 'No such order.', code: 'not_found', httpCode: 404, description: 'Check the ID…' });
	assert.deepEqual(errorItem(new Error('An ID is required')), { error: 'An ID is required', code: null, httpCode: null, description: null });
	assert.equal(retryAfterSeconds({ context: { retryAfter: '7' } }), 7);
	assert.equal(retryAfterSeconds({ context: { retryAfter: '3600' } }), 60, 'at most a minute');
	assert.equal(retryAfterSeconds({ context: {} }), 60);
	assert.equal(retryAfterSeconds({ context: { retryAfter: 'Wed, 21 Oct 2026 07:28:00 GMT' } }), 60);
});

test('uses https for the API, and plain http only on this machine', () => {
	assert.deepEqual(apiRoot(undefined), { root: 'https://pay.railbed.io/v1' });
	assert.deepEqual(apiRoot('https://pay.railbed.io/'), { root: 'https://pay.railbed.io/v1' });
	assert.deepEqual(apiRoot('https://pay.railbed.io/v1'), { root: 'https://pay.railbed.io/v1' });
	assert.deepEqual(apiRoot('http://localhost:5173'), { root: 'http://localhost:5173/v1' });
	assert.deepEqual(apiRoot('http://127.0.0.1:8787/v1'), { root: 'http://127.0.0.1:8787/v1' });
	assert.ok('problem' in apiRoot('http://pay.railbed.io'));
	assert.ok('problem' in apiRoot('http://localhost.example.com'));
	assert.ok('problem' in apiRoot('not a url'));
});

test('lists Railbed’s seven event types, currencies and statuses', () => {
	assert.deepEqual(
		EVENT_TYPES.map((e) => e.value),
		['payment.started', 'payment.paid', 'payment.held', 'payment.updated', 'payment.failed', 'payment.expired', 'payment.canceled'],
	);
	for (const e of EVENT_TYPES) assert.ok(e.name && e.description, e.value);
	assert.deepEqual([...CURRENCIES], ['USD', 'EUR', 'GBP', 'CAD', 'AUD']);
	assert.deepEqual([...PAYMENT_STATUSES], ['open', 'pending', 'paid', 'held', 'failed', 'expired']);
});
