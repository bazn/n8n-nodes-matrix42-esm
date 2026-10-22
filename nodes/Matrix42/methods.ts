import type {
	FieldType,
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';

import {
	ACTIVITY_CLASS,
	APPROVAL_TASK_CLASS,
	APPROVAL_TASK_OPEN,
	BOOKMARK_ACTIVE,
	BOOKMARK_CLASS,
	TICKET_TYPES,
	type TicketTypeKey,
} from './constants';
import {
	andWhere,
	asqlLikeContains,
	loadTree,
	matrix42ApiRequest,
	queryFragments,
	simplifyTicketRow,
} from './GenericFunctions';

const LIST_PAGE_SIZE = 50;

interface ListSearchSpec {
	className: string;
	columns: string[];
	sort?: string;
	/** Builds the ASQL condition for the user's search text. */
	search?: (pattern: string) => string;
	/** Always-applied condition, e.g. a type restriction. */
	baseWhere?: string;
	valueField?: string;
	name?: (row: IDataObject) => string;
}

async function listSearchFragments(
	this: ILoadOptionsFunctions,
	spec: ListSearchSpec,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const pageNumber = paginationToken ? Number(paginationToken) : 0;
	const where = andWhere([spec.baseWhere, filter && spec.search ? spec.search(asqlLikeContains(filter)) : undefined]);
	const qs: IDataObject = {
		Columns: ['ID', ...spec.columns].join(','),
		PageSize: LIST_PAGE_SIZE,
		PageNumber: pageNumber,
	};
	if (where) qs.Where = where;
	if (spec.sort) qs.Sort = spec.sort;

	const rows = (await matrix42ApiRequest.call(
		this,
		'GET',
		`data/fragments/${encodeURIComponent(spec.className)}`,
		undefined,
		qs,
	)) as IDataObject[];

	return {
		results: rows.map((row) => ({
			name: spec.name ? spec.name(row) : String(row.DisplayString ?? row.ID),
			value: String(row[spec.valueField ?? 'ID']),
		})),
		paginationToken: rows.length === LIST_PAGE_SIZE ? String(pageNumber + 1) : undefined,
	};
}

const templateName = 'T(SPSActivityTemplateClassBase).Name';

export const listSearch = {
	async searchCategories(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return listSearchFragments.call(
			this,
			{
				className: 'SPSScCategoryClassBase',
				columns: ['Name'],
				sort: 'Name ASC',
				search: (pattern) => `Name LIKE ${pattern}`,
			},
			filter,
			paginationToken,
		);
	},

	async searchRoles(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return listSearchFragments.call(
			this,
			{
				className: 'SPSScRoleClassBase',
				columns: ['T(SPSSecurityClassRole).Name as Name'],
				sort: 'Name ASC',
				search: (pattern) => `T(SPSSecurityClassRole).Name LIKE ${pattern}`,
			},
			filter,
			paginationToken,
		);
	},

	async searchUsers(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return listSearchFragments.call(
			this,
			{
				className: 'SPSUserClassBase',
				columns: ['LastName', 'FirstName', 'MailAddress'],
				sort: 'LastName ASC',
				search: (pattern) =>
					`LastName LIKE ${pattern} OR FirstName LIKE ${pattern} OR MailAddress LIKE ${pattern}`,
				name: (row) =>
					row.MailAddress ? `${row.DisplayString as string} (${row.MailAddress as string})` : String(row.DisplayString),
			},
			filter,
			paginationToken,
		);
	},

	async searchServices(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return listSearchFragments.call(
			this,
			{
				className: 'SPSArticleClassBase',
				columns: ['Name'],
				sort: 'Name ASC',
				search: (pattern) => `Name LIKE ${pattern}`,
			},
			filter,
			paginationToken,
		);
	},

	async searchQuickCalls(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return listSearchFragments.call(
			this,
			{
				className: 'SPSQuickCallClassBase',
				columns: [`${templateName} as Name`],
				sort: 'Name ASC',
				search: (pattern) => `${templateName} LIKE ${pattern}`,
			},
			filter,
			paginationToken,
		);
	},

	async searchTaskTemplates(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return listSearchFragments.call(
			this,
			{
				className: 'SPSActivityTemplateClassBase',
				columns: ['Name'],
				sort: 'Name ASC',
				baseWhere: 'UsedInTypeSPSActivityTemplateType IS NOT NULL',
				search: (pattern) => `Name LIKE ${pattern}`,
			},
			filter,
			paginationToken,
		);
	},

	async searchChangeTemplates(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return listSearchFragments.call(
			this,
			{
				className: 'SVMChangeTemplateClassBase',
				columns: [`${templateName} as Name`],
				sort: 'Name ASC',
				search: (pattern) => `${templateName} LIKE ${pattern}`,
			},
			filter,
			paginationToken,
		);
	},

	async searchAssets(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return listSearchFragments.call(
			this,
			{
				className: 'SPSAssetClassBase',
				columns: ['T(SPSComputerClassBase).Name as ComputerName', 'SerialNumber', 'InventoryNumber'],
				search: (pattern) =>
					`T(SPSComputerClassBase).Name LIKE ${pattern} OR SerialNumber LIKE ${pattern} OR InventoryNumber LIKE ${pattern}`,
			},
			filter,
			paginationToken,
		);
	},

	async searchTickets(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		const resource = this.getCurrentNodeParameter('resource') as string;
		const type = TICKET_TYPES[resource as TicketTypeKey];
		return listSearchFragments.call(
			this,
			{
				className: ACTIVITY_CLASS,
				columns: ['[Expression-ObjectID] as ObjectId', 'TicketNumber', 'CreatedDate'],
				sort: 'CreatedDate DESC',
				baseWhere: type && resource !== 'ticket' ? `UsedInType${type.typeName} IS NOT NULL` : undefined,
				search: (pattern) => `TicketNumber LIKE ${pattern} OR Subject LIKE ${pattern}`,
				valueField: 'ObjectId',
				name: (row) => String(simplifyTicketRow(row).DisplayString),
			},
			filter,
			paginationToken,
		);
	},

	async searchWaitingWorkflows(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return listSearchFragments.call(
			this,
			{
				className: BOOKMARK_CLASS,
				columns: ['Summary', 'CreatedDate', 'T(PLSLProcessInstanceClassBase).Name as WorkflowName'],
				sort: 'CreatedDate DESC',
				baseWhere: `Status = ${BOOKMARK_ACTIVE}`,
				search: (pattern) => `Summary LIKE ${pattern} OR T(PLSLProcessInstanceClassBase).Name LIKE ${pattern}`,
				name: (row) =>
					`${row.WorkflowName as string} – ${row.Summary as string} (${String(row.CreatedDate).slice(0, 10)})`,
			},
			filter,
			paginationToken,
		);
	},

	async searchWorkflows(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return listSearchFragments.call(
			this,
			{
				className: 'PLSLXamlComponentClassBase',
				columns: ['[Expression-ObjectID] as ObjectId', 'T(PLSLComponentClassBase).Title as Title'],
				sort: 'Title ASC',
				search: (pattern) => `T(PLSLComponentClassBase).Title LIKE ${pattern}`,
				valueField: 'ObjectId',
				name: (row) => String(row.Title ?? row.DisplayString),
			},
			filter,
			paginationToken,
		);
	},

	async searchApprovalTasks(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return listSearchFragments.call(
			this,
			{
				className: APPROVAL_TASK_CLASS,
				columns: ['[Expression-ObjectID] as ObjectId', 'TicketNumber', 'CreatedDate'],
				sort: 'CreatedDate DESC',
				baseWhere: `T(SPSCommonClassBase).State = ${APPROVAL_TASK_OPEN}`,
				search: (pattern) => `TicketNumber LIKE ${pattern}`,
				valueField: 'ObjectId',
			},
			filter,
			paginationToken,
		);
	},

	async searchDataQueries(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return listSearchFragments.call(
			this,
			{
				className: 'PDRDataQueryClassBase',
				columns: ['[Expression-ObjectID] as ObjectId', 'Name'],
				sort: 'Name ASC',
				search: (pattern) => `Name LIKE ${pattern}`,
				valueField: 'ObjectId',
				name: (row) => String(row.Name ?? row.DisplayString),
			},
			filter,
			paginationToken,
		);
	},

	async searchImportDefinitions(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
		return listSearchFragments.call(
			this,
			{
				className: 'GDIEImportClassBase',
				columns: ['[Expression-ObjectID] as ObjectId', 'Name'],
				sort: 'Name ASC',
				search: (pattern) => `Name LIKE ${pattern}`,
				valueField: 'ObjectId',
				name: (row) => String(row.Name ?? row.DisplayString),
			},
			filter,
			paginationToken,
		);
	},

	async searchTypes(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		const types = (await matrix42ApiRequest.call(this, 'GET', 'Schema/types')) as IDataObject[];
		const needle = (filter ?? '').toLowerCase();
		return {
			results: types
				.filter(
					(type) =>
						!needle ||
						String(type.InternalName).toLowerCase().includes(needle) ||
						String(type.DisplayName).toLowerCase().includes(needle),
				)
				.sort((a, b) => String(a.InternalName).localeCompare(String(b.InternalName)))
				.map((type) => ({
					name: `${type.InternalName as string} (${type.DisplayName as string})`,
					value: String(type.InternalName),
				})),
		};
	},

	async searchClasses(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		const classes = (await matrix42ApiRequest.call(this, 'GET', 'Schema/classes')) as IDataObject[];
		const needle = (filter ?? '').toLowerCase();
		return {
			results: classes
				.filter((cls) => !cls.IsPickup)
				.filter(
					(cls) =>
						!needle ||
						String(cls.InternalName).toLowerCase().includes(needle) ||
						String(cls.DisplayName).toLowerCase().includes(needle),
				)
				.sort((a, b) => String(a.InternalName).localeCompare(String(b.InternalName)))
				.map((cls) => ({
					name: `${cls.InternalName as string} (${cls.DisplayName as string})`,
					value: String(cls.InternalName),
				})),
		};
	},
};

async function loadPickup(this: ILoadOptionsFunctions, className: string, where?: string) {
	const qs: IDataObject = { Columns: 'ID,Value', PageSize: 500, Sort: 'Value ASC' };
	if (where) qs.Where = where;
	const rows = (await matrix42ApiRequest.call(
		this,
		'GET',
		`data/fragments/${className}`,
		undefined,
		qs,
	)) as IDataObject[];
	return rows.map(
		(row): INodePropertyOptions => ({
			name: `${row.DisplayString as string} (${row.Value as number})`,
			value: row.Value as number,
		}),
	);
}

/** All entries of a hierarchical data definition, named by their path (e.g. "Service Desk / Störungen"). */
async function treeOptions(this: ILoadOptionsFunctions, className: string): Promise<INodePropertyOptions[]> {
	const tree = await loadTree.call(this, className);
	const byId = new Map(tree.map((node) => [node.id, node]));
	const path = (node: (typeof tree)[number]) => {
		const names = [node.name];
		let parent = node.parent ? byId.get(node.parent) : undefined;
		for (let depth = 0; parent && depth < 10; depth++) {
			names.unshift(parent.name);
			parent = parent.parent ? byId.get(parent.parent) : undefined;
		}
		return names.join(' / ');
	};
	return tree.map((node) => ({ name: path(node), value: node.id })).sort((a, b) => a.name.localeCompare(b.name));
}

async function flatOptions(this: ILoadOptionsFunctions, className: string): Promise<INodePropertyOptions[]> {
	const rows = await queryFragments.call(this, className, { columns: [] });
	return rows
		.map((row) => ({ name: String(row.DisplayString ?? row.ID), value: row.ID as string }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export const loadOptions = {
	async getImpacts(this: ILoadOptionsFunctions) {
		return loadPickup.call(this, 'SVMActivityPickupImpact');
	},
	async getUrgencies(this: ILoadOptionsFunctions) {
		return loadPickup.call(this, 'SVMActivityPickupUrgency');
	},
	async getPriorities(this: ILoadOptionsFunctions) {
		return loadPickup.call(this, 'SPSActivityPickupPriority');
	},
	async getCloseReasons(this: ILoadOptionsFunctions) {
		return loadPickup.call(this, 'SPSCommonPickupObjectStateReason');
	},
	async getStates(this: ILoadOptionsFunctions) {
		return loadPickup.call(this, 'SPSCommonPickupObjectStatus');
	},
	async getCategories(this: ILoadOptionsFunctions) {
		return treeOptions.call(this, 'SPSScCategoryClassBase');
	},
	async getOrgUnits(this: ILoadOptionsFunctions) {
		return treeOptions.call(this, 'SPSOrgUnitClassBase');
	},
	async getLocations(this: ILoadOptionsFunctions) {
		return treeOptions.call(this, 'SPSLocationClassBase');
	},
	async getCostCenters(this: ILoadOptionsFunctions) {
		return flatOptions.call(this, 'SPSCostCenterClassBase');
	},
	async getServices(this: ILoadOptionsFunctions) {
		return flatOptions.call(this, 'SPSArticleClassBase');
	},
	async getRoles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const rows = await queryFragments.call(this, 'SPSScRoleClassBase', {
			columns: ['T(SPSSecurityClassRole).Name as Name'],
			sort: 'Name ASC',
		});
		return rows.map((row) => ({ name: String(row.Name ?? row.DisplayString), value: row.ID as string }));
	},
};

/** Maps Matrix42 contract types (from a workflow descriptor) to n8n field types. */
function toFieldType(contractType: unknown): FieldType {
	if (Array.isArray(contractType)) return 'array';
	switch (contractType) {
		case 'IntType':
		case 'LongType':
		case 'DecimalType':
		case 'DoubleType':
			return 'number';
		case 'BoolType':
			return 'boolean';
		case 'DateType':
			return 'dateTime';
		case 'StringType':
		case 'GuidType':
			return 'string';
		default:
			return 'object';
	}
}

export const resourceMapping = {
	async getWorkflowArguments(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
		const workflowId = this.getNodeParameter('workflowId', undefined, { extractValue: true }) as string;
		if (!workflowId) return { fields: [] };
		const descriptor = (await matrix42ApiRequest.call(
			this,
			'GET',
			`workflow/Descriptor/${encodeURIComponent(workflowId)}`,
		)) as { RequestContract?: { UsedTypes?: Record<string, { Descriptor?: Record<string, IDataObject> }> } };
		const args = descriptor?.RequestContract?.UsedTypes?.WorkflowArguments?.Descriptor ?? {};
		const fields: ResourceMapperField[] = Object.entries(args).map(([name, info]) => ({
			id: name,
			displayName: String(info.Title ?? name),
			required: false,
			defaultMatch: false,
			display: true,
			type: toFieldType(info.Type),
			canBeUsedToMatch: false,
		}));
		return { fields };
	},
};
