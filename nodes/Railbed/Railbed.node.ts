import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { RAILBED_CREDENTIAL } from '../shared/constants';
import {
	compact,
	jsonObject,
	metadataFromRows,
	moneyText,
	simplifyCustomer,
	simplifyOrder,
	simplifyPayment,
	simplifySession,
	toUnixSeconds,
} from '../shared/inputs';
import { checkRecordId, type RecordKind } from '../shared/records';
import { errorItem, railbedApiRequest, railbedApiRequestAllItems } from '../shared/transport';
import { checkoutSessionFields, checkoutSessionOperations } from './descriptions/checkoutSession';
import { customerFields, customerOperations } from './descriptions/customer';
import { orderFields, orderOperations } from './descriptions/order';
import { paymentFields, paymentOperations } from './descriptions/payment';
import { webhookEndpointFields, webhookEndpointOperations } from './descriptions/webhookEndpoint';
import {
	searchCheckoutSessions,
	searchCustomers,
	searchOrders,
	searchPayments,
	searchWebhookEndpoints,
} from './listSearch';

/**
 * Railbed's merchant API (/v1) as n8n operations. Programmatic rather than declarative because lists page with
 * Railbed's cursor (next_cursor → starting_after) until a limit, creates carry an optional Idempotency-Key header,
 * and Railbed's error body (code, message, field) is turned into an error that says what to do next.
 */
export class Railbed implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Railbed',
		name: 'railbed',
		icon: { light: 'file:../../icons/railbed.svg', dark: 'file:../../icons/railbed.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create checkout sessions and look up payments, orders and customers in Railbed',
		defaults: { name: 'Railbed' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: RAILBED_CREDENTIAL, required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Checkout Session', value: 'checkoutSession' },
					{ name: 'Customer', value: 'customer' },
					{ name: 'Order', value: 'order' },
					{ name: 'Payment', value: 'payment' },
					{ name: 'Webhook Endpoint', value: 'webhookEndpoint' },
				],
				default: 'checkoutSession',
			},
			...checkoutSessionOperations,
			...checkoutSessionFields,
			...paymentOperations,
			...paymentFields,
			...orderOperations,
			...orderFields,
			...customerOperations,
			...customerFields,
			...webhookEndpointOperations,
			...webhookEndpointFields,
		],
	};

	methods = {
		listSearch: {
			searchCheckoutSessions,
			searchCustomers,
			searchOrders,
			searchPayments,
			searchWebhookEndpoints,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const results = await runOperation.call(this, resource, operation, i);
				for (const json of results) returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					// Railbed's code, the HTTP status and the next step too, so a later node can branch on `code`.
					returnData.push({ json: errorItem(error), pairedItem: { item: i } });
					continue;
				}
				// Railbed's refusals are already NodeApiErrors (passed through unchanged); anything else gets the item's context.
				if (error instanceof NodeApiError)
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject);
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

/** A money field as decimal text, or an error naming the field when a mapped number has more than two decimals. */
function money(this: IExecuteFunctions, value: unknown, label: string, i: number): string {
	const amount = moneyText(value);
	if ('problem' in amount) {
		throw new NodeOperationError(this.getNode(), `${label} ${amount.problem}`, {
			itemIndex: i,
			description:
				'Railbed takes amounts with at most two decimals, such as 49.90. Round the amount in an earlier step, or send it as text.',
		});
	}
	return amount.text;
}

/**
 * A record field's ID, ready for a URL path. The field is a resource locator: n8n's extractValue takes the ID out of a
 * pasted link (By URL), and From List and By ID hold it as it is. An empty field or a value that isn't this kind of ID
 * stops here with a message naming the field, before Railbed is asked.
 */
function recordId(
	this: IExecuteFunctions,
	name: string,
	kind: RecordKind,
	field: string,
	i: number,
	value: unknown = this.getNodeParameter(name, i, '', { extractValue: true }),
): string {
	const checked = checkRecordId(value, kind, field);
	if ('id' in checked) return checked.id;
	throw new NodeOperationError(this.getNode(), checked.message, {
		itemIndex: i,
		description: checked.description,
	});
}

