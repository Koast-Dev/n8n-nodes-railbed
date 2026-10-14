// The requests the nodes send and how they read Railbed's answers, with n8n's request helper replaced by a recorder
// (fake-n8n.mjs). No network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	RATE_LIMIT_WAITS,
	railbedApiRequest,
	railbedApiRequestAllItems,
	railbedErrorCode,
	railbedHttpStatus,
} from '../dist/nodes/shared/transport.js';
import { executeContext, fakeRailbed } from './fake-n8n.mjs';

function context() {
	const sent = [];
	const ctx = {
		getCredentials: async () => ({ apiKey: 'rb_test_x', baseUrl: 'https://pay.railbed.io' }),
		getNode: () => ({ name: 'Railbed', type: 'railbed', typeVersion: 1, parameters: {} }),
		helpers: {
			httpRequestWithAuthentication: async (_name, options) => {
				sent.push(options);
				return { statusCode: 200, headers: {}, body: { ok: true } };
			},
		},
	};
	return { ctx, sent };
}

test('an empty body goes out as {} with a JSON content type (session start with no fields)', async () => {
	// n8n drops an empty object body; Railbed answers 400 "Send the request body as JSON." without one.
	const { ctx, sent } = context();
	await railbedApiRequest.call(ctx, 'POST', '/checkout_sessions/pay_1/start', { body: {} });
	assert.equal(sent[0].body, '{}');
	assert.equal(sent[0].headers['Content-Type'], 'application/json');
});

test('a body with fields is sent as an object, and a GET sends none', async () => {
	const { ctx, sent } = context();
	await railbedApiRequest.call(ctx, 'POST', '/checkout_sessions/pay_1/start', { body: { country: 'US' } });
	await railbedApiRequest.call(ctx, 'GET', '/payments/pay_1');
	assert.deepEqual(sent[0].body, { country: 'US' });
	assert.equal(sent[0].headers['Content-Type'], undefined);
	assert.equal('body' in sent[1], false);
});

const page = (ids, next) => ({ statusCode: 200, headers: {}, body: { data: ids.map((id) => ({ id })), has_more: !!next, next_cursor: next ?? null } });
const refusal = (statusCode, code, message, headers = {}) => ({ statusCode, headers, body: { error: { code, message } } });

test('a refusal becomes an error with Railbed’s message, next step, code and status', async () => {
	const railbed = fakeRailbed();
	railbed.queue({ statusCode: 403, headers: {}, body: { error: { code: 'insufficient_scope', message: 'This key can’t do this.', field: null } } });
	await assert.rejects(railbedApiRequest.call(executeContext(railbed, {}), 'POST', '/checkout_sessions', { body: { amount: '1.00' }, itemIndex: 0 }), (error) => {
		assert.equal(error.message, 'This key can’t do this.');
		assert.match(error.description, /Full access/);
		assert.match(error.description, /Railbed code: insufficient_scope/);
		assert.equal(error.httpCode, '403');
		assert.equal(railbedErrorCode(error), 'insufficient_scope');
		assert.equal(railbedHttpStatus(error), 403);
		assert.equal(error.context.itemIndex, 0);
		return true;
	});
	// No answer at all: a network failure has no code or status.
	railbed.queue(new Error('getaddrinfo ENOTFOUND pay.railbed.io'));
	await assert.rejects(railbedApiRequest.call(executeContext(railbed, {}), 'GET', '/payments/pay_1'), (error) => {
		assert.equal(error.message, 'Couldn’t reach Railbed');
		assert.equal(railbedErrorCode(error), null);
		return true;
	});
});

test('a Base URL that would send the key over plain http is refused before any request', async () => {
	const railbed = fakeRailbed();
	const ctx = { ...executeContext(railbed, {}), getCredentials: async () => ({ apiKey: 'rb_live_x', baseUrl: 'http://pay.railbed.io' }) };
	await assert.rejects(railbedApiRequest.call(ctx, 'GET', '/payments'), /must start with https/);
	assert.equal(railbed.requests.length, 0);
});

