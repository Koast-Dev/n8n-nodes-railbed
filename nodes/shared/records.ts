import type { IDataObject } from 'n8n-workflow';
import { apiRoot } from './transport';

/**
 * The Railbed records a node field can point at, with what n8n needs to find one: its ID's prefix and an example,
 * the dashboard link a person can paste instead (src/main.tsx routes; the same deep links Railbed's emails, Slack and
 * Telegram messages use), and how the list shows it. A checkout session and its payment share one `pay_` ID.
 */
export type RecordKind = 'payment' | 'session' | 'order' | 'customer' | 'endpoint';

interface RecordInfo {
	/** In a sentence: "payment", "checkout session". */
	noun: string;
	/** With its article: "a payment", "an order". */
	aNoun: string;
	prefix: string;
	example: string;
	/** Where the dashboard opens the record (mode added by recordUrl). */
	path: (id: string) => string;
	/** What comes right before the ID in a dashboard or checkout link, as a regex without capture groups. */
	linkBefore: string;
	exampleUrl: string;
	/** Said after "isn't a … ID", to point at the right way to find the record. */
	findHint: string;
}

const ID_CHARS = '[A-Za-z0-9_-]{1,64}';

export const RECORDS: Record<RecordKind, RecordInfo> = {
	payment: {
		noun: 'payment',
		aNoun: 'a payment',
		prefix: 'pay_',
		example: 'pay_7AAiYH0Ykt11ED4hmfiN',
		path: (id) => `/payments?open=${id}`,
		linkBefore: '(?:[?&]open=|/p/|/payment-links/)',
		exampleUrl: 'https://app.railbed.io/payments?open=pay_7AAiYH0Ykt11ED4hmfiN',
		findHint:
			'To find a payment by your own order ID, use Payment → Get Many with the Reference filter.',
	},
	session: {
		noun: 'checkout session',
		aNoun: 'a checkout session',
		prefix: 'pay_',
		example: 'pay_7AAiYH0Ykt11ED4hmfiN',
		path: (id) => `/payments?open=${id}`,
		linkBefore: '(?:[?&]open=|/p/|/payment-links/)',
		exampleUrl: 'https://pay.railbed.io/p/pay_7AAiYH0Ykt11ED4hmfiN',
		findHint: 'A checkout session and its payment share one ID, so a payment’s ID works here too.',
	},
	order: {
		noun: 'order',
		aNoun: 'an order',
		prefix: 'ord_',
		example: 'ord_M4tQx8ZkP1vRn6WcLs2B',
		path: (id) => `/orders?order=${id}`,
		linkBefore: '[?&]order=',
		exampleUrl: 'https://app.railbed.io/orders?order=ord_M4tQx8ZkP1vRn6WcLs2B',
		findHint:
			'To find an order by your store’s order ID, use Order → Get Many with the Store Order ID filter.',
	},
	customer: {
		noun: 'customer',
		aNoun: 'a customer',
		prefix: 'cus_',
		example: 'cus_Hc7nQ2wVz9KpT4mRb1Ye',
		path: (id) => `/customers/${id}`,
		linkBefore: '(?:/customers/|[?&]customer=)',
		exampleUrl: 'https://app.railbed.io/customers/cus_Hc7nQ2wVz9KpT4mRb1Ye',
		findHint: 'To find a customer by email, use Customer → Get Many with the Email filter.',
	},
	endpoint: {
		noun: 'webhook endpoint',
		aNoun: 'a webhook endpoint',
		prefix: 'we_',
		example: 'we_N8nQ4vRx7KtZ2mLp9WcB',
		path: (id) => `/developers?endpoint=${id}`,
		linkBefore: '[?&]endpoint=',
		exampleUrl: 'https://app.railbed.io/developers?endpoint=we_N8nQ4vRx7KtZ2mLp9WcB',
		findHint: 'Webhook Endpoint → Get Many lists every endpoint with its ID.',
	},
};

/** By ID: the whole value is one ID (spaces around it allowed; n8n anchors the pattern). */
export const idPattern = (kind: RecordKind) => `\\s*${RECORDS[kind].prefix}${ID_CHARS}\\s*`;
/** By URL: a web address with the ID where the dashboard or checkout puts it (n8n anchors the pattern). */
export const linkPattern = (kind: RecordKind) =>
	`\\s*https?://\\S*${RECORDS[kind].linkBefore}${RECORDS[kind].prefix}${ID_CHARS}\\S*`;
