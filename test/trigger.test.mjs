// Railbed Trigger's lifecycle (checkExists, create, delete) and webhook(), against the fake Railbed in fake-n8n.mjs.
// Runs on the built package: `npm test` builds first. No network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RailbedTrigger } from '../dist/nodes/RailbedTrigger/RailbedTrigger.node.js';
import { fakeRailbed, hookContext, webhookContext } from './fake-n8n.mjs';

const hooks = new RailbedTrigger().webhookMethods.default;
const webhook = (ctx) => new RailbedTrigger().webhook.call(ctx);
const URL_ = 'https://n8n.example.com/webhook/5f2b9c1e/webhook';
const calls = (railbed) => railbed.requests.map((r) => `${r.method} ${r.path}`);

/** What n8n does when a workflow is published, or on start-up for a published one. */
async function activate(ctx) {
	if (await hooks.checkExists.call(ctx)) return 'kept';
	await hooks.create.call(ctx);
	return 'created';
}

test('publishing subscribes once and keeps the endpoint across restarts', async () => {
	const railbed = fakeRailbed();
	const ctx = hookContext(railbed, { url: URL_, events: ['payment.paid', 'payment.held'] });
	assert.equal(await activate(ctx), 'created');
	assert.deepEqual(railbed.requests[0].body, {
		url: URL_,
		events: ['payment.paid', 'payment.held'],
		description: 'n8n: Fulfil orders',
	});
	assert.deepEqual(ctx.staticData, {
		endpointId: 'we_1',
		secret: 'whsec_1',
		mode: 'test',
		url: URL_,
		events: ['payment.paid', 'payment.held'],
	});
	// A restart: same address, same events (in another order), a secret on file.
	const again = hookContext(railbed, { url: URL_, events: ['payment.held', 'payment.paid'], staticData: ctx.staticData });
	assert.equal(await activate(again), 'kept');
	assert.equal(railbed.endpoints.length, 1);
});

test('n8n’s address in another spelling still matches the stored endpoint', async () => {
	// Railbed stores new URL(raw).toString(): lowercase host, no :443, punycode, no fragment or bare "?".
	for (const spelling of [
		'https://N8N.Example.com:443/webhook/5f2b9c1e/webhook',
		'https://n8n.example.com/webhook/5f2b9c1e/webhook?',
		'https://n8n.example.com/webhook/5f2b9c1e/webhook#n8n',
		'https://bücher.example/webhook/5f2b9c1e/webhook',
	]) {
		const railbed = fakeRailbed();
		const ctx = hookContext(railbed, { url: spelling });
		await activate(ctx);
		assert.notEqual(railbed.endpoints[0].url, spelling, 'Railbed stored another spelling');
		assert.equal(await activate(hookContext(railbed, { url: spelling, staticData: ctx.staticData })), 'kept', spelling);
		assert.deepEqual(calls(railbed), ['POST /webhook_endpoints', 'GET /webhook_endpoints/we_1'], spelling);
	}
});

test('a changed address or event list replaces the endpoint', async () => {
	const railbed = fakeRailbed();
	const ctx = hookContext(railbed, { url: URL_ });
	await activate(ctx);
	const moved = hookContext(railbed, { url: 'https://automation.example.com/webhook/5f2b9c1e/webhook', staticData: ctx.staticData });
	assert.equal(await activate(moved), 'created');
	assert.deepEqual(calls(railbed).slice(1), ['GET /webhook_endpoints/we_1', 'DELETE /webhook_endpoints/we_1', 'POST /webhook_endpoints']);
	const more = hookContext(railbed, { url: moved.staticData.url, events: ['payment.paid', 'payment.held'], staticData: moved.staticData });
	assert.equal(await activate(more), 'created');
	assert.deepEqual(railbed.endpoints.map((e) => [e.id, e.events]), [['we_3', ['payment.paid', 'payment.held']]]);
});

test('an endpoint removed in Railbed (or by revoking its key) is subscribed again', async () => {
	const railbed = fakeRailbed();
	const ctx = hookContext(railbed, { url: URL_ });
	await activate(ctx);
	railbed.endpoints.length = 0;
	const restart = hookContext(railbed, { url: URL_, staticData: ctx.staticData });
	assert.equal(await activate(restart), 'created');
	assert.equal(ctx.staticData.endpointId, 'we_2');
	assert.match(restart.logs[0][0], /no longer exists/);
});

