import type { IDataObject } from 'n8n-workflow';

/** Railbed's error body: `{ "error": { "code", "message", "field"? } }` (railbed.com/docs/api/errors/). */
export interface RailbedErrorBody {
	code: string | null;
	message: string | null;
	field: string | null;
}

export function readErrorBody(body: unknown): RailbedErrorBody {
	const error = body && typeof body === 'object' ? (body as IDataObject).error : undefined;
	if (!error || typeof error !== 'object') return { code: null, message: null, field: null };
	const e = error as IDataObject;
	return {
		code: typeof e.code === 'string' ? e.code : null,
		message: typeof e.message === 'string' ? e.message : null,
		field: typeof e.field === 'string' ? e.field : null,
	};
}

/** What to do next, by Railbed's error code. Codes not listed fall back to advice by HTTP status. */
const NEXT_STEP: Record<string, string> = {
	invalid_api_key:
		'Check the secret key in the Railbed credential. Keys start with rb_test_ (Test data) or rb_live_ (Live data); create one under Developers in the Railbed dashboard.',
	insufficient_scope:
		'This key can’t do that. Use a secret key with Full access: Read only keys can look up payments, orders and customers but change nothing and can’t manage webhook endpoints.',
	merchant_read_only:
		'This Railbed account is suspended or archived, so it can be read but not changed. Contact support@railbed.com.',
	commerce_paused:
		'This Railbed account isn’t taking new payments right now. Contact support@railbed.com to turn payments back on.',
	integration_disabled:
		'The API is turned off for this Railbed account. Contact support@railbed.com.',
	no_payout_wallet:
		'Add a payout wallet in the Railbed dashboard’s Settings before taking Live payments.',
	not_found:
		'Check the ID, and that the credential’s key is in the same mode as the record: a Test key can’t see Live records, and a Live key can’t see Test ones.',
	idempotency_conflict:
		'This idempotency key was already used for a different session. Use a new key for a new order, or send exactly the same details to get the original session back.',
	idempotency_in_progress:
		'Another request with this idempotency key is still running. Try again in a second.',
	order_paid:
		'This store order is already paid, or money for it is waiting for your decision. Check it in the dashboard before asking the buyer to pay again.',
	live_payment: 'Only Test payments can be simulated. Use a Test key (rb_test_…).',
	not_started: 'Start the checkout session before simulating its outcome.',
	duplicate_url:
		'That address is already one of your webhook endpoints in this mode. Use the existing endpoint, or remove it under Developers in the Railbed dashboard first.',
	too_many:
		'This mode already has 10 webhook endpoints. Remove one under Developers in the Railbed dashboard, then try again.',
	invalid_url:
		'Live webhook endpoints must be public https:// addresses. While building, use a Test key, or give n8n a public https address (its N8N_WEBHOOK_URL setting, WEBHOOK_URL before n8n 2.35, or a tunnel).',
	rate_limited:
		'Railbed is limiting requests from this account. Wait a minute, or turn on Retry On Fail in this node’s settings.',
};

export function nextStep(statusCode: number, code: string | null, retryAfter?: unknown): string {
	if (code && NEXT_STEP[code]) {
		return code === 'rate_limited' && retryAfter
			? `Wait ${String(retryAfter)} seconds, then try again.`
			: NEXT_STEP[code];
	}
	if (statusCode === 429)
		return `Wait ${retryAfter ? String(retryAfter) : '60'} seconds, then try again.`;
	if (statusCode >= 500)
		return 'Railbed couldn’t complete the request. Try again in a minute; turn on Retry On Fail in this node’s settings to do that automatically.';
	if (statusCode === 401) return NEXT_STEP.invalid_api_key;
	if (statusCode === 404) return NEXT_STEP.not_found;
	return 'Check the values sent to Railbed and try again.';
}

/** The message and description an n8n user sees when Railbed refuses a request. */
export function describeRailbedError(
	statusCode: number,
	body: unknown,
	retryAfter?: unknown,
): { message: string; description: string; code: string | null } {
	const { code, message, field } = readErrorBody(body);
	const where = [code ? `Railbed code: ${code}` : null, field ? `field: ${field}` : null]
		.filter(Boolean)
		.join(', ');
	return {
		message: message ?? `Railbed answered with HTTP ${statusCode}`,
		description: where
			? `${nextStep(statusCode, code, retryAfter)} (${where})`
			: nextStep(statusCode, code, retryAfter),
		code,
	};
}
