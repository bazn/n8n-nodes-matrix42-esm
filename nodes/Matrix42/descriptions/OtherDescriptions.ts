import type { INodeProperties } from 'n8n-workflow';

import { locatorField, queryOptionFields, returnAllFields, ticketField } from './shared';

// ---------------------------------------------------------------- Journal

export const journalDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['journal'] } },
		options: [
			{ name: 'Add', value: 'add', action: 'Add a journal entry', description: 'Add a journal entry to a ticket' },
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many journal entries',
				description: 'Get the journal entries of a ticket',
			},
		],
		default: 'add',
	},
	ticketField({ show: { resource: ['journal'] } }),
	{
		displayName: 'Comments',
		name: 'comments',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: { show: { resource: ['journal'], operation: ['add'] } },
	},
	{
		displayName: 'Options',
		name: 'journalOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['journal'], operation: ['add'] } },
		options: [
			{
				displayName: 'Entry Type',
				name: 'entryType',
				type: 'number',
				default: 0,
				description: 'Numeric journal entry type as defined in Matrix42',
			},
			{
				displayName: 'Publish',
				name: 'publish',
				type: 'boolean',
				default: false,
				description: 'Whether the entry is published (e.g. sent by mail to the initiator)',
			},
			{
				displayName: 'Visible in Portal',
				name: 'visibleInPortal',
				type: 'boolean',
				default: false,
				description: 'Whether the entry is visible to the initiator in the Self Service Portal',
			},
		],
	},
	...returnAllFields({ show: { resource: ['journal'], operation: ['getAll'] } }),
];

// ---------------------------------------------------------------- Asset

export const assetDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['asset'] } },
		options: [
			{ name: 'Get', value: 'get', action: 'Get an asset', description: 'Get an asset' },
			{ name: 'Get Many', value: 'getAll', action: 'Get many assets', description: 'Get many assets' },
		],
		default: 'getAll',
	},
	locatorField({
		displayName: 'Asset',
		name: 'assetId',
		searchListMethod: 'searchAssets',
		required: true,
		displayOptions: { show: { resource: ['asset'], operation: ['get'] } },
	}),
	{
		displayName: 'Full Object',
		name: 'fullObject',
		type: 'boolean',
		default: false,
		description:
			'Whether to return the complete configuration item with all data definitions (e.g. computer, inventory data) instead of only the asset fields',
		displayOptions: { show: { resource: ['asset'], operation: ['get'] } },
	},
	...returnAllFields({ show: { resource: ['asset'], operation: ['getAll'] } }),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['asset'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Custom Where (ASQL)',
				name: 'where',
				type: 'string',
				default: '',
				placeholder: "ManufacturerName = 'Dell'",
				description: 'Additional ASQL condition, combined with the other filters using AND',
			},
			{
				displayName: 'Search Term',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Matches computer name, serial number or inventory number',
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['asset'], operation: ['getAll'] } },
		options: queryOptionFields,
	},
];

// ---------------------------------------------------------------- Object (generic data)

const classField: INodeProperties = {
	displayName: 'Data Definition',
	name: 'className',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'Matrix42 data definition (class), e.g. SPSUserClassBase',
	displayOptions: { show: { resource: ['object'], operation: ['get', 'getAll', 'create', 'update', 'delete'] } },
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchClasses', searchable: true },
		},
		{ displayName: 'Name', name: 'name', type: 'string', placeholder: 'SPSUserClassBase' },
	],
};

export const objectDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['object'] } },
		options: [
			{ name: 'Create', value: 'create', action: 'Create an object', description: 'Create a data fragment' },
			{
				name: 'Create Full Object',
				value: 'createObject',
				action: 'Create a full configuration item',
				description: 'Create a configuration item with values for one or more data definitions',
			},
			{ name: 'Delete', value: 'delete', action: 'Delete a data fragment', description: 'Delete a data fragment' },
			{
				name: 'Delete Full Object',
				value: 'deleteObject',
				action: 'Delete a full configuration item',
				description: 'Delete a configuration item with all of its data',
			},
			{ name: 'Get', value: 'get', action: 'Get an object', description: 'Get a data fragment by ID' },
			{
				name: 'Get Full Object',
				value: 'getFull',
				action: 'Get a full configuration item',
				description: 'Get a complete configuration item by type and object ID',
			},
			{ name: 'Get Many', value: 'getAll', action: 'Get many objects', description: 'Query data fragments with ASQL' },
			{ name: 'Update', value: 'update', action: 'Update an object', description: 'Update a data fragment' },
			{
				name: 'Update Full Object',
				value: 'updateObject',
				action: 'Update a full configuration item',
				description: 'Update values of one or more data definitions of a configuration item',
			},
		],
		default: 'getAll',
	},
	classField,
	{
		displayName: 'Fragment ID',
		name: 'fragmentId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['object'], operation: ['get', 'update', 'delete'] } },
	},
	{
		displayName: 'Fields (JSON)',
		name: 'fields',
		type: 'json',
		required: true,
		default: '{}',
		description: 'Attribute values of the fragment, e.g. {"Name": "Example"}',
		displayOptions: { show: { resource: ['object'], operation: ['create', 'update'] } },
	},
	{
		displayName: 'Configuration Item Type',
		name: 'ciName',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The configuration item type, e.g. SPSComputerType or SPSLocationType',
		displayOptions: {
			show: { resource: ['object'], operation: ['getFull', 'createObject', 'updateObject', 'deleteObject'] },
		},
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchTypes', searchable: true },
			},
			{ displayName: 'Name', name: 'name', type: 'string', placeholder: 'SPSComputerType' },
		],
	},
	{
		displayName: 'Data (JSON)',
		name: 'objectData',
		type: 'json',
		required: true,
		default: '{\n  "SPSLocationClassBase": {\n    "Name": "Example"\n  }\n}',
		description: 'Values per data definition: {"DataDefinition": {"Attribute": value, …}, …}',
		displayOptions: { show: { resource: ['object'], operation: ['createObject', 'updateObject'] } },
	},
	{
		displayName: 'Object ID',
		name: 'objectId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['object'], operation: ['getFull', 'updateObject', 'deleteObject'] } },
	},
	...returnAllFields({ show: { resource: ['object'], operation: ['getAll'] } }),
	{
		displayName: 'Columns',
		name: 'columns',
		type: 'string',
		default: '',
		placeholder: 'Name, LastName, MailAddress',
		description: 'Comma-separated ASQL column expressions. ID is always included.',
		displayOptions: { show: { resource: ['object'], operation: ['getAll'] } },
	},
	{
		displayName: 'Where (ASQL)',
		name: 'where',
		type: 'string',
		default: '',
		placeholder: "LastName LIKE 'M%'",
		displayOptions: { show: { resource: ['object'], operation: ['getAll'] } },
	},
	{
		displayName: 'Sort',
		name: 'sort',
		type: 'string',
		default: '',
		placeholder: 'LastName ASC',
		displayOptions: { show: { resource: ['object'], operation: ['getAll'] } },
	},
];
