import type { INodeProperties } from 'n8n-workflow';
import { EVENT_TYPES } from '../../shared/constants';

const show = (operation: string[]) => ({ show: { resource: ['webhookEndpoint'], operation } });

export const webhookEndpointOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['webhookEndpoint'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Add an address that receives Railbed events, and get its signing secret',
				action: 'Create webhook endpoint',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Remove a webhook endpoint so it stops receiving events',
				action: 'Delete webhook endpoint',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a webhook endpoint by ID',
				action: 'Get webhook endpoint',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get the webhook endpoints in the key’s mode',
				action: 'Get many webhook endpoints',
			},
		],
		default: 'getAll',
	},
];

export const webhookEndpointFields: INodeProperties[] = [
	{
		displayName:
			'To start a workflow from Railbed events, use the Railbed Trigger node instead: it adds and removes its own endpoint. The signing secret appears in this node’s output once, and n8n saves output with each execution.',
		name: 'createNotice',
		type: 'notice',
		default: '',
		displayOptions: show(['create']),
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://example.com/webhooks/railbed',
		description: 'Where Railbed sends events. Live endpoints must be public https:// addresses.',
		displayOptions: show(['create']),
	},
	{
		displayName: 'Events',
		name: 'events',
		type: 'multiOptions',
		required: true,
		default: ['payment.paid'],
		options: [...EVENT_TYPES].sort((a, b) => a.name.localeCompare(b.name)),
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
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				placeholder: 'e.g. Fulfilment server',
				description: 'A label shown on the endpoint in Developers. Up to 80 characters.',
			},
		],
	},
	{
		displayName: 'Endpoint ID',
		name: 'endpointId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. we_N8nQ4vRx7KtZ2mLp9WcB',
		displayOptions: show(['get', 'delete']),
	},
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
		displayOptions: {
			show: { resource: ['webhookEndpoint'], operation: ['getAll'], returnAll: [false] },
		},
	},
];
