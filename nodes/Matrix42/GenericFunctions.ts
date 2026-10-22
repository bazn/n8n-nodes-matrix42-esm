import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeParameterResourceLocator,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { ACTIVITY_CLASS, TICKET_TYPE_BY_ID, TICKET_TYPE_NAME_BY_ID } from './constants';

export type Matrix42Context = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

const API_PREFIX = 'm42Services/api';
const MAX_PAGE_SIZE = 500;

export function getBaseUrl(url: string): string {
	const trimmed = url.trim().replace(/\/+$/, '');
	return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function matrix42ApiRequest(
	this: Matrix42Context,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject | IDataObject[],
	qs: IDataObject = {},
): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
	const options: Omit<IHttpRequestOptions, 'url'> & { url: string } = { method, url: endpoint, qs, json: true };
	if (body !== undefined) {
		options.body = body;
	}
	return matrix42RawRequest.call(this, options);
}

export const TOKEN_CREDENTIAL = 'matrix42EsmApi';
export const BASIC_CREDENTIAL = 'matrix42EsmBasicApi';

/** Credential type chosen in the node's "Authentication" parameter (API token unless Basic Auth is selected). */
export function matrix42CredentialType(context: Matrix42Context): string {
	let authentication: unknown;
	try {
		authentication =
			'getInputData' in context
				? (context as IExecuteFunctions).getNodeParameter('authentication', 0, 'apiToken')
				: (context as ILoadOptionsFunctions | IPollFunctions).getNodeParameter('authentication', 'apiToken');
	} catch {
		authentication = 'apiToken';
	}
	return authentication === 'basicAuth' ? BASIC_CREDENTIAL : TOKEN_CREDENTIAL;
}

/** HTTP status Matrix42 answers for an expired or invalid access token (verified live, it is not 401). */
const TOKEN_REJECTED_STATUS = 406;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Access tokens obtained by the 406 fallback, per Matrix42 URL and API token (in memory only). */
const fallbackTokens = new Map<string, { token: string; expiresAt: number }>();

function statusOf(error: unknown): number | undefined {
	const candidate = error as { httpCode?: string; response?: { status?: number }; cause?: { response?: { status?: number } } };
	const status = candidate.httpCode ?? candidate.response?.status ?? candidate.cause?.response?.status;
	return status === undefined ? undefined : Number(status);
}

/**
 * Request with the Matrix42 credential. `url` may be absolute or relative to the API.
 * n8n only renews a pre-authentication token on 401 by default, but Matrix42 rejects expired tokens
 * with 406. Newer n8n versions are told to renew on 406 as well; where that is not supported, the
 * node exchanges the API token itself and retries.
 */
export async function matrix42RawRequest(
	this: Matrix42Context,
	options: Omit<IHttpRequestOptions, 'url'> & { url: string },
): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
	const credentialType = matrix42CredentialType(this);
	const credentials = await this.getCredentials<{
		url: string;
		apiToken: string;
		language?: string;
		ignoreSslIssues?: boolean;
	}>(credentialType);
	const url = /^https?:\/\//i.test(options.url)
		? options.url
		: `${getBaseUrl(credentials.url)}/${API_PREFIX}/${options.url.replace(/^\/+/, '')}`;
	options = { ...options, skipSslCertificateValidation: credentials.ignoreSslIssues === true };

	const wrap = (error: unknown) =>
		new NodeApiError(this.getNode(), error as JsonObject, { message: extractMatrix42Message(error) });

	if (credentialType === BASIC_CREDENTIAL) {
		try {
			return await this.helpers.httpRequestWithAuthentication.call(this, credentialType, { ...options, url });
		} catch (error) {
			throw wrap(error);
		}
	}

	const cacheKey = `${getBaseUrl(credentials.url)}|${credentials.apiToken}`;

	const cached = fallbackTokens.get(cacheKey);
	if (!cached || Date.now() >= cached.expiresAt) {
		try {
			return await this.helpers.httpRequestWithAuthentication.call(
				this,
				TOKEN_CREDENTIAL,
				{ ...options, url },
				{ preAuthenticationRetryStatusCode: [401, TOKEN_REJECTED_STATUS] },
			);
		} catch (error) {
			if (statusOf(error) !== TOKEN_REJECTED_STATUS) throw wrap(error);
		}
	}
	try {
		return await requestWithFallbackToken.call(this, { ...options, url }, credentials, cacheKey);
	} catch (error) {
		throw wrap(error);
	}
}