test('a secret rolled in Developers is replaced while the overlap lasts, once', async () => {
	const railbed = fakeRailbed();
	const ctx = hookContext(railbed, { url: URL_ });
	await activate(ctx);
	railbed.roll('we_1');
	// The trigger's secret only works for 24 hours more, so it takes a fresh endpoint and secret now...
	assert.equal(await activate(hookContext(railbed, { url: URL_, staticData: ctx.staticData })), 'created');
	assert.deepEqual([ctx.staticData.endpointId, ctx.staticData.secret], ['we_2', 'whsec_2']);
	assert.deepEqual(railbed.endpoints.map((e) => e.id), ['we_2']);
	// ...and the new endpoint has no rolled secret, so the next start keeps it.
	assert.equal(await activate(hookContext(railbed, { url: URL_, staticData: ctx.staticData })), 'kept');
});

test('a lost ID and secret for an address that is still subscribed: remove it and subscribe once more', async () => {
	// The editor's "listen for test event" starts with empty static data; so does a workflow whose data was reset.
	const railbed = fakeRailbed();
	for (let i = 0; i < 3; i++)
		await activate(hookContext(railbed, { url: `https://n8n.example.com/webhook/other-${i}/webhook` }));
	await activate(hookContext(railbed, { url: 'https://N8N.example.com:443/webhook-test/5f2b9c1e/webhook' }));
	railbed.requests.length = 0;
	const fresh = hookContext(railbed, { url: 'https://n8n.example.com/webhook-test/5f2b9c1e/webhook' });
	assert.equal(await activate(fresh), 'created');
	assert.deepEqual(calls(railbed), [
		'POST /webhook_endpoints',
		'GET /webhook_endpoints',
		'DELETE /webhook_endpoints/we_4',
		'POST /webhook_endpoints',
	]);
	assert.equal(railbed.requests[1].qs.limit, 100);
	assert.equal(fresh.staticData.secret, 'whsec_5');
	assert.equal(railbed.endpoints.length, 4, 'the other workflows’ endpoints are untouched');
});

test('a duplicate that can’t be found again is reported, not retried', async () => {
	const railbed = fakeRailbed();
	railbed.queue({ statusCode: 409, headers: {}, body: { error: { code: 'duplicate_url', message: 'Already an endpoint.' } } });
	const ctx = hookContext(railbed, { url: URL_ });
	await assert.rejects(hooks.create.call(ctx), (error) => error.context.railbedCode === 'duplicate_url');
	assert.deepEqual(calls(railbed), ['POST /webhook_endpoints', 'GET /webhook_endpoints']);
	assert.deepEqual(ctx.staticData, {});
});

test('a local n8n address refused by a Live key gets the n8n address message; other refusals keep Railbed’s', async () => {
	const live = fakeRailbed({ live: true });
	await assert.rejects(hooks.create.call(hookContext(live, { url: 'http://localhost:5678/webhook/5f2b9c1e/webhook' })), {
		message: 'Railbed can’t send events to this n8n address',
	});
	// A 400 for another reason on the same address is Railbed's own message, with its code.
	const railbed = fakeRailbed();
	railbed.queue({ statusCode: 400, headers: {}, body: { error: { code: 'invalid_events', message: 'events must be a list.', field: 'events' } } });
	await assert.rejects(hooks.create.call(hookContext(railbed, { url: 'http://localhost:5678/webhook/5f2b9c1e/webhook' })), (error) => {
		assert.equal(error.message, 'events must be a list.');
		assert.equal(error.context.railbedCode, 'invalid_events');
		assert.equal(error.httpCode, '400');
		return true;
	});
	// A Test key accepts http://localhost.
	const testMode = fakeRailbed();
	assert.equal(await hooks.create.call(hookContext(testMode, { url: 'http://localhost:5678/webhook/5f2b9c1e/webhook' })), true);
});

test('unpublishing removes the endpoint; one already gone counts as removed', async () => {
	const railbed = fakeRailbed();
	const ctx = hookContext(railbed, { url: URL_ });
	await activate(ctx);
	assert.equal(await hooks.delete.call(ctx), true);
	assert.deepEqual(ctx.staticData, {});
	assert.equal(railbed.endpoints.length, 0);
	ctx.staticData.endpointId = 'we_1';
	assert.equal(await hooks.delete.call(ctx), true);
	assert.deepEqual(ctx.staticData, {});
	// A revoked key: Railbed removed the endpoints it added with it, so there's nothing left to remove.
	ctx.staticData.endpointId = 'we_1';
	railbed.queue({ statusCode: 401, headers: {}, body: { error: { code: 'invalid_api_key', message: 'Invalid API key.' } } });
	assert.equal(await hooks.delete.call(ctx), true);
	assert.deepEqual(ctx.staticData, {});
	// Any other refusal is reported.
	ctx.staticData.endpointId = 'we_1';
	railbed.queue({ statusCode: 403, headers: {}, body: { error: { code: 'insufficient_scope', message: 'This key can’t do this.' } } });
	await assert.rejects(hooks.delete.call(ctx), { message: 'This key can’t do this.' });
});

