import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { RAILBED_CREDENTIAL } from '../shared/constants';
import {
	customerLabel,
	dashboardOrigin,
	endpointLabel,
	matchesSearch,
	orderLabel,
	orderNumber,
	paymentLabel,
	type RecordKind,
	RECORDS,
	recordUrl,
} from '../shared/records';
import { railbedApiRequest, railbedHttpStatus } from '../shared/transport';

/**
 * The lists behind each "From List" field. Railbed's /v1 lists are newest first and page with `starting_after`; n8n
 * passes the previous page's `next_cursor` back as `paginationToken` when the list is scrolled.
 *
 * Search spends at most two requests, since these share the key's 120 requests a minute with the workflows that use it:
 * an ID (or a link holding one) is read directly; other text is matched against the newest 100 records' labels, plus
 * the one exact filter the API has for that record (a payment's reference, a customer's email, an order's ID from your
 * own system). Search results are a single page: n8n doesn't load more on its own while a search is typed.
 */

/** Records per page when browsing, and how many of the newest a search looks through. */
export const PAGE_SIZE = 50;
export const SEARCH_SIZE = 100;

interface View {
	origin: string | null;
	timeZone: string;
}

async function view(this: ILoadOptionsFunctions): Promise<View> {
	const credentials = await this.getCredentials(RAILBED_CREDENTIAL);
	return { origin: dashboardOrigin(credentials.baseUrl), timeZone: this.getTimezone() };
}

interface Page {
	data: IDataObject[];
	next: string | null;
}

async function page(
	this: ILoadOptionsFunctions,
	path: string,
	qs: IDataObject,
	limit: number,
	cursor?: string,
): Promise<Page> {
	const body = await railbedApiRequest.call(this, 'GET', path, {
		qs: { ...qs, limit, ...(cursor ? { starting_after: cursor } : {}) },
	});
	const data = Array.isArray(body.data) ? (body.data as IDataObject[]) : [];
	return {
		data,
		next: body.has_more === true && typeof body.next_cursor === 'string' ? body.next_cursor : null,
	};
}

