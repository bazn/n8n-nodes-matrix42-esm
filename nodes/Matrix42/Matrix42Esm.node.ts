import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { executeDataQuery, executeImport } from './actions/data';
import { executeApproval, executeAttachment, executeUser } from './actions/more';
import { executeAsset, executeJournal, executeObject } from './actions/other';
import { executeTicket } from './actions/ticket';
import { executeWorkflow } from './actions/workflow';
import type { TicketKind } from './constants';
import { dataQueryDescription, importDescription } from './descriptions/DataDescriptions';
import { approvalDescription, attachmentDescription, userDescription } from './descriptions/MoreDescriptions';
import { assetDescription, journalDescription, objectDescription } from './descriptions/OtherDescriptions';
import { authenticationProperty, matrix42Credentials } from './descriptions/shared';
import { ticketDescription } from './descriptions/TicketDescription';
import { workflowDescription } from './descriptions/WorkflowDescription';
import { listSearch, loadOptions, resourceMapping } from './methods';

const TICKET_KINDS: TicketKind[] = ['ticket', 'incident', 'serviceRequest', 'task', 'change'];

export class Matrix42Esm implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Matrix42 ESM',
		name: 'matrix42Esm',
		icon: { light: 'file:matrix42.svg', dark: 'file:matrix42.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Work with tickets, incidents, service requests, tasks, changes, approvals, workflows, attachments, assets and any data in Matrix42 ESM',
		defaults: {
			name: 'Matrix42 ESM',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: matrix42Credentials,
		properties: [
			authenticationProperty,
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Approval',
						value: 'approval',
						description: 'Approval tasks of service catalog orders',
					},
					{ name: 'Asset', value: 'asset' },
					{ name: 'Attachment', value: 'attachment' },
					{ name: 'Change', value: 'change' },
					{ name: 'Data Query', value: 'dataQuery', description: 'Read data queries defined in Matrix42' },
					{ name: 'Import', value: 'import', description: 'Run import definitions' },
					{ name: 'Incident', value: 'incident' },
					{ name: 'Journal', value: 'journal' },
					{
						name: 'Object (Generic Data)',
						value: 'object',
						description: 'Any Matrix42 data definition via the Fragments API',
					},
					{ name: 'Service Request', value: 'serviceRequest' },
					{ name: 'Task', value: 'task' },
					{
						name: 'Ticket',
						value: 'ticket',
						description: 'Generic tickets; actions here work on tickets of any type',
					},
					{ name: 'User', value: 'user' },
					{
						name: 'Workflow',
						value: 'workflow',
						description: 'Resume waiting workflows or start workflows',
					},
				],
				default: 'ticket',
			},
			...TICKET_KINDS.flatMap((kind) => ticketDescription(kind)),
			...journalDescription,
			...assetDescription,
			...objectDescription,
			...workflowDescription,
			...attachmentDescription,
			...approvalDescription,
			...userDescription,
			...dataQueryDescription,
			...importDescription,
		],
	};

	methods = { listSearch, loadOptions, resourceMapping };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;

				if (resource === 'attachment') {
					const binaryItems = await executeAttachment.call(this, operation, itemIndex);
					returnData.push(...binaryItems.map((item) => ({ ...item, pairedItem: { item: itemIndex } })));
					continue;
				}

				let result: IDataObject | IDataObject[];
				if ((TICKET_KINDS as string[]).includes(resource)) {
					result = await executeTicket.call(this, resource as TicketKind, operation, itemIndex);
				} else if (resource === 'journal') {
					result = await executeJournal.call(this, operation, itemIndex);
				} else if (resource === 'asset') {
					result = await executeAsset.call(this, operation, itemIndex);
				} else if (resource === 'object') {
					result = await executeObject.call(this, operation, itemIndex);
				} else if (resource === 'approval') {
					result = await executeApproval.call(this, operation, itemIndex);
				} else if (resource === 'dataQuery') {
					result = await executeDataQuery.call(this, operation, itemIndex);
				} else if (resource === 'import') {
					result = await executeImport.call(this, operation, itemIndex);
				} else if (resource === 'user') {
					result = await executeUser.call(this, operation, itemIndex);
				} else if (resource === 'workflow') {
					result = await executeWorkflow.call(this, operation, itemIndex);
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported resource "${resource}"`, { itemIndex });
				}

				returnData.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(result), {
						itemData: { item: itemIndex },
					}),
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: itemIndex } });
					continue;
				}
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error.errorResponse ?? (error as unknown as JsonObject), {
						message: error.message,
						description: error.description ?? undefined,
						httpCode: error.httpCode ?? undefined,
						itemIndex,
					});
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error.message, {
						description: error.description ?? undefined,
						itemIndex,
					});
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
