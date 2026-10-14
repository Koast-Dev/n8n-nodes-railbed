// How the nodes name Railbed's records: labels in the dashboard's words, dashboard links, and the ID checks behind
// every record field. Pure functions from dist; no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	checkRecordId,
	customerLabel,
	dashboardOrigin,
	endpointLabel,
	fulfilmentText,
	groupDecimal,
	idPattern,
	linkExtract,
	linkPattern,
	matchesSearch,
	orderLabel,
	orderNumber,
	orderStatusText,
	paymentLabel,
	paymentStatusText,
	price,
	RECORDS,
	recordUrl,
	whenText,
} from '../dist/nodes/shared/records.js';
import { customerRecord, NOW, orderRecord, paymentRecord } from './fake-n8n.mjs';

const SAME_YEAR = (NOW + 3600) * 1000;

test('amounts read as the dashboard writes them, with their currency', () => {
	assert.equal(price('49', 'USD'), '$49.00');
	assert.equal(price('12480.5', 'EUR'), '€12,480.50');
	assert.equal(price('1000000.00', 'GBP'), '£1,000,000.00');
	assert.equal(price('5.00', 'CAD'), 'CA$5.00');
	assert.equal(price('5.00', 'AUD'), 'A$5.00');
	assert.equal(price('5.00', 'chf'), '5.00 CHF', 'a currency without a symbol trails its code');
	assert.equal(groupDecimal('0049.10'), '49.10');
	assert.equal(groupDecimal('-3.5'), '-3.50');
	assert.equal(groupDecimal('1.005'), '1.01', 'more decimals than two are rounded for display only');
	assert.equal(groupDecimal(''), '—');
	assert.equal(groupDecimal('abc'), 'abc');
});

test('statuses use the dashboard’s words; a held payment needs your decision, never “held”', () => {
	const words = (over) => paymentStatusText(paymentRecord(over));
	assert.equal(words({ status: 'paid' }), 'Paid');
	assert.equal(words({ status: 'pending' }), 'In progress');
	assert.equal(words({ status: 'open' }), 'Open');
	assert.equal(words({ status: 'failed' }), 'Declined');
	assert.equal(words({ status: 'expired' }), 'Expired');
	assert.equal(words({ status: 'expired', canceled_at: NOW }), 'Canceled');
	assert.equal(words({ status: 'held', hold_acceptable: true }), 'Needs your decision');
	assert.equal(words({ status: 'held', hold_acceptable: false }), 'Not received', 'nothing to decide when the money went elsewhere');
	assert.equal(words({ status: 'something_new' }), 'something_new');
	for (const status of ['open', 'pending', 'paid', 'held', 'failed', 'expired'])
		assert.doesNotMatch(words({ status, hold_acceptable: true }), /held/i);

	const order = (over) => orderStatusText(orderRecord(over));
	assert.equal(order({ status: 'canceled' }), 'Canceled');
	assert.equal(order({ status: 'held', needs_review: true }), 'Needs your decision');
	assert.equal(order({ status: 'held', needs_review: false }), 'Not received');
	assert.equal(order({ status: 'pending' }), 'In progress');
	assert.equal(fulfilmentText(orderRecord({ fulfillment: 'unfulfilled' })), 'Not fulfilled');
	assert.equal(fulfilmentText(orderRecord({ fulfillment: 'none' })), 'No shipping');
	assert.equal(fulfilmentText(orderRecord({ fulfillment: 'fulfilled', status: 'open' })), 'Fulfilled');
	assert.equal(fulfilmentText(orderRecord({ fulfillment: 'unfulfilled', status: 'open' })), null, 'an unpaid order has nothing to ship yet');
});

test('dates are absolute, in the workflow’s time zone, with the year only when it isn’t this one', () => {
	assert.equal(whenText(NOW, 'UTC', SAME_YEAR), 'Oct 12, 7:04 PM');
	assert.equal(whenText(NOW, 'America/New_York', SAME_YEAR), 'Oct 12, 3:04 PM');
	assert.equal(whenText(NOW, 'Asia/Tokyo', SAME_YEAR), 'Oct 13, 4:04 AM');
	assert.equal(whenText(NOW - 365 * 86400, 'UTC', SAME_YEAR), 'Oct 12, 2025, 7:04 PM');
	assert.equal(whenText(NOW, 'Not/A_Zone', SAME_YEAR), 'Oct 12, 7:04 PM', 'an unknown zone falls back to UTC');
	assert.equal(whenText(null, 'UTC'), '');
	assert.doesNotMatch(whenText(NOW, 'UTC', SAME_YEAR), /[  ]/, 'plain spaces only');
});

