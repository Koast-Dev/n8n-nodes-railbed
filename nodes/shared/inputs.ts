import type { IDataObject } from 'n8n-workflow';

/**
 * Money goes to Railbed as decimal text ("49.00"), never a number, so nothing is rounded on the way. Text is sent as
 * it is (trimmed), and Railbed checks it. A number mapped from an earlier node is written with two decimals, the only
 * precision Railbed's currencies (USD, EUR, GBP, CAD and AUD) have; a number with a third decimal, such as 49.999, is
 * refused rather than rounded, since rounding would change the price. Binary noise such as 0.1 + 0.2 counts as 0.30.
 */
export function moneyText(value: unknown): { text: string } | { problem: string } {
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) return { problem: 'isn’t a number' };
		const cents = Math.round(value * 100);
		if (Math.abs(value * 100 - cents) > 1e-6)
			return { problem: `has more than two decimals (${value})` };
		return { text: (cents / 100).toFixed(2) };
	}
	return { text: typeof value === 'string' ? value.trim() : String(value ?? '') };
}

/** Date-time text without a zone or offset, such as n8n's date picker writes: "2026-10-12T09:30:00" or "2026-10-12". */
const LOCAL_DATE_TIME =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?$/;

/** How far `zone` is ahead of UTC at the instant `utcMs`, in milliseconds; null for a zone this runtime doesn't know. */
function zoneOffsetMs(zone: string, utcMs: number): number | null {
	let parts: Intl.DateTimeFormatPart[];
	try {
		parts = new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
		}).formatToParts(new Date(utcMs));
	} catch {
		return null;
	}
	const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	const wall = Date.UTC(
		part('year'),
		part('month') - 1,
		part('day'),
		part('hour'),
		part('minute'),
		part('second'),
	);
	return Number.isFinite(wall) ? wall - Math.floor(utcMs / 1000) * 1000 : null;
}

/**
 * An n8n date (ISO text, a Luxon DateTime or a JS Date) as Unix seconds; undefined when empty or unreadable. Text with
 * no zone or offset (what n8n's date picker gives) is read in `timeZone`, the workflow's time zone, as n8n's own nodes
 * do; text with `Z` or an offset, a Luxon DateTime and a Date are exact instants already.
 */
export function toUnixSeconds(value: unknown, timeZone?: string): number | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (value instanceof Date) {
		const ms = value.getTime();
		return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
	}
	const text =
		typeof value === 'object' && 'toISO' in value
			? String((value as { toISO: () => string }).toISO())
			: String(value).trim();
	const local = LOCAL_DATE_TIME.exec(text);
	if (local && timeZone) {
		const [, y, mo, d, h = '0', mi = '0', s = '0', frac = '0'] = local;
		const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, Number(frac.padEnd(3, '0')));
		// The zone's offset at the wall time itself, then at the instant that gives (right across a clock change).
		const first = zoneOffsetMs(timeZone, wall);
		if (first !== null) {
			const second = zoneOffsetMs(timeZone, wall - first) ?? first;
			const ms = wall - second;
			return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
		}
	}
	const ms = Date.parse(text);
	return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

/** Key/value rows from a fixed collection as Railbed metadata; undefined when there are none. */
export function metadataFromRows(rows: unknown): Record<string, string> | undefined {
	if (!Array.isArray(rows) || !rows.length) return undefined;
	const metadata: Record<string, string> = {};
	for (const row of rows as IDataObject[]) {
		const key = typeof row.key === 'string' ? row.key.trim() : '';
		if (key) metadata[key] = row.value === undefined || row.value === null ? '' : String(row.value);
	}
	return Object.keys(metadata).length ? metadata : undefined;
}

/** A JSON object typed into a JSON field (text) or mapped from an earlier node (an object). */
export function jsonObject(value: unknown): { value: IDataObject } | { problem: string } | null {
	if (value === undefined || value === null || value === '') return null;
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			return { problem: 'isn’t valid JSON' };
		}
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
		return { problem: 'must be a JSON object' };
	return { value: parsed as IDataObject };
}

/** Removes keys whose value is undefined or an empty string, so optional fields Railbed would refuse aren't sent. */
export function compact(object: IDataObject): IDataObject {
	return Object.fromEntries(
		Object.entries(object).filter(([, value]) => value !== undefined && value !== ''),
	) as IDataObject;
}

/**
 * An ID for a URL path, encoded so it stays one path segment: a "/", "?" or "%" in it can't reach another route.
 * Encoding leaves "." and ".." as they are, and URL parsers read those as "this folder" and "the folder above" (so
 * /payments/.. would become a different request), so they are refused, as is an empty ID (which would turn a Get into
 * a list).
 */
export function pathId(value: unknown): string {
	const id = String(value ?? '').trim();
	if (!id || /^\.{1,2}$/.test(id))
		throw new Error(id ? `“${id}” isn’t a Railbed ID` : 'An ID is required');
	return encodeURIComponent(id);
}

const pick = (source: IDataObject, keys: string[]): IDataObject =>
	Object.fromEntries(keys.map((key) => [key, source[key] ?? null])) as IDataObject;

/**
 * The ten payment fields a workflow checks before it fulfils (railbed.com/docs/guides/fulfilment/): the id and mode,
 * the reference and metadata your order is matched on, the price, the status with why it's held, and the order.
 * Description, email, settlement and the rest stay in the full response (turn Simplify off).
 */
export function simplifyPayment(payment: IDataObject): IDataObject {
	return pick(payment, [
		'id',
		'status',
		'livemode',
		'amount',
		'currency',
		'reference',
		'metadata',
		'order_id',
		'paid_at',
		'hold_reason',
	]);
}

/** A checkout session's essentials: the address to send the buyer to, and what it's for. */
export function simplifySession(session: IDataObject): IDataObject {
	return pick(session, [
		'id',
		'url',
		'status',
		'amount',
		'currency',
		'description',
		'reference',
		'customer_email',
		'order_id',
		'expires_at',
	]);
}

export function simplifyOrder(order: IDataObject): IDataObject {
	return pick(order, [
		'id',
		'number',
		'status',
		'needs_review',
		'fulfillment',
		'total',
		'amount_paid',
		'currency',
		'customer_id',
		'created',
	]);
}

export function simplifyCustomer(customer: IDataObject): IDataObject {
	return pick(customer, [
		'id',
		'email',
		'name',
		'phone',
		'orders_count',
		'paid_orders_count',
		'spent',
		'created',
		'last_order_at',
		'erased',
	]);
}