/** By URL: n8n's extractValue keeps the one capture group, the ID. */
export const linkExtract = (kind: RecordKind) =>
	`${RECORDS[kind].linkBefore}(${RECORDS[kind].prefix}${ID_CHARS})`;

/**
 * An ID once it's checked (its prefix, then only letters, digits, "_" and "-", so it is safe in a URL path as it is),
 * or what's wrong with it, said so the next step is clear.
 */
export function checkRecordId(
	value: unknown,
	kind: RecordKind,
	field: string,
): { id: string } | { message: string; description: string } {
	const record = RECORDS[kind];
	const id = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
	if (!id) {
		return {
			message: `‘${field}’ is empty`,
			description: `Choose ${record.aNoun} from the list, or check that the expression gives an ID such as ${record.example}.`,
		};
	}
	if (!new RegExp(`^${record.prefix}${ID_CHARS}$`).test(id)) {
		const shown = id.length > 40 ? `${id.slice(0, 40)}…` : id;
		return {
			message: `“${shown}” isn’t ${record.aNoun} ID`,
			description: `${capitalize(record.noun)} IDs start with ${record.prefix}, such as ${record.example}. ${record.findHint}`,
		};
	}
	return { id };
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// ---------- Words and figures, as the Railbed dashboard shows them (src/lib/format.ts, src/components/ui.tsx) ----------

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$' };

/** "12480.5" → "12,480.50". Railbed sends decimal text; this never goes through a float for two-decimal amounts. */
export function groupDecimal(value: unknown): string {
	const raw = String(value ?? '').trim();
	const match = /^(-?)(\d+)(?:\.(\d{0,2}))?$/.exec(raw);
	if (match) {
		const whole = match[2].replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		return `${match[1]}${whole}.${(match[3] ?? '').padEnd(2, '0')}`;
	}
	const n = Number(raw);
	if (!raw || !Number.isFinite(n)) return raw || '—';
	return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A price with its currency, as the dashboard writes it: "$49.00", "€12.50", "CA$5.00", "49.00 CHF". */
export function price(amount: unknown, currency: unknown): string {
	const code = typeof currency === 'string' ? currency.toUpperCase() : '';
	const body = groupDecimal(amount);
	const symbol = SYMBOLS[code];
	return symbol ? `${symbol}${body}` : `${body}${code ? ` ${code}` : ''}`;
}

/** A payment's status in the dashboard's words. Held reads as the decision it waits on, never "held". */
export function paymentStatusText(payment: IDataObject): string {
	switch (payment.status) {
		case 'paid':
			return 'Paid';
		case 'pending':
			return 'In progress';
		case 'held':
			// Money that went somewhere else can't be accepted, so there's nothing to decide.
			return payment.hold_acceptable === false ? 'Not received' : 'Needs your decision';
		case 'open':
			return 'Open';
		case 'failed':
			return 'Declined';
		case 'expired':
			return payment.canceled_at ? 'Canceled' : 'Expired';
		default:
			return typeof payment.status === 'string' ? payment.status : '';
	}
}

/** An order's status in the same words as its payment's, plus Canceled for a canceled payment link's order. */
export function orderStatusText(order: IDataObject): string {
	if (order.status === 'canceled') return 'Canceled';
	if (order.status === 'held')
		return order.needs_review === false ? 'Not received' : 'Needs your decision';
	return paymentStatusText({ status: order.status });
}

/** "Fulfilled", "Not fulfilled" or "No shipping" once an order is paid (an unpaid one has nothing to say). */
export function fulfilmentText(order: IDataObject): string | null {
	if (order.fulfillment === 'fulfilled') return 'Fulfilled';
	if (order.status !== 'paid') return null;
	return order.fulfillment === 'unfulfilled' ? 'Not fulfilled' : 'No shipping';
}

/**
 * When something happened, in the workflow's time zone: "Oct 12, 3:04 PM", with the year once it isn't this year.
 * Absolute, not "5m ago": n8n keeps the chosen item's label in the workflow.
 */
export function whenText(seconds: unknown, timeZone: string, now = Date.now()): string {
	const ms = Number(seconds) * 1000;
	if (!Number.isFinite(ms) || ms <= 0) return '';
	const format = (zone: string) => {
		const year = (at: number) =>
			new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric' }).format(at);
		return new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			month: 'short',
			day: 'numeric',
			...(year(ms) === year(now) ? {} : { year: 'numeric' }),
			hour: 'numeric',
			minute: '2-digit',
		})
			.format(ms)
			.replace(/\s/g, ' ');
	};
	try {
		return format(timeZone || 'UTC');
	} catch {
		return format('UTC'); // a zone this runtime doesn't know
	}
}

