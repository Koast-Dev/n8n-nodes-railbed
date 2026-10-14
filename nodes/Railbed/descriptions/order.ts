import type { INodeProperties } from 'n8n-workflow';
import { recordLocator } from './locators';

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
				description: 'Retrieve an order with its items, addresses and payment attempts',
				action: 'Get order',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description:
					'Retrieve a list of orders, newest first, for a customer or by your store’s order ID',
				action: 'Get many orders',
			},
			{
				name: 'Record Cancellation or Refund',
				value: 'recordEvent',
				description:
					'Note on an order’s timeline that your store canceled it or refunded the buyer. Moves no money.',
				action: 'Record order cancellation or refund',
			},
			{
				name: 'Update Fulfillment',
				value: 'update',
				description: 'Mark an order fulfilled, not fulfilled, or as having nothing to ship',
				action: 'Update order fulfillment',
			},
		],
		default: 'get',
	},
];

export const orderFields: INodeProperties[] = [
	recordLocator('order', {
		name: 'orderId',
		displayName: 'Order',
		description:
			'The order. In a workflow, map it from a payment’s order_id or a Railbed Trigger event’s data.order.id.',
		displayOptions: show(['get', 'update', 'recordEvent']),
	}),

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
				name: 'No Shipping',
				value: 'none',
				description: 'Nothing to send, such as a download, a service or a donation',
			},
			{
				name: 'Not Fulfilled',
				value: 'unfulfilled',
				description:
					'Still to send or deliver. Paid orders like this wait under Not fulfilled in Orders.',
			},
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
		description:
			'Optional. How much you refunded, as decimal text in the order’s currency, up to the order total.',
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
			recordLocator('customer', {
				name: 'customerId',
				displayName: 'Customer',
				description: 'Only this customer’s orders.',
				required: false,
			}),
			{
				displayName: 'Store ID',
				name: 'storeId',
				type: 'string',
				default: '',
				placeholder: 'e.g. my-store',
				description: 'Only orders your store or system sent with this store ID',
			},
			{
				displayName: 'Store Order ID',
				name: 'storeOrderId',
				type: 'string',
				default: '',
				placeholder: 'e.g. 1042',
				description:
					'Find the order your store or system sent with this order ID when it created the checkout session. Add Store ID when you sent one.',
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
