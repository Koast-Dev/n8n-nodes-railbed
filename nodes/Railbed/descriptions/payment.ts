import type { INodeProperties } from 'n8n-workflow';
import { PAYMENT_STATUSES } from '../../shared/constants';

const show = (operation: string[]) => ({ show: { resource: ['payment'], operation } });

const STATUS_NAMES: Record<string, string> = {
	open: 'Open',
	pending: 'Pending',
	paid: 'Paid',
	held: 'Held',
	failed: 'Failed',
	expired: 'Expired',
};

export const paymentOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['payment'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a payment’s current status and settlement details',
				action: 'Get payment',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many payments, newest first',
				action: 'Get many payments',
			},
			{
				name: 'Simulate',
				value: 'simulate',
				description: 'Simulate how a Test payment ends, without moving money',
				action: 'Simulate payment outcome',
			},
		],
		default: 'get',
	},
];

export const paymentFields: INodeProperties[] = [
	{
		displayName: 'Payment ID',
		name: 'paymentId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. pay_7AAiYH0Ykt11ED4hmfiN',
		displayOptions: show(['get', 'simulate']),
	},

	// ---------- simulate ----------
	{
		displayName:
			'Simulating works only on Test payments (a key starting rb_test_), after the session has started. No money moves.',
		name: 'simulateNotice',
		type: 'notice',
		default: '',
		displayOptions: show(['simulate']),
	},
	{
		displayName: 'Outcome',
		name: 'outcome',
		type: 'options',
		required: true,
		default: 'paid',
		options: [
			{
				name: 'Declined',
				value: 'declined',
				description: 'The card was declined; the payment stays open for another try',
			},
			{ name: 'Failed', value: 'failed', description: 'The payment ends in a terminal failure' },
			{
				name: 'Paid',
				value: 'paid',
				description: 'The money arrives in full and passes every check',
			},
			{
				name: 'Underpaid',
				value: 'underpaid',
				description: 'Too little money arrives, so the payment is held for your decision',
			},
		],
		displayOptions: show(['simulate']),
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
		displayOptions: { show: { resource: ['payment'], operation: ['getAll'], returnAll: [false] } },
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
				displayName: 'Created After',
				name: 'createdAfter',
				type: 'dateTime',
				default: '',
				description:
					'Only payments created at or after this time. A time without a zone is read in the workflow’s time zone.',
			},
			{
				displayName: 'Created Before',
				name: 'createdBefore',
				type: 'dateTime',
				default: '',
				description:
					'Only payments created at or before this time. A time without a zone is read in the workflow’s time zone.',
			},
			{
				displayName: 'Reference',
				name: 'reference',
				type: 'string',
				default: '',
				description: 'Only payments with exactly this reference (your order ID)',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				default: 'paid',
				options: [...PAYMENT_STATUSES]
					.sort()
					.map((value) => ({ name: STATUS_NAMES[value], value })),
				description:
					'Only payments in this status. Only Paid means the money arrived and passed every check.',
			},
		],
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return a simplified version of the response instead of the raw data',
		displayOptions: show(['get', 'getAll']),
	},
];
