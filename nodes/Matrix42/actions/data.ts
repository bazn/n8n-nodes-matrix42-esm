import { randomUUID } from 'crypto';
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import { matrix42ApiRequest, parseJsonParameter } from '../GenericFunctions';

const DATA_QUERY_PAGE_SIZE = 500;
const POLL_INTERVAL_MS = 3000;

export async function executeDataQuery(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	if (operation !== 'getData') {
		throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, { itemIndex });
	}
	const dataQueryId = this.getNodeParameter('dataQueryId', itemIndex, '', { extractValue: true }) as string;
	const limit = this.getNodeParameter('returnAll', itemIndex)
		? undefined
		: (this.getNodeParameter('limit', itemIndex) as number);
	const options = this.getNodeParameter('dataQueryOptions', itemIndex, {}) as IDataObject;
	const userFilters = parseJsonParameter.call(this, options.userFilters, 'User Filters (JSON)', itemIndex);
	const hasUserFilters = Object.keys(userFilters).length > 0;

	const qs: IDataObject = {};
	for (const key of ['columns', 'orderBy', 'search']) {
		if (options[key]) qs[key] = options[key];
	}
	const pageSize = limit ? Math.min(limit, DATA_QUERY_PAGE_SIZE) : DATA_QUERY_PAGE_SIZE;

	// Pages are 0-based; user filters are only accepted in the body of the POST variant.
	const rows: IDataObject[] = [];
	for (let page = 0; ; page++) {
		const response = (await matrix42ApiRequest.call(
			this,
			hasUserFilters ? 'POST' : 'GET',
			`DataQuery/${encodeURIComponent(dataQueryId)}`,
			hasUserFilters ? userFilters : undefined,
			{ ...qs, pageSize, page },
		)) as IDataObject[] | IDataObject;
		const pageRows = Array.isArray(response) ? response : [response];
		rows.push(...pageRows);
		if (pageRows.length < pageSize || (limit !== undefined && rows.length >= limit)) break;
	}
	return limit !== undefined ? rows.slice(0, limit) : rows;
}

export async function executeImport(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject> {
	const sequenceId = this.getNodeParameter('importDefinitionId', itemIndex, '', { extractValue: true }) as string;

	if (operation === 'getProgress') {
		return (await matrix42ApiRequest.call(this, 'POST', 'importdata/getProgress', undefined, {
			sequenceId,
			loggerId: this.getNodeParameter('loggerId', itemIndex),
		})) as IDataObject;
	}

	if (operation !== 'execute') {
		throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, { itemIndex });
	}
	const parameters = (
		(this.getNodeParameter('importParameters', itemIndex, {}) as { parameter?: Array<{ name: string; value: string }> })
			.parameter ?? []
	).map((parameter) => ({ Name: parameter.name, Value: parameter.value }));

	const result = (await matrix42ApiRequest.call(this, 'POST', 'importdata/executeImportDefinition', {
		SequenceId: sequenceId,
		ActionType: 3, // full execution
		Token: randomUUID(),
		Parameters: parameters,
	})) as IDataObject;

	if (!this.getNodeParameter('waitForCompletion', itemIndex, false) || !result.OperationId) {
		return { SequenceId: sequenceId, ...result };
	}

	// The import runs as a background operation, like a started workflow.
	const deadline = Date.now() + (this.getNodeParameter('timeout', itemIndex, 300) as number) * 1000;
	for (;;) {
		const status = (await matrix42ApiRequest.call(
			this,
			'GET',
			`BackgroundProcess/${encodeURIComponent(result.OperationId as string)}`,
		)) as IDataObject;
		if (status.FinishTime || Date.now() >= deadline) {
			const progress = result.LoggerId
				? ((await matrix42ApiRequest.call(this, 'POST', 'importdata/getProgress', undefined, {
						sequenceId,
						loggerId: result.LoggerId,
					})) as IDataObject)
				: undefined;
			return { SequenceId: sequenceId, ...result, Completed: !!status.FinishTime, Status: status, Progress: progress };
		}
		await sleep(POLL_INTERVAL_MS);
	}
}
