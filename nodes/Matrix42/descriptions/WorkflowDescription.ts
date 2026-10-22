import type { INodeProperties } from 'n8n-workflow';

import { returnAllFields } from './shared';

const GUID_REGEX = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const guidValidation = [
	{ type: 'regex' as const, properties: { regex: GUID_REGEX, errorMessage: 'Not a valid ID (GUID)' } },
];

const show = (operation: string[]) => ({ show: { resource: ['workflow'], operation } });

export const workflowDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['workflow'] } },
		options: [
			{
				name: 'Get Many Waiting',
				value: 'getWaiting',
				action: 'Get many waiting workflows',
				description: 'List suspended workflow instances that wait at an active bookmark (trigger activity)',
			},
			{
				name: 'Resume (Trigger)',
				value: 'resume',
				action: 'Resume a waiting workflow',
				description: 'Trigger a suspended workflow that waits at a bookmark so that it continues',
			},
			{
				name: 'Start',
				value: 'start',
				action: 'Start a workflow',
				description: 'Start a workflow (e.g. one with a call trigger) with arguments',
			},
		],
		default: 'resume',
	},

	// ---------------- resume ----------------
	{
		displayName: 'Waiting Workflow',
		name: 'bookmark',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The waiting workflow to continue, identified by its active bookmark',
		displayOptions: show(['resume']),
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchWaitingWorkflows', searchable: true },
			},
			{
				displayName: 'By Bookmark ID',
				name: 'id',
				type: 'string',
				placeholder: '00000000-0000-0000-0000-000000000000',
				validation: guidValidation,
			},
			{
				displayName: 'By Waited Object ID',
				name: 'objectId',
				type: 'string',
				placeholder: '00000000-0000-0000-0000-000000000000',
				hint: 'Object ID of the object the workflow waits for (e.g. the task of a "Wait for Activity" step)',
				validation: guidValidation,
			},
		],
	},
	{
		displayName: 'Input Data',
		name: 'inputData',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		description:
			'Data handed to the resumed workflow (available as the output of the waiting activity). Objects are sent as JSON.',
		displayOptions: show(['resume']),
	},

	// ---------------- get waiting ----------------
	...returnAllFields(show(['getWaiting'])),
	{
		displayName: 'Filters',
		name: 'waitingFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show(['getWaiting']),
		options: [
			{
				displayName: 'Activity Contains',
				name: 'activity',
				type: 'string',
				default: '',
				description: 'Matches the summary of the waiting activity (bookmark), e.g. "Wait Task Activity"',
			},
			{
				displayName: 'Waited Object ID',
				name: 'externalObjectId',
				type: 'string',
				default: '',
				description: 'Only bookmarks that wait for this object',
			},
			{
				displayName: 'Workflow Name Contains',
				name: 'workflowName',
				type: 'string',
				default: '',
			},
		],
	},

	// ---------------- start ----------------
	{
		displayName: 'Workflow',
		name: 'workflowId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: show(['start']),
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchWorkflows', searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: '00000000-0000-0000-0000-000000000000',
				hint: 'Object ID of the workflow (XAML component)',
				validation: guidValidation,
			},
		],
	},
	{
		displayName: 'Arguments Input',
		name: 'argumentsMode',
		type: 'options',
		default: 'mapper',
		displayOptions: show(['start']),
		options: [
			{
				name: 'Map Each Argument',
				value: 'mapper',
				description: 'Fill the arguments the workflow declares, field by field',
			},
			{ name: 'JSON', value: 'json', description: 'Provide all arguments as one JSON object' },
		],
	},
	{
		displayName: 'Arguments',
		name: 'argumentsMapping',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		required: true,
		typeOptions: {
			loadOptionsDependsOn: ['workflowId.value'],
			resourceMapper: {
				resourceMapperMethod: 'getWorkflowArguments',
				mode: 'add',
				fieldWords: { singular: 'argument', plural: 'arguments' },
				addAllFields: true,
				supportAutoMap: true,
				hideNoDataError: true,
				noFieldsError: 'This workflow declares no input arguments',
			},
		},
		displayOptions: { show: { resource: ['workflow'], operation: ['start'], argumentsMode: ['mapper'] } },
	},
	{
		displayName: 'Arguments (JSON)',
		name: 'workflowArguments',
		type: 'json',
		default: '{}',
		description: 'Input arguments of the workflow, e.g. {"ServiceBookingID": "…"}',
		displayOptions: { show: { resource: ['workflow'], operation: ['start'], argumentsMode: ['json'] } },
	},
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: false,
		description:
			'Whether to wait until the workflow has finished (or stopped at its next waiting activity) and return its final status',
		displayOptions: show(['start', 'resume']),
	},
	{
		displayName: 'Timeout (Seconds)',
		name: 'timeout',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 60,
		description: 'Maximum time to wait for completion',
		displayOptions: { show: { resource: ['workflow'], operation: ['start', 'resume'], waitForCompletion: [true] } },
	},
];
