// The node descriptions as n8n loads them from dist: every operation reachable, every field shown somewhere, and the
// trigger's events and lifecycle in place. Catches a field wired to the wrong operation before n8n would.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Railbed } from '../dist/nodes/Railbed/Railbed.node.js';
import { RailbedTrigger } from '../dist/nodes/RailbedTrigger/RailbedTrigger.node.js';
import { RailbedApi } from '../dist/credentials/RailbedApi.credentials.js';
import { createRequire } from 'node:module';
import { executeContext, fakeRailbed } from './fake-n8n.mjs';

// n8n-workflow's ESM build can't be imported by Node directly; the nodes load its CommonJS build, and so does this.
const { Workflow, WorkflowExpression } = createRequire(import.meta.url)('n8n-workflow');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the action node offers every /v1 operation, each with an action', () => {
	const { description } = new Railbed();
	assert.equal(description.usableAsTool, true);
	const resources = description.properties.find((p) => p.name === 'resource').options.map((o) => o.value);
	const operations = {};
	for (const p of description.properties.filter((p) => p.name === 'operation')) {
		for (const resource of p.displayOptions.show.resource) {
			operations[resource] = p.options.map((o) => o.value);
			for (const o of p.options) assert.ok(o.action && o.description, `${resource} ${o.value}`);
		}
	}
	assert.deepEqual(Object.keys(operations).sort(), [...resources].sort());
	assert.deepEqual(operations, {
		checkoutSession: ['create', 'get', 'start'],
		payment: ['get', 'getAll', 'simulate'],
		order: ['get', 'getAll', 'recordEvent', 'update'],
		customer: ['get', 'getAll'],
		webhookEndpoint: ['create', 'delete', 'get', 'getAll'],
	});
	// Every other field belongs to at least one real resource and operation.
	for (const p of description.properties.filter((p) => !['resource', 'operation'].includes(p.name))) {
		const show = p.displayOptions?.show;
		assert.ok(show?.resource?.every((r) => resources.includes(r)), p.name);
		assert.ok(show?.operation?.every((op) => show.resource.some((r) => operations[r].includes(op))), p.name);
	}
});

test('the trigger subscribes, verifies and unsubscribes', () => {
	const trigger = new RailbedTrigger();
	const { description } = trigger;
	assert.equal(description.name, 'railbedTrigger');
	assert.deepEqual(description.inputs, []);
	assert.equal(description.usableAsTool, undefined);
	assert.deepEqual(description.webhooks.map((w) => [w.name, w.httpMethod]), [['default', 'POST']]);
	assert.deepEqual(Object.keys(trigger.webhookMethods.default).sort(), ['checkExists', 'create', 'delete']);
	const events = description.properties.find((p) => p.name === 'events');
	assert.deepEqual(events.default, ['payment.paid']);
	assert.equal(events.options.length, 7);
	assert.equal(typeof trigger.webhook, 'function');
});

