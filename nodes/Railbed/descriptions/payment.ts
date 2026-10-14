import type { INodeProperties } from 'n8n-workflow';
import { PAYMENT_STATUSES } from '../../shared/constants';
import { recordLocator } from './locators';

const show = (operation: string[]) => ({ show: { resource: ['payment'], operation } });

/** Each status in the dashboard's words (Payments' filters), with what it means for a workflow. */
const STATUS_OPTIONS: Record<
	(typeof PAYMENT_STATUSES)[number],
	{ name: string; description: string }
> = {
	open: { name: 'Open', description: 'Waiting for the buyer to go on and pay' },
	pending: {
		name: 'In Progress',
		description: 'The buyer went on to pay, and the money hasn’t arrived yet',
	},
	paid: {
		name: 'Paid',
		description: 'The money arrived and passed every check. Fulfil orders only on these.',
	},
	held: {
		name: 'Needs Your Decision',
		description:
			'Money arrived but didn’t pass a check, so it isn’t paid until you decide in the dashboard',
	},
	failed: {
		name: 'Failed',
		description:
			'Ended without being paid (the dashboard shows Declined). Today only Test mode’s Simulate (Failed) does this.',
	},
	expired: {
		name: 'Expired',
		description: 'Nobody paid in time, or you canceled the payment link',
	},
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
				description: 'Retrieve a payment with its current status and what arrived',
				action: 'Get payment',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve a list of payments, newest first, by status, reference or date',
				action: 'Get many payments',
			},
			{
				name: 'Simulate',
				value: 'simulate',
				description: 'Choose how a Test payment ends, to try a workflow without moving money',
				action: 'Simulate payment outcome',
			},
		],
		default: 'get',
	},
];

export const paymentFields: INodeProperties[] = [
	recordLocator('payment', {
		name: 'paymentId',
		displayName: 'Payment',
		description: 'The payment to look up.',
		displayOptions: show(['get']),
	}),
	recordLocator('payment', {
		name: 'paymentId',
		displayName: 'Payment',
		description: 'The Test payment to end. Start its checkout session first.',
		displayOptions: show(['simulate']),
	}),

	// ---------- simulate ----------
	{
		displayName:
			'Simulate works only with a Test key (rb_test_…) and a payment whose checkout session has started. No money moves, and your Test webhooks and Railbed Trigger receive the same events a real payment sends.',
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
				description:
					'The buyer’s card is declined. The payment stays open so they can try another way to pay, and no event is sent.',
			},
			{
				name: 'Failed',
				value: 'failed',
				description: 'The payment can’t be completed and ends unpaid. Sends Payment Failed.',
			},
			{
				name: 'Paid',
				value: 'paid',
				description: 'The money arrives and passes every check. Sends Payment Paid.',
			},
			{
				name: 'Underpaid',
				value: 'underpaid',
				description:
					'Half the amount arrives, so the payment needs your decision in the dashboard. Sends Payment Needs Your Decision.',
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
				placeholder: 'e.g. order_1042',
				description:
					'Only payments with exactly this reference, the order ID you sent when creating the checkout session',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				default: 'paid',
				options: PAYMENT_STATUSES.map((value) => ({ value, ...STATUS_OPTIONS[value] })).sort(
					(a, b) => a.name.localeCompare(b.name),
				),
				description:
					'Only payments with this status, as the dashboard shows it. Only Paid means the money arrived and passed every check.',
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
