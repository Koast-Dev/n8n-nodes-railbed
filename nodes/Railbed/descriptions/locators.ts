import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';
import {
	idPattern,
	linkExtract,
	linkPattern,
	type RecordKind,
	RECORDS,
} from '../../shared/records';

/** The list method (Railbed.methods.listSearch) behind each kind of record. */
const LIST_METHOD: Record<RecordKind, string> = {
	payment: 'searchPayments',
	session: 'searchCheckoutSessions',
	order: 'searchOrders',
	customer: 'searchCustomers',
	endpoint: 'searchWebhookEndpoints',
};

/** What a person can paste for By URL, in the field's tooltip. */
const LINKS: Record<RecordKind, string> = {
	payment: 'a payment’s link from Payments in the Railbed dashboard, or its checkout link',
	session: 'its checkout link, or the payment’s link from Payments in the Railbed dashboard',
	order: 'an order’s link from Orders in the Railbed dashboard',
	customer: 'a customer’s link from Customers in the Railbed dashboard',
	endpoint: 'a webhook endpoint’s link from Developers in the Railbed dashboard',
};

/**
 * A record field as n8n's resource locator (UX guidelines: "Use a Resource Locator component whenever possible",
 * From List first). From List searches the key's own records; By ID checks the prefix; By URL takes the ID out of a
 * dashboard or checkout link. An AI Agent fills it with $fromAI in any mode, since expressions skip the checks and
 * From List extracts nothing.
 */
export function recordLocator(
	kind: RecordKind,
	field: {
		name: string;
		displayName: string;
		description: string;
		displayOptions?: IDisplayOptions;
		required?: boolean;
	},
): INodeProperties {
	const record = RECORDS[kind];
	return {
		displayName: field.displayName,
		name: field.name,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: field.required ?? true,
		description: `${field.description} Choose it from the list, enter its ID (${record.prefix}…) or paste ${LINKS[kind]}. The list shows the credential’s mode only: Test keys find Test records, Live keys Live ones.`,
		...(field.displayOptions ? { displayOptions: field.displayOptions } : {}),
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: `Select ${record.aNoun}…`,
				typeOptions: { searchListMethod: LIST_METHOD[kind], searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: `e.g. ${record.example}`,
				validation: [
					{
						type: 'regex',
						properties: {
							regex: idPattern(kind),
							errorMessage: `Enter ${record.aNoun} ID: it starts with ${record.prefix}, such as ${record.example}`,
						},
					},
				],
			},
			{
				displayName: 'By URL',
				name: 'url',
				type: 'string',
				placeholder: `e.g. ${record.exampleUrl}`,
				validation: [
					{
						type: 'regex',
						properties: {
							regex: linkPattern(kind),
							errorMessage: `Paste ${LINKS[kind]}, such as ${record.exampleUrl}`,
						},
					},
				],
				extractValue: { type: 'regex', regex: linkExtract(kind) },
			},
		],
	};
}
