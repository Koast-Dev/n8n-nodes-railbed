import type { INodeProperties } from 'n8n-workflow';
import { recordLocator } from './locators';

const show = (operation: string[]) => ({ show: { resource: ['customer'], operation } });

export const customerOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['customer'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve a customer with their contact details, addresses and totals',
				action: 'Get customer',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve a list of customers, newest first, or find one by email',
				action: 'Get many customers',
			},
		],
		default: 'get',
	},
];

export const customerFields: INodeProperties[] = [
	recordLocator('customer', {
		name: 'customerId',
		displayName: 'Customer',
		description:
			'The customer. In a workflow, map it from an order’s customer_id or a Railbed Trigger event’s data.customer.id.',
		displayOptions: show(['get']),
	}),
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
		displayOptions: { show: { resource: ['customer'], operation: ['getAll'], returnAll: [false] } },
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
				displayName: 'Email',
				name: 'email',
				type: 'string',
				default: '',
				placeholder: 'e.g. nathan@example.com',
				description: 'Only the customer with exactly this email, in any letter case',
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
