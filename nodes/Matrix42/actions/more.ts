import { randomUUID } from 'crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeParameterResourceLocator,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	APPROVAL_TASK_CLASS,
	APPROVAL_TASK_COLUMNS,
	APPROVAL_TASK_OPEN,
	USER_CLASS,
	USER_COLUMNS,
} from '../constants';
import {
	andWhere,
	asqlLikeContains,
	asqlLiteral,
	getTicketTypeId,
	matrix42ApiRequest,
	matrix42RawRequest,
	parseIdList,
	queryFragments,
	resolveLocatorValue,
	resolveTicketId,
	simplifyRow,
} from '../GenericFunctions';

function limitFor(this: IExecuteFunctions, itemIndex: number): number | undefined {
	return this.getNodeParameter('returnAll', itemIndex) ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
}

// ---------------------------------------------------------------- Attachment

interface StorageProvider {
	StorageId: string;
	MaxFileSizeMb?: number;
	SendContentThroughServer?: boolean;
}

async function listFiles(this: IExecuteFunctions, objectId: string): Promise<IDataObject[]> {
	const files = (await matrix42ApiRequest.call(
		this,
		'GET',
		`commonStorage/files/${encodeURIComponent(objectId)}`,
	)) as IDataObject[];
	return files.map((file) => {
		const withoutThumbnail = { ...file };
		delete withoutThumbnail.Thumbnail;
		return withoutThumbnail;
	});
}

function fileNameFromDisposition(disposition: unknown): string | undefined {
	if (typeof disposition !== 'string') return undefined;
	const encoded = /filename\*=utf-8''([^;]+)/i.exec(disposition);
	if (encoded) return decodeURIComponent(encoded[1]);
	const plain = /filename="?([^";]+)"?/i.exec(disposition);
	return plain ? plain[1] : undefined;
}

/** The ticket or arbitrary object an attachment belongs to, with its CI type id (needed for uploads). */
async function resolveAttachmentTarget(
	this: IExecuteFunctions,
	itemIndex: number,
	withTypeId = true,
): Promise<{ objectId: string; typeId: string }> {
	if (this.getNodeParameter('attachTo', itemIndex, 'ticket') === 'ticket') {
		const objectId = await resolveTicketId.call(this, 'ticketId', itemIndex);
		return { objectId, typeId: withTypeId ? await getTicketTypeId.call(this, objectId) : '' };
	}
	const objectId = (this.getNodeParameter('attachmentObjectId', itemIndex) as string).trim();
	if (!withTypeId) return { objectId, typeId: '' };
	// Every configuration item has the common base fragment, which carries the type id.
	const rows = await queryFragments.call(
		this,
		'SPSCommonClassBase',
		{ columns: [], where: `[Expression-ObjectID] = ${asqlLiteral(objectId)}` },
		1,
	);
	if (!rows.length) {
		throw new NodeOperationError(this.getNode(), `Object ${objectId} not found`, { itemIndex });
	}
	return { objectId, typeId: rows[0]['Expression-TypeID'] as string };
}