async function requestWithFallbackToken(
	this: Matrix42Context,
	options: IHttpRequestOptions,
	credentials: { url: string; apiToken: string; language?: string; ignoreSslIssues?: boolean },
	cacheKey: string,
): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
	let cached = fallbackTokens.get(cacheKey);
	if (!cached || Date.now() >= cached.expiresAt) {
		const exchange = (await this.helpers.httpRequest({
			method: 'POST',
			url: `${getBaseUrl(credentials.url)}/${API_PREFIX}/ApiToken/GenerateAccessTokenFromApiToken`,
			headers: { Authorization: `Bearer ${credentials.apiToken}`, Accept: 'application/json' },
			json: true,
			skipSslCertificateValidation: credentials.ignoreSslIssues === true,
		})) as { RawToken?: string; LifeTime?: string };
		if (!exchange.RawToken) {
			throw new NodeOperationError(this.getNode(), 'Matrix42 did not return an access token. Check the API token.');
		}
		cached = { token: exchange.RawToken, expiresAt: Date.now() + lifetimeMs(exchange.LifeTime) - TOKEN_REFRESH_MARGIN_MS };
		fallbackTokens.set(cacheKey, cached);
	}
	return this.helpers.httpRequest({
		...options,
		headers: {
			...(options.headers ?? {}),
			Authorization: `Bearer ${cached.token}`,
			...(credentials.language ? { 'Explicit-Language': credentials.language } : {}),
		},
	});
}

