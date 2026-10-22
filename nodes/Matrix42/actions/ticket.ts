import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	ACTIVITY_CLASS,
	CHANGE_APPROVAL_CLASS,
	CHANGE_APPROVAL_COLUMNS,
	CLOSE_ENDPOINT_BY_TYPE_NAME,
	KIND_ENDPOINTS,
	MAJOR_INCIDENT_COLUMNS,
	TICKET_COLUMNS,
	TICKET_TYPES,
	type TicketKind,
	type TicketTypeKey,
} from '../constants';
import {
	andWhere,
	asqlLikeContains,
	asqlLiteral,
	expandFilterHierarchies,
	getTicketTypeName,
	matrix42ApiRequest,
	parseIdList,
	parseJsonParameter,
	queryFragments,
	resolveLocatorValue,
	resolveTicketId,
	simplifyRow,
	simplifyTicketRow,
	splitTopLevel,
	toMatrix42Date,
} from '../GenericFunctions';

/** Node field name → Matrix42 API field name for values that are passed through unchanged. */
const PLAIN_FIELDS: Record<string, string> = {
	subject: 'Subject',
	description: 'Description',
	impact: 'Impact',
	urgency: 'Urgency',
	priority: 'Priority',
	notifyResponsible: 'NotifyResponsible',
	userReachableAt: 'UserReachableAt',
	journalEntry: 'JournalEntry',
	journalEntryVisibleInPortal: 'JournalEntryVisibleInPortal',
	knownRisks: 'KnownRisks',
	counteractions: 'Counteractions',
	rollbackStrategy: 'RollbackStrategy',
	costEstimation: 'CostEstimation',
	timeline: 'Timeline',
	requiredResources: 'RequiredResources',
	startWorkflowImmediately: 'StartWorkflowImmediately',
	typeOfChange: 'TypeOfChange',
};

const LOCATOR_FIELDS: Record<string, string> = {
	category: 'Category',
	initiator: 'User',
	responsibleRole: 'ResponsibleRole',
	responsibleUser: 'ResponsibleUser',
	service: 'Service',
	template: 'Template',
	affectedAsset: 'AffectedAsset',
	affectedService: 'AffectedService',
};

const LIST_FIELDS: Record<string, string> = {
	relatedAssets: 'RelatedAssets',
	configurationItems: 'ConfigurationItems',
};

function buildTicketBody(this: IExecuteFunctions, fields: IDataObject, itemIndex: number): IDataObject {
	const body: IDataObject = {};
	for (const [key, value] of Object.entries(fields)) {
		if (value === '' || value === undefined || value === null) continue;
		if (key in PLAIN_FIELDS) {
			body[PLAIN_FIELDS[key]] = value;
		} else if (key in LOCATOR_FIELDS) {
			const resolved = resolveLocatorValue(value);
			if (resolved) body[LOCATOR_FIELDS[key]] = resolved;
		} else if (key in LIST_FIELDS) {
			const ids = parseIdList(value);
			if (ids.length) body[LIST_FIELDS[key]] = ids;
		} else if (key === 'deadline') {
			body.Deadline = toMatrix42Date(value, this.getTimezone());
		}
	}
	return { ...body, ...parseJsonParameter.call(this, fields.customFields, 'Custom Fields (JSON)', itemIndex) };
}

function ticketColumns(options: IDataObject, kind?: TicketKind): string[] {
	const extra = splitTopLevel((options.columns as string) ?? '');
	if (options.onlyAdditionalColumns) return extra;
	return [...TICKET_COLUMNS, ...(kind === 'incident' ? MAJOR_INCIDENT_COLUMNS : []), ...extra];
}

/** ASQL condition restricting to ticket types. `prefix` addresses the ticket from another fragment class. */
export function typeCondition(types: TicketTypeKey[], prefix = ''): string | undefined {
	if (types.length === 0) return undefined;
	return types.map((type) => `${prefix}UsedInType${TICKET_TYPES[type].typeName} IS NOT NULL`).join(' OR ');
}

/**
 * Multi-value filters on category, responsible role/user and priority. `prefix` addresses the ticket
 * from another fragment class (e.g. journal entries). Subcategories must be expanded beforehand.
 */