export async function executeAttachment(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const wrap = (json: IDataObject | IDataObject[]) =>
		(Array.isArray(json) ? json : [json]).map((entry) => ({ json: entry }));

	if (operation === 'upload') {
		const { objectId, typeId } = await resolveAttachmentTarget.call(this, itemIndex);
		const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex) as string;
		const options = this.getNodeParameter('uploadOptions', itemIndex, {}) as IDataObject;
		const binary = this.helpers.assertBinaryData(itemIndex, binaryPropertyName);
		const content = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
		const fileName = (options.fileName as string) || binary.fileName || 'attachment';

		const provider = (await matrix42ApiRequest.call(
			this,
			'GET',
			`commonStorage/provider/${encodeURIComponent(typeId)}`,
		)) as StorageProvider;
		if (provider.MaxFileSizeMb && provider.MaxFileSizeMb > 0 && content.length > provider.MaxFileSizeMb * 1024 * 1024) {
			throw new NodeOperationError(
				this.getNode(),
				`File is larger than the ${provider.MaxFileSizeMb} MB allowed by the Matrix42 storage`,
				{ itemIndex },
			);
		}

		// Verified live: GetUploadUrl needs a client-generated UniqueFileId and the storage of the ticket type.
		const uniqueFileId = randomUUID();
		const upload = (await matrix42ApiRequest.call(this, 'POST', 'fileStorage/GetUploadUrl', {
			UniqueFileId: uniqueFileId,
			StorageId: provider.StorageId,
			Name: fileName,
			ObjectId: objectId,
			TypeId: typeId,
			Size: content.length,
		})) as { Url: string };

		if (provider.SendContentThroughServer === false) {
			// External blob storage: the URL is pre-signed, so no Matrix42 authorization is sent.
			await this.helpers.httpRequest({
				method: 'PUT',
				url: upload.Url,
				body: content,
				headers: { 'Content-Type': binary.mimeType, 'x-ms-blob-type': 'BlockBlob' },
			});
		} else {
			await matrix42RawRequest.call(this, {
				method: 'POST',
				url: upload.Url,
				body: content,
				headers: { 'Content-Type': 'application/octet-stream' },
			});
		}
		await matrix42ApiRequest.call(this, 'POST', `commonStorage/FinishUploading/${uniqueFileId}`);

		const uploaded = (await listFiles.call(this, objectId)).find((file) => file.UniqueFileId === uniqueFileId);
		return wrap(uploaded ?? { UniqueFileId: uniqueFileId, Name: fileName, ObjectId: objectId, Size: content.length });
	}

	if (operation === 'getAll') {
		const { objectId } = await resolveAttachmentTarget.call(this, itemIndex, false);
		return wrap(await listFiles.call(this, objectId));
	}

	const fileId = (this.getNodeParameter('fileId', itemIndex) as string).trim();

	if (operation === 'download') {
		const response = (await matrix42RawRequest.call(this, {
			method: 'GET',
			url: `fileStorage/${encodeURIComponent(fileId)}`,
			encoding: 'arraybuffer',
			returnFullResponse: true,
			json: false,
		})) as { body: ArrayBuffer | Buffer; headers: IDataObject };
		const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body);
		if (body.length === 0) {
			throw new NodeOperationError(this.getNode(), `File ${fileId} not found or empty`, { itemIndex });
		}
		const fileName = fileNameFromDisposition(response.headers['content-disposition']) ?? fileId;
		const mimeType = String(response.headers['content-type'] ?? 'application/octet-stream').split(';')[0];
		const outputField = this.getNodeParameter('outputBinaryPropertyName', itemIndex) as string;
		return [
			{
				json: { UniqueFileId: fileId, Name: fileName, MimeType: mimeType, Size: body.length },
				binary: { [outputField]: await this.helpers.prepareBinaryData(body, fileName, mimeType) },
			},
		];
	}

	if (operation === 'delete') {
		await matrix42ApiRequest.call(this, 'DELETE', `commonStorage/${encodeURIComponent(fileId)}`);
		return wrap({ success: true, UniqueFileId: fileId });
	}

	throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, { itemIndex });
}

// ---------------------------------------------------------------- Approval

async function resolveApprovalTaskId(this: IExecuteFunctions, itemIndex: number): Promise<string> {
	const locator = this.getNodeParameter('approvalTaskId', itemIndex) as INodeParameterResourceLocator;
	const value = String(locator.value ?? '').trim();
	if (value === '') throw new NodeOperationError(this.getNode(), 'No approval task specified', { itemIndex });
	if (locator.mode !== 'ticketNumber') return value;
	const rows = await queryFragments.call(
		this,
		APPROVAL_TASK_CLASS,
		{ columns: ['[Expression-ObjectID] as ObjectId'], where: `TicketNumber = ${asqlLiteral(value)}` },
		1,
	);
	if (!rows.length) throw new NodeOperationError(this.getNode(), `No approval task "${value}" found`, { itemIndex });
	return rows[0].ObjectId as string;
}

async function getApprovalTask(this: IExecuteFunctions, objectId: string): Promise<IDataObject | undefined> {
	const rows = await queryFragments.call(
		this,
		APPROVAL_TASK_CLASS,
		{ columns: APPROVAL_TASK_COLUMNS, where: `[Expression-ObjectID] = ${asqlLiteral(objectId)}` },
		1,
	);
	return rows.length ? simplifyRow(rows[0]) : undefined;
}