/** Parses the token lifetime ("hh:mm:ss"); defaults to 55 minutes. */
function lifetimeMs(lifetime: string | undefined): number {
	const match = /^(\d+):(\d{2}):(\d{2})/.exec(lifetime ?? '');
	const ms = match ? (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 : 0;
	return ms > 0 ? ms : 55 * 60_000;
}

function extractMatrix42Message(error: unknown): string | undefined {
	const candidate = error as { response?: { body?: unknown }; cause?: { response?: { data?: unknown } } };
	const body = candidate.response?.body ?? candidate.cause?.response?.data;
	if (body && typeof body === 'object' && 'Message' in body) {
		return String((body as { Message: unknown }).Message);
	}
	if (Array.isArray(body) && body[0]?.Message !== undefined) {
		return body.map((entry: IDataObject) => `${entry.Name ?? ''} ${entry.Message ?? ''}`.trim()).join('; ');
	}
	return undefined;
}

/** Escapes a value for use inside an ASQL string literal. */
export function asqlLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/** Escapes a value for use inside an ASQL `LIKE '%…%'` pattern. */
export function asqlLikeContains(value: string): string {
	const escaped = value.replace(/'/g, "''").replace(/\[/g, '[[]').replace(/%/g, '[%]').replace(/_/g, '[_]');
	return `'%${escaped}%'`;
}

/** Splits a comma separated expression list, ignoring commas inside parentheses or brackets. */
export function splitTopLevel(input: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = '';
	for (const char of input) {
		if (char === '(' || char === '[') depth++;
		if (char === ')' || char === ']') depth--;
		if (char === ',' && depth === 0) {
			parts.push(current);
			current = '';
			continue;
		}
		current += char;
	}
	parts.push(current);
	return parts.map((part) => part.trim()).filter((part) => part !== '');
}

function columnOutputName(column: string): string {
	const alias = /\s+as\s+([\w-]+)\s*$/i.exec(column);
	return (alias ? alias[1] : column).toLowerCase();
}

/**
 * The Fragments API rejects queries whose columns lack `ID` (it is the default sort key) and
 * queries that sort on a column that is not selected. Both are added here so callers don't have to care.
 */
export function buildColumns(columns: string[], sort?: string): string[] {
	const result = ['ID'];
	const known = new Set(['id']);
	const add = (column: string) => {
		const key = columnOutputName(column);
		const raw = column.toLowerCase();
		if (known.has(key) || known.has(raw)) return;
		known.add(key);
		known.add(raw);
		result.push(column);
	};
	columns.forEach(add);
	for (const sortPart of splitTopLevel(sort ?? '')) {
		add(sortPart.replace(/\s+(asc|desc)\s*$/i, '').trim());
	}
	return result;
}

export interface FragmentQuery {
	columns: string[];
	where?: string;
	sort?: string;
}

/**
 * Queries `data/fragments/{class}`. The wire `PageNumber` is 0-based (verified live).
 * Pass `limit` to stop after that many rows, or omit it to fetch every page.
 */
export async function queryFragments(
	this: Matrix42Context,
	className: string,
	query: FragmentQuery,
	limit?: number,
): Promise<IDataObject[]> {
	const pageSize = limit ? Math.min(limit, MAX_PAGE_SIZE) : MAX_PAGE_SIZE;
	const qs: IDataObject = {
		Columns: buildColumns(query.columns, query.sort).join(','),
		PageSize: pageSize,
	};
	if (query.where) qs.Where = query.where;
	if (query.sort) qs.Sort = query.sort;

	const results: IDataObject[] = [];
	for (let pageNumber = 0; ; pageNumber++) {
		const rows = (await matrix42ApiRequest.call(
			this,
			'GET',
			`data/fragments/${encodeURIComponent(className)}`,
			undefined,
			{ ...qs, PageNumber: pageNumber },
		)) as IDataObject[];
		results.push(...rows);
		if (rows.length < pageSize || (limit !== undefined && results.length >= limit)) break;
	}
	return limit !== undefined ? results.slice(0, limit) : results;
}

/** Joins ASQL conditions with AND, wrapping each one in parentheses. */
export function andWhere(conditions: Array<string | undefined>): string | undefined {
	const parts = conditions.filter((condition): condition is string => !!condition && condition.trim() !== '');
	if (parts.length === 0) return undefined;
	return parts.map((part) => `(${part})`).join(' AND ');
}

/** Drops Fragments API bookkeeping fields and labels the ticket type. */
export function simplifyRow(row: IDataObject): IDataObject {
	const rest = { ...row };
	const typeId = rest['Expression-TypeID'];
	delete rest['Expression-TypeCase'];
	delete rest['Expression-TypeID'];
	return typeId === undefined ? rest : { ...rest, TypeId: typeId };
}

export function simplifyTicketRow(row: IDataObject): IDataObject {
	const simplified = simplifyRow(row);
	return { ...simplified, TicketType: TICKET_TYPE_BY_ID[simplified.TypeId as string] ?? null };
}

/** Reads a value that may be a plain string or a resource locator (e.g. inside a collection). */
export function resolveLocatorValue(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'object' && 'value' in (value as IDataObject)) {
		const inner = (value as INodeParameterResourceLocator).value;
		return inner === undefined || inner === null || inner === '' ? undefined : String(inner);
	}
	return value === '' ? undefined : String(value);
}

/** Resolves a ticket resource locator to its object id (the id all ticket operations take). */
export async function resolveTicketId(
	this: IExecuteFunctions,
	parameterName: string,
	itemIndex: number,
): Promise<string> {
	const locator = this.getNodeParameter(parameterName, itemIndex) as INodeParameterResourceLocator;
	const value = String(locator.value ?? '').trim();
	if (value === '') {
		throw new NodeOperationError(this.getNode(), 'No ticket specified', { itemIndex });
	}
	if (locator.mode !== 'ticketNumber') {
		return value;
	}

	const rows = await queryFragments.call(
		this,
		ACTIVITY_CLASS,
		{ columns: ['[Expression-ObjectID] as ObjectId'], where: `TicketNumber = ${asqlLiteral(value)}` },
		1,
	);
	if (rows.length === 0) {
		throw new NodeOperationError(this.getNode(), `No ticket found with number "${value}"`, { itemIndex });
	}
	return rows[0].ObjectId as string;
}

/**
 * Returns the CI type name (e.g. SPSActivityTypeIncident) of a ticket object.
 * ticket/GetTicketEntityType answers SPSActivityTypeIncident even for tasks and changes (verified live),
 * so the type is read from the fragment's own type id and the endpoint is only a fallback.
 */
export async function getTicketTypeName(this: IExecuteFunctions, objectId: string): Promise<string> {
	const rows = await queryFragments.call(
		this,
		ACTIVITY_CLASS,
		{ columns: [], where: `[Expression-ObjectID] = ${asqlLiteral(objectId)}` },
		1,
	);
	const typeName = rows.length ? TICKET_TYPE_NAME_BY_ID[rows[0]['Expression-TypeID'] as string] : undefined;
	if (typeName) return typeName;
	return (await matrix42ApiRequest.call(
		this,
		'GET',
		`ticket/GetTicketEntityType/${encodeURIComponent(objectId)}`,
	)) as string;
}

/** Returns the CI type id of a ticket object (needed e.g. to attach files to it). */
export async function getTicketTypeId(this: IExecuteFunctions, objectId: string): Promise<string> {
	const rows = await queryFragments.call(
		this,
		ACTIVITY_CLASS,
		{ columns: [], where: `[Expression-ObjectID] = ${asqlLiteral(objectId)}` },
		1,
	);
	if (!rows.length) {
		throw new NodeOperationError(this.getNode(), `Ticket ${objectId} not found`);
	}
	return rows[0]['Expression-TypeID'] as string;
}

/**
 * Matrix42 stores and compares timestamps as server wall-clock time and ignores any offset
 * (verified live: "…T10:00:00Z" and "…T10:00:00" are stored identically). Values are therefore
 * converted to wall-clock time in the workflow's time zone, which should match the server's.
 */
export function toMatrix42Date(value: unknown, timeZone: string): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const text = String(value);
	if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) return text.slice(0, 19);
	const date = new Date(text);
	if (Number.isNaN(date.getTime())) return text;
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23',
		})
			.formatToParts(date)
			.map((part) => [part.type, part.value]),
	);
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function parseIdList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String).filter((id) => id.trim() !== '');
	if (typeof value !== 'string') return [];
	return value
		.split(',')
		.map((id) => id.trim())
		.filter((id) => id !== '');
}

