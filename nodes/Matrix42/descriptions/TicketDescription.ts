import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { TICKET_TYPES, type TicketKind } from '../constants';
import { assignmentFilterFields, locatorField, queryOptionFields, returnAllFields, ticketField } from './shared';

const ACTIONS_WITH_TRANSFORM: TicketKind[] = ['ticket', 'incident', 'serviceRequest'];

function operationsFor(kind: TicketKind): INodePropertyOptions[] {
	const label = TICKET_TYPES[kind].label.toLowerCase();
	const op = (name: string, value: string, action: string): INodePropertyOptions => ({
		name,
		value,
		action,
		description: action,
	});

	const operations: INodePropertyOptions[] = [
		op('Accept', 'accept', `Accept a ${label}`),
		op('Close', 'close', `Close a ${label}`),
		op('Create', 'create', `Create a ${label}`),
		op('Forward', 'forward', `Forward a ${label} to a role or user`),
		op('Get', 'get', `Get a ${label}`),
		op('Get Many', 'getAll', `Get many ${label}s`),
		op('Pause', 'pause', `Pause a ${label}`),
		op('Reopen', 'reopen', `Reopen a ${label}`),
		op('Return to Role', 'returnToRole', `Return a ${label} to its role`),
		op('Set Deadline', 'setDeadline', `Set the deadline of a ${label}`),
		op('Take Over', 'takeOver', `Take over a ${label}`),
		op('Track Working Time', 'trackWorkingTime', `Track working time on a ${label}`),
		op('Update', 'update', `Update a ${label}`),
	];
	if (ACTIONS_WITH_TRANSFORM.includes(kind)) {
		operations.push(op('Transform', 'transform', `Transform a ${label} into another ticket type`));
	}
	if (kind === 'ticket') {
		operations.push(op('Classify', 'classify', 'Classify a text as incident or service request'));
	}
	if (kind === 'incident') {
		operations.push(
			op('Decline Major Proposal', 'declineMajorProposal', 'Decline the proposal to make an incident major'),
			op('Propose Major', 'proposeMajor', 'Propose an incident as major incident'),
			op('Revert Major', 'revertMajor', 'Revert a major incident to a standard incident'),
			op('Set Major', 'setMajor', 'Mark an incident as major incident'),
		);
	}
	if (kind === 'change') {
		operations.push(
			op('Decide Approval', 'decideApproval', 'Approve or reject a change approval'),
			op('Get Approvals', 'getApprovals', 'Get the approvals of a change'),
		);
	}
	return operations.sort((a, b) => a.name.localeCompare(b.name));
}

function templateField(kind: TicketKind): INodeProperties | undefined {
	if (kind === 'change') return undefined;
	return locatorField({
		displayName: kind === 'task' ? 'Task Template' : 'Quick Call Template',
		name: 'template',
		searchListMethod: kind === 'task' ? 'searchTaskTemplates' : 'searchQuickCalls',
		description: 'Template whose default values are applied',
	});
}