export async function executeApproval(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'getAll') {
		const filters = this.getNodeParameter('approvalFilters', itemIndex, {}) as IDataObject;
		const recipient = resolveLocatorValue(filters.recipient);
		const recipientRole = resolveLocatorValue(filters.recipientRole);
		const rows = await queryFragments.call(
			this,
			APPROVAL_TASK_CLASS,
			{
				columns: APPROVAL_TASK_COLUMNS,
				where: andWhere([
					filters.onlyOpen === false ? undefined : `T(SPSCommonClassBase).State = ${APPROVAL_TASK_OPEN}`,
					recipient ? `Recipient = ${asqlLiteral(recipient)}` : undefined,
					recipientRole ? `RecipientRole = ${asqlLiteral(recipientRole)}` : undefined,
				]),
				sort: 'CreatedDate DESC',
			},
			limitFor.call(this, itemIndex),
		);
		return rows.map(simplifyRow);
	}

	const taskId = await resolveApprovalTaskId.call(this, itemIndex);
	const bookings = (await matrix42ApiRequest.call(this, 'GET', 'servicebookings/decide', undefined, {
		approvalTaskObjectId: taskId,
	})) as IDataObject[];

	if (operation === 'get') {
		return { ...(await getApprovalTask.call(this, taskId)), Bookings: bookings };
	}

	if (operation === 'decide') {
		const task = await getApprovalTask.call(this, taskId);
		if (task && Number(task.State) !== APPROVAL_TASK_OPEN) {
			throw new NodeOperationError(this.getNode(), `Approval task ${task.TicketNumber as string} is already decided`, {
				itemIndex,
			});
		}
		const approve = this.getNodeParameter('decision', itemIndex) === 'approve';
		const options = this.getNodeParameter('decideOptions', itemIndex, {}) as IDataObject;
		const onlyThese = new Set(parseIdList(options.bookingIds));
		const selected = (booking: IDataObject) =>
			approve && (onlyThese.size === 0 || onlyThese.has(String(booking.ObjectId)));

		// Verified live: approving selects every booking; rejecting deselects them and declines the unselected ones.
		await matrix42ApiRequest.call(this, 'POST', 'servicebookings/decide', {
			ApprovalTaskObjectId: taskId,
			Comments: this.getNodeParameter('comments', itemIndex, ''),
			DeclineUnselected: !approve || onlyThese.size > 0,
			Bookings: bookings.map((booking) => ({
				ObjectId: booking.ObjectId,
				Id: booking.Id,
				Quantity: booking.Quantity ?? 1,
				Selected: selected(booking),
			})),
		});
		return {
			success: true,
			...(await getApprovalTask.call(this, taskId)),
			Decisions: bookings.map((booking) => ({
				ObjectId: booking.ObjectId,
				ItemNumber: booking.ItemNumber,
				Name: booking.Name,
				Approved: selected(booking),
			})),
		};
	}

	throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, { itemIndex });
}

// ---------------------------------------------------------------- User

export async function executeUser(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'get') {
		const userId = this.getNodeParameter('userId', itemIndex, '', { extractValue: true }) as string;
		const rows = await queryFragments.call(
			this,
			USER_CLASS,
			{ columns: USER_COLUMNS, where: `ID = ${asqlLiteral(userId)}` },
			1,
		);
		if (!rows.length) throw new NodeOperationError(this.getNode(), `User ${userId} not found`, { itemIndex });
		return simplifyRow(rows[0]);
	}

	if (operation === 'getAll') {
		const filters = this.getNodeParameter('userFilters', itemIndex, {}) as IDataObject;
		const name = filters.name ? asqlLikeContains(String(filters.name)) : undefined;
		const rows = await queryFragments.call(
			this,
			USER_CLASS,
			{
				columns: USER_COLUMNS,
				where: andWhere([
					filters.email ? `MailAddress = ${asqlLiteral(String(filters.email).trim())}` : undefined,
					name ? `FirstName LIKE ${name} OR LastName LIKE ${name} OR DisplayName LIKE ${name}` : undefined,
					filters.department ? `Department = ${asqlLiteral(String(filters.department))}` : undefined,
					filters.where as string | undefined,
				]),
				sort: 'LastName ASC',
			},
			limitFor.call(this, itemIndex),
		);
		return rows.map(simplifyRow);
	}

	throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, { itemIndex });
}
