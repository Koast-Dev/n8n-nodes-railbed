// Railbed-Signature checks, against the test vector published at railbed.com/docs/webhooks/signatures/#test-vector.
// Runs on the built package: `npm test` builds first. No network.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyRailbedSignature, SIGNATURE_REFUSALS } from '../dist/nodes/shared/signature.js';

const SECRET = 'whsec_4mJ9pQx2VtR7cY1nKs8LwZ3bHd6fGa0e';
const T = 1790380800;
const BODY =
	'{"id":"evt_ExampleEventId0001","type":"ping","created":1790380800,"livemode":false,"data":{"payment":null,"order":null,"customer":null}}';
const V1 = 'b8b4ad5be59701daf771f57b3ada57d26b5ff7048af7b90230067f4aaafd0ead';
const sign = (secret, t, body) => createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');

test('accepts the published test vector at its own time, as text or bytes', () => {
	assert.deepEqual(verifyRailbedSignature(BODY, `t=${T},v1=${V1}`, SECRET, T), { valid: true, timestamp: T });
	assert.equal(verifyRailbedSignature(Buffer.from(BODY), `t=${T},v1=${V1}`, SECRET, T + 299).valid, true);
});

test('refuses an old or future timestamp outside five minutes', () => {
	assert.deepEqual(verifyRailbedSignature(BODY, `t=${T},v1=${V1}`, SECRET, T + 301), { valid: false, reason: 'stale' });
	assert.deepEqual(verifyRailbedSignature(BODY, `t=${T},v1=${V1}`, SECRET, T - 301), { valid: false, reason: 'stale' });
	// The default clock is now, so the 2026 vector is stale today.
	assert.equal(verifyRailbedSignature(BODY, `t=${T},v1=${V1}`, SECRET).valid, false);
});

test('refuses a changed body, another secret or a changed timestamp', () => {
	assert.equal(verifyRailbedSignature(BODY.replace('ping', 'pong'), `t=${T},v1=${V1}`, SECRET, T).reason, 'mismatch');
	assert.equal(verifyRailbedSignature(BODY, `t=${T},v1=${V1}`, `${SECRET} `, T).reason, 'mismatch');
	assert.equal(verifyRailbedSignature(BODY, `t=${T + 1},v1=${V1}`, SECRET, T).reason, 'mismatch');
});

test('accepts either signature during a secret roll', () => {
	const now = Math.floor(Date.now() / 1000);
	const current = sign('whsec_current', now, BODY);
	const previous = sign('whsec_previous', now, BODY);
	const header = `t=${now},v1=${current},v1=${previous}`;
	assert.equal(verifyRailbedSignature(BODY, header, 'whsec_current').valid, true);
	assert.equal(verifyRailbedSignature(BODY, header, 'whsec_previous').valid, true);
	assert.equal(verifyRailbedSignature(BODY, header, 'whsec_other').reason, 'mismatch');
	// A proxy that splits the repeated values into a list.
	assert.equal(verifyRailbedSignature(BODY, [`t=${now},v1=${current}`, `v1=${previous}`], 'whsec_previous').valid, true);
});

test('refuses missing and malformed headers and a missing secret', () => {
	for (const header of [undefined, '', '   ']) {
		assert.equal(verifyRailbedSignature(BODY, header, SECRET, T).reason, 'missing');
	}
	for (const header of [
		`v1=${V1}`,
		`t=${T}`,
		`t=${T},v1=${V1.toUpperCase()}`,
		`t=${T},v1=${V1.slice(1)}`,
		`t=${T},v0=${V1}`,
		`t=${T}, v1=${V1}`,
		`t=abc,v1=${V1}`,
		`t=${T},v1=${V1},`,
	]) {
		assert.equal(verifyRailbedSignature(BODY, header, SECRET, T).reason, 'malformed', header);
	}
	assert.equal(verifyRailbedSignature(BODY, `t=${T},v1=${V1}`, undefined, T).reason, 'no_secret');
	assert.equal(verifyRailbedSignature(BODY, `t=${T},v1=${V1}`, '', T).reason, 'no_secret');
});

test('has a sentence for every refusal', () => {
	for (const reason of ['no_secret', 'missing', 'malformed', 'stale', 'mismatch']) {
		assert.match(SIGNATURE_REFUSALS[reason], /^[A-Z].+\.$/);
	}
});
