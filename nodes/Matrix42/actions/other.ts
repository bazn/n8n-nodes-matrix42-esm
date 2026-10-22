import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { ASSET_COLUMNS, JOURNAL_CLASS, JOURNAL_COLUMNS } from '../constants';
import {
	andWhere,
	asqlLikeContains,
	asqlLiteral,
	matrix42ApiRequest,
	parseJsonParameter,
	queryFragments,
	resolveTicketId,
	simplifyRow,
	splitTopLevel,
} from '../GenericFunctions';

function limitFor(this: IExecuteFunctions, itemIndex: number): number | undefined {
	return this.getNodeParameter('returnAll', itemIndex) ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
}

export async function executeJournal(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	const objectId = await resolveTicketId.call(this, 'ticketId', itemIndex);

	if (operation === 'add') {
		const options = this.getNodeParameter('journalOptions', itemIndex, {}) as IDataObject;
		const response = (await matrix42ApiRequest.call(this, 'POST', 'journal/Add', {
			ObjectId: objectId,
			Comments: this.getNodeParameter('comments', itemIndex),
			...(options.visibleInPortal !== undefined && { VisibleInPortal: options.visibleInPortal }),
			...(options.publish !== undefined && { Publish: options.publish }),
			...(options.entryType !== undefined && { EntryType: options.entryType }),
		})) as IDataObject;
		return { ObjectId: objectId, ...response };
	}

	if (operation === 'getAll') {
		// The journal REST route is not reachable on all instances; journal entries are fragments
		// of the ticket object itself, so they are read through the Fragments API instead.
		const rows = await queryFragments.call(
			this,
			JOURNAL_CLASS,
			{
				columns: JOURNAL_COLUMNS,
				where: `[Expression-ObjectID] = ${asqlLiteral(objectId)}`,
				sort: 'CreatedDate DESC',
			},
			limitFor.call(this, itemIndex),
		);
		return rows.map((row) => ({ ...simplifyRow(row), ObjectId: objectId }));
	}

	throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, { itemIndex });
}

async function getFullObject(this: IExecuteFunctions, ciName: string, objectId: string): Promise<IDataObject> {
	return (await matrix42ApiRequest.call(
		this,
		'GET',
		`data/objects/${encodeURIComponent(ciName)}/${encodeURIComponent(objectId)}`,
		undefined,
		{ full: true },
	)) as IDataObject;
}

export async function executeAsset(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'get') {
		const assetId = this.getNodeParameter('assetId', itemIndex, '', { extractValue: true }) as string;
		const fragment = (await matrix42ApiRequest.call(
			this,
			'GET',
			`data/fragments/SPSAssetClassBase/${encodeURIComponent(assetId)}`,
		)) as IDataObject | null;
		if (!fragment) {
			throw new NodeOperationError(this.getNode(), `Asset ${assetId} not found`, { itemIndex });
		}
		if (!this.getNodeParameter('fullObject', itemIndex, false)) {
			return fragment;
		}
		// The fragment lists every possible CI type as UsedInType<Type>; the one that is set is the asset's type.
		const typeKey = Object.keys(fragment).find((key) => key.startsWith('UsedInType') && fragment[key]);
		if (!typeKey) {
			throw new NodeOperationError(this.getNode(), `Could not determine the type of asset ${assetId}`, { itemIndex });
		}
		return getFullObject.call(this, typeKey.replace(/^UsedInType/, ''), fragment[typeKey] as string);
	}

	if (operation === 'getAll') {
		const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
		const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
		const extra = splitTopLevel((options.columns as string) ?? '');
		const search = filters.search ? asqlLikeContains(String(filters.search)) : undefined;
		const rows = await queryFragments.call(
			this,
			'SPSAssetClassBase',
			{
				columns: options.onlyAdditionalColumns ? extra : [...ASSET_COLUMNS, ...extra],
				where: andWhere([
					search
						? `T(SPSComputerClassBase).Name LIKE ${search} OR SerialNumber LIKE ${search} OR InventoryNumber LIKE ${search}`
						: undefined,
					filters.where as string | undefined,
				]),
				sort: (options.sort as string) || undefined,
			},
			limitFor.call(this, itemIndex),
		);
		return rows.map(simplifyRow);
	}

	throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, { itemIndex });
}

export async function executeObject(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	if (['getFull', 'createObject', 'updateObject', 'deleteObject'].includes(operation)) {
		const ciName = this.getNodeParameter('ciName', itemIndex, '', { extractValue: true }) as string;
		const objectsPath = `data/objects/${encodeURIComponent(ciName)}`;
		const objectData = () =>
			parseJsonParameter.call(this, this.getNodeParameter('objectData', itemIndex), 'Data (JSON)', itemIndex);

		if (operation === 'createObject') {
			const objectId = (await matrix42ApiRequest.call(this, 'POST', objectsPath, objectData())) as string;
			return getFullObject.call(this, ciName, objectId);
		}

		const objectId = (this.getNodeParameter('objectId', itemIndex) as string).trim();
		if (operation === 'getFull') return getFullObject.call(this, ciName, objectId);
		if (operation === 'updateObject') {
			await matrix42ApiRequest.call(this, 'PUT', objectsPath, { ...objectData(), ID: objectId });
			return getFullObject.call(this, ciName, objectId);
		}
		await matrix42ApiRequest.call(this, 'DELETE', `${objectsPath}/${encodeURIComponent(objectId)}`);
		return { success: true, ObjectId: objectId };
	}

	const className = this.getNodeParameter('className', itemIndex, '', { extractValue: true }) as string;
	const path = `data/fragments/${encodeURIComponent(className)}`;

	switch (operation) {
		case 'getAll': {
			const sort = this.getNodeParameter('sort', itemIndex, '') as string;
			const rows = await queryFragments.call(
				this,
				className,
				{
					columns: splitTopLevel(this.getNodeParameter('columns', itemIndex, '') as string),
					where: (this.getNodeParameter('where', itemIndex, '') as string) || undefined,
					sort: sort || undefined,
				},
				limitFor.call(this, itemIndex),
			);
			return rows.map(simplifyRow);
		}

		case 'get':
			return (await matrix42ApiRequest.call(
				this,
				'GET',
				`${path}/${encodeURIComponent(this.getNodeParameter('fragmentId', itemIndex) as string)}`,
			)) as IDataObject;

		case 'create': {
			const fields = parseJsonParameter.call(this, this.getNodeParameter('fields', itemIndex), 'Fields', itemIndex);
			const id = (await matrix42ApiRequest.call(this, 'POST', path, fields)) as string;
			return { ID: id, ...fields };
		}

		case 'delete': {
			const id = (this.getNodeParameter('fragmentId', itemIndex) as string).trim();
			// Removes only this fragment; the object and its other data definitions remain (verified live).
			await matrix42ApiRequest.call(this, 'DELETE', `${path}/${encodeURIComponent(id)}`);
			return { success: true, ID: id };
		}

		case 'update': {
			const id = this.getNodeParameter('fragmentId', itemIndex) as string;
			const fields = parseJsonParameter.call(this, this.getNodeParameter('fields', itemIndex), 'Fields', itemIndex);
			await matrix42ApiRequest.call(this, 'PUT', path, { ...fields, ID: id });
			return { success: true, ID: id };
		}
	}

	throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, { itemIndex });
}
