import type { INodeProperties } from 'n8n-workflow';

const show = (operation: string[]) => ({ show: { resource: ['order'], operation } });

export const orderOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['order'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get an order with its items, addresses and payment attempts',
				action: 'Get order',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many orders, newest first',
				action: 'Get many orders',
			},
			{
				name: 'Record Cancellation or Refund',
				value: 'recordEvent',
				description:
					'Note on the order’s timeline that your store canceled it or refunded the buyer. Moves no money.',
				action: 'Record order cancellation or refund',
			},
			{
				name: 'Update Fulfillment',
				value: 'update',
				description: 'Mark an order fulfilled or unfulfilled',
				action: 'Update order fulfillment',
			},
		],
		default: 'get',
	},
];

export const orderFields: INodeProperties[] = [
	{
		displayName: 'Order ID',
		name: 'orderId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. ord_M4tQx8ZkP1vRn6WcLs2B',
		description:
			'Railbed’s order ID (ord_…). Payments and webhook events carry it as order_id or orderId.',
		displayOptions: show(['get', 'update', 'recordEvent']),
	},

	// ---------- update ----------
	{
		displayName: 'Fulfillment',
		name: 'fulfillment',
		type: 'options',
		required: true,
		default: 'fulfilled',
		options: [
			{ name: 'Fulfilled', value: 'fulfilled', description: 'You sent or delivered it' },
			{
				name: 'None',
				value: 'none',
				description: 'Nothing to fulfil, such as a service or donation',
			},
			{ name: 'Unfulfilled', value: 'unfulfilled', description: 'Still to send or deliver' },
		],
		displayOptions: show(['update']),
	},

	// ---------- recordEvent ----------
	{
		displayName: 'Event',
		name: 'eventType',
		type: 'options',
		required: true,
		default: 'refunded',
		options: [
			{ name: 'Canceled', value: 'canceled', description: 'Your store canceled the order' },
			{
				name: 'Refunded',
				value: 'refunded',
				description: 'You refunded the buyer outside Railbed',
			},
		],
		displayOptions: show(['recordEvent']),
	},
	{
		displayName: 'Your Event ID',
		name: 'storeEventId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. refund_5521',
		description:
			'Your own ID for this cancellation or refund (up to 64 characters, no spaces). Sending the same ID again records nothing new.',
		displayOptions: show(['recordEvent']),
	},
	{
		displayName: 'Refunded Amount',
		name: 'amount',
		type: 'string',
		default: '',
		placeholder: 'e.g. 12.00',
		description: 'Optional. Decimal text in the order’s currency, up to the order total.',
		displayOptions: {
			show: { resource: ['order'], operation: ['recordEvent'], eventType: ['refunded'] },
		},
	},

	// ---------- getAll ----------
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: show(['getAll']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['order'], operation: ['getAll'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show(['getAll']),
		options: [
			{
				displayName: 'Customer ID',
				name: 'customerId',
				type: 'string',
				default: '',
				placeholder: 'e.g. cus_Hc7nQ2wVz9KpT4mRb1Ye',
				description: 'Only this customer’s orders',
			},
			{
				displayName: 'Store ID',
				name: 'storeId',
				type: 'string',
				default: '',
				description: 'Only orders sent with this store ID',
			},
			{
				displayName: 'Store Order ID',
				name: 'storeOrderId',
				type: 'string',
				default: '',
				description:
					'Find the order your store or system sent with this order ID. Add Store ID when you sent one.',
			},
		],
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return a simplified version of the response instead of the raw data',
		displayOptions: show(['get', 'getAll', 'update']),
	},
];
