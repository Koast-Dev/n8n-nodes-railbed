import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class RailbedApi implements ICredentialType {
	name = 'railbedApi';

	displayName = 'Railbed API';

	icon: Icon = { light: 'file:../icons/railbed.svg', dark: 'file:../icons/railbed.dark.svg' };

	documentationUrl = 'https://railbed.com/docs/guides/n8n/#connect-your-railbed-account';

	properties: INodeProperties[] = [
		{
			displayName: 'Secret Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'e.g. rb_test_…',
			description:
				'A secret key from Developers in the Railbed dashboard. Keys starting rb_test_ work only on Test data and rb_live_ only on Live data, so make one credential for each mode. Use a key with Full access to create sessions and subscribe the trigger.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://pay.railbed.io',
			description:
				'Where Railbed’s API lives. Leave it as it is unless you are testing against your own Railbed server. It must start with https://; plain http works only for localhost.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			// The nodes' rules (apiRoot in nodes/shared/transport.ts): only the address's origin counts, so a pasted ".../v1"
			// still works, and plain http only for this machine. Any other http address is swapped for a host that can't
			// exist (.invalid never resolves), so the test fails and the key is never sent unencrypted.
			baseURL:
				'={{ (function (raw) { const m = /^(https?):\\/\\/([^\\/?#\\s]+)/i.exec(raw); const local = !!m && /^(localhost|127\\.0\\.0\\.1|\\[::1\\])(:\\d+)?$/i.test(m[2]); return m && (m[1].toLowerCase() === "https" || local) ? m[1].toLowerCase() + "://" + m[2] : "https://base-url-must-start-with-https.invalid"; })(String($credentials.baseUrl || "https://pay.railbed.io").trim()) }}/v1',
			url: '/payments',
			method: 'GET',
			qs: { limit: 1 },
		},
	};
}