function ticketDataFields(kind: TicketKind): INodeProperties[] {
	const fields: INodeProperties[] = [
		locatorField({ displayName: 'Category', name: 'category', searchListMethod: 'searchCategories' }),
		{
			displayName: 'Configuration Item IDs',
			name: 'configurationItems',
			type: 'string',
			default: '',
			description: 'Comma-separated IDs of related configuration items',
		},
		{
			displayName: 'Custom Fields (JSON)',
			name: 'customFields',
			type: 'json',
			default: '{}',
			description:
				'Additional fields sent as-is to the Matrix42 API, e.g. {"SLA": "…", "EntryBy": 1}. Overrides fields set above.',
		},
		{
			displayName: 'Deadline',
			name: 'deadline',
			type: 'dateTime',
			default: '',
		},
		{
			displayName: 'Impact Name or ID',
			name: 'impact',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getImpacts' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		locatorField({
			displayName: 'Initiator',
			name: 'initiator',
			searchListMethod: 'searchUsers',
			description: 'User the ticket is reported for',
		}),
		{
			displayName: 'Notify Responsible',
			name: 'notifyResponsible',
			type: 'boolean',
			default: false,
			description: 'Whether the responsible user or role is notified',
		},
		{
			displayName: 'Priority Name or ID',
			name: 'priority',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getPriorities' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Related Asset IDs',
			name: 'relatedAssets',
			type: 'string',
			default: '',
			description: 'Comma-separated asset IDs to relate',
		},
		locatorField({ displayName: 'Responsible Role', name: 'responsibleRole', searchListMethod: 'searchRoles' }),
		locatorField({ displayName: 'Responsible User', name: 'responsibleUser', searchListMethod: 'searchUsers' }),
		locatorField({ displayName: 'Service', name: 'service', searchListMethod: 'searchServices' }),
		{
			displayName: 'Urgency Name or ID',
			name: 'urgency',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getUrgencies' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
	];

	const template = templateField(kind);
	if (template) fields.push(template);

	if (kind !== 'task' && kind !== 'change') {
		fields.push(
			locatorField({ displayName: 'Affected Asset', name: 'affectedAsset', searchListMethod: 'searchAssets' }),
			locatorField({ displayName: 'Affected Service', name: 'affectedService', searchListMethod: 'searchServices' }),
			{
				displayName: 'User Reachable At',
				name: 'userReachableAt',
				type: 'string',
				default: '',
				description: 'Contact information of the initiator',
			},
		);
	}

	if (kind === 'change') {
		fields.push(
			{ displayName: 'Cost Estimation', name: 'costEstimation', type: 'string', default: '' },
			{ displayName: 'Counteractions', name: 'counteractions', type: 'string', default: '' },
			{ displayName: 'Known Risks', name: 'knownRisks', type: 'string', default: '' },
			{ displayName: 'Required Resources', name: 'requiredResources', type: 'string', default: '' },
			{ displayName: 'Rollback Strategy', name: 'rollbackStrategy', type: 'string', default: '' },
			{
				displayName: 'Start Workflow Immediately',
				name: 'startWorkflowImmediately',
				type: 'boolean',
				default: false,
				description: 'Whether the change workflow of the template is started right away',
			},
			{ displayName: 'Timeline', name: 'timeline', type: 'string', default: '' },
			{
				displayName: 'Type of Change',
				name: 'typeOfChange',
				type: 'number',
				default: 20,
				description: 'Numeric change type as defined in Matrix42 (e.g. 20 = non-standard change)',
			},
		);
	}

	return fields.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function ticketDescription(kind: TicketKind): INodeProperties[] {
	const show = (operation: string[]) => ({ show: { resource: [kind], operation } });
	const ticketOperations = [
		'accept',
		'close',
		'forward',
		'get',
		'pause',
		'reopen',
		'returnToRole',
		'setDeadline',
		'takeOver',
		'trackWorkingTime',
		'transform',
		'update',
		'getApprovals',
		'decideApproval',
		'proposeMajor',
		'declineMajorProposal',
		'setMajor',
		'revertMajor',
	];

	const properties: INodeProperties[] = [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: { show: { resource: [kind] } },
			options: operationsFor(kind),
			default: 'getAll',
		},

		// ---------------- shared ticket locator ----------------
		ticketField(show(ticketOperations), 'ticketId', kind === 'change' ? 'Change' : 'Ticket'),

		// ---------------- create ----------------
		{
			displayName: 'Subject',
			name: 'subject',
			type: 'string',
			required: true,
			default: '',
			displayOptions: show(['create']),
		},
		{
			displayName: 'Description',
			name: 'description',
			type: 'string',
			typeOptions: { rows: 4 },
			default: '',
			displayOptions: show(['create']),
		},
	];

	if (kind === 'change') {
		properties.push(
			locatorField({
				displayName: 'Change Template',
				name: 'changeTemplate',
				searchListMethod: 'searchChangeTemplates',
				required: true,
				description: 'Matrix42 requires a change template to create a change',
				displayOptions: show(['create']),
			}),
		);
	}

	properties.push(
		{
			displayName: 'Additional Fields',
			name: 'additionalFields',
			type: 'collection',
			placeholder: 'Add Field',
			default: {},
			displayOptions: show(['create']),
			options: ticketDataFields(kind),
		},

		// ---------------- update ----------------
		{
			displayName: 'Update Fields',
			name: 'updateFields',
			type: 'collection',
			placeholder: 'Add Field',
			default: {},
			displayOptions: show(['update']),
			options: [
				{ displayName: 'Subject', name: 'subject', type: 'string', default: '' },
				{ displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 4 }, default: '' },
				{
					displayName: 'Journal Entry',
					name: 'journalEntry',
					type: 'string',
					typeOptions: { rows: 2 },
					default: '',
					description: 'Comment added to the journal together with the update',
				},
				{
					displayName: 'Journal Entry Visible in Portal',
					name: 'journalEntryVisibleInPortal',
					type: 'boolean',
					default: false,
					description: 'Whether the journal entry is visible to the initiator in the Self Service Portal',
				},
				...ticketDataFields(kind),
			].sort((a, b) => a.displayName.localeCompare(b.displayName)) as INodeProperties[],
		},

		// ---------------- close ----------------
		{
			displayName: 'Comments',
			name: 'comments',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '',
			description: 'Solution / closing comment (HTML allowed)',
			displayOptions: show(['close']),
		},
		{
			displayName: 'Close Options',
			name: 'closeOptions',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: show(['close']),
			options: [
				{
					displayName: 'Close Related Incidents',
					name: 'closeRelatedIncidents',
					type: 'boolean',
					default: false,
					description: 'Whether related incidents are closed too',
				},
				{
					displayName: 'Notify Responsible',
					name: 'notifyResponsible',
					type: 'boolean',
					default: false,
					description: 'Whether the responsible user is notified',
				},
				{
					displayName: 'Reason Name or ID',
					name: 'reason',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getCloseReasons' },
					default: '',
					description:
						'Closing reason. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				},
				{
					displayName: 'Send Mail to Initiator',
					name: 'sendMailToInitiator',
					type: 'boolean',
					default: false,
					description: 'Whether the initiator receives a notification mail',
				},
				{
					displayName: 'Send Mail to Users',
					name: 'sendMailToUsers',
					type: 'boolean',
					default: false,
					description: 'Whether users attached to the ticket receive a notification mail',
				},
				{
					displayName: 'Skip if Already Closed',
					name: 'skipFailIfAlreadyClosed',
					type: 'boolean',
					default: false,
					description: 'Whether to succeed silently when the ticket is already closed',
				},
			],
		},

		// ---------------- get / get many ----------------
		...returnAllFields(show(['getAll'])),
		{
			displayName: 'Filters',
			name: 'filters',
			type: 'collection',
			placeholder: 'Add Filter',
			default: {},
			displayOptions: show(['getAll']),
			options: [
				...assignmentFilterFields,
				{
					displayName: 'Created After',
					name: 'createdAfter',
					type: 'dateTime',
					default: '',
				},
				{
					displayName: 'Custom Where (ASQL)',
					name: 'where',
					type: 'string',
					default: '',
					placeholder: "Priority >= 2 AND Subject LIKE '%VPN%'",
					description: 'Additional ASQL condition, combined with the other filters using AND',
				},
				locatorField({ displayName: 'Initiator', name: 'initiator', searchListMethod: 'searchUsers' }),
				{
					displayName: 'Status Names or IDs',
					name: 'states',
					type: 'multiOptions',
					typeOptions: { loadOptionsMethod: 'getStates' },
					default: [],
					description:
						'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
				{
					displayName: 'Subject Contains',
					name: 'subjectContains',
					type: 'string',
					default: '',
				},
				{
					displayName: 'Ticket Number',
					name: 'ticketNumber',
					type: 'string',
					default: '',
					placeholder: 'INC00123',
				},
				...(kind === 'ticket'
					? ([
							{
								displayName: 'Ticket Types',
								name: 'ticketTypes',
								type: 'multiOptions',
								default: [],
								description: 'Restrict to these ticket types. Leave empty for all types.',
								options: Object.entries(TICKET_TYPES).map(([value, type]) => ({ name: type.label, value })),
							},
						] as INodeProperties[])
					: []),
				{
					displayName: 'Updated After',
					name: 'updatedAfter',
					type: 'dateTime',
					default: '',
				},
			],
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: show(['get', 'getAll']),
			options: queryOptionFields,
		},

		// ---------------- actions ----------------
		locatorField({
			displayName: 'Role',
			name: 'role',
			searchListMethod: 'searchRoles',
			required: true,
			description: 'Role to forward the ticket to',
			displayOptions: show(['forward']),
		}),
		{
			displayName: 'Forward Options',
			name: 'forwardOptions',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: show(['forward']),
			options: [
				{ displayName: 'Comments', name: 'comments', type: 'string', default: '' },
				locatorField({
					displayName: 'User',
					name: 'user',
					searchListMethod: 'searchUsers',
					description: 'User within the role to forward to',
				}),
			],
		},
		{
			displayName: 'Reminder Date',
			name: 'reminderDate',
			type: 'dateTime',
			required: true,
			default: '',
			description: 'When the paused ticket becomes active again',
			displayOptions: show(['pause']),
		},
		{
			displayName: 'Pause Options',
			name: 'pauseOptions',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: show(['pause']),
			options: [
				{ displayName: 'Comments', name: 'comments', type: 'string', default: '' },
				{
					displayName: 'Do Not Escalate While Paused',
					name: 'notEscalateWhilePaused',
					type: 'boolean',
					default: false,
					description: 'Whether SLA escalation is suspended while the ticket is paused',
				},
				{
					displayName: 'Reason',
					name: 'reason',
					type: 'number',
					default: 0,
					description: 'Numeric pause reason as defined in Matrix42',
				},
			],
		},
		{
			displayName: 'Deadline',
			name: 'deadline',
			type: 'dateTime',
			required: true,
			default: '',
			displayOptions: show(['setDeadline']),
		},
		{
			displayName: 'Comments',
			name: 'comments',
			type: 'string',
			default: '',
			displayOptions: show(['returnToRole']),
		},
		{
			displayName: 'Reason',
			name: 'reason',
			type: 'number',
			default: 0,
			description: 'Numeric reopen reason as defined in Matrix42 (0 = none)',
			displayOptions: show(['reopen']),
		},
		{
			displayName: 'Minutes',
			name: 'minutes',
			type: 'number',
			required: true,
			typeOptions: { minValue: 1 },
			default: 15,
			displayOptions: show(['trackWorkingTime']),
		},
		{
			displayName: 'Activity Type',
			name: 'activityType',
			type: 'options',
			default: 2,
			displayOptions: show(['trackWorkingTime']),
			options: [
				{ name: 'Administration', value: 5 },
				{ name: 'Assignment', value: 1 },
				{ name: 'Investigation', value: 2 },
				{ name: 'Other', value: 6 },
				{ name: 'Recording', value: 3 },
				{ name: 'Resolution', value: 4 },
			],
		},
		{
			displayName: 'Begin',
			name: 'begin',
			type: 'dateTime',
			required: true,
			default: '',
			displayOptions: show(['trackWorkingTime']),
		},
		{
			displayName: 'End',
			name: 'end',
			type: 'dateTime',
			required: true,
			default: '',
			displayOptions: show(['trackWorkingTime']),
		},
		{
			displayName: 'Work Description',
			name: 'workDescription',
			type: 'string',
			default: '',
			displayOptions: show(['trackWorkingTime']),
		},
	);

	if (ACTIONS_WITH_TRANSFORM.includes(kind)) {
		properties.push(
			{
				displayName: 'Target Type',
				name: 'targetType',
				type: 'options',
				required: true,
				default: 'incident',
				displayOptions: show(['transform']),
				options: (['incident', 'serviceRequest', 'ticket', 'problem'] as const).map((value) => ({
					name: TICKET_TYPES[value].label,
					value,
				})),
			},
			{
				displayName: 'Transform Options',
				name: 'transformOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: show(['transform']),
				options: [
					locatorField({ displayName: 'Category', name: 'category', searchListMethod: 'searchCategories' }),
					{
						displayName: 'Init Default Values',
						name: 'initDefaultValues',
						type: 'boolean',
						default: true,
						description: 'Whether default values of the target type are applied',
					},
					locatorField({ displayName: 'Responsible Role', name: 'recipientRole', searchListMethod: 'searchRoles' }),
				],
			},
		);
	}

	if (kind === 'ticket') {
		properties.push(
			{
				displayName: 'Subject',
				name: 'classifySubject',
				type: 'string',
				required: true,
				default: '',
				displayOptions: show(['classify']),
			},
			{
				displayName: 'Description',
				name: 'classifyDescription',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				displayOptions: show(['classify']),
			},
		);
	}

	if (kind === 'incident') {
		properties.push(
			{
				displayName: 'Options',
				name: 'majorOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: show(['proposeMajor']),
				options: [
					locatorField({ displayName: 'Affected Service', name: 'affectedService', searchListMethod: 'searchServices' }),
					{ displayName: 'Comments', name: 'comments', type: 'string', default: '' },
				],
			},
			{
				displayName: 'Options',
				name: 'majorOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: show(['setMajor']),
				options: [
					locatorField({ displayName: 'Affected Service', name: 'affectedService', searchListMethod: 'searchServices' }),
					{
						displayName: 'Include Affected Service in Availability Center',
						name: 'includeAffectedServiceInSac',
						type: 'boolean',
						default: false,
						description: 'Whether the affected service is shown in the Service Availability Center',
					},
					{
						displayName: 'Summary',
						name: 'summary',
						type: 'string',
						default: '',
						description: 'Communication summary of the major incident',
					},
					{
						displayName: 'Visible in Availability Center',
						name: 'visibleInSac',
						type: 'boolean',
						default: false,
						description: 'Whether the major incident is published in the Service Availability Center',
					},
				],
			},
			{
				displayName: 'Remove Service From Availability Center',
				name: 'removeServiceFromSac',
				type: 'boolean',
				default: true,
				description: 'Whether the affected service is removed from the Service Availability Center',
				displayOptions: show(['revertMajor']),
			},
		);
	}

	if (kind === 'change') {
		properties.push(
			{
				displayName: 'Approval Object ID',
				name: 'approvalId',
				type: 'string',
				required: true,
				default: '',
				description: 'Object ID of the change approval (see "Get Approvals", field ObjectId)',
				displayOptions: show(['decideApproval']),
			},
			{
				displayName: 'Decision',
				name: 'decision',
				type: 'options',
				default: 'approve',
				displayOptions: show(['decideApproval']),
				options: [
					{ name: 'Approve', value: 'approve' },
					{ name: 'Reject', value: 'reject' },
				],
			},
			{
				displayName: 'Comments',
				name: 'comments',
				type: 'string',
				default: '',
				displayOptions: show(['decideApproval']),
			},
		);
	}

	return properties;
}