/** One part of a label, cut so a long description or address can't push the rest out of sight. */
function part(text: unknown, max = 48): string | null {
	if (typeof text !== 'string' || !text.trim()) return null;
	const clean = text.trim().replace(/\s+/g, ' ');
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const join = (parts: Array<string | null | undefined>, livemode: unknown) =>
	[...parts, livemode === false ? 'Test' : null].filter(Boolean).join(' · ');

/** "$49.00 · nathan@example.com · Paid · Oct 12, 3:04 PM", with " · Test" on Test records. */
export function paymentLabel(payment: IDataObject, timeZone: string, now?: number): string {
	return join(
		[
			price(payment.amount, payment.currency),
			part(payment.customer_email) ?? part(payment.description),
			paymentStatusText(payment),
			whenText(payment.created, timeZone, now),
		],
		payment.livemode,
	);
}

/** The number a buyer sees: the store's own when it sent one, else Railbed's. */
export function orderNumber(order: IDataObject): string {
	const store = (order.store ?? null) as IDataObject | null;
	const number = store?.order_number ?? order.number;
	return `#${String(number ?? '').replace(/^#/, '')}`;
}

/** "Order #1042 · $49.00 · Paid · Not fulfilled · Oct 12, 3:04 PM". */
export function orderLabel(order: IDataObject, timeZone: string, now?: number): string {
	return join(
		[
			`Order ${orderNumber(order)}`,
			price(order.total, order.currency),
			orderStatusText(order),
			fulfilmentText(order),
			whenText(order.created, timeZone, now),
		],
		order.livemode,
	);
}

/** "Nathan Smith · nathan@example.com"; a customer whose details were deleted says so. */
export function customerLabel(customer: IDataObject): string {
	if (customer.erased === true) return join(['Deleted customer'], customer.livemode);
	const name = part(customer.name);
	const email = part(customer.email, 64);
	return join(name || email ? [name, email] : ['No email yet'], customer.livemode);
}

/** "n8n: Fulfil orders · https://n8n.example.com/webhook/…", or the address alone. */
export function endpointLabel(endpoint: IDataObject): string {
	return join([part(endpoint.description), part(endpoint.url, 72)], endpoint.livemode);
}

/** Whether a list item matches what was typed in the search box, in any letter case. */
export function matchesSearch(search: string, values: unknown[]): boolean {
	const wanted = search.trim().toLowerCase();
	if (!wanted) return true;
	return values.some((value) => typeof value === 'string' && value.toLowerCase().includes(wanted));
}

// ---------- Links into the dashboard ----------

/**
 * The dashboard's address for a credential's Base URL: app.railbed.io beside pay.railbed.io, or the same origin for a
 * Railbed running on this machine. Null for any other address, which then gets no links.
 */
export function dashboardOrigin(baseUrl: unknown): string | null {
	const base = apiRoot(baseUrl);
	if ('problem' in base) return null;
	const url = new URL(base.root);
	if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.origin;
	if (url.protocol === 'https:' && url.hostname.startsWith('pay.'))
		return `https://app.${url.hostname.slice(4)}`;
	return null;
}

/** A record's page in the dashboard, in its own mode (the dashboard reads ?mode=), or undefined without an origin. */
export function recordUrl(
	origin: string | null,
	kind: RecordKind,
	id: unknown,
	livemode: unknown,
): string | undefined {
	if (!origin || typeof id !== 'string' || !id) return undefined;
	const path = RECORDS[kind].path(encodeURIComponent(id));
	const mode =
		typeof livemode === 'boolean'
			? `${path.includes('?') ? '&' : '?'}mode=${livemode ? 'live' : 'test'}`
			: '';
	return `${origin}${path}${mode}${kind === 'endpoint' ? '#webhooks' : ''}`;
}
