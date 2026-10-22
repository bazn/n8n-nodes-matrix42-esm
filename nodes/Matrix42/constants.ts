import type { IDataObject } from 'n8n-workflow';

export type TicketKind = 'ticket' | 'incident' | 'serviceRequest' | 'task' | 'change';

/** Every ticket-like type that can be filtered on, including types without their own resource. */
export type TicketTypeKey = TicketKind | 'problem';

export const ACTIVITY_CLASS = 'SPSActivityClassBase';

export interface TicketTypeInfo {
	label: string;
	/** Configuration Item (type) internal name, e.g. used for `UsedInType<TypeName> IS NOT NULL` filters. */
	typeName: string;
	/** Standard Matrix42 type id, used to label rows returned by the Fragments API. */
	typeId: string;
}

export const TICKET_TYPES: Record<TicketTypeKey, TicketTypeInfo> = {
	ticket: {
		label: 'Ticket',
		typeName: 'SPSActivityTypeTicket',
		typeId: '13f950a8-f2f8-e611-e182-60e327035d31',
	},
	incident: {
		label: 'Incident',
		typeName: 'SPSActivityTypeIncident',
		typeId: 'fe098714-ac94-47f1-9724-df5bac86b3fb',
	},
	serviceRequest: {
		label: 'Service Request',
		typeName: 'SPSActivityTypeServiceRequest',
		typeId: '173add94-1ff9-e611-e182-60e327035d31',
	},
	task: {
		label: 'Task',
		typeName: 'SPSActivityTypeBase',
		typeId: '2bd82345-74d9-4fa5-9159-9fd506343cc7',
	},
	change: {
		label: 'Change',
		typeName: 'SVMChangeRequestType',
		typeId: '036888d0-7e44-4e0b-8572-f53e76d10826',
	},
	problem: {
		label: 'Problem',
		typeName: 'SPSActivityTypeGroupTicket',
		typeId: 'ae98d261-1761-4cdb-8675-9c1947799ad1',
	},
};

export const TICKET_TYPE_BY_ID: Record<string, string> = Object.fromEntries(
	Object.values(TICKET_TYPES).map((type) => [type.typeId, type.label]),
);

export const TICKET_TYPE_NAME_BY_ID: Record<string, string> = Object.fromEntries(
	Object.values(TICKET_TYPES).map((type) => [type.typeId, type.typeName]),
);

interface KindEndpoints {
	create: string;
	createQs?: IDataObject;
	update: string;
	/** Extra body fields the update endpoint needs to address this kind. */
	updateExtra?: IDataObject;
	close: string;
}

// Verified live against a Matrix42 instance: Ticket and Service Request have no update endpoint
// of their own, but incident/Update addresses them via ActivityTicketType (same codes as ticket/Create).
export const KIND_ENDPOINTS: Record<TicketKind, KindEndpoints> = {
	ticket: {
		create: 'ticket/Create',
		createQs: { activityType: 0 },
		update: 'incident/Update',
		updateExtra: { ActivityTicketType: 0 },
		close: 'ticket/Close',
	},
	incident: {
		create: 'incident/Create',
		update: 'incident/Update',
		close: 'ticket/Close',
	},
	serviceRequest: {
		create: 'ticket/Create',
		createQs: { activityType: 6 },
		update: 'incident/Update',
		updateExtra: { ActivityTicketType: 6 },
		close: 'ticket/Close',
	},
	task: {
		create: 'task/create',
		update: 'task/update',
		close: 'task/Close',
	},
	change: {
		create: 'change/create',
		update: 'change/update',
		close: 'change/Close',
	},
};

/** Close endpoint per CI type name, for operations that work on a ticket of unknown kind. */
export const CLOSE_ENDPOINT_BY_TYPE_NAME: Record<string, string> = {
	SPSActivityTypeTicket: 'ticket/Close',
	SPSActivityTypeIncident: 'ticket/Close',
	SPSActivityTypeServiceRequest: 'ticket/Close',
	SPSActivityTypeBase: 'task/Close',
	SVMChangeRequestType: 'change/Close',
	SPSActivityTypeGroupTicket: 'problem/Close',
};

