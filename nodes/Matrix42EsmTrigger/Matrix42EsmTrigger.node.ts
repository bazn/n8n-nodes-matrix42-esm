import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { assignmentConditions, buildTicketWhere, typeCondition } from '../Matrix42/actions/ticket';
import {
	ACTIVITY_CLASS,
	BOOKMARK_ACTIVE,
	BOOKMARK_CLASS,
	BOOKMARK_COLUMNS,
	JOURNAL_CLASS,
	JOURNAL_TRIGGER_COLUMNS,
	TICKET_COLUMNS,
	TICKET_TYPES,
	type TicketTypeKey,
} from '../Matrix42/constants';
import {
	assignmentFilterFields,
	authenticationProperty,
	locatorField,
	matrix42Credentials,
} from '../Matrix42/descriptions/shared';
import {
	andWhere,
	asqlLikeContains,
	asqlLiteral,
	expandFilterHierarchies,
	queryFragments,
	resolveLocatorValue,
	simplifyRow,
	getClassColumns,
	rowVersionLiteral,
	simplifyTicketRow,
	splitTopLevel,
	toMatrix42Date,
} from '../Matrix42/GenericFunctions';
import { listSearch, loadOptions } from '../Matrix42/methods';

interface PollState {
	lastTimestamp?: string;
	/** Ids already emitted at `lastTimestamp`, to avoid duplicates on the `>=` boundary. */
	lastIds?: string[];
	/** Event the state belongs to; switching the event restarts from "now". */
	event?: string;
}

/** What a trigger event polls: a fragment class, its time column and how rows are identified. */
interface EventQuery {
	className: string;
	columns: string[];
	/** Column that orders changes: a date column, or the fragment rowversion `TimeStamp`. */
	timeColumn: string;
	/** Whether `timeColumn` is the rowversion (compared with `>` as hex literal instead of a date). */
	isRowVersion?: boolean;
	idField: string;
	where?: string;
	simplify: (row: IDataObject) => IDataObject;
}

const MAX_ITEMS_PER_POLL = 1000;
const MANUAL_PREVIEW_ROWS = 10;
const EMPTY_ROW_VERSION = 'AAAAAAAAAAA=';

const ticketTypeOptions = Object.entries(TICKET_TYPES).map(([value, type]) => ({ name: type.label, value }));

