import type { INodeProperties } from 'n8n-workflow';
import { CURRENCIES } from '../../shared/constants';
import { recordLocator } from './locators';

const show = (operation: string[]) => ({ show: { resource: ['checkoutSession'], operation } });

export const checkoutSessionOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['checkoutSession'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a new checkout session and get the link to send the buyer',
				action: 'Create checkout session',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve a checkout session with its link and status',
				action: 'Get checkout session',
			},
			{
				name: 'Start',
				value: 'start',
				description:
					'Start a checkout session and get its card providers, for a checkout page you build yourself',
				action: 'Start checkout session',
			},
		],
		default: 'create',
	},
];

export const checkoutSessionFields: INodeProperties[] = [
	// ---------- create ----------
	{
		displayName: 'Amount',
		name: 'amount',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 49.00',
		description: 'The price as decimal text in the session’s currency, from 1.00 to 100000.00',
		displayOptions: show(['create']),
	},
	{
		displayName: 'Currency',
		name: 'currency',
		type: 'options',
		required: true,
		default: 'USD',
		options: [...CURRENCIES].sort().map((code) => ({ name: code, value: code })),
		displayOptions: show(['create']),
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Pro membership',
		description: 'What the buyer is paying for, shown on the checkout page. Up to 120 characters.',
		displayOptions: show(['create']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['create']),
		options: [
			{
				displayName: 'Ask the Buyer For (JSON)',
				name: 'collect',
				type: 'json',
				default: '',
				placeholder: 'e.g. {"name": "required", "shipping_address": "required"}',
				description:
					'What the checkout page asks the buyer for besides their email, as the API’s collect object: name, phone, date_of_birth, shipping_address and billing_address (each off, optional or required), minimum_age, marketing_opt_in and up to 5 custom_fields. See railbed.com/docs/api/checkout-sessions.',
			},
			{
				displayName: 'Cancel URL',
				name: 'cancelUrl',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://example.com/cart',
				description:
					'Where the buyer goes if they leave the checkout page. Live sessions need https.',
			},
			{
				displayName: 'Customer Accepts Marketing',
				name: 'customerAcceptsMarketing',
				type: 'boolean',
				default: false,
				description:
					'Whether the buyer agreed to marketing email in your store. On adds them to your list in Railbed; off changes nothing.',
			},
			{
				displayName: 'Customer Date of Birth',
				name: 'customerDateOfBirth',
				type: 'string',
				default: '',
				placeholder: 'e.g. 1990-04-21',
				description:
					'The buyer’s date of birth as YYYY-MM-DD, saved on the customer. Railbed records it as given; it isn’t an ID check.',
			},
			{
				displayName: 'Customer Email',
				name: 'customerEmail',
				type: 'string',
				default: '',
				placeholder: 'e.g. nathan@example.com',
				description: 'The buyer’s email. The checkout page asks for it when you leave it out.',
			},
			{
				displayName: 'Customer Name',
				name: 'customerName',
				type: 'string',
				default: '',
				placeholder: 'e.g. Nathan Smith',
				description: 'The buyer’s name, saved on the order and the customer. Up to 120 characters.',
			},
			{
				displayName: 'Customer Phone',
				name: 'customerPhone',
				type: 'string',
				default: '',
				placeholder: 'e.g. +1 555 010 0199',
				description:
					'The buyer’s phone number, saved on the order and the customer. Up to 40 characters.',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				placeholder: 'e.g. order-1042-attempt-1',
				description:
					'A value unique to this order attempt, such as your order ID. Sending the same key and details again within 24 hours returns the original session instead of creating a second one.',
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'fixedCollection',
				placeholder: 'Add Metadata',
				default: {},
				typeOptions: { multipleValues: true },
				description:
					'Your own key/value pairs (up to 20), returned on the payment and in webhooks. Never put secrets here.',
				options: [
					{
						displayName: 'Entry',
						name: 'entry',
						values: [
							{
								displayName: 'Key',
								name: 'key',
								type: 'string',
								default: '',
								placeholder: 'e.g. user_id',
							},
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'Order (JSON)',
				name: 'order',
				type: 'json',
				default: '',
				placeholder: 'e.g. {"items": [{"name": "Mug", "quantity": 1, "amount": "18.00"}]}',
				description:
					'What is being bought and where it ships, as the API’s order object: items, discount, shipping, tax, addresses and your store’s order ID. See railbed.com/docs/api/checkout-sessions.',
			},
			{
				displayName: 'Reference',
				name: 'reference',
				type: 'string',
				default: '',
				placeholder: 'e.g. order_1042',
				description:
					'Your own order ID, echoed on the payment and in webhooks. It doesn’t prevent duplicates; use an idempotency key for that.',
			},
			{
				displayName: 'Store Customer ID',
				name: 'storeCustomerId',
				type: 'string',
				default: '',
				placeholder: 'e.g. 5521',
				description: 'The buyer’s customer ID in your own store or system. Up to 64 characters.',
			},
			{
				displayName: 'Success URL',
				name: 'successUrl',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://example.com/thanks?payment={PAYMENT_ID}',
				description:
					'Where the buyer goes once paid. {PAYMENT_ID} and {REFERENCE} are filled in. Live sessions need https.',
			},
		],
	},

	// ---------- get, start ----------
	recordLocator('session', {
		name: 'sessionId',
		displayName: 'Checkout Session',
		description: 'The checkout session. It shares its ID with its payment.',
		displayOptions: show(['get']),
	}),
	recordLocator('session', {
		name: 'sessionId',
		displayName: 'Checkout Session',
		description:
			'The checkout session to start; the list shows open sessions. It shares its ID with its payment.',
		displayOptions: show(['start']),
	}),
	{
		displayName: 'Additional Fields',
		name: 'startFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['start']),
		options: [
			{
				displayName: 'Buyer Country',
				name: 'country',
				type: 'string',
				default: '',
				placeholder: 'e.g. US',
				description:
					'The buyer’s two-letter country code, from the buyer’s own request. It helps choose card providers that serve them.',
			},
			{
				displayName: 'Customer Email',
				name: 'customerEmail',
				type: 'string',
				default: '',
				placeholder: 'e.g. nathan@example.com',
				description: 'The buyer’s email. Needed when the session was created without one.',
			},
		],
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return a simplified version of the response instead of the raw data',
		displayOptions: show(['create', 'get']),
	},
];