export function assignmentConditions(filters: IDataObject, prefix = ''): Array<string | undefined> {
	const ids = (column: string, values: unknown) => {
		const list = Array.isArray(values) ? values.map((value) => String(value).trim()).filter((value) => value !== '') : [];
		return list.length ? `${prefix}${column} IN (${list.map(asqlLiteral).join(', ')})` : undefined;
	};
	const anyOf = (columns: string[], values: unknown) => {
		const parts = columns.map((column) => ids(column, values)).filter(Boolean);
		return parts.length ? parts.join(' OR ') : undefined;
	};
	const priorities = Array.isArray(filters.priorities) ? (filters.priorities as unknown[]).map(Number) : [];
	const incident = 'T(SPSActivityClassIncident)';
	return [
		ids('Category', filters.categories),
		ids('RecipientRole', filters.responsibleRoles),
		ids('Recipient', filters.responsibleUsers),
		priorities.length ? `${prefix}Priority IN (${priorities.join(', ')})` : undefined,
		// reported or affected service (the latter only exists on incidents)
		anyOf(['Service', `${incident}.ServiceAffected`], filters.services),
		// reported or affected asset, by asset ID or object ID
		anyOf(
			[
				`${incident}.Asset`,
				`${incident}.AssetAffected`,
				`${incident}.Asset.[Expression-ObjectID]`,
				`${incident}.AssetAffected.[Expression-ObjectID]`,
			],
			filters.assets,
		),
		ids('T(SPSCommonClassBase).OU', filters.orgUnits),
		ids('T(SPSCommonClassBase).Location', filters.locations),
		ids('T(SPSCommonClassBase).CostCenter', filters.costCenters),
		// N:M relation; Matrix42 evaluates it as "has at least one matching configuration item"
		ids('ConfigurationItems.[Expression-ObjectID]', filters.configurationItems),
	];
}

export function buildTicketWhere(kind: TicketKind, filters: IDataObject, timeZone: string): string | undefined {
	const types =
		kind === 'ticket' ? ((filters.ticketTypes as TicketTypeKey[] | undefined) ?? []) : [kind as TicketTypeKey];
	const states = (filters.states as number[] | undefined) ?? [];
	const eq = (column: string, value: unknown) => {
		const resolved = resolveLocatorValue(value);
		return resolved ? `${column} = ${asqlLiteral(resolved)}` : undefined;
	};
	const after = (column: string, value: unknown) => {
		const date = toMatrix42Date(value, timeZone);
		return date ? `${column} > ${asqlLiteral(date)}` : undefined;
	};

	return andWhere([
		typeCondition(types),
		states.length ? `T(SPSCommonClassBase).State IN (${states.map(Number).join(', ')})` : undefined,
		filters.ticketNumber ? `TicketNumber = ${asqlLiteral(String(filters.ticketNumber))}` : undefined,
		filters.subjectContains ? `Subject LIKE ${asqlLikeContains(String(filters.subjectContains))}` : undefined,
		after('CreatedDate', filters.createdAfter),
		after('LastChangeDate', filters.updatedAfter),
		eq('Category', filters.category),
		eq('RecipientRole', filters.responsibleRole),
		eq('Recipient', filters.responsibleUser),
		eq('Initiator', filters.initiator),
		...assignmentConditions(filters),
		filters.where as string | undefined,
	]);
}

async function getTicket(
	this: IExecuteFunctions,
	objectId: string,
	options: IDataObject,
	itemIndex: number,
	kind?: TicketKind,
) {
	const rows = await queryFragments.call(
		this,
		ACTIVITY_CLASS,
		{ columns: ticketColumns(options, kind), where: `[Expression-ObjectID] = ${asqlLiteral(objectId)}` },
		1,
	);
	if (rows.length === 0) {
		throw new NodeOperationError(this.getNode(), `Ticket ${objectId} not found`, { itemIndex });
	}
	return simplifyTicketRow(rows[0]);
}

function compact(body: IDataObject): IDataObject {
	return Object.fromEntries(
		Object.entries(body).filter(([, value]) => value !== undefined && value !== '' && value !== null),
	);
}

