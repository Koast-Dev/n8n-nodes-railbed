import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { EVENT_TYPES, RAILBED_CREDENTIAL } from '../shared/constants';
import { pathId } from '../shared/inputs';
import { SIGNATURE_REFUSALS, verifyRailbedSignature } from '../shared/signature';
import {
	railbedApiRequest,
	railbedApiRequestAllItems,
	railbedErrorCode,
	railbedHttpStatus,
} from '../shared/transport';
import { looksLocal, readTriggerEvent, sameAddress, sameEvents } from './events';

/** What the trigger keeps between activations, in the workflow's static data. */
interface TriggerState extends IDataObject {
	endpointId?: string;
	secret?: string;
	mode?: string;
	url?: string;
	events?: string[];
}

const clearState = (state: TriggerState) => {
	delete state.endpointId;
	delete state.secret;
	delete state.mode;
	delete state.url;
	delete state.events;
};

// Errors are rethrown through `new NodeApiError(node, error)`, which hands back an error that already is one, so
// Railbed's code and status reach n8n unchanged.

/**
 * Removes one of this trigger's endpoints. One that's already gone (404) counts as removed, and so does a revoked key
 * (401 invalid_api_key): Railbed removes the endpoints a key added when the key is revoked.
 */
async function removeEndpoint(this: IHookFunctions, endpointId: string): Promise<void> {
	try {
		await railbedApiRequest.call(this, 'DELETE', `/webhook_endpoints/${pathId(endpointId)}`);
	} catch (error) {
		const status = railbedHttpStatus(error);
		if (status !== 404 && !(status === 401 && railbedErrorCode(error) === 'invalid_api_key'))
			throw new NodeApiError(this.getNode(), error as JsonObject);
		this.logger.info('Railbed Trigger: the webhook endpoint was already removed', { endpointId });
	}
}