test('labels name each record the way a merchant recognises it', () => {
	assert.equal(paymentLabel(paymentRecord(), 'America/New_York', SAME_YEAR), '$49.00 · nathan@example.com · Paid · Oct 12, 3:04 PM · Test');
	assert.equal(
		paymentLabel(paymentRecord({ livemode: true, customer_email: null, status: 'held', hold_acceptable: true, currency: 'EUR', amount: '1250.00' }), 'UTC', SAME_YEAR),
		'€1,250.00 · Pro membership · Needs your decision · Oct 12, 7:04 PM',
		'Live records carry no mark, and the description stands in for a missing email',
	);
	const long = paymentLabel(paymentRecord({ customer_email: null, description: 'x'.repeat(200) }), 'UTC', SAME_YEAR);
	assert.ok(long.includes(`${'x'.repeat(47)}…`), 'a long description is cut');

	assert.equal(orderLabel(orderRecord(), 'UTC', SAME_YEAR), 'Order #1042 · $49.00 · Paid · Not fulfilled · Oct 12, 7:04 PM · Test');
	assert.equal(orderNumber(orderRecord({ store: { id: 'shop', order_id: '5521', order_number: '#5521' } })), '#5521', 'the store’s number, once');
	assert.equal(
		orderLabel(orderRecord({ status: 'open', livemode: true, total: '18.00', currency: 'GBP' }), 'UTC', SAME_YEAR),
		'Order #1042 · £18.00 · Open · Oct 12, 7:04 PM',
	);

	assert.equal(customerLabel(customerRecord()), 'Nathan Smith · nathan@example.com · Test');
	assert.equal(customerLabel(customerRecord({ name: null, livemode: true })), 'nathan@example.com');
	assert.equal(customerLabel(customerRecord({ name: null, email: null, livemode: true })), 'No email yet');
	assert.equal(customerLabel(customerRecord({ erased: true, email: null, name: null })), 'Deleted customer · Test');

	assert.equal(
		endpointLabel({ id: 'we_1', url: 'https://n8n.example.com/webhook/x/webhook', description: 'n8n: Fulfil orders', livemode: true }),
		'n8n: Fulfil orders · https://n8n.example.com/webhook/x/webhook',
	);
	assert.equal(endpointLabel({ id: 'we_1', url: 'https://example.com/hooks', description: null, livemode: false }), 'https://example.com/hooks · Test');
});

test('search matches any part of a label or field, in any letter case', () => {
	assert.equal(matchesSearch('NATHAN', ['$49.00 · nathan@example.com']), true);
	assert.equal(matchesSearch('$49', ['$49.00 · nathan@example.com']), true);
	assert.equal(matchesSearch('  ', ['anything']), true);
	assert.equal(matchesSearch('mug', [null, undefined, 42, 'Order #1042']), false);
});

test('links open the record in the dashboard, in its own mode', () => {
	assert.equal(dashboardOrigin(undefined), 'https://app.railbed.io');
	assert.equal(dashboardOrigin('https://pay.railbed.io/v1'), 'https://app.railbed.io');
	assert.equal(dashboardOrigin('http://localhost:5175'), 'http://localhost:5175', 'a local Railbed serves both on one address');
	assert.equal(dashboardOrigin('https://railbed.example.com'), null, 'an address Railbed doesn’t use gets no links');
	assert.equal(dashboardOrigin('http://pay.railbed.io'), null);

	const app = 'https://app.railbed.io';
	assert.equal(recordUrl(app, 'payment', 'pay_1', false), `${app}/payments?open=pay_1&mode=test`);
	assert.equal(recordUrl(app, 'session', 'pay_1', true), `${app}/payments?open=pay_1&mode=live`);
	assert.equal(recordUrl(app, 'order', 'ord_1', true), `${app}/orders?order=ord_1&mode=live`);
	assert.equal(recordUrl(app, 'customer', 'cus_1', false), `${app}/customers/cus_1?mode=test`);
	assert.equal(recordUrl(app, 'endpoint', 'we_1', true), `${app}/developers?endpoint=we_1&mode=live#webhooks`);
	assert.equal(recordUrl(app, 'customer', 'cus_1', undefined), `${app}/customers/cus_1`);
	assert.equal(recordUrl(null, 'payment', 'pay_1', true), undefined);
});