export class Matrix42EsmTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Matrix42 ESM Trigger',
		name: 'matrix42EsmTrigger',
		icon: { light: 'file:../Matrix42/matrix42.svg', dark: 'file:../Matrix42/matrix42.dark.svg' },
		group: ['trigger'],
		version: [1],
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow on new or changed tickets, journal entries, waiting workflows or records of any data definition in Matrix42',
		defaults: {
			name: 'Matrix42 ESM Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: matrix42Credentials,
		properties: [
			authenticationProperty,
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				default: 'created',
				options: [
					{
						name: 'Journal Entry Added',
						value: 'journalEntry',
						description: 'A journal entry (comment, status change, …) was added to a ticket',
					},
					{
						name: 'Object Created or Updated',
						value: 'objectChanged',
						description: 'A record of any data definition (users, assets, contracts, …) was created or changed',
					},
					{ name: 'Ticket Created', value: 'created', description: 'A new ticket was created' },
					{
						name: 'Ticket Created or Updated',
						value: 'updated',
						description: 'A ticket was created or changed',
					},
					{
						name: 'Workflow Waiting',
						value: 'workflowWaiting',
						description: 'A workflow stopped at a waiting activity (bookmark) and can be resumed',
					},
				],
			},
			{
				displayName: 'Data Definition',
				name: 'className',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				description: 'The data definition (class) to watch, e.g. SPSUserClassBase or SPSComputerClassBase',
				displayOptions: { show: { event: ['objectChanged'] } },
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: { searchListMethod: 'searchClasses', searchable: true },
					},
					{ displayName: 'Name', name: 'name', type: 'string', placeholder: 'SPSUserClassBase' },
				],
			},
			{
				displayName: 'Filters',
				name: 'objectFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { event: ['objectChanged'] } },
				options: [
					{
						displayName: 'Columns',
						name: 'columns',
						type: 'string',
						default: '',
						placeholder: 'LastName, FirstName, MailAddress, Location.Name as LocationName',
						description:
							'Comma-separated ASQL column expressions to return. Leave empty to return all attributes of the data definition.',
					},
					{
						displayName: 'Where (ASQL)',
						name: 'where',
						type: 'string',
						default: '',
						placeholder: "Department = 'IT'",
						description: 'Only trigger for records matching this ASQL condition',
					},
				],
			},
			{
				displayName: 'Ticket Types',
				name: 'ticketTypes',
				type: 'multiOptions',
				default: [],
				description: 'Only trigger for these ticket types. Leave empty for all types.',
				options: ticketTypeOptions,
				displayOptions: { show: { event: ['created', 'updated', 'journalEntry'] } },
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { event: ['created', 'updated'] } },
				options: [
					...assignmentFilterFields,
					{
						displayName: 'Custom Where (ASQL)',
						name: 'where',
						type: 'string',
						default: '',
						placeholder: 'Priority >= 3',
						description: 'Additional ASQL condition, combined with the other filters using AND',
					},
					{
						displayName: 'Status Names or IDs',
						name: 'states',
						type: 'multiOptions',
						typeOptions: { loadOptionsMethod: 'getStates' },
						default: [],
						description:
							'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
				],
			},
			{
				displayName: 'Filters',
				name: 'journalFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { event: ['journalEntry'] } },
				options: [
					...assignmentFilterFields,
					locatorField({
						displayName: 'Ignore Entries by User',
						name: 'ignoreCreator',
						searchListMethod: 'searchUsers',
						description: 'Skip entries written by this user, e.g. the integration account, to avoid sync loops',
					}),
					{
						displayName: 'Only Visible in Portal',
						name: 'onlyVisibleInPortal',
						type: 'boolean',
						default: false,
						description: 'Whether to trigger only for entries the initiator can see in the Self Service Portal',
					},
					{
						displayName: 'Only With Text',
						name: 'onlyWithText',
						type: 'boolean',
						default: true,
						description: 'Whether to skip entries without text (e.g. pure status changes)',
					},
				],
			},
			{
				displayName: 'Filters',
				name: 'workflowFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { event: ['workflowWaiting'] } },
				options: [
					{
						displayName: 'Activity Contains',
						name: 'activity',
						type: 'string',
						default: '',
						description: 'Matches the summary of the waiting activity (bookmark)',
					},
					{ displayName: 'Workflow Name Contains', name: 'workflowName', type: 'string', default: '' },
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Test Run Lookback (Minutes)',
						name: 'testLookbackMinutes',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 60,
						description:
							'When the workflow is executed manually in the editor, return all matching items of this many past minutes. Active workflows are not affected.',
					},
				],
			},
		],
	};

	methods = { listSearch, loadOptions };

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const event = this.getNodeParameter('event') as string;
		const query = await buildEventQuery.call(this, event);
		const state = this.getWorkflowStaticData('node') as PollState;

		const hasPosition = !!state.lastTimestamp && state.event === event;

		if (this.getMode() === 'manual') {
			// A manual run never moves the stored position. It shows, in this order: items the active
			// trigger has not delivered yet; else all items of the lookback window; else the newest item as sample.
			if (hasPosition) {
				const pending = await fetchSince.call(this, query, state);
				if (pending.fresh.length) return [this.helpers.returnJsonArray(pending.fresh.map(query.simplify))];
			}
			if (!query.isRowVersion) {
				const lookbackMinutes = (this.getNodeParameter('options.testLookbackMinutes', 60) as number) || 60;
				// Matrix42 compares wall-clock time; the workflow time zone is expected to match the server's.
				const since = toMatrix42Date(
					new Date(Date.now() - lookbackMinutes * 60_000).toISOString(),
					this.getTimezone(),
				) as string;
				const recent = await fetchSince.call(this, query, { lastTimestamp: since, lastIds: [] });
				if (recent.fresh.length) return [this.helpers.returnJsonArray(recent.fresh.map(query.simplify))];
			}
			// A rowversion carries no time, so the most recently changed records serve as preview.
			const rows = await queryFragments.call(
				this,
				query.className,
				{ columns: query.columns, where: query.where, sort: `${query.timeColumn} DESC` },
				query.isRowVersion ? MANUAL_PREVIEW_ROWS : 1,
			);
			return rows.length ? [this.helpers.returnJsonArray(rows.reverse().map(query.simplify))] : null;
		}

		if (!hasPosition) {
			// First activation: start from the newest existing row instead of emitting the whole history.
			// The server's own timestamp is used because Matrix42 reports wall-clock time labelled as UTC.
			const newest = await queryFragments.call(
				this,
				query.className,
				{ columns: query.columns, where: query.where, sort: `${query.timeColumn} DESC` },
				1,
			);
			state.event = event;
			state.lastTimestamp =
				(newest[0]?.[query.timeColumn] as string | undefined) ??
				(query.isRowVersion ? EMPTY_ROW_VERSION : '1900-01-01T00:00:00');
			state.lastIds = newest.map((row) => String(row[query.idField]));
			return null;
		}

		const { rows, fresh } = await fetchSince.call(this, query, state);
		if (rows.length) {
			const seen = state.lastIds ?? [];
			const newest = rows[rows.length - 1][query.timeColumn] as string;
			const idsAtNewest = rows
				.filter((row) => row[query.timeColumn] === newest)
				.map((row) => String(row[query.idField]));
			state.lastIds = newest === state.lastTimestamp ? [...seen, ...idsAtNewest] : idsAtNewest;
			state.lastTimestamp = newest;
		}

		return fresh.length ? [this.helpers.returnJsonArray(fresh.map(query.simplify))] : null;
	}
}

