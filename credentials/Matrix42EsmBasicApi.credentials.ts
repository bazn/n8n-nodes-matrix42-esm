import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class Matrix42EsmBasicApi implements ICredentialType {
	name = 'matrix42EsmBasicApi';

	displayName = 'Matrix42 ESM Basic Auth API';

	icon = {
		light: 'file:../nodes/Matrix42/matrix42.svg',
		dark: 'file:../nodes/Matrix42/matrix42.dark.svg',
	} as const;

	documentationUrl = 'https://www.npmjs.com/package/@bazulu1/n8n-nodes-matrix42-esm#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Matrix42 URL',
			name: 'url',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://m42.example.com',
			description: 'Base URL of your Matrix42 Enterprise Service Management instance',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'DOMAIN\\user',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
		{
			displayName: 'Language',
			name: 'language',
			type: 'string',
			default: 'de-DE',
			description: 'Culture used for localized values such as picklist display names (e.g. de-DE, en-US)',
		},
		{
			displayName: 'Ignore SSL Issues (Insecure)',
			name: 'ignoreSslIssues',
			type: 'boolean',
			default: false,
			description:
				'Whether to connect even if the TLS certificate cannot be validated, e.g. a self-signed certificate. Only use this for test systems.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			auth: {
				username: '={{$credentials.username}}',
				password: '={{$credentials.password}}',
			},
			headers: {
				'Explicit-Language': '={{$credentials.language}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{ (/^https?:\\/\\//i.test($credentials.url.trim()) ? $credentials.url.trim() : "https://" + $credentials.url.trim()).replace(/\\/+$/, "") }}',
			url: '/m42Services/api/data/fragments/SPSScCategoryClassBase',
			qs: { Columns: 'ID', PageSize: 1 },
			skipSslCertificateValidation: '={{$credentials.ignoreSslIssues}}',
		},
	};
}
