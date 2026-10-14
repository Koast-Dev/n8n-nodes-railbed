/** The credential both nodes use (credentials/RailbedApi.credentials.ts). */
export const RAILBED_CREDENTIAL = 'railbedApi';

/** Where the merchant API lives in production. The credential's Base URL can point elsewhere for local testing. */
export const DEFAULT_BASE_URL = 'https://pay.railbed.io';

/** Currencies a checkout session can be priced in. */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'] as const;

/** A payment's status, as the API reports it. Only "paid" means the money arrived and passed every check. */
export const PAYMENT_STATUSES = ['open', 'pending', 'paid', 'held', 'failed', 'expired'] as const;

/**
 * Webhook event types, in the order Railbed's dashboard lists them, with what each means for a workflow.
 * Keep in step with WEBHOOK_EVENT_TYPES in Railbed's shared/api.ts.
 */
export const EVENT_TYPES: ReadonlyArray<{ value: string; name: string; description: string }> = [
	{
		value: 'payment.started',
		name: 'Payment Started',
		description:
			'The buyer entered their email and was given a way to pay. Useful for abandoned-checkout follow-ups.',
	},
	{
		value: 'payment.paid',
		name: 'Payment Paid',
		description: 'The money arrived and passed every check. Fulfil orders on this event.',
	},
	{
		value: 'payment.held',
		name: 'Payment Held',
		description:
			'Money arrived but failed a check, so it waits for your decision in the dashboard. Do not fulfil yet.',
	},
	{
		value: 'payment.updated',
		name: 'Payment Updated',
		description: 'A paid payment’s settlement details were filled in later',
	},
	{
		value: 'payment.failed',
		name: 'Payment Failed',
		description: 'A Test payment ended in a simulated failure',
	},
	{
		value: 'payment.expired',
		name: 'Payment Expired',
		description:
			'Nobody paid in time. Money that arrives later still settles and sends Paid or Held.',
	},
	{
		value: 'payment.canceled',
		name: 'Payment Canceled',
		description: 'You canceled a payment link before anyone started paying',
	},
];