test('lists follow next_cursor up to the limit, or to the end', async () => {
	const railbed = fakeRailbed();
	railbed.queue(page(['pay_1', 'pay_2'], 'pay_2'));
	railbed.queue(page(['pay_3'], null));
	const all = await railbedApiRequestAllItems.call(executeContext(railbed, {}), '/payments', { status: 'paid' }, null);
	assert.deepEqual(all.map((p) => p.id), ['pay_1', 'pay_2', 'pay_3']);
	assert.deepEqual(railbed.requests.map((r) => r.qs), [
		{ status: 'paid', limit: 100 },
		{ status: 'paid', limit: 100, starting_after: 'pay_2' },
	]);

	const limited = fakeRailbed();
	limited.queue(page(['pay_1', 'pay_2'], 'pay_2'));
	const two = await railbedApiRequestAllItems.call(executeContext(limited, {}), '/payments', {}, 2);
	assert.deepEqual(two.map((p) => p.id), ['pay_1', 'pay_2']);
	assert.equal(limited.requests.length, 1, 'stops once it has enough');
	assert.equal(limited.requests[0].qs.limit, 2);

	const big = fakeRailbed();
	big.queue(page(Array.from({ length: 100 }, (_, i) => `pay_${i}`), 'pay_99'));
	big.queue(page(Array.from({ length: 100 }, (_, i) => `pay_${100 + i}`), 'pay_199'));
	assert.equal((await railbedApiRequestAllItems.call(executeContext(big, {}), '/payments', {}, 150)).length, 150);
	assert.deepEqual(big.requests.map((r) => r.qs.limit), [100, 50]);
});

test('a limit is a whole number of 1 or more', async () => {
	const railbed = fakeRailbed();
	railbed.queue(page(['pay_1', 'pay_2', 'pay_3'], 'pay_3'));
	assert.equal((await railbedApiRequestAllItems.call(executeContext(railbed, {}), '/payments', {}, 2.7)).length, 2);
	assert.equal(railbed.requests[0].qs.limit, 2);
	for (const bad of [0, -1, Number.NaN, 0.5]) {
		await assert.rejects(railbedApiRequestAllItems.call(executeContext(railbed, {}), '/payments', {}, bad), /whole number/, String(bad));
	}
});

test('Return All waits out Railbed’s rate limit a few times, then gives up', async () => {
	const railbed = fakeRailbed();
	railbed.queue(page(['pay_1'], 'pay_1'));
	railbed.queue(refusal(429, 'rate_limited', 'Too many requests.', { 'retry-after': '0' }));
	railbed.queue(page(['pay_2'], null));
	const all = await railbedApiRequestAllItems.call(executeContext(railbed, {}), '/payments', {}, null);
	assert.deepEqual(all.map((p) => p.id), ['pay_1', 'pay_2']);
	assert.deepEqual(railbed.requests.map((r) => r.qs.starting_after), [undefined, 'pay_1', 'pay_1'], 'the same page again');

	const stuck = fakeRailbed();
	for (let i = 0; i <= RATE_LIMIT_WAITS; i++) stuck.queue(refusal(429, 'rate_limited', 'Too many requests.', { 'retry-after': '0' }));
	await assert.rejects(railbedApiRequestAllItems.call(executeContext(stuck, {}), '/payments', {}, null), (error) => railbedHttpStatus(error) === 429);
	assert.equal(stuck.requests.length, RATE_LIMIT_WAITS + 1);

	// Other refusals aren't retried.
	const refused = fakeRailbed();
	refused.queue(refusal(400, 'invalid_status', 'status must be open, pending, paid, held, failed or expired.'));
	await assert.rejects(railbedApiRequestAllItems.call(executeContext(refused, {}), '/payments', { status: 'nope' }, null));
	assert.equal(refused.requests.length, 1);
});