export function parseJsonParameter(
	this: IExecuteFunctions,
	value: unknown,
	parameterName: string,
	itemIndex: number,
): IDataObject {
	if (value === undefined || value === null || value === '') return {};
	if (typeof value === 'object') return value as IDataObject;
	try {
		const parsed = JSON.parse(String(value)) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as IDataObject;
	} catch {
		// handled below
	}
	throw new NodeOperationError(this.getNode(), `"${parameterName}" must be a JSON object`, { itemIndex });
}

export interface TreeNode {
	id: string;
	name: string;
	parent?: string;
}

/** Loads a self-referencing data definition (categories, org units, locations) as a flat tree. */
export async function loadTree(this: Matrix42Context, className: string): Promise<TreeNode[]> {
	const rows = await queryFragments.call(this, className, { columns: ['Parent'] });
	return rows.map((row) => ({
		id: row.ID as string,
		name: String(row.DisplayString ?? row.ID),
		parent: (row.Parent as string | null) ?? undefined,
	}));
}

/** Returns the given nodes together with all of their descendants. */
export function withSubcategories(tree: TreeNode[], ids: string[]): string[] {
	const children = new Map<string, string[]>();
	for (const node of tree) {
		if (!node.parent) continue;
		children.set(node.parent, [...(children.get(node.parent) ?? []), node.id]);
	}
	const result = new Set<string>();
	const stack = [...ids];
	while (stack.length) {
		const id = stack.pop() as string;
		if (result.has(id)) continue;
		result.add(id);
		stack.push(...(children.get(id) ?? []));
	}
	return [...result];
}