test('the credential is a password field with a test request', () => {
	const credential = new RailbedApi();
	const key = credential.properties.find((p) => p.name === 'apiKey');
	assert.equal(key.typeOptions.password, true);
	assert.equal(credential.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.equal(credential.test.request.url, '/payments');
	assert.match(credential.test.request.baseURL, /\/v1$/);
});

test('the credential test applies the nodes’ Base URL rules, through n8n’s own expression engine', () => {
	const description = { properties: [], name: 'x', displayName: 'x', group: [], version: 1, defaults: {}, inputs: [], outputs: [], description: '' };
	const nodeTypes = { getByName: () => ({ description }), getByNameAndVersion: () => ({ description }), getKnownTypes: () => ({}) };
	const workflow = new Workflow({
		id: 'wf_1',
		nodes: [{ id: 'n', name: 'Node', type: 'x', typeVersion: 1, position: [0, 0], parameters: {} }],
		connections: {},
		active: false,
		nodeTypes,
	});
	const baseURL = (baseUrl) =>
		new WorkflowExpression(workflow).getParameterValue(new RailbedApi().test.request.baseURL, null, 0, 0, 'Node', [], 'internal', {
			$credentials: { apiKey: 'rb_test_x', baseUrl },
		});
	assert.equal(baseURL(''), 'https://pay.railbed.io/v1');
	assert.equal(baseURL(' https://pay.railbed.io/ '), 'https://pay.railbed.io/v1');
	assert.equal(baseURL('https://pay.railbed.io/v1'), 'https://pay.railbed.io/v1', 'a pasted /v1 is not doubled');
	assert.equal(baseURL('http://localhost:5173/v1/'), 'http://localhost:5173/v1');
	assert.equal(baseURL('http://127.0.0.1:8787'), 'http://127.0.0.1:8787/v1');
	// The key never goes over plain http to another host: the test aims at a name that can't resolve.
	assert.equal(baseURL('http://pay.railbed.io'), 'https://base-url-must-start-with-https.invalid/v1');
	assert.equal(baseURL('pay.railbed.io'), 'https://base-url-must-start-with-https.invalid/v1');
});

const run = (railbed, parameters, options) => new Railbed().execute.call(executeContext(railbed, parameters, options));
const session = { id: 'pay_1', object: 'checkout_session', url: 'https://pay.railbed.io/p/pay_1', status: 'open', livemode: false, amount: '49.90', currency: 'USD' };

test('Create sends money as text, customer details, and the idempotency key', async () => {
	const railbed = fakeRailbed();
	railbed.queue({ statusCode: 201, headers: {}, body: session });
	const [[item]] = await run(railbed, {
		resource: 'checkoutSession',
		operation: 'create',
		amount: 49.9,
		currency: 'USD',
		description: 'Pro membership',
		additionalFields: { customerDateOfBirth: ' 1990-04-21 ', customerAcceptsMarketing: true, idempotencyKey: 'order-1042' },
	});
	const sent = railbed.requests[0];
	assert.deepEqual(sent.body, {
		amount: '49.90',
		currency: 'USD',
		description: 'Pro membership',
		customer: { date_of_birth: '1990-04-21', accepts_marketing: true },
	});
	assert.equal(sent.headers['Idempotency-Key'], 'order-1042');
	assert.equal(item.json.url, session.url);

	// "No" to marketing is the same as not saying, so no customer object is sent for it.
	const quiet = fakeRailbed();
	quiet.queue({ statusCode: 201, headers: {}, body: session });
	await run(quiet, { resource: 'checkoutSession', operation: 'create', amount: '49.90', currency: 'USD', description: 'x', additionalFields: { customerAcceptsMarketing: false } });
	assert.equal(quiet.requests[0].body.customer, undefined);
});

test('a mapped amount with a third decimal is refused, not rounded', async () => {
	const railbed = fakeRailbed();
	await assert.rejects(
		run(railbed, { resource: 'checkoutSession', operation: 'create', amount: 49.999, currency: 'USD', description: 'x', additionalFields: {} }),
		(error) => /Amount has more than two decimals/.test(error.message) && /at most two decimals/.test(error.description),
	);
	assert.equal(railbed.requests.length, 0);
});

test('Get Many reads a picked date in the workflow’s time zone', async () => {
	const railbed = fakeRailbed();
	railbed.queue({ statusCode: 200, headers: {}, body: { data: [], has_more: false, next_cursor: null } });
	await run(
		railbed,
		{ resource: 'payment', operation: 'getAll', returnAll: true, filters: { status: 'paid', createdAfter: '2026-10-12T00:00:00' } },
		{ timeZone: 'America/New_York' },
	);
	assert.deepEqual(railbed.requests[0].qs, { status: 'paid', created_gte: 1791763200 + 4 * 3600, limit: 100 });
});

test('with On Error set to continue, a refusal becomes an item carrying Railbed’s code', async () => {
	const railbed = fakeRailbed();
	railbed.queue({ statusCode: 404, headers: {}, body: { error: { code: 'not_found', message: 'No such order.' } } });
	const [[item]] = await run(railbed, { resource: 'order', operation: 'get', orderId: 'ord_missing' }, { continueOnFail: true });
	assert.equal(item.json.error, 'No such order.');
	assert.equal(item.json.code, 'not_found');
	assert.equal(item.json.httpCode, 404);
	assert.match(item.json.description, /same mode/);
	assert.deepEqual(item.pairedItem, { item: 0 });

	const [[blank]] = await run(fakeRailbed(), { resource: 'order', operation: 'get', orderId: '..' }, { continueOnFail: true });
	assert.deepEqual(blank.json, {
		error: '“..” isn’t an order ID',
		code: null,
		httpCode: null,
		description:
			'Order IDs start with ord_, such as ord_M4tQx8ZkP1vRn6WcLs2B. To find an order by your store’s order ID, use Order → Get Many with the Store Order ID filter.',
	});

	// Without it, the same refusal stops the workflow with Railbed's message.
	const strict = fakeRailbed();
	strict.queue({ statusCode: 404, headers: {}, body: { error: { code: 'not_found', message: 'No such order.' } } });
	await assert.rejects(run(strict, { resource: 'order', operation: 'get', orderId: 'ord_missing' }), { message: 'No such order.' });
});

test('package.json registers both nodes and the credential, with no runtime dependencies', () => {
	assert.deepEqual(pkg.n8n.nodes, ['dist/nodes/Railbed/Railbed.node.js', 'dist/nodes/RailbedTrigger/RailbedTrigger.node.js']);
	assert.deepEqual(pkg.n8n.credentials, ['dist/credentials/RailbedApi.credentials.js']);
	assert.equal(pkg.dependencies, undefined);
	assert.equal(pkg.license, 'MIT');
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
	assert.deepEqual(pkg.peerDependencies, { 'n8n-workflow': '*' });
	for (const node of ['Railbed', 'RailbedTrigger']) {
		const codex = JSON.parse(readFileSync(new URL(`../nodes/${node}/${node}.node.json`, import.meta.url), 'utf8'));
		assert.equal(codex.node, `${pkg.name}.${node[0].toLowerCase()}${node.slice(1)}`);
	}
});