export async function executeTicket(
	this: IExecuteFunctions,
	kind: TicketKind,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	const endpoints = KIND_ENDPOINTS[kind];

	if (operation === 'create') {
		const body = buildTicketBody.call(
			this,
			{
				subject: this.getNodeParameter('subject', itemIndex),
				description: this.getNodeParameter('description', itemIndex, ''),
				...(this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject),
			},
			itemIndex,
		);
		if (kind === 'change') {
			body.Template = this.getNodeParameter('changeTemplate', itemIndex, '', { extractValue: true });
		}
		const objectId = (await matrix42ApiRequest.call(
			this,
			'POST',
			endpoints.create,
			body,
			endpoints.createQs,
		)) as string;
		return getTicket.call(this, objectId, {}, itemIndex, kind);
	}

	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
		const filters = await expandFilterHierarchies.call(
			this,
			this.getNodeParameter('filters', itemIndex, {}) as IDataObject,
		);
		const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
		const rows = await queryFragments.call(
			this,
			ACTIVITY_CLASS,
			{
				columns: ticketColumns(options, kind),
				where: buildTicketWhere(kind, filters, this.getTimezone()),
				sort: (options.sort as string) || 'CreatedDate DESC',
			},
			limit,
		);
		return rows.map(simplifyTicketRow);
	}

	if (operation === 'classify') {
		const response = (await matrix42ApiRequest.call(this, 'POST', 'ticket/Classify', {
			TicketSubject: this.getNodeParameter('classifySubject', itemIndex),
			TicketDescription: this.getNodeParameter('classifyDescription', itemIndex, ''),
		})) as IDataObject;
		return response ?? {};
	}

	const objectId = await resolveTicketId.call(this, 'ticketId', itemIndex);
	const done = (extra: IDataObject = {}) => ({ success: true, ObjectId: objectId, ...extra });

	switch (operation) {
		case 'get':
			return getTicket.call(this, objectId, this.getNodeParameter('options', itemIndex, {}) as IDataObject, itemIndex, kind);

		case 'update': {
			const fields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
			const body = { ...buildTicketBody.call(this, fields, itemIndex), ...endpoints.updateExtra, Id: objectId };
			await matrix42ApiRequest.call(this, 'POST', endpoints.update, body);
			return getTicket.call(this, objectId, {}, itemIndex, kind);
		}

		case 'close': {
			const closeOptions = this.getNodeParameter('closeOptions', itemIndex, {}) as IDataObject;
			// The generic Ticket resource may receive any ticket type, so pick the endpoint by the real type.
			const endpoint =
				kind === 'ticket'
					? CLOSE_ENDPOINT_BY_TYPE_NAME[await getTicketTypeName.call(this, objectId)] ?? endpoints.close
					: endpoints.close;
			await matrix42ApiRequest.call(
				this,
				'POST',
				endpoint,
				compact({
					ObjectIds: [objectId],
					Comments: this.getNodeParameter('comments', itemIndex, ''),
					Reason: closeOptions.reason,
					SendMailToInitiator: closeOptions.sendMailToInitiator,
					SendMailToUsers: closeOptions.sendMailToUsers,
					NotifyResponsible: closeOptions.notifyResponsible,
					CloseRelatedIncidents: closeOptions.closeRelatedIncidents,
					SkipFailIfAlreadyClosed: closeOptions.skipFailIfAlreadyClosed,
				}),
			);
			return getTicket.call(this, objectId, {}, itemIndex, kind);
		}

		case 'reopen': {
			const reason = this.getNodeParameter('reason', itemIndex, 0) as number;
			await matrix42ApiRequest.call(this, 'POST', 'activity/Reopen', compact({ ObjectIds: [objectId], Reason: reason || undefined }));
			return getTicket.call(this, objectId, {}, itemIndex, kind);
		}

		case 'takeOver':
		case 'accept': {
			const typeName = await getTicketTypeName.call(this, objectId);
			await matrix42ApiRequest.call(this, 'POST', operation === 'takeOver' ? 'activity/TakeOver' : 'activity/Accept', {
				Objects: [{ ObjectIds: [objectId], TypeName: typeName }],
			});
			return getTicket.call(this, objectId, {}, itemIndex, kind);
		}

		case 'forward': {
			const typeName = await getTicketTypeName.call(this, objectId);
			const forwardOptions = this.getNodeParameter('forwardOptions', itemIndex, {}) as IDataObject;
			await matrix42ApiRequest.call(
				this,
				'POST',
				'activity/Forward',
				compact({
					Tickets: [{ Item1: typeName, Item2: objectId }],
					RoleID: this.getNodeParameter('role', itemIndex, '', { extractValue: true }),
					UserID: resolveLocatorValue(forwardOptions.user),
					Comments: forwardOptions.comments,
				}),
			);
			return getTicket.call(this, objectId, {}, itemIndex, kind);
		}

		case 'pause': {
			const pauseOptions = this.getNodeParameter('pauseOptions', itemIndex, {}) as IDataObject;
			await matrix42ApiRequest.call(
				this,
				'POST',
				'activity/Pause',
				compact({
					ObjectIds: [objectId],
					ReminderDate: toMatrix42Date(this.getNodeParameter('reminderDate', itemIndex), this.getTimezone()),
					Comments: pauseOptions.comments,
					Reason: pauseOptions.reason || undefined,
					NotEscalateWhilePaused: pauseOptions.notEscalateWhilePaused,
				}),
			);
			return getTicket.call(this, objectId, {}, itemIndex, kind);
		}

		case 'setDeadline':
			await matrix42ApiRequest.call(this, 'POST', 'activity/SetDeadline', {
				ObjectIds: [objectId],
				Deadline: toMatrix42Date(this.getNodeParameter('deadline', itemIndex), this.getTimezone()),
			});
			return getTicket.call(this, objectId, {}, itemIndex, kind);

		case 'returnToRole':
			await matrix42ApiRequest.call(
				this,
				'POST',
				'activity/ReturnToRole',
				compact({ TicketId: objectId, Comments: this.getNodeParameter('comments', itemIndex, '') }),
			);
			return getTicket.call(this, objectId, {}, itemIndex, kind);

		case 'trackWorkingTime':
			await matrix42ApiRequest.call(
				this,
				'POST',
				'activity/TrackWorkingTime',
				compact({
					ObjectIds: [objectId],
					Minutes: this.getNodeParameter('minutes', itemIndex),
					ActivityType: this.getNodeParameter('activityType', itemIndex),
					Begin: toMatrix42Date(this.getNodeParameter('begin', itemIndex), this.getTimezone()),
					End: toMatrix42Date(this.getNodeParameter('end', itemIndex), this.getTimezone()),
					Description: this.getNodeParameter('workDescription', itemIndex, ''),
				}),
			);
			return done();

		case 'transform': {
			const targetType = this.getNodeParameter('targetType', itemIndex) as TicketTypeKey;
			const transformOptions = this.getNodeParameter('transformOptions', itemIndex, {}) as IDataObject;
			await matrix42ApiRequest.call(
				this,
				'POST',
				'ticket/Transform',
				compact({
					ObjectIds: [objectId],
					SourceTypeName: await getTicketTypeName.call(this, objectId),
					TargetTypeName: TICKET_TYPES[targetType].typeName,
					InitDefaultValues: transformOptions.initDefaultValues ?? true,
					Category: resolveLocatorValue(transformOptions.category),
					RecipientRole: resolveLocatorValue(transformOptions.recipientRole),
				}),
			);
			return getTicket.call(this, objectId, {}, itemIndex, kind);
		}

		case 'getApprovals': {
			const rows = await queryFragments.call(this, CHANGE_APPROVAL_CLASS, {
				columns: CHANGE_APPROVAL_COLUMNS,
				where: `Change.[Expression-ObjectID] = ${asqlLiteral(objectId)}`,
				sort: 'CreatedDate DESC',
			});
			return rows.map(simplifyRow);
		}

		case 'proposeMajor': {
			const majorOptions = this.getNodeParameter('majorOptions', itemIndex, {}) as IDataObject;
			await matrix42ApiRequest.call(
				this,
				'PUT',
				`incident/${encodeURIComponent(objectId)}/proposeMajor`,
				compact({
					Comment: majorOptions.comments,
					AffectedServiceID: resolveLocatorValue(majorOptions.affectedService),
				}),
			);
			return getTicket.call(this, objectId, {}, itemIndex, kind);
		}

		case 'declineMajorProposal':
			await matrix42ApiRequest.call(this, 'PUT', `incident/${encodeURIComponent(objectId)}/declineProposeMajor`);
			return getTicket.call(this, objectId, {}, itemIndex, kind);

		case 'setMajor': {
			const majorOptions = this.getNodeParameter('majorOptions', itemIndex, {}) as IDataObject;
			await matrix42ApiRequest.call(
				this,
				'PUT',
				`incident/${encodeURIComponent(objectId)}/major`,
				compact({
					Summary: majorOptions.summary,
					VisibleInSac: majorOptions.visibleInSac ?? false,
					AffectedServiceID: resolveLocatorValue(majorOptions.affectedService),
					IncludeAffectedServiceInSac: majorOptions.includeAffectedServiceInSac,
				}),
			);
			return getTicket.call(this, objectId, {}, itemIndex, kind);
		}

		case 'revertMajor': {
			const removeFromSac = this.getNodeParameter('removeServiceFromSac', itemIndex, true) as boolean;
			await matrix42ApiRequest.call(
				this,
				'DELETE',
				`incident/${encodeURIComponent(objectId)}/major/true/${removeFromSac}`,
			);
			return getTicket.call(this, objectId, {}, itemIndex, kind);
		}

		case 'decideApproval':
			await matrix42ApiRequest.call(
				this,
				'POST',
				'change/DecideChangeApproval',
				compact({
					ChangeObjectId: objectId,
					ChangeApprovalObjectId: this.getNodeParameter('approvalId', itemIndex),
					Agreed: this.getNodeParameter('decision', itemIndex) === 'approve',
					Comments: this.getNodeParameter('comments', itemIndex, ''),
				}),
			);
			return done();
	}

	throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, { itemIndex });
}
