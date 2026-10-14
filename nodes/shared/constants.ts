/** The credential both nodes use (credentials/RailbedApi.credentials.ts). */
export const RAILBED_CREDENTIAL = 'railbedApi';

/** Where the merchant API lives in production. The credential's Base URL can point elsewhere for local testing. */
export const DEFAULT_BASE_URL = 'https://pay.railbed.io';

/** Currencies a checkout session can be priced in. */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'] as const;

/** A payment's status, as the API reports it (the dashboard's words are in descriptions/payment.ts). Only "paid" means the money arrived and passed every check. */
export const PAYMENT_STATUSES = ['open', 'pending', 'paid', 'held', 'failed', 'expired'] as const;

/**
 * Webhook event types, in the order Railbed's dashboard lists them, with the type each event carries. A held payment
 * "needs your decision", in the dashboard's words. Keep in step with WEBHOOK_EVENT_TYPES in Railbed's shared/api.ts.
 */
export const EVENT_TYPES: ReadonlyArray<{ value: string; name: string; description: string }> = [
	{
		value: 'payment.started',
		name: 'Payment Started',
		description:
			'The buyer entered their email and was given a way to pay. Useful for abandoned-checkout follow-ups. Its type is payment.started.',
	},
	{
		value: 'payment.paid',
		name: 'Payment Paid',
		description:
			'The money arrived and passed every check. Fulfil orders on this event only. Its type is payment.paid.',
	},
	{
		value: 'payment.held',
		name: 'Payment Needs Your Decision',
		description:
			'Money arrived but didn’t pass a check, so it isn’t paid until you decide in the dashboard. Don’t fulfil yet. Its type is payment.held.',
	},
	{
		value: 'payment.updated',
		name: 'Payment Updated',
		description:
			'A paid payment’s settlement details, such as the amount received, arrived later. Its type is payment.updated.',
	},
	{
		value: 'payment.failed',
		name: 'Payment Failed',
		description:
			'A payment that can’t be completed. Today only Test mode’s Simulate (Failed) sends it; a declined card leaves the payment open and sends nothing. Its type is payment.failed.',
	},
	{
		value: 'payment.expired',
		name: 'Payment Expired',
		description:
			'Nobody paid in time. Money that arrives later still settles and sends Payment Paid or Payment Needs Your Decision. Its type is payment.expired.',
	},
	{
		value: 'payment.canceled',
		name: 'Payment Canceled',
		description:
			'You canceled a payment link before anyone started paying. Its type is payment.canceled.',
	},
];