const event = (over = {}) => ({
	id: 'evt_1',
	type: 'payment.paid',
	created: 1790381342000,
	livemode: false,
	data: { payment: { id: 'pay_1', status: 'paid', metadata: {} }, order: { id: 'ord_1' }, customer: null },
	...over,
});
const state = { endpointId: 'we_1', secret: 'whsec_1', mode: 'test' };

test('a signed delivery runs the workflow with the event', async () => {
	const ctx = webhookContext(fakeRailbed(), { body: event(), secret: 'whsec_1', staticData: state });
	const result = await webhook(ctx);
	assert.equal(result.workflowData[0][0].json.id, 'evt_1');
	assert.equal(result.workflowData[0][0].json.sample, false);
	assert.equal(ctx.response.statusCode, null, 'n8n answers 200 itself');
});

test('a delivery that isn’t signed by this trigger’s secret is refused before it is read', async () => {
	for (const [options, status, reason] of [
		[{ secret: 'whsec_other' }, 400, /does not match/],
		[{ header: 't=1,v1=abc' }, 400, /not in the t=/],
		[{}, 400, /missing/],
		[{ secret: 'whsec_1', now: Math.floor(Date.now() / 1000) - 600 }, 400, /five minutes/],
	]) {
		const ctx = webhookContext(fakeRailbed(), { body: event(), staticData: state, ...options });
		assert.deepEqual(await webhook(ctx), { noWebhookResponse: true });
		assert.equal(ctx.response.statusCode, status);
		assert.match(ctx.response.body.error, reason);
	}
	const unsubscribed = webhookContext(fakeRailbed(), { body: event(), secret: 'whsec_1', staticData: {} });
	await webhook(unsubscribed);
	assert.equal(unsubscribed.response.statusCode, 409);
});

test('pings, other modes and events not chosen are acknowledged without running', async () => {
	const ping = event({ type: 'ping', data: { payment: null, order: null, customer: null } });
	for (const [body, skipped] of [
		[ping, 'ping'],
		[event({ livemode: true }), 'other mode'],
		[event({ type: 'payment.failed' }), 'event type not chosen'],
	]) {
		const result = await webhook(webhookContext(fakeRailbed(), { body, secret: 'whsec_1', staticData: state }));
		assert.deepEqual(result, { webhookResponse: { received: true, skipped } });
	}
	const bad = webhookContext(fakeRailbed(), { body: '{"nope":1}', secret: 'whsec_1', staticData: state });
	await webhook(bad);
	assert.equal(bad.response.statusCode, 400);
});

test('Include Current Payment reads the payment, except for Send test event’s sample', async () => {
	const railbed = fakeRailbed();
	railbed.payments.set('pay_1', { id: 'pay_1', object: 'payment', status: 'paid', livemode: false });
	const result = await webhook(
		webhookContext(railbed, { body: event(), secret: 'whsec_1', staticData: state, options: { includeCurrentPayment: true } }),
	);
	assert.equal(result.workflowData[0][0].json.currentPayment.status, 'paid');
	assert.deepEqual(calls(railbed), ['GET /payments/pay_1']);

	const sample = event();
	sample.data.payment = { id: 'pay_sample', status: 'paid', metadata: { sample: 'true' } };
	sample.data.order = { id: 'ord_sample' };
	const quiet = fakeRailbed();
	const out = await webhook(
		webhookContext(quiet, { body: sample, secret: 'whsec_1', staticData: state, options: { includeCurrentPayment: true } }),
	);
	assert.equal(out.workflowData[0][0].json.sample, true);
	assert.equal(out.workflowData[0][0].json.currentPayment, undefined);
	assert.equal(quiet.requests.length, 0);

	// An API refusal fails the delivery, so Railbed retries it.
	await assert.rejects(
		webhook(webhookContext(fakeRailbed(), { body: event(), secret: 'whsec_1', staticData: state, options: { includeCurrentPayment: true } })),
		{ message: 'No such payment.' },
	);
});
