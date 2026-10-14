import { createHmac, timingSafeEqual } from 'crypto';

/** Railbed rejects nothing older than this itself; receivers allow five minutes of clock difference. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** One timestamp, then one or more 64-character hex signatures (two while a rolled secret's overlap lasts). */
const HEADER = /^t=(\d{1,12})((?:,v1=[0-9a-f]{64})+)$/;

export type SignatureResult =
	| { valid: true; timestamp: number }
	| { valid: false; reason: 'no_secret' | 'missing' | 'malformed' | 'stale' | 'mismatch' };

/**
 * Checks a `Railbed-Signature` header the way railbed.com/docs/webhooks/signatures/ describes:
 * `t={unix seconds},v1={hex HMAC-SHA256(secret, "{t}.{raw body}")}`, with every `v1` value kept
 * (two during a secret roll), a five-minute window and a constant-time comparison. The raw body
 * must be the exact bytes received, never JSON parsed and serialized again.
 */
export function verifyRailbedSignature(
	rawBody: Buffer | string,
	header: unknown,
	secret: unknown,
	nowSeconds: number = Math.floor(Date.now() / 1000),
	toleranceSeconds: number = SIGNATURE_TOLERANCE_SECONDS,
): SignatureResult {
	if (typeof secret !== 'string' || !secret) return { valid: false, reason: 'no_secret' };
	// A proxy can split repeated values into a list; Railbed sends them in one header.
	const value = Array.isArray(header) ? header.join(',') : header;
	if (typeof value !== 'string' || !value.trim()) return { valid: false, reason: 'missing' };
	const match = HEADER.exec(value.trim());
	if (!match) return { valid: false, reason: 'malformed' };
	const timestamp = Number(match[1]);
	if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { valid: false, reason: 'stale' };
	const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
	const expected = createHmac('sha256', secret).update(`${match[1]}.`).update(body).digest();
	const matches = match[2]
		.slice(1)
		.split(',')
		.some((part) => timingSafeEqual(expected, Buffer.from(part.slice(3), 'hex')));
	return matches ? { valid: true, timestamp } : { valid: false, reason: 'mismatch' };
}

/** What the trigger answers for each refusal, in words a person reading the delivery log can act on. */
export const SIGNATURE_REFUSALS: Record<
	Exclude<SignatureResult, { valid: true }>['reason'],
	string
> = {
	no_secret:
		'This trigger has no signing secret. Turn the workflow off and on again to subscribe afresh.',
	missing: 'The Railbed-Signature header is missing.',
	malformed: 'The Railbed-Signature header is not in the t=…,v1=… form.',
	stale: 'The signature is more than five minutes old. Check this server’s clock.',
	mismatch: 'The signature does not match this trigger’s signing secret.',
};