/** Hierarchical filters: filter field, its "include children" toggle and the data definition. */
const HIERARCHICAL_FILTERS = [
	{ field: 'categories', toggle: 'includeSubcategories', className: 'SPSScCategoryClassBase' },
	{ field: 'orgUnits', toggle: 'includeSubOrgUnits', className: 'SPSOrgUnitClassBase' },
	{ field: 'locations', toggle: 'includeSubLocations', className: 'SPSLocationClassBase' },
];

/** Adds descendants to hierarchical filters unless their toggle is explicitly false. */
export async function expandFilterHierarchies(this: Matrix42Context, filters: IDataObject): Promise<IDataObject> {
	const expanded = { ...filters };
	for (const { field, toggle, className } of HIERARCHICAL_FILTERS) {
		const ids = Array.isArray(filters[field]) ? (filters[field] as string[]) : [];
		if (filters[toggle] === false || ids.length === 0) continue;
		expanded[field] = withSubcategories(await loadTree.call(this, className), ids);
	}
	return expanded;
}

/**
 * Fragments expose a SQL rowversion `TimeStamp` (base64). It increases database-wide on every change,
 * and ASQL compares it as a hex literal (verified live: `TimeStamp > 0x…`).
 */
export function rowVersionLiteral(base64: string): string {
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
		throw new Error(`Invalid row version "${base64}"`);
	}
	return `0x${Buffer.from(base64, 'base64').toString('hex')}`;
}

/** Attribute types that are not returned by default: blob, virtual relation end, varbinary. */
const NON_DEFAULT_DATATYPES = new Set([6, 7, 13]);

/**
 * Default columns of a data definition: its scalar attributes plus its single-valued relations, quoted
 * because attribute names may be reserved words (e.g. `End`). `hasObjectId` is false for pure data
 * classes that belong to no configuration item type and therefore have no `[Expression-ObjectID]`.
 */
export async function getClassColumns(
	this: Matrix42Context,
	className: string,
): Promise<{ columns: string[]; hasObjectId: boolean }> {
	const schema = (await matrix42ApiRequest.call(this, 'GET', `Schema/classes/${encodeURIComponent(className)}`)) as {
		UsedInTypes?: unknown[];
		Attributes?: Array<{ InternalName: string; Datatype: number }>;
		Relations?: Array<{
			AttributeNameLeft: string;
			AttributeNameRight: string;
			AttributeDataTypeLeft?: number;
			AttributeDataTypeRight?: number;
			ClassLeft: { InternalName: string };
			ClassRight: { InternalName: string };
		}>;
	};
	const attributes = (schema.Attributes ?? [])
		.filter((attribute) => !NON_DEFAULT_DATATYPES.has(attribute.Datatype))
		.map((attribute) => attribute.InternalName);
	// A relation end is a real column only where it holds the foreign key; the other end (and both
	// ends of N:M relations) are "virtual relation ends" (datatype 7) and cannot be selected.
	const relations = (schema.Relations ?? []).flatMap((relation) => [
		...(relation.ClassLeft.InternalName === className && !NON_DEFAULT_DATATYPES.has(relation.AttributeDataTypeLeft ?? 7)
			? [relation.AttributeNameLeft]
			: []),
		...(relation.ClassRight.InternalName === className && !NON_DEFAULT_DATATYPES.has(relation.AttributeDataTypeRight ?? 7)
			? [relation.AttributeNameRight]
			: []),
	]);
	return {
		columns: [...new Set([...attributes, ...relations])].sort().map((name) => `[${name}]`),
		hasObjectId: (schema.UsedInTypes ?? []).length > 0,
	};
}