export const TICKET_COLUMNS = [
	'[Expression-ObjectID] as ObjectId',
	'TicketNumber',
	'Subject',
	'Description',
	'T(SPSCommonClassBase).State as State',
	'Priority',
	'Impact',
	'Urgency',
	'Category',
	'Category.Name as CategoryName',
	'Service',
	'Service.Name as ServiceName',
	'Initiator',
	'Recipient',
	'RecipientRole',
	'CreatedDate',
	'LastChangeDate',
	'ClosedDate',
];

export const ASSET_COLUMNS = [
	'[Expression-ObjectID] as ObjectId',
	'T(SPSComputerClassBase).Name as ComputerName',
	'SerialNumber',
	'InventoryNumber',
	'ManufacturerName',
	'Model',
	'AcquisitionDate',
	'GuarantyEndDate',
	'EndOfLifeDueDate',
	'Location',
	'AssignedUser',
];

export const JOURNAL_CLASS = 'SPSActivityClassUnitOfWork';

export const JOURNAL_COLUMNS = [
	'CreatedDate',
	'OriginalSolution as Text',
	'ActivityAction',
	'VisibleInPortal',
	'Creator',
];

export const CHANGE_APPROVAL_CLASS = 'SVMChangeApprovalClassBase';

export const CHANGE_APPROVAL_COLUMNS = [
	'[Expression-ObjectID] as ObjectId',
	'TicketNumber',
	'T(SPSCommonClassBase).State as State',
	'Recipient',
	'RecipientRole',
	'CreatedDate',
	'ClosedDate',
];

/** Workflow bookmarks are fragments of the workflow process instance a suspended workflow waits in. */
export const BOOKMARK_CLASS = 'PLSLWorkflowBookmarkClassBase';

/** PLSLWorkflowBookmarkPickupStatus: 1 = active (the workflow is waiting at this bookmark). */
export const BOOKMARK_ACTIVE = 1;

export const BOOKMARK_COLUMNS = [
	'[Expression-ObjectID] as InstanceObjectId',
	'Summary as Activity',
	'Status',
	'ExternalObjectId as WaitedObjectId',
	'ExternalObjectTypeId as WaitedObjectTypeId',
	'CreatedDate',
	'ClosedDate',
	'T(PLSLProcessInstanceClassBase).Name as WorkflowName',
	'T(PLSLProcessInstanceClassBase).State as InstanceState',
	'T(PLSLWorkflowProcessInstanceClassBase).InstanceID as InstanceId',
];

/** Workflow process instance states (PLSLProcessPickupState). */
export const PROCESS_STATES: Record<number, string> = {
	1: 'Active',
	2: 'Completed',
	4: 'Failed',
	8: 'Terminated',
	16: 'Cancelled',
	32: 'Suspended',
	64: 'Queued',
	128: 'Running',
	256: 'Terminating',
	512: 'Cancelling',
	1024: 'Suspending',
	2048: 'Starting',
};

export const PROCESS_FINAL_STATES = [2, 4, 8, 16];
export const PROCESS_SUSPENDED = 32;

export const MAJOR_INCIDENT_COLUMNS = [
	'T(SPSActivityClassIncident).MajorIncident as MajorIncident',
	'T(SPSActivityClassIncident).MajorIncidentProposalStatus as MajorIncidentProposalStatus',
];

export const USER_CLASS = 'SPSUserClassBase';

export const USER_COLUMNS = [
	'[Expression-ObjectID] as ObjectId',
	'FirstName',
	'LastName',
	'DisplayName',
	'MailAddress',
	'Department',
	'Position',
	'Company',
	'Office',
	'BusinessPhone',
	'MobilePhone',
	'UserType',
];

export const APPROVAL_TASK_CLASS = 'SVCApprovalTaskClassBase';

/** SPSCommonPickupObjectStatus value of an approval task that still waits for a decision. */
export const APPROVAL_TASK_OPEN = 10022;

export const APPROVAL_TASK_COLUMNS = [
	'[Expression-ObjectID] as ObjectId',
	'TicketNumber',
	'T(SPSCommonClassBase).State as State',
	'ApprovalStep',
	'Recipient',
	'RecipientRole',
	'Order',
	'CreatedDate',
	'ClosedDate',
	'Reason',
];

export const JOURNAL_TRIGGER_COLUMNS = [
	'[Expression-ObjectID] as ObjectId',
	'T(SPSActivityClassBase).TicketNumber as TicketNumber',
	'T(SPSActivityClassBase).Subject as Subject',
	...JOURNAL_COLUMNS,
];
