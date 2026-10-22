import type { IDisplayOptions, INodeCredentialDescription, INodeProperties } from 'n8n-workflow';

const GUID_REGEX = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

interface LocatorOptions {
	displayName: string;
	name: string;
	searchListMethod: string;
	description?: string;
	required?: boolean;
	displayOptions?: IDisplayOptions;
}

/** Resource locator for a Matrix42 object: pick from a searchable list or paste its ID. */
export function locatorField(options: LocatorOptions): INodeProperties {
	return {
		displayName: options.displayName,
		name: options.name,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: options.required,
		description: options.description,
		displayOptions: options.displayOptions,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: options.searchListMethod, searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: '00000000-0000-0000-0000-000000000000',
				validation: [{ type: 'regex', properties: { regex: GUID_REGEX, errorMessage: 'Not a valid ID (GUID)' } }],
			},
		],
	};
}

/** Ticket locator: from list, by object ID, or by ticket number (resolved at runtime). */
export function ticketField(displayOptions: IDisplayOptions, name = 'ticketId', displayName = 'Ticket'): INodeProperties {
	return {
		displayName,
		name,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The ticket to work on',
		displayOptions,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchTickets', searchable: true },
			},
			{
				displayName: 'By Ticket Number',
				name: 'ticketNumber',
				type: 'string',
				placeholder: 'INC00123',
			},
			{
				displayName: 'By Object ID',
				name: 'id',
				type: 'string',
				placeholder: '00000000-0000-0000-0000-000000000000',
				validation: [{ type: 'regex', properties: { regex: GUID_REGEX, errorMessage: 'Not a valid ID (GUID)' } }],
			},
		],
	};
}

export function returnAllFields(displayOptions: IDisplayOptions): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions,
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 50,
			description: 'Max number of results to return',
			displayOptions: {
				...displayOptions,
				show: { ...displayOptions.show, returnAll: [false] },
			},
		},
	];
}

export const queryOptionFields: INodeProperties[] = [
	{
		displayName: 'Additional Columns',
		name: 'columns',
		type: 'string',
		default: '',
		placeholder: 'ReminderDate, Recipient.LastName as RecipientLastName',
		description:
			'Comma-separated ASQL column expressions to return in addition to the default columns',
	},
	{
		displayName: 'Only Additional Columns',
		name: 'onlyAdditionalColumns',
		type: 'boolean',
		default: false,
		description: 'Whether to skip the default columns and return only the additional columns (plus ID)',
	},
	{
		displayName: 'Sort',
		name: 'sort',
		type: 'string',
		default: '',
		placeholder: 'CreatedDate DESC',
		description: 'ASQL sort expression, e.g. "CreatedDate DESC, TicketNumber ASC"',
	},
];

/** Multi-value ticket filters (categories, roles, users, priorities) shared by Get Many and the trigger. */
export const assignmentFilterFields: INodeProperties[] = [
	{
		displayName: 'Category Names or IDs',
		name: 'categories',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getCategories' },
		default: [],
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Only tickets in one of these categories',
	},
	{
		displayName: 'Include Subcategories',
		name: 'includeSubcategories',
		type: 'boolean',
		default: true,
		description: 'Whether tickets in subcategories of the selected categories match too',
	},
	{
		displayName: 'Priority Names or IDs',
		name: 'priorities',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getPriorities' },
		default: [],
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Only tickets with one of these priorities',
	},
	{
		displayName: 'Responsible Role Names or IDs',
		name: 'responsibleRoles',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getRoles' },
		default: [],
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Only tickets assigned to one of these roles',
	},
	{
		displayName: 'Asset IDs',
		name: 'assets',
		type: 'string',
		typeOptions: { multipleValues: true },
		default: [],
		placeholder: '00000000-0000-0000-0000-000000000000',
		description: 'Only tickets whose reported or affected asset is one of these (asset ID or object ID, see the Asset resource)',
	},
	{
		displayName: 'Configuration Item Object IDs',
		name: 'configurationItems',
		type: 'string',
		typeOptions: { multipleValues: true },
		default: [],
		placeholder: '00000000-0000-0000-0000-000000000000',
		description: 'Only tickets linked to at least one of these configuration items (object IDs of any kind of object)',
	},
	{
		displayName: 'Cost Center Names or IDs',
		name: 'costCenters',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getCostCenters' },
		default: [],
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Only tickets of one of these cost centers',
	},
	{
		displayName: 'Include Sub-Locations',
		name: 'includeSubLocations',
		type: 'boolean',
		default: true,
		description: 'Whether locations below the selected locations match too',
	},
	{
		displayName: 'Include Sub-Org-Units',
		name: 'includeSubOrgUnits',
		type: 'boolean',
		default: true,
		description: 'Whether organizational units below the selected ones match too',
	},
	{
		displayName: 'Location Names or IDs',
		name: 'locations',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getLocations' },
		default: [],
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Only tickets of one of these locations',
	},
	{
		displayName: 'Organizational Unit Names or IDs',
		name: 'orgUnits',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getOrgUnits' },
		default: [],
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Only tickets of one of these organizational units',
	},
	{
		displayName: 'Responsible User IDs',
		name: 'responsibleUsers',
		type: 'string',
		typeOptions: { multipleValues: true },
		default: [],
		placeholder: '00000000-0000-0000-0000-000000000000',
		description: 'Only tickets assigned to one of these users (user IDs, see the User resource)',
	},
	{
		displayName: 'Service Names or IDs',
		name: 'services',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getServices' },
		default: [],
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Only tickets whose reported or affected service is one of these',
	},
];

export const authenticationProperty: INodeProperties = {
	displayName: 'Authentication',
	name: 'authentication',
	type: 'options',
	options: [
		{ name: 'API Token', value: 'apiToken' },
		{ name: 'Basic Auth', value: 'basicAuth' },
	],
	default: 'apiToken',
};

export const matrix42Credentials: INodeCredentialDescription[] = [
	{ name: 'matrix42EsmApi', required: true, displayOptions: { show: { authentication: ['apiToken'] } } },
	{ name: 'matrix42EsmBasicApi', required: true, displayOptions: { show: { authentication: ['basicAuth'] } } },
];
