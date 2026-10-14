import type { IDataObject } from 'n8n-workflow';

export interface RailbedEvent extends IDataObject {
	id: string;
	type: string;
	created: number;
	livemode: boolean;
	data: IDataObject;
}

export type ReadEvent =
	| { refusal: string }
	| { event: RailbedEvent; skip: string | null; sample: boolean; paymentId: string | null };

/**
 * A verified delivery's body as a Railbed event (railbed.com/docs/webhooks/events/). `skip` says why a valid event
 * shouldn't start the workflow: a ping from Send test event, or an event for the other mode. `sample` marks Test
 * samples from Send test event, whose made-up payment the API doesn't know.
 */
export function readTriggerEvent(raw: Buffer | string, mode: string | undefined): ReadEvent {
	let parsed: unknown;
	try {
		parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
	} catch {
		return { refusal: 'The body is not JSON.' };
	}
	const event = parsed as Partial<RailbedEvent> | null;
	if (
		!event ||
		typeof event !== 'object' ||
		typeof event.id !== 'string' ||
		typeof event.type !== 'string'
	) {
		return { refusal: 'The body is not a Railbed event.' };
	}
	const data = (event.data && typeof event.data === 'object' ? event.data : {}) as IDataObject;
	const payment = (
		data.payment && typeof data.payment === 'object' ? data.payment : null
	) as IDataObject | null;
	const metadata = (
		payment?.metadata && typeof payment.metadata === 'object' ? payment.metadata : null
	) as IDataObject | null;
	const sample = event.livemode === false && metadata?.sample === 'true';
	let skip: string | null = null;
	if (event.type === 'ping') skip = 'ping';
	else if (mode && typeof event.livemode === 'boolean' && event.livemode !== (mode === 'live'))
		skip = 'other mode';
	return {
		event: { ...event, data } as RailbedEvent,
		skip,
		sample,
		paymentId: typeof payment?.id === 'string' ? payment.id : null,
	};
}

/** Whether an endpoint's events are exactly the ones chosen, in any order. */
export function sameEvents(actual: unknown, wanted: string[]): boolean {
	if (!Array.isArray(actual)) return false;
	const a = new Set(actual.map(String));
	return a.size === new Set(wanted).size && wanted.every((type) => a.has(type));
}

/**
 * A webhook address as Railbed stores it, so n8n's address and an endpoint's `url` compare equal when they are the
 * same destination: parsed as a URL (lowercase host, punycode for an international name, no default port), without
 * a `#fragment` or a bare trailing `?`. Null when it isn't a web address.
 */
export function endpointAddress(raw: unknown): string | null {
	if (typeof raw !== 'string' || !raw.trim()) return null;
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	url.hash = '';
	// An empty query still prints its "?"; setting it to '' removes the mark itself.
	if (!url.search) url.search = '';
	return url.toString();
}

/** Whether two webhook addresses are the same destination once Railbed has normalised them. */
export function sameAddress(a: unknown, b: unknown): boolean {
	const left = endpointAddress(a);
	return left !== null && left === endpointAddress(b);
}

/** n8n's address can't take Live events: plain http, or a host only this computer can reach. */
export function looksLocal(url: string): boolean {
	return /^http:\/\//i.test(url) || /^https?:\/\/(?:localhost|127\.|\[::1\])/i.test(url);
}