test('an ID is checked before Railbed is asked, and the message says what to do', () => {
	assert.deepEqual(checkRecordId(' pay_7AAiYH0Ykt11ED4hmfiN ', 'payment', 'Payment'), { id: 'pay_7AAiYH0Ykt11ED4hmfiN' });
	assert.deepEqual(checkRecordId('we_1', 'endpoint', 'Webhook Endpoint'), { id: 'we_1' });
	const empty = checkRecordId('', 'order', 'Order');
	assert.equal(empty.message, '‘Order’ is empty');
	assert.equal(empty.description, 'Choose an order from the list, or check that the expression gives an ID such as ord_M4tQx8ZkP1vRn6WcLs2B.');
	const wrong = checkRecordId('1042', 'order', 'Order');
	assert.equal(wrong.message, '“1042” isn’t an order ID');
	assert.match(wrong.description, /start with ord_/);
	assert.match(wrong.description, /Store Order ID/);
	assert.match(checkRecordId('nathan@example.com', 'customer', 'Customer').description, /Email filter/);
	assert.match(checkRecordId('ord_1', 'session', 'Checkout Session').message, /isn’t a checkout session ID/);
	for (const bad of ['..', '.', 'pay_', 'pay_a/b', 'pay_1?x=1', 'pay_%2e', null, undefined, {}, 'x'.repeat(100)]) {
		assert.ok('message' in checkRecordId(bad, 'payment', 'Payment'), String(bad));
	}
	assert.match(checkRecordId('x'.repeat(100), 'payment', 'Payment').message, /^“x{40}…” isn’t/);
});

test('By ID and By URL patterns accept the real IDs and links, and take out exactly the ID', () => {
	const anchored = (pattern) => new RegExp(`^${pattern}$`);
	const links = {
		payment: [
			'https://app.railbed.io/payments?open=pay_7AAiYH0Ykt11ED4hmfiN',
			'https://app.railbed.io/payments?status=held&open=pay_7AAiYH0Ykt11ED4hmfiN&mode=test',
			'https://pay.railbed.io/p/pay_7AAiYH0Ykt11ED4hmfiN',
			'https://app.railbed.io/payment-links/pay_7AAiYH0Ykt11ED4hmfiN?mode=live',
			'http://localhost:5175/payments?open=pay_7AAiYH0Ykt11ED4hmfiN',
		],
		session: ['https://pay.railbed.io/p/pay_7AAiYH0Ykt11ED4hmfiN', 'https://app.railbed.io/payments?open=pay_7AAiYH0Ykt11ED4hmfiN#x'],
		order: ['https://app.railbed.io/orders?order=ord_M4tQx8ZkP1vRn6WcLs2B', 'https://app.railbed.io/orders?view=review&order=ord_M4tQx8ZkP1vRn6WcLs2B&mode=live'],
		customer: ['https://app.railbed.io/customers/cus_Hc7nQ2wVz9KpT4mRb1Ye', 'https://app.railbed.io/orders?customer=cus_Hc7nQ2wVz9KpT4mRb1Ye'],
		endpoint: ['https://app.railbed.io/developers?endpoint=we_N8nQ4vRx7KtZ2mLp9WcB&mode=live#webhooks'],
	};
	for (const [kind, urls] of Object.entries(links)) {
		const { example } = RECORDS[kind];
		assert.match(example, anchored(idPattern(kind)), kind);
		assert.match(` ${example} `, anchored(idPattern(kind)), `${kind}: spaces around a pasted ID`);
		assert.match(RECORDS[kind].exampleUrl, anchored(linkPattern(kind)), `${kind} example link`);
		for (const url of urls) {
			assert.match(url, anchored(linkPattern(kind)), url);
			const extracted = new RegExp(linkExtract(kind)).exec(url);
			assert.equal(extracted.length, 2, 'n8n requires exactly one group');
			assert.equal(extracted[1], example, url);
		}
	}
	assert.doesNotMatch('ord_M4tQx8ZkP1vRn6WcLs2B', anchored(idPattern('payment')));
	assert.doesNotMatch('pay_7AAiYH0Ykt11ED4hmfiN', anchored(linkPattern('payment')), 'an ID isn’t a link');
	assert.doesNotMatch('https://app.railbed.io/orders?order=ord_x', anchored(linkPattern('payment')));
	assert.doesNotMatch('https://app.railbed.io/payments', anchored(linkPattern('payment')));
	assert.doesNotMatch('pay_7AAiYH0Ykt11ED4hmfiN?', anchored(idPattern('payment')));
});
