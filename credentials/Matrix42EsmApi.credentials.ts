import type {
	IAuthenticateGeneric,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IDataObject,
	IHttpRequestHelper,
	INodeProperties,
} from 'n8n-workflow';

function normalizeUrl(url: string): string {
	const trimmed = url.trim().replace(/\/+$/, '');
	return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export class Matrix42EsmApi implements ICredentialType {
	name = 'matrix42EsmApi';

	displayName = 'Matrix42 ESM API';

	icon = {
		light: 'file:../nodes/Matrix42/matrix42.svg',
		dark: 'file:../nodes/Matrix42/matrix42.dark.svg',
	} as const;

	documentationUrl = 'https://help.matrix42.com/030_DWP/030_INT/Business_Processes_and_API_Integrations/Public_API_reference_documentation';

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
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'API token generated in Matrix42 (Administration → Integration → API Tokens). It is exchanged for a short-lived access token automatically.',
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
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'hidden',
			typeOptions: { expirable: true, password: true },
			default: '',
		},
	];

	async preAuthentication(this: IHttpRequestHelper, credentials: ICredentialDataDecryptedObject) {
		const response = (await this.helpers.httpRequest({
			method: 'POST',
			url: `${normalizeUrl(credentials.url as string)}/m42Services/api/ApiToken/GenerateAccessTokenFromApiToken`,
			headers: {
				Authorization: `Bearer ${credentials.apiToken as string}`,
				Accept: 'application/json',
			},
			json: true,
			skipSslCertificateValidation: credentials.ignoreSslIssues === true,
		})) as IDataObject;

		return { accessToken: response.RawToken as string };
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.accessToken}}',
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