/** Rows at or after the stored position; `fresh` excludes the ones already emitted at that exact timestamp. */
async function fetchSince(
	this: IPollFunctions,
	query: EventQuery,
	state: PollState,
): Promise<{ rows: IDataObject[]; fresh: IDataObject[] }> {
	const rows = await queryFragments.call(
		this,
		query.className,
		{
			columns: query.columns,
			where: andWhere([
				query.where,
				query.isRowVersion
					? `${query.timeColumn} > ${rowVersionLiteral(state.lastTimestamp as string)}`
					: `${query.timeColumn} >= ${asqlLiteral(state.lastTimestamp as string)}`,
			]),
			sort: `${query.timeColumn} ASC`,
		},
		MAX_ITEMS_PER_POLL,
	);
	const seen = new Set(state.lastIds ?? []);
	const fresh = rows.filter(
		(row) => !(row[query.timeColumn] === state.lastTimestamp && seen.has(String(row[query.idField]))),
	);
	return { rows, fresh };
}

async function buildEventQuery(this: IPollFunctions, event: string): Promise<EventQuery> {
	if (event === 'journalEntry') {
		const filters = await expandFilterHierarchies.call(
			this,
			this.getNodeParameter('journalFilters', {}) as IDataObject,
		);
		const ignoreCreator = resolveLocatorValue(filters.ignoreCreator);
		return {
			className: JOURNAL_CLASS,
			columns: JOURNAL_TRIGGER_COLUMNS,
			timeColumn: 'CreatedDate',
			idField: 'ID',
			// Journal entries are fragments of the ticket object, so ticket attributes are reached via T(…).
			where: andWhere([
				typeCondition(this.getNodeParameter('ticketTypes', []) as TicketTypeKey[], 'T(SPSActivityClassBase).'),
				...assignmentConditions(filters, 'T(SPSActivityClassBase).'),
				filters.onlyWithText === false ? undefined : 'OriginalSolution IS NOT NULL',
				filters.onlyVisibleInPortal ? 'VisibleInPortal = 1' : undefined,
				ignoreCreator ? `Creator <> ${asqlLiteral(ignoreCreator)}` : undefined,
			]),
			simplify: simplifyTicketRow,
		};
	}

	if (event === 'objectChanged') {
		const className = this.getNodeParameter('className', '', { extractValue: true }) as string;
		const filters = this.getNodeParameter('objectFilters', {}) as IDataObject;
		const custom = splitTopLevel((filters.columns as string) ?? '');
		const schema = await getClassColumns.call(this, className);
		// Some data definitions have an own attribute "ObjectId" (a readable number); keep it and
		// expose the technical object id as "CiObjectId" there.
		const ownObjectId = schema.columns.some((column) => column.toLowerCase() === '[objectid]');
		return {
			className,
			columns: [
				...(schema.hasObjectId ? [`[Expression-ObjectID] as ${ownObjectId ? 'CiObjectId' : 'ObjectId'}`] : []),
				...(custom.length ? custom : schema.columns),
				'TimeStamp',
			],
			timeColumn: 'TimeStamp',
			isRowVersion: true,
			idField: 'ID',
			where: (filters.where as string) || undefined,
			simplify: simplifyRow,
		};
	}

	if (event === 'workflowWaiting') {
		const filters = this.getNodeParameter('workflowFilters', {}) as IDataObject;
		return {
			className: BOOKMARK_CLASS,
			columns: BOOKMARK_COLUMNS,
			timeColumn: 'CreatedDate',
			idField: 'ID',
			where: andWhere([
				`Status = ${BOOKMARK_ACTIVE}`,
				filters.activity ? `Summary LIKE ${asqlLikeContains(String(filters.activity))}` : undefined,
				filters.workflowName
					? `T(PLSLProcessInstanceClassBase).Name LIKE ${asqlLikeContains(String(filters.workflowName))}`
					: undefined,
			]),
			simplify: simplifyRow,
		};
	}

	const filters = await expandFilterHierarchies.call(this, {
		...(this.getNodeParameter('filters', {}) as IDataObject),
		ticketTypes: this.getNodeParameter('ticketTypes', []) as string[],
	});
	return {
		className: ACTIVITY_CLASS,
		columns: TICKET_COLUMNS,
		timeColumn: event === 'created' ? 'CreatedDate' : 'LastChangeDate',
		idField: 'ObjectId',
		where: buildTicketWhere('ticket', filters, this.getTimezone()),
		simplify: simplifyTicketRow,
	};
}
