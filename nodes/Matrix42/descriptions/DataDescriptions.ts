import type { INodeProperties } from 'n8n-workflow';

import { returnAllFields } from './shared';

// ---------------------------------------------------------------- Data Query

const dataQueryShow = (operation: string[]) => ({ show: { resource: ['dataQuery'], operation } });

export const dataQueryDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['dataQuery'] } },
		options: [
			{
				name: 'Get Data',
				value: 'getData',
				action: 'Get the data of a data query',
				description: 'Read the rows of a data query defined in Matrix42',
			},
		],
		default: 'getData',
	},
	{
		displayName: 'Data Query',
		name: 'dataQueryId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: dataQueryShow(['getData']),
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchDataQueries', searchable: true },
			},
			{ displayName: 'ID', name: 'id', type: 'string', placeholder: '00000000-0000-0000-0000-000000000000' },
		],
	},
	...returnAllFields(dataQueryShow(['getData'])),
	{
		displayName: 'Options',
		name: 'dataQueryOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: dataQueryShow(['getData']),
		options: [
			{
				displayName: 'Columns',
				name: 'columns',
				type: 'string',
				default: '',
				description: 'Comma-separated columns to return instead of the columns defined in the data query',
			},
			{
				displayName: 'Order By',
				name: 'orderBy',
				type: 'string',
				default: '',
				placeholder: 'CreatedDate DESC',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Full-text search within the data query, like the search box in Matrix42',
			},
			{
				displayName: 'User Filters (JSON)',
				name: 'userFilters',
				type: 'json',
				default: '',
				description:
					'Structured filter group (QueryFilterGroup), e.g. {"LogicalOperator": 0, "Conditions": [{"Property": "Name", "Operator": 0, "Value": ["x"]}]}',
			},
		],
	},
];

// ---------------------------------------------------------------- Import

const importShow = (operation: string[]) => ({ show: { resource: ['import'], operation } });

export const importDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['import'] } },
		options: [
			{
				name: 'Execute',
				value: 'execute',
				action: 'Execute an import definition',
				description: 'Run an import definition configured in Matrix42',
			},
			{
				name: 'Get Progress',
				value: 'getProgress',
				action: 'Get the progress of an import',
				description: 'Get the progress of a running import',
			},
		],
		default: 'execute',
	},
	{
		displayName: 'Import Definition',
		name: 'importDefinitionId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: importShow(['execute', 'getProgress']),
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchImportDefinitions', searchable: true },
			},
			{ displayName: 'ID', name: 'id', type: 'string', placeholder: '00000000-0000-0000-0000-000000000000' },
		],
	},
	{
		displayName: 'Parameters',
		name: 'importParameters',
		type: 'fixedCollection',
		placeholder: 'Add Parameter',
		typeOptions: { multipleValues: true },
		default: {},
		description: 'Parameters the import definition expects',
		displayOptions: importShow(['execute']),
		options: [
			{
				displayName: 'Parameter',
				name: 'parameter',
				values: [
					{ displayName: 'Name', name: 'name', type: 'string', default: '' },
					{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				],
			},
		],
	},
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: false,
		description: 'Whether to wait until the import has finished and return its final status',
		displayOptions: importShow(['execute']),
	},
	{
		displayName: 'Timeout (Seconds)',
		name: 'timeout',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 300,
		description: 'Maximum time to wait for completion',
		displayOptions: { show: { resource: ['import'], operation: ['execute'], waitForCompletion: [true] } },
	},
	{
		displayName: 'Logger ID',
		name: 'loggerId',
		type: 'string',
		required: true,
		default: '',
		description: 'LoggerId returned by the Execute operation',
		displayOptions: importShow(['getProgress']),
	},
];