/** Runs one resource and operation for item `i`; every result becomes an output item. */
async function runOperation(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<IDataObject[]> {
	const simplified = (shape: (o: IDataObject) => IDataObject, objects: IDataObject[]) =>
		(this.getNodeParameter('simplify', i, true) as boolean) ? objects.map(shape) : objects;
	const many = async (path: string, qs: IDataObject) => {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? null : (this.getNodeParameter('limit', i) as number);
		return railbedApiRequestAllItems.call(this, path, compact(qs), limit, i);
	};

	if (resource === 'checkoutSession') {
		if (operation === 'create') {
			const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
			const order = jsonObject(extra.order);
			if (order && 'problem' in order) {
				throw new NodeOperationError(this.getNode(), `Order (JSON) ${order.problem}`, {
					itemIndex: i,
					description:
						'Enter the order as a JSON object, for example {"id": "1042", "items": [{"name": "Mug", "quantity": 1, "amount": "18.00"}]}.',
				});
			}
			const collect = jsonObject(extra.collect);
			if (collect && 'problem' in collect) {
				throw new NodeOperationError(
					this.getNode(),
					`Ask the Buyer For (JSON) ${collect.problem}`,
					{
						itemIndex: i,
						description:
							'Enter it as a JSON object, for example {"name": "required", "shipping_address": "required"}.',
					},
				);
			}
			const customer = compact({
				name: extra.customerName as string,
				phone: extra.customerPhone as string,
				date_of_birth:
					typeof extra.customerDateOfBirth === 'string'
						? extra.customerDateOfBirth.trim()
						: undefined,
				// Only "yes" is sent: Railbed treats false and absent alike, and an empty customer stays out of the request.
				accepts_marketing: extra.customerAcceptsMarketing === true ? true : undefined,
				id: extra.storeCustomerId as string,
			});
			const body = compact({
				amount: money.call(this, this.getNodeParameter('amount', i), 'Amount', i),
				currency: this.getNodeParameter('currency', i) as string,
				description: this.getNodeParameter('description', i) as string,
				customer_email: extra.customerEmail as string,
				reference: extra.reference as string,
				success_url: extra.successUrl as string,
				cancel_url: extra.cancelUrl as string,
				metadata: metadataFromRows((extra.metadata as IDataObject | undefined)?.entry),
				customer: Object.keys(customer).length ? customer : undefined,
				order: order?.value,
				collect: collect?.value,
			});
			const key = typeof extra.idempotencyKey === 'string' ? extra.idempotencyKey.trim() : '';
			const session = await railbedApiRequest.call(this, 'POST', '/checkout_sessions', {
				body,
				headers: key ? { 'Idempotency-Key': key } : undefined,
				itemIndex: i,
			});
			return simplified(simplifySession, [session]);
		}
		const sessionId = recordId.call(this, 'sessionId', 'session', 'Checkout Session', i);
		if (operation === 'get') {
			return simplified(simplifySession, [
				await railbedApiRequest.call(this, 'GET', `/checkout_sessions/${sessionId}`, {
					itemIndex: i,
				}),
			]);
		}
		if (operation === 'start') {
			const extra = this.getNodeParameter('startFields', i, {}) as IDataObject;
			const body = compact({
				customer_email: extra.customerEmail as string,
				country: typeof extra.country === 'string' ? extra.country.trim().toUpperCase() : undefined,
			});
			return [
				await railbedApiRequest.call(this, 'POST', `/checkout_sessions/${sessionId}/start`, {
					body,
					itemIndex: i,
				}),
			];
		}
	}

	if (resource === 'payment') {
		if (operation === 'getAll') {
			const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
			const payments = await many('/payments', {
				status: filters.status as string,
				reference: filters.reference as string,
				// A date picked without a zone means that time in the workflow's time zone.
				created_gte: toUnixSeconds(filters.createdAfter, this.getTimezone()),
				created_lte: toUnixSeconds(filters.createdBefore, this.getTimezone()),
			});
			return simplified(simplifyPayment, payments);
		}
		const paymentId = recordId.call(this, 'paymentId', 'payment', 'Payment', i);
		if (operation === 'get') {
			return simplified(simplifyPayment, [
				await railbedApiRequest.call(this, 'GET', `/payments/${paymentId}`, { itemIndex: i }),
			]);
		}
		if (operation === 'simulate') {
			const outcome = this.getNodeParameter('outcome', i) as string;
			return [
				await railbedApiRequest.call(this, 'POST', `/payments/${paymentId}/simulate`, {
					body: { outcome },
					itemIndex: i,
				}),
			];
		}
	}

	if (resource === 'order') {
		if (operation === 'getAll') {
			const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
			const customer = this.getNodeParameter('filters.customerId', i, '', { extractValue: true });
			const orders = await many('/orders', {
				// A Customer filter added but left empty lists every order, as before it was added.
				customer_id:
					customer === '' || customer === null || customer === undefined
						? undefined
						: recordId.call(this, 'filters.customerId', 'customer', 'Customer', i, customer),
				store_id: filters.storeId as string,
				store_order_id: filters.storeOrderId as string,
			});
			return simplified(simplifyOrder, orders);
		}
		const orderId = recordId.call(this, 'orderId', 'order', 'Order', i);
		if (operation === 'get') {
			return simplified(simplifyOrder, [
				await railbedApiRequest.call(this, 'GET', `/orders/${orderId}`, { itemIndex: i }),
			]);
		}
		if (operation === 'update') {
			const fulfillment = this.getNodeParameter('fulfillment', i) as string;
			return simplified(simplifyOrder, [
				await railbedApiRequest.call(this, 'PATCH', `/orders/${orderId}`, {
					body: { fulfillment },
					itemIndex: i,
				}),
			]);
		}
		if (operation === 'recordEvent') {
			const type = this.getNodeParameter('eventType', i) as string;
			const amount =
				type === 'refunded'
					? money.call(this, this.getNodeParameter('amount', i, ''), 'Refunded Amount', i)
					: '';
			const body = compact({
				type,
				id: String(this.getNodeParameter('storeEventId', i)).trim(),
				amount: amount || undefined,
			});
			return [
				await railbedApiRequest.call(this, 'POST', `/orders/${orderId}/events`, {
					body,
					itemIndex: i,
				}),
			];
		}
	}

	if (resource === 'customer') {
		if (operation === 'getAll') {
			const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
			return simplified(
				simplifyCustomer,
				await many('/customers', { email: filters.email as string }),
			);
		}
		if (operation === 'get') {
			const customerId = recordId.call(this, 'customerId', 'customer', 'Customer', i);
			return simplified(simplifyCustomer, [
				await railbedApiRequest.call(this, 'GET', `/customers/${customerId}`, { itemIndex: i }),
			]);
		}
	}

	if (resource === 'webhookEndpoint') {
		if (operation === 'getAll') return many('/webhook_endpoints', {});
		if (operation === 'create') {
			const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
			const body = compact({
				url: String(this.getNodeParameter('url', i)).trim(),
				events: this.getNodeParameter('events', i) as string[],
				description: extra.description as string,
			});
			return [
				await railbedApiRequest.call(this, 'POST', '/webhook_endpoints', { body, itemIndex: i }),
			];
		}
		const endpointId = recordId.call(this, 'endpointId', 'endpoint', 'Webhook Endpoint', i);
		if (operation === 'get')
			return [
				await railbedApiRequest.call(this, 'GET', `/webhook_endpoints/${endpointId}`, {
					itemIndex: i,
				}),
			];
		if (operation === 'delete')
			return [
				await railbedApiRequest.call(this, 'DELETE', `/webhook_endpoints/${endpointId}`, {
					itemIndex: i,
				}),
			];
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation "${operation}" isn’t available for "${resource}"`,
		{ itemIndex: i },
	);
}
