import type { INodeProperties } from 'n8n-workflow';

import { locatorField, returnAllFields, ticketField } from './shared';

// ---------------------------------------------------------------- Attachment

const attachmentShow = (operation: string[]) => ({ show: { resource: ['attachment'], operation } });

export const attachmentDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['attachment'] } },
		options: [
			{ name: 'Delete', value: 'delete', action: 'Delete an attachment', description: 'Delete an attachment' },
			{
				name: 'Download',
				value: 'download',
				action: 'Download an attachment',
				description: 'Download an attachment as binary data',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many attachments',
				description: 'List the attachments of a ticket',
			},
			{
				name: 'Upload',
				value: 'upload',
				action: 'Upload an attachment',
				description: 'Attach binary data from the input as a file to a ticket',
			},
		],
		default: 'upload',
	},
	{
		displayName: 'Attach To',
		name: 'attachTo',
		type: 'options',
		default: 'ticket',
		displayOptions: attachmentShow(['upload', 'getAll']),
		options: [
			{ name: 'Ticket', value: 'ticket' },
			{ name: 'Any Object', value: 'object', description: 'E.g. an asset, contract or user, by its object ID.' },
		],
	},
	ticketField({ show: { resource: ['attachment'], operation: ['upload', 'getAll'], attachTo: ['ticket'] } }),
	{
		displayName: 'Object ID',
		name: 'attachmentObjectId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '00000000-0000-0000-0000-000000000000',
		description: 'Object ID of the configuration item (e.g. the ObjectId of an asset)',
		displayOptions: { show: { resource: ['attachment'], operation: ['upload', 'getAll'], attachTo: ['object'] } },
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the input binary field containing the file to upload',
		displayOptions: attachmentShow(['upload']),
	},
	{
		displayName: 'Options',
		name: 'uploadOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: attachmentShow(['upload']),
		options: [
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				description: 'Overrides the file name of the binary data',
			},
		],
	},
	{
		displayName: 'File ID',
		name: 'fileId',
		type: 'string',
		required: true,
		default: '',
		description: 'UniqueFileId of the attachment (see "Get Many")',
		displayOptions: attachmentShow(['download', 'delete']),
	},
	{
		displayName: 'Put Output File in Field',
		name: 'outputBinaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the output binary field to put the file in',
		displayOptions: attachmentShow(['download']),
	},
];

// ---------------------------------------------------------------- Approval (service catalog orders)

const approvalShow = (operation: string[]) => ({ show: { resource: ['approval'], operation } });

const approvalTaskField: INodeProperties = {
	displayName: 'Approval Task',
	name: 'approvalTaskId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'The approval task (APT…) of a service catalog order',
	displayOptions: approvalShow(['get', 'decide']),
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchApprovalTasks', searchable: true },
		},
		{ displayName: 'By Number', name: 'ticketNumber', type: 'string', placeholder: 'APT000123' },
		{ displayName: 'By Object ID', name: 'id', type: 'string', placeholder: '00000000-0000-0000-0000-000000000000' },
	],
};

export const approvalDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['approval'] } },
		options: [
			{
				name: 'Decide',
				value: 'decide',
				action: 'Approve or reject an approval task',
				description: 'Approve or reject the bookings of an approval task',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get an approval task',
				description: 'Get an approval task including its bookings',
			},
			{ name: 'Get Many', value: 'getAll', action: 'Get many approval tasks', description: 'List approval tasks' },
		],
		default: 'decide',
	},
	approvalTaskField,
	{
		displayName: 'Decision',
		name: 'decision',
		type: 'options',
		default: 'approve',
		displayOptions: approvalShow(['decide']),
		options: [
			{ name: 'Approve', value: 'approve' },
			{ name: 'Reject', value: 'reject' },
		],
	},
	{
		displayName: 'Comments',
		name: 'comments',
		type: 'string',
		typeOptions: { rows: 2 },
		default: '',
		displayOptions: approvalShow(['decide']),
	},
	{
		displayName: 'Options',
		name: 'decideOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: approvalShow(['decide']),
		options: [
			{
				displayName: 'Only These Bookings',
				name: 'bookingIds',
				type: 'string',
				default: '',
				description:
					'Comma-separated booking object IDs to approve. All other bookings of the task are rejected. Leave empty to decide all bookings.',
			},
		],
	},
	...returnAllFields(approvalShow(['getAll'])),
	{
		displayName: 'Filters',
		name: 'approvalFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: { onlyOpen: true },
		displayOptions: approvalShow(['getAll']),
		options: [
			{
				displayName: 'Only Open',
				name: 'onlyOpen',
				type: 'boolean',
				default: true,
				description: 'Whether to return only tasks that still wait for a decision',
			},
			locatorField({ displayName: 'Responsible Role', name: 'recipientRole', searchListMethod: 'searchRoles' }),
			locatorField({ displayName: 'Responsible User', name: 'recipient', searchListMethod: 'searchUsers' }),
		],
	},
];

// ---------------------------------------------------------------- User

const userShow = (operation: string[]) => ({ show: { resource: ['user'], operation } });

export const userDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['user'] } },
		options: [
			{ name: 'Get', value: 'get', action: 'Get a user', description: 'Get a user' },
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many users',
				description: 'Find users, e.g. by e-mail address',
			},
		],
		default: 'getAll',
	},
	locatorField({
		displayName: 'User',
		name: 'userId',
		searchListMethod: 'searchUsers',
		required: true,
		displayOptions: userShow(['get']),
	}),
	...returnAllFields(userShow(['getAll'])),
	{
		displayName: 'Filters',
		name: 'userFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: userShow(['getAll']),
		options: [
			{
				displayName: 'Custom Where (ASQL)',
				name: 'where',
				type: 'string',
				default: '',
				placeholder: "Company = 'Example Ltd'",
			},
			{ displayName: 'Department', name: 'department', type: 'string', default: '' },
			{
				displayName: 'E-Mail',
				name: 'email',
				type: 'string',
				placeholder: 'name@example.com',
				default: '',
				description: 'Exact e-mail address (case-insensitive)',
			},
			{
				displayName: 'Name Contains',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Matches first name, last name or display name',
			},
		],
	},
];
