import type { IDataObject, IExecuteFunctions, INodeParameterResourceLocator } from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import {
	BOOKMARK_ACTIVE,
	BOOKMARK_CLASS,
	BOOKMARK_COLUMNS,
	PROCESS_FINAL_STATES,
	PROCESS_STATES,
	PROCESS_SUSPENDED,
} from '../constants';
import {
	andWhere,
	asqlLikeContains,
	asqlLiteral,
	matrix42ApiRequest,
	parseJsonParameter,
	queryFragments,
	simplifyRow,
} from '../GenericFunctions';

const POLL_INTERVAL_MS = 2000;

async function getBookmark(this: IExecuteFunctions, bookmarkId: string): Promise<IDataObject | undefined> {
	const rows = await queryFragments.call(
		this,
		BOOKMARK_CLASS,
		{ columns: BOOKMARK_COLUMNS, where: `ID = ${asqlLiteral(bookmarkId)}` },
		1,
	);
	return rows.length ? simplifyRow(rows[0]) : undefined;
}

/**
 * Polls the workflow instance behind a resumed bookmark until it has finished or stopped again at
 * another waiting activity (state "suspended" with a new active bookmark).
 */
async function waitForInstance(
	this: IExecuteFunctions,
	bookmarkId: string,
	instanceObjectId: string,
	timeoutSeconds: number,
): Promise<IDataObject> {
	const deadline = Date.now() + timeoutSeconds * 1000;
	for (;;) {
		const rows = await queryFragments.call(this, BOOKMARK_CLASS, {
			columns: BOOKMARK_COLUMNS,
			where: `[Expression-ObjectID] = ${asqlLiteral(instanceObjectId)}`,
			sort: 'CreatedDate DESC',
		});
		const own = rows.find((row) => row.ID === bookmarkId);
		const state = Number((own ?? rows[0])?.InstanceState);
		const nextBookmark = rows.find((row) => row.ID !== bookmarkId && Number(row.Status) === BOOKMARK_ACTIVE);
		const ownClosed = own !== undefined && Number(own.Status) !== BOOKMARK_ACTIVE;
		const settled =
			PROCESS_FINAL_STATES.includes(state) || (ownClosed && state === PROCESS_SUSPENDED && nextBookmark !== undefined);
		if (settled || Date.now() >= deadline) {
			return {
				Completed: settled,
				InstanceObjectId: instanceObjectId,
				InstanceState: state,
				InstanceStateName: PROCESS_STATES[state] ?? null,
				NextBookmark: nextBookmark ? simplifyRow(nextBookmark) : null,
			};
		}
		await sleep(POLL_INTERVAL_MS);
	}
}

function serializeInputData(value: unknown): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	return typeof value === 'string' ? value : JSON.stringify(value);
}

export async function executeWorkflow(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'getWaiting') {
		const filters = this.getNodeParameter('waitingFilters', itemIndex, {}) as IDataObject;
		const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
		const rows = await queryFragments.call(
			this,
			BOOKMARK_CLASS,
			{
				columns: BOOKMARK_COLUMNS,
				where: andWhere([
					`Status = ${BOOKMARK_ACTIVE}`,
					filters.activity ? `Summary LIKE ${asqlLikeContains(String(filters.activity))}` : undefined,
					filters.workflowName
						? `T(PLSLProcessInstanceClassBase).Name LIKE ${asqlLikeContains(String(filters.workflowName))}`
						: undefined,
					filters.externalObjectId ? `ExternalObjectId = ${asqlLiteral(String(filters.externalObjectId))}` : undefined,
				]),
				sort: 'CreatedDate DESC',
			},
			returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number),
		);
		return rows.map(simplifyRow);
	}

	if (operation === 'resume') {
		const locator = this.getNodeParameter('bookmark', itemIndex) as INodeParameterResourceLocator;
		const value = String(locator.value ?? '').trim();
		if (value === '') {
			throw new NodeOperationError(this.getNode(), 'No waiting workflow specified', { itemIndex });
		}
		const inputData = serializeInputData(this.getNodeParameter('inputData', itemIndex, ''));

		if (locator.mode === 'objectId') {
			// Matrix42 answers `true` here even when no workflow waits for the object, so the result is passed on as-is.
			const resumed = await matrix42ApiRequest.call(this, 'GET', 'workflow/Resume', undefined, {
				ObjectId: value,
				...(inputData !== undefined && { InputData: inputData }),
			});
			return { success: resumed === true, WaitedObjectId: value };
		}

		const before = await getBookmark.call(this, value);
		if (!before) {
			throw new NodeOperationError(this.getNode(), `Bookmark ${value} not found`, { itemIndex });
		}
		if (Number(before.Status) !== BOOKMARK_ACTIVE) {
			throw new NodeOperationError(this.getNode(), `Bookmark ${value} is not active (status ${before.Status})`, {
				itemIndex,
				description: 'The workflow is no longer waiting at this activity.',
			});
		}
		await matrix42ApiRequest.call(this, 'GET', 'workflow/Resume', undefined, {
			BookmarkId: value,
			...(inputData !== undefined && { InputData: inputData }),
		});
		const after = { success: true, ...(await getBookmark.call(this, value)) };
		if (!this.getNodeParameter('waitForCompletion', itemIndex, false)) return after;
		return {
			...after,
			...(await waitForInstance.call(
				this,
				value,
				before.InstanceObjectId as string,
				this.getNodeParameter('timeout', itemIndex, 60) as number,
			)),
		};
	}

	if (operation === 'start') {
		const workflowId = this.getNodeParameter('workflowId', itemIndex, '', { extractValue: true }) as string;
		const args =
			this.getNodeParameter('argumentsMode', itemIndex, 'json') === 'mapper'
				? (((this.getNodeParameter('argumentsMapping', itemIndex, {}) as IDataObject).value as IDataObject | null) ??
					{})
				: parseJsonParameter.call(
						this,
						this.getNodeParameter('workflowArguments', itemIndex, '{}'),
						'Arguments (JSON)',
						itemIndex,
					);
		const started = (await matrix42ApiRequest.call(
			this,
			'POST',
			`workflow/start/${encodeURIComponent(workflowId)}`,
			args,
		)) as IDataObject;

		if (!this.getNodeParameter('waitForCompletion', itemIndex, false)) {
			return { WorkflowId: workflowId, ...started };
		}

		const deadline = Date.now() + (this.getNodeParameter('timeout', itemIndex, 60) as number) * 1000;
		for (;;) {
			const status = (await matrix42ApiRequest.call(
				this,
				'GET',
				`BackgroundProcess/${encodeURIComponent(started.OperationId as string)}`,
			)) as IDataObject;
			if (status.FinishTime) {
				return { WorkflowId: workflowId, OperationId: started.OperationId, Completed: true, ...status };
			}
			if (Date.now() >= deadline) {
				return { WorkflowId: workflowId, OperationId: started.OperationId, Completed: false, ...status };
			}
			await sleep(POLL_INTERVAL_MS);
		}
	}

	throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, { itemIndex });
}