/** One record by ID, or nothing when this key's business and mode has no such record. */
async function one(this: ILoadOptionsFunctions, path: string): Promise<IDataObject[]> {
	try {
		return [await railbedApiRequest.call(this, 'GET', path)];
	} catch (error) {
		if (railbedHttpStatus(error) === 404) return [];
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/** The ID of this kind in what was typed: an ID on its own, or inside a pasted dashboard or checkout link. */
export function idIn(search: string, kind: RecordKind): string | null {
	const match = new RegExp(`(?:^|[^A-Za-z0-9])(${RECORDS[kind].prefix}[A-Za-z0-9_-]{1,64})`).exec(
		search.trim(),
	);
	return match ? match[1] : null;
}

/** Records from several lookups, each once, newest first. */
function merge(...lists: IDataObject[][]): IDataObject[] {
	const seen = new Map<string, IDataObject>();
	for (const record of lists.flat()) {
		if (typeof record.id === 'string' && !seen.has(record.id)) seen.set(record.id, record);
	}
	return [...seen.values()].sort((a, b) => Number(b.created ?? 0) - Number(a.created ?? 0));
}

function result(
	records: IDataObject[],
	item: (record: IDataObject) => INodeListSearchItems,
	next: string | null = null,
): INodeListSearchResult {
	return { results: records.map(item), ...(next ? { paginationToken: next } : {}) };
}

// ---------- Payments and checkout sessions ----------

async function findPayments(
	this: ILoadOptionsFunctions,
	kind: 'payment' | 'session',
	filter: string | undefined,
	paginationToken: string | undefined,
	status: string | undefined,
): Promise<INodeListSearchResult> {
	const { origin, timeZone } = await view.call(this);
	const item = (p: IDataObject): INodeListSearchItems => ({
		name: paymentLabel(p, timeZone),
		value: String(p.id),
		url: recordUrl(origin, kind, p.id, p.livemode),
	});
	const qs = status ? { status } : {};
	const search = (filter ?? '').trim();
	if (!search) {
		const { data, next } = await page.call(this, '/payments', qs, PAGE_SIZE, paginationToken);
		return result(data, item, next);
	}
	// An ID that isn't a payment here may still be part of a reference, so the search carries on.
	const id = idIn(search, 'payment');
	const byId = id ? await one.call(this, `/payments/${encodeURIComponent(id)}`) : [];
	if (byId.length) return result(byId, item);
	// Railbed matches a reference exactly, as it was sent (up to 120 characters).
	const [recent, referenced] = await Promise.all([
		page.call(this, '/payments', qs, SEARCH_SIZE),
		search.length <= 120
			? page.call(this, '/payments', { ...qs, reference: search }, SEARCH_SIZE)
			: Promise.resolve({ data: [], next: null }),
	]);
	const matched = recent.data.filter((p) =>
		matchesSearch(search, [
			paymentLabel(p, timeZone),
			p.id,
			p.reference,
			p.description,
			p.customer_email,
			p.order_id,
		]),
	);
	return result(merge(referenced.data, matched), item);
}

/** Payment fields (Get, Simulate): every payment in the key's mode. */
export async function searchPayments(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	return findPayments.call(this, 'payment', filter, paginationToken, undefined);
}

/** Checkout Session fields: every session for Get; for Start, only the open ones, which can still be started. */
export async function searchCheckoutSessions(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const operation = this.getCurrentNodeParameter('operation');
	return findPayments.call(
		this,
		'session',
		filter,
		paginationToken,
		operation === 'start' ? 'open' : undefined,
	);
}

// ---------- Orders ----------

export async function searchOrders(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const { origin, timeZone } = await view.call(this);
	const item = (o: IDataObject): INodeListSearchItems => ({
		name: orderLabel(o, timeZone),
		value: String(o.id),
		url: recordUrl(origin, 'order', o.id, o.livemode),
	});
	const search = (filter ?? '').trim();
	if (!search) {
		const { data, next } = await page.call(this, '/orders', {}, PAGE_SIZE, paginationToken);
		return result(data, item, next);
	}
	const orderId = idIn(search, 'order');
	const byId = orderId ? await one.call(this, `/orders/${encodeURIComponent(orderId)}`) : [];
	if (byId.length) return result(byId, item);
	// A customer's orders, by their ID or their exact email (the customer list finds the email in any letter case).
	let customerId = idIn(search, 'customer');
	if (!customerId && /^[^\s@]+@[^\s@]+$/.test(search)) {
		const found = await page.call(this, '/customers', { email: search }, 1);
		customerId = typeof found.data[0]?.id === 'string' ? found.data[0].id : null;
		if (!customerId) return result([], item);
	}
	if (customerId) {
		const { data, next } = await page.call(
			this,
			'/orders',
			{ customer_id: customerId },
			PAGE_SIZE,
			paginationToken,
		);
		return result(data, item, next);
	}
	// Orders sent without a store ID are found by your own order ID (order.id at checkout).
	const [recent, ownId] = await Promise.all([
		page.call(this, '/orders', {}, SEARCH_SIZE),
		search.length <= 64
			? page.call(this, '/orders', { store_order_id: search }, SEARCH_SIZE)
			: Promise.resolve({ data: [], next: null }),
	]);
	const store = (o: IDataObject) => (o.store ?? {}) as IDataObject;
	const matched = recent.data.filter((o) =>
		matchesSearch(search, [
			orderLabel(o, timeZone),
			o.id,
			orderNumber(o),
			store(o).order_id,
			store(o).name,
			...(Array.isArray(o.items) ? (o.items as IDataObject[]).map((line) => line.name) : []),
		]),
	);
	return result(merge(ownId.data, matched), item);
}

// ---------- Customers ----------

export async function searchCustomers(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const { origin } = await view.call(this);
	const item = (c: IDataObject): INodeListSearchItems => ({
		name: customerLabel(c),
		value: String(c.id),
		url: recordUrl(origin, 'customer', c.id, c.livemode),
	});
	const search = (filter ?? '').trim();
	if (!search) {
		const { data, next } = await page.call(this, '/customers', {}, PAGE_SIZE, paginationToken);
		return result(data, item, next);
	}
	const id = idIn(search, 'customer');
	const byId = id ? await one.call(this, `/customers/${encodeURIComponent(id)}`) : [];
	if (byId.length) return result(byId, item);
	const [recent, byEmail] = await Promise.all([
		page.call(this, '/customers', {}, SEARCH_SIZE),
		/^[^\s@]+@[^\s@]+$/.test(search)
			? page.call(this, '/customers', { email: search }, 1)
			: Promise.resolve({ data: [], next: null }),
	]);
	const matched = recent.data.filter((c) =>
		matchesSearch(search, [customerLabel(c), c.id, c.email, c.name, c.phone]),
	);
	return result(merge(byEmail.data, matched), item);
}

// ---------- Webhook endpoints ----------

/** A mode has at most 10 endpoints, so one page holds them all and search filters it here. */
export async function searchWebhookEndpoints(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const { origin } = await view.call(this);
	const { data } = await page.call(this, '/webhook_endpoints', {}, SEARCH_SIZE);
	const search = (filter ?? '').trim();
	const matched = data.filter((e) =>
		matchesSearch(search, [endpointLabel(e), e.id, e.url, e.description]),
	);
	return result(matched, (e) => ({
		name: endpointLabel(e),
		value: String(e.id),
		url: recordUrl(origin, 'endpoint', e.id, e.livemode),
	}));
}