/** POST /v1/webhook_endpoints for n8n's address; a Live key refusing a local address gets an error that says why. */
async function subscribe(this: IHookFunctions, body: IDataObject): Promise<IDataObject> {
	try {
		return await railbedApiRequest.call(this, 'POST', '/webhook_endpoints', { body });
	} catch (error) {
		const url = String(body.url);
		if (railbedErrorCode(error) === 'invalid_url' && looksLocal(url)) {
			throw new NodeApiError(
				this.getNode(),
				{ url },
				{
					message: 'Railbed can’t send events to this n8n address',
					description: `n8n’s webhook address is ${url}. Live keys need a public https:// address, and Railbed’s servers can’t reach your computer’s localhost. Set n8n’s N8N_WEBHOOK_URL (WEBHOOK_URL before n8n 2.35) to a public https address, for example through a tunnel, and try again.`,
					httpCode: '400',
				},
			);
		}
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/**
 * Starts a workflow on signed Railbed events. Turning the workflow on subscribes: it adds a webhook endpoint for
 * n8n's address through POST /v1/webhook_endpoints and keeps the endpoint's ID and signing secret in the workflow's
 * static data. Every delivery's Railbed-Signature is checked before anything runs; turning the workflow off removes
 * the endpoint.
 */
export class RailbedTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Railbed Trigger',
		name: 'railbedTrigger',
		icon: { light: 'file:../../icons/railbed.svg', dark: 'file:../../icons/railbed.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description:
			'Starts the workflow when a Railbed payment starts, is paid, needs your decision, expires or changes',
		defaults: { name: 'Railbed Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: RAILBED_CREDENTIAL, required: true }],
		webhooks: [
			{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' },
		],
		properties: [
			{
				displayName:
					'Railbed only sends Live events to public https:// addresses. While you build on your own computer, use a Test key, and give n8n a public address (its N8N_WEBHOOK_URL setting, WEBHOOK_URL before n8n 2.35, or a tunnel) so Railbed can reach it.',
				name: 'addressNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['payment.paid'],
				description: 'The events that start this workflow. Fulfil orders from Payment Paid only.',
				options: [...EVENT_TYPES].sort((a, b) => a.name.localeCompare(b.name)),
			},
			{
				// n8n keeps a trigger's static data only when the workflow is activated, not after each delivery, so the
				// trigger can't remember event IDs itself; n8n's Remove Duplicates node does, across executions.
				displayName:
					'Railbed may send an event more than once. To act on each event once, add a Remove Duplicates node after this trigger, choose Remove Items Processed in Previous Executions, and give it the event’s ID field.',
				name: 'repeatNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Include Current Payment',
						name: 'includeCurrentPayment',
						type: 'boolean',
						default: false,
						description:
							'Whether to read the payment from the Railbed API as well and add it as currentPayment. The API’s answer is always current, even when events arrive out of order.',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as TriggerState;
				if (!state.endpointId) return false;
				let endpoint: IDataObject;
				try {
					endpoint = await railbedApiRequest.call(
						this,
						'GET',
						`/webhook_endpoints/${pathId(state.endpointId)}`,
					);
				} catch (error) {
					// Removed in the dashboard, removed with a revoked key, or the credential now holds a key for the other
					// mode: subscribe again.
					if (railbedHttpStatus(error) === 404) {
						this.logger.info(
							'Railbed Trigger: the saved webhook endpoint no longer exists; subscribing again',
							{ endpointId: state.endpointId },
						);
						clearState(state);
						return false;
					}
					throw new NodeApiError(this.getNode(), error as JsonObject);
				}
				// Compared as Railbed stores addresses, so a host with capitals, :443 or an international name still matches.
				const address = sameAddress(endpoint.url, this.getNodeWebhookUrl('default'));
				const events = sameEvents(endpoint.events, this.getNodeParameter('events') as string[]);
				// A secret rolled in Developers is never returned to the trigger, so the one it holds stops working when the
				// 24-hour overlap ends. While the overlap lasts, a fresh endpoint (and secret) keeps deliveries verifiable;
				// the new endpoint has no rolled secret, so the next check reuses it.
				const rolled =
					endpoint.previous_secret_expires_at !== null &&
					endpoint.previous_secret_expires_at !== undefined;
				if (address && events && typeof state.secret === 'string' && !rolled) return true;
				this.logger.info('Railbed Trigger: replacing the webhook endpoint', {
					endpointId: state.endpointId,
					reason: !address
						? "n8n's address changed"
						: !events
							? 'the events changed'
							: rolled
								? 'its signing secret was rolled in Railbed'
								: 'no signing secret is saved',
				});
				// Replace the endpoint rather than leave a stale one behind (it would also block the same address).
				await removeEndpoint.call(this, state.endpointId);
				clearState(state);
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default');
				if (!url)
					throw new NodeOperationError(
						this.getNode(),
						'n8n has no webhook address for this trigger',
					);
				const events = this.getNodeParameter('events') as string[];
				const workflow = this.getWorkflow();
				const body: IDataObject = {
					url,
					events,
					description: `n8n: ${workflow.name ?? workflow.id ?? 'workflow'}`.slice(0, 80),
				};
				let endpoint: IDataObject;
				try {
					endpoint = await subscribe.call(this, body);
				} catch (error) {
					if (railbedErrorCode(error) !== 'duplicate_url')
						throw new NodeApiError(this.getNode(), error as JsonObject);
					// This exact address is already an endpoint, but the trigger has lost its ID and secret (n8n's static data
					// was reset, a listen for a test event starts with none, or n8n stopped mid-way). The secret can't be read
					// back, so remove that endpoint and subscribe once more. The address carries this node's own webhook ID,
					// so the endpoint can only be this trigger's.
					const existing = (
						await railbedApiRequestAllItems.call(this, '/webhook_endpoints', {}, null)
					).find((candidate) => sameAddress(candidate.url, url));
					if (!existing || typeof existing.id !== 'string')
						throw new NodeApiError(this.getNode(), error as JsonObject);
					this.logger.info(
						'Railbed Trigger: replacing an endpoint for this address whose signing secret was lost',
						{ endpointId: existing.id },
					);
					await removeEndpoint.call(this, existing.id);
					endpoint = await subscribe.call(this, body);
				}
				if (typeof endpoint.id !== 'string' || typeof endpoint.secret !== 'string') {
					throw new NodeOperationError(
						this.getNode(),
						'Railbed didn’t return a webhook endpoint with a signing secret',
					);
				}
				const state = this.getWorkflowStaticData('node') as TriggerState;
				state.endpointId = endpoint.id;
				state.secret = endpoint.secret;
				state.mode = typeof endpoint.mode === 'string' ? endpoint.mode : undefined;
				state.url = url;
				state.events = events;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as TriggerState;
				if (state.endpointId) await removeEndpoint.call(this, state.endpointId);
				clearState(state);
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const state = this.getWorkflowStaticData('node') as TriggerState;
		const refuse = (status: number, message: string): IWebhookResponseData => {
			res.status(status).json({ error: message });
			return { noWebhookResponse: true };
		};

		// The signature covers the exact bytes Railbed sent, so check those before reading anything.
		if (!req.rawBody) await req.readRawBody();
		const raw = req.rawBody;
		if (!raw) return refuse(400, 'The request had no body.');
		const check = verifyRailbedSignature(
			raw,
			this.getHeaderData()['railbed-signature'],
			state.secret,
		);
		if (!check.valid)
			return refuse(check.reason === 'no_secret' ? 409 : 400, SIGNATURE_REFUSALS[check.reason]);

		const read = readTriggerEvent(raw, state.mode);
		if ('refusal' in read) return refuse(400, read.refusal);
		const { event } = read;
		// Signed by this endpoint's secret, but not something this workflow runs on: acknowledge it and stop.
		if (read.skip) return { webhookResponse: { received: true, skipped: read.skip } };
		const wanted = this.getNodeParameter('events') as string[];
		if (!wanted.includes(event.type))
			return { webhookResponse: { received: true, skipped: 'event type not chosen' } };

		const options = this.getNodeParameter('options', {}) as IDataObject;

		const output: IDataObject = { ...event, sample: read.sample };
		if (options.includeCurrentPayment === true && read.paymentId && !read.sample) {
			// Throws on an API refusal, so the delivery fails and Railbed retries it later.
			output.currentPayment = await railbedApiRequest.call(
				this,
				'GET',
				`/payments/${pathId(read.paymentId)}`,
			);
		}
		return { workflowData: [this.helpers.returnJsonArray([output])] };
	}
}
