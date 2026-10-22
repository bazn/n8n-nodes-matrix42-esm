// Live end-to-end tests against a real Matrix42 instance.
//   M42_URL=https://m42.example.com M42_API_TOKEN=… npm run test:live
// Creates tickets prefixed with "[n8n-test]" and closes them again at the end.
// Tests that change foreign data only run when explicitly enabled:
//   M42_TEST_APPROVAL_TASK=APT000123   decide (approve) this approval task
//   M42_TEST_RESUME_BOOKMARK=<guid>    resume the workflow waiting at this bookmark
const { run, method, poll, rl, staticData, getLog, credentials, runtime } = require('./harness.cjs');

const results = [];
const created = [];
const assert = (cond, msg) => {
	if (!cond) throw new Error(msg);
};
const short = (o) => JSON.stringify(o).slice(0, 200);
const resetPoll = () => Object.keys(staticData).forEach((k) => delete staticData[k]);

async function step(name, fn) {
	try {
		const value = await fn();
		results.push(true);
		console.log(`PASS ${name}`);
		return value;
	} catch (error) {
		results.push(false);
		console.log(`FAIL ${name}: ${error.message}${error.description ? ' | ' + error.description : ''}`);
		console.log('     requests:', getLog().join(' | '));
		return undefined;
	}
}

async function createTicket(resource, subject, extra = {}) {
	const [ticket] = await run({
		resource,
		operation: 'create',
		subject: `[n8n-test] ${subject}`,
		description: 'Created by the n8n node live tests - safe to close',
		additionalFields: {},
		...extra,
	});
	created.push(ticket.ObjectId);
	return ticket;
}

(async () => {
	// ------------------------------------------------ lookups
	const lists = [
		['searchCategories', ''],
		['searchRoles', ''],
		['searchUsers', ''],
		['searchServices', ''],
		['searchQuickCalls', ''],
		['searchTaskTemplates', ''],
		['searchChangeTemplates', ''],
		['searchAssets', ''],
		['searchClasses', 'UserClassBase'],
		['searchWorkflows', ''],
		['searchWaitingWorkflows', ''],
	];
	for (const [name, filter] of lists) {
		await step(`listSearch ${name}`, async () => {
			const r = await method('listSearch', name, {}, filter);
			assert(r.results.length > 0, 'empty');
		});
	}
	await step('listSearch searchTickets (incident)', async () => {
		const r = await method('listSearch', 'searchTickets', { resource: 'incident' }, '');
		assert(r.results.length > 0, 'empty');
	});
	await step('listSearch searchApprovalTasks', async () => {
		const r = await method('listSearch', 'searchApprovalTasks', {}, '');
		console.log(`     ${r.results.length} open approval tasks`);
	});
	for (const name of ['getImpacts', 'getUrgencies', 'getPriorities', 'getCloseReasons', 'getStates']) {
		await step(`loadOptions ${name}`, async () => assert((await method('loadOptions', name)).length > 0, 'empty'));
	}

	// ------------------------------------------------ incident lifecycle
	const inc = await step('incident create', async () => {
		const t = await createTicket('incident', 'Incident');
		assert(t.TicketNumber.startsWith('INC') && t.MajorIncident === 0, short(t));
		return t;
	});
	if (inc) {
		const id = rl(inc.ObjectId);
		await step('incident get by ticket number', async () => {
			const [r] = await run({ resource: 'incident', operation: 'get', ticketId: rl(inc.TicketNumber, 'ticketNumber'), options: {} });
			assert(r.ObjectId === inc.ObjectId && r.TicketType === 'Incident', short(r));
		});
		await step('incident update keeps other fields', async () => {
			const [r] = await run({ resource: 'incident', operation: 'update', ticketId: id, updateFields: { subject: '[n8n-test] Incident (updated)' } });
			assert(r.Subject.endsWith('(updated)') && r.Description, short(r));
		});
		await step('journal add + get many', async () => {
			await run({ resource: 'journal', operation: 'add', ticketId: id, comments: 'n8n journal test', journalOptions: {} });
			const r = await run({ resource: 'journal', operation: 'getAll', ticketId: id, returnAll: true });
			assert(r.some((e) => e.Text === 'n8n journal test'), short(r));
		});
		await step('incident take over + deadline', async () => {
			await run({ resource: 'incident', operation: 'takeOver', ticketId: id });
			await run({ resource: 'incident', operation: 'setDeadline', ticketId: id, deadline: '2030-01-15T10:00:00' });
			const [g] = await run({ resource: 'incident', operation: 'get', ticketId: id, options: { columns: 'ProcessUntilDate' } });
			assert(String(g.ProcessUntilDate).startsWith('2030-01-15T10:00:00'), g.ProcessUntilDate);
		});
		await step('major: propose, decline, set, revert', async () => {
			let [r] = await run({ resource: 'incident', operation: 'proposeMajor', ticketId: id, majorOptions: { comments: 'n8n test' } });
			[r] = await run({ resource: 'incident', operation: 'declineMajorProposal', ticketId: id });
			[r] = await run({ resource: 'incident', operation: 'setMajor', ticketId: id, majorOptions: { summary: 'n8n test' } });
			assert(r.MajorIncident === 1, `set: ${r.MajorIncident}`);
			[r] = await run({ resource: 'incident', operation: 'revertMajor', ticketId: id, removeServiceFromSac: true });
			assert(r.MajorIncident === 0, `revert: ${r.MajorIncident}`);
		});

		// ------------------------------------------------ attachments
		const text = `n8n attachment test äöü ${Date.now()}`;
		const binary = { data: { data: Buffer.from(text).toString('base64'), mimeType: 'text/plain', fileName: 'n8n-test äöü.txt' } };
		const file = await step('attachment upload', async () => {
			const [r] = await run({ resource: 'attachment', operation: 'upload', ticketId: id, binaryPropertyName: 'data', uploadOptions: {} }, { binary });
			assert(r.UniqueFileId && r.Uploaded === true && r.Name === 'n8n-test äöü.txt', short(r));
			return r;
		});
		if (file) {
			await step('attachment get many', async () => {
				const r = await run({ resource: 'attachment', operation: 'getAll', ticketId: id });
				assert(r.some((f) => f.UniqueFileId === file.UniqueFileId), short(r));
			});
			await step('attachment download roundtrip', async () => {
				const [item] = await run({ resource: 'attachment', operation: 'download', fileId: file.UniqueFileId, outputBinaryPropertyName: 'file' }, { raw: true });
				assert(Buffer.from(item.binary.file.data, 'base64').toString() === text, 'content differs');
				assert(item.json.Name === 'n8n-test äöü.txt', item.json.Name);
			});
			await step('attachment delete', async () => {
				await run({ resource: 'attachment', operation: 'delete', fileId: file.UniqueFileId });
				const r = await run({ resource: 'attachment', operation: 'getAll', ticketId: id });
				assert(!r.some((f) => f.UniqueFileId === file.UniqueFileId), 'still listed');
			});
		}

		// ------------------------------------------------ journal trigger
		await step('trigger journalEntry: baseline, new entry, no duplicates', async () => {
			resetPoll();
			const params = { event: 'journalEntry', ticketTypes: ['incident'], journalFilters: {} };
			assert((await poll(params)) === null, 'baseline should not emit');
			await run({ resource: 'journal', operation: 'add', ticketId: id, comments: 'n8n trigger test', journalOptions: {} });
			const r = await poll(params);
			assert(r && r.some((e) => e.Text === 'n8n trigger test' && e.TicketNumber === inc.TicketNumber), short(r));
			assert((await poll(params)) === null, 'duplicates');
		});
	}

	// ------------------------------------------------ category / role filters
	await step('loadOptions getCategories (with path) + getRoles', async () => {
		const cats = await method('loadOptions', 'getCategories');
		const roles = await method('loadOptions', 'getRoles');
		assert(cats.some((c) => c.name.includes(' / ')) && roles.length > 0, `${cats.length} categories, ${roles.length} roles`);
	});
	if (inc) {
		const [current] = await run({ resource: 'incident', operation: 'get', ticketId: rl(inc.ObjectId), options: { columns: 'Category.Parent as CategoryParent' } });
		await step('getAll: parent category incl. subcategories + role finds the ticket', async () => {
			const filters = { categories: [current.CategoryParent], responsibleRoles: [current.RecipientRole], subjectContains: '[n8n-test]' };
			const r = await run({ resource: 'incident', operation: 'getAll', returnAll: true, filters, options: {} });
			assert(r.some((t) => t.ObjectId === inc.ObjectId), `${r.length} rows`);
			const without = await run({ resource: 'incident', operation: 'getAll', returnAll: true, filters: { ...filters, includeSubcategories: false }, options: {} });
			assert(!without.some((t) => t.ObjectId === inc.ObjectId), 'parent only must not match');
		});
		await step('trigger created: category filter matches only own category', async () => {
			resetPoll();
			const params = { event: 'created', ticketTypes: ['incident'], filters: { categories: [current.Category] } };
			assert((await poll(params)) === null, 'baseline');
			const t = await createTicket('incident', 'Trigger category probe');
			const r = await poll(params);
			assert(r && r.length === 1 && r[0].ObjectId === t.ObjectId, short(r));
		});
		await step('trigger manual run previews all pending entries without moving the position', async () => {
			resetPoll();
			const params = { event: 'journalEntry', ticketTypes: ['incident'], journalFilters: {} };
			assert((await poll(params)) === null, 'baseline');
			for (const text of ['n8n manual preview 1', 'n8n manual preview 2']) {
				await run({ resource: 'journal', operation: 'add', ticketId: rl(inc.ObjectId), comments: text, journalOptions: {} });
			}
			const position = JSON.stringify(staticData);
			const manual = await poll(params, 'manual');
			assert(manual && manual.filter((e) => e.ObjectId === inc.ObjectId && e.Text.startsWith('n8n manual preview')).length === 2, short(manual));
			assert(JSON.stringify(staticData) === position, 'manual run moved the position');
			const live = await poll(params);
			assert(live && live.filter((e) => e.ObjectId === inc.ObjectId && e.Text.startsWith('n8n manual preview')).length === 2, short(live));
			// nothing pending any more: the manual run falls back to the lookback window
			const recent = await poll(params, 'manual');
			assert(recent && recent.filter((e) => e.ObjectId === inc.ObjectId && e.Text.startsWith('n8n manual preview')).length === 2, short(recent));
		});
		await step('trigger manual run without position returns the lookback window', async () => {
			resetPoll();
			const params = { event: 'journalEntry', ticketTypes: ['incident'], journalFilters: {}, options: { testLookbackMinutes: 30 } };
			const r = await poll(params, 'manual');
			assert(r && r.filter((e) => e.ObjectId === inc.ObjectId && e.Text.startsWith('n8n manual preview')).length === 2, short(r));
			assert(Object.keys(staticData).length === 0, 'manual run stored a position');
		});
		await step('trigger journalEntry: role filter', async () => {
			resetPoll();
			const params = { event: 'journalEntry', journalFilters: { responsibleRoles: [current.RecipientRole] } };
			assert((await poll(params)) === null, 'baseline');
			await run({ resource: 'journal', operation: 'add', ticketId: rl(inc.ObjectId), comments: 'n8n role filter test', journalOptions: {} });
			const r = await poll(params);
			assert(r && r.some((e) => e.Text === 'n8n role filter test'), short(r));
		});
	}

	// ------------------------------------------------ service / asset / org / CI filters (read-only, on existing tickets)
	await step('filters: service, asset, org unit, location, cost center, CI', async () => {
		const [sample] = await run({
			resource: 'ticket', operation: 'getAll', returnAll: false, limit: 1,
			filters: { where: 'Service IS NOT NULL AND T(SPSActivityClassIncident).Asset IS NOT NULL AND T(SPSCommonClassBase).Location IS NOT NULL' },
			options: { columns: 'T(SPSActivityClassIncident).Asset as Asset, T(SPSActivityClassIncident).Asset.[Expression-ObjectID] as AssetObjectId, T(SPSCommonClassBase).OU as OU, T(SPSCommonClassBase).Location as Location, T(SPSCommonClassBase).CostCenter as CostCenter, T(SPSCommonClassBase).Location.Parent as LocationParent' },
		});
		assert(sample, 'no sample ticket with service, asset and location');
		const finds = async (filters) => {
			const r = await run({ resource: 'ticket', operation: 'getAll', returnAll: true, filters: { ...filters, ticketNumber: sample.TicketNumber }, options: { onlyAdditionalColumns: true, columns: 'TicketNumber' } });
			return r.length === 1;
		};
		const checks = {
			service: { services: [sample.Service] },
			assetById: { assets: [sample.Asset] },
			assetByObjectId: { assets: [sample.AssetObjectId] },
			orgUnit: { orgUnits: [sample.OU] },
			location: { locations: [sample.Location] },
			costCenter: { costCenters: [sample.CostCenter] },
		};
		if (sample.LocationParent) checks.parentLocationWithSubs = { locations: [sample.LocationParent] };
		const failed = [];
		for (const [name, filters] of Object.entries(checks)) if (!(await finds(filters))) failed.push(name);
		if (sample.LocationParent && (await finds({ locations: [sample.LocationParent], includeSubLocations: false }))) failed.push('parentLocationWithoutSubs');
		if (await finds({ services: ['00000000-0000-0000-0000-000000000001'] })) failed.push('serviceNegative');
		assert(failed.length === 0, `failed: ${failed.join(', ')} (sample ${sample.TicketNumber})`);
		console.log(`     sample ${sample.TicketNumber}, ${Object.keys(checks).length} positive + negative checks`);
	});
	await step('filter: configuration item (object ID)', async () => {
		const [ticket] = await run({ resource: 'ticket', operation: 'getAll', returnAll: false, limit: 1, filters: { where: 'ConfigurationItems.ID IS NOT NULL' }, options: {} });
		const cis = await run({ resource: 'object', operation: 'getAll', className: rl('SPSCommonClassBase', 'name'), returnAll: false, limit: 1, columns: '[Expression-ObjectID] as ObjectId', where: `Tasks.ID = '${ticket.ID}'`, sort: '' });
		const r = await run({ resource: 'ticket', operation: 'getAll', returnAll: true, filters: { configurationItems: [cis[0].ObjectId] }, options: {} });
		assert(r.some((t) => t.ObjectId === ticket.ObjectId), `${ticket.TicketNumber} not found via CI ${cis[0].ObjectId}`);
	});
	await step('loadOptions org units, locations, cost centers, services', async () => {
		for (const name of ['getOrgUnits', 'getLocations', 'getCostCenters', 'getServices']) {
			assert((await method('loadOptions', name)).length > 0, `${name} empty`);
		}
	});
	if (inc) {
		await step('trigger journalEntry: location + org unit filter', async () => {
			const [t] = await run({ resource: 'incident', operation: 'get', ticketId: rl(inc.ObjectId), options: { columns: 'T(SPSCommonClassBase).Location as Location, T(SPSCommonClassBase).OU as OU' } });
			resetPoll();
			const params = { event: 'journalEntry', journalFilters: { locations: [t.Location], orgUnits: [t.OU] } };
			assert((await poll(params)) === null, 'baseline');
			await run({ resource: 'journal', operation: 'add', ticketId: rl(inc.ObjectId), comments: 'n8n location filter test', journalOptions: {} });
			const r = await poll(params);
			assert(r && r.some((e) => e.Text === 'n8n location filter test'), short(r));
		});
	}

	await step('trigger objectChanged: manual preview with all attributes of a data definition', async () => {
		resetPoll();
		const r = await poll({ event: 'objectChanged', className: rl('SPSUserClassBase', 'name'), objectFilters: {} }, 'manual');
		assert(r && r.length > 0 && r.length <= 10 && 'LastName' in r[0] && 'MailAddress' in r[0] && r[0].ObjectId, short(r && r[0]));
	});
	if (inc) {
		await step('trigger objectChanged: detects an update, no duplicates', async () => {
			resetPoll();
			const params = {
				event: 'objectChanged',
				className: rl('SPSActivityClassBase', 'name'),
				objectFilters: { columns: 'TicketNumber, Subject', where: "Subject LIKE '[[]n8n-test]%'" },
			};
			assert((await poll(params)) === null, 'baseline');
			await run({ resource: 'incident', operation: 'update', ticketId: rl(inc.ObjectId), updateFields: { subject: '[n8n-test] Incident (changed for trigger)' } });
			const r = await poll(params);
			assert(r && r.some((o) => o.ObjectId === inc.ObjectId && o.Subject.endsWith('(changed for trigger)')), short(r));
			assert((await poll(params)) === null, 'duplicates');
		});
	}

	// ------------------------------------------------ other kinds
	const sr = await step('service request create + update', async () => {
		const t = await createTicket('serviceRequest', 'SR');
		const [r] = await run({ resource: 'serviceRequest', operation: 'update', ticketId: rl(t.ObjectId), updateFields: { subject: '[n8n-test] SR (updated)' } });
		assert(t.TicketType === 'Service Request' && r.Subject.endsWith('(updated)'), short(r));
		return t;
	});
	await step('ticket create + update', async () => {
		const t = await createTicket('ticket', 'Ticket');
		const [r] = await run({ resource: 'ticket', operation: 'update', ticketId: rl(t.ObjectId), updateFields: { subject: '[n8n-test] Ticket (updated)' } });
		assert(r.Subject.endsWith('(updated)'), short(r));
	});
	await step('task create', async () => assert((await createTicket('task', 'Task')).TicketType === 'Task', 'type'));
	await step('change create + get approvals', async () => {
		const tpl = await method('listSearch', 'searchChangeTemplates', {}, 'Non-Standard');
		const t = await createTicket('change', 'Change', { changeTemplate: rl(tpl.results[0].value, 'list') });
		assert(t.TicketType === 'Change', short(t));
		await run({ resource: 'change', operation: 'getApprovals', ticketId: rl(t.ObjectId) });
	});

	// ------------------------------------------------ get many
	await step('getAll with type, state and extra columns', async () => {
		const r = await run({ resource: 'ticket', operation: 'getAll', returnAll: false, limit: 5, filters: { ticketTypes: ['task', 'change'], states: [204, 10013] }, options: { columns: 'Recipient.LastName as RecipientLastName', sort: 'ClosedDate DESC' } });
		assert(r.length > 0 && r.every((t) => ['Task', 'Change'].includes(t.TicketType)), short(r));
	});
	await step('getAll returnAll paginates', async () => {
		const r = await run({ resource: 'task', operation: 'getAll', returnAll: true, filters: {}, options: { onlyAdditionalColumns: true, columns: 'TicketNumber' } });
		assert(r.length > 0 && new Set(r.map((t) => t.ID)).size === r.length, `${r.length} rows`);
	});

	// ------------------------------------------------ assets, objects, users
	await step('asset get many + get + full object', async () => {
		const [a] = await run({ resource: 'asset', operation: 'getAll', returnAll: false, limit: 1, filters: {}, options: {} });
		const [f] = await run({ resource: 'asset', operation: 'get', assetId: rl(a.ID), fullObject: true });
		assert(f && Object.keys(f).length > 1, short(f));
	});
	await step('object get many', async () => {
		const r = await run({ resource: 'object', operation: 'getAll', className: rl('SPSUserClassBase', 'name'), returnAll: false, limit: 2, columns: 'LastName', where: '', sort: 'LastName ASC' });
		assert(r.length === 2, short(r));
	});
	await step('user get many by e-mail + get', async () => {
		const [any] = await run({ resource: 'user', operation: 'getAll', returnAll: false, limit: 1, userFilters: { where: 'MailAddress IS NOT NULL' } });
		const r = await run({ resource: 'user', operation: 'getAll', returnAll: false, limit: 5, userFilters: { email: any.MailAddress } });
		assert(r.length >= 1 && r[0].MailAddress.toLowerCase() === any.MailAddress.toLowerCase(), short(r));
		const [g] = await run({ resource: 'user', operation: 'get', userId: rl(any.ID) });
		assert(g.ID === any.ID, short(g));
	});

	// ------------------------------------------------ full objects, fragments, attachments on any object
	const location = await step('object: create full object (location)', async () => {
		const [o] = await run({ resource: 'object', operation: 'createObject', ciName: rl('SPSLocationType', 'name'), objectData: { SPSLocationClassBase: { Name: '[n8n-test] Location' } } });
		assert(o.ID && o.SPSLocationClassBase && o.SPSLocationClassBase.Name === '[n8n-test] Location', short(o));
		return o;
	});
	if (location) {
		await step('object: update + get full object', async () => {
			await run({ resource: 'object', operation: 'updateObject', ciName: rl('SPSLocationType', 'name'), objectId: location.ID, objectData: { SPSLocationClassBase: { Name: '[n8n-test] Location (updated)' } } });
			const [o] = await run({ resource: 'object', operation: 'getFull', ciName: rl('SPSLocationType', 'name'), objectId: location.ID });
			assert(o.SPSLocationClassBase.Name === '[n8n-test] Location (updated)', short(o.SPSLocationClassBase));
		});
		await step('attachment on any object: upload, list, delete', async () => {
			const binary = { data: { data: Buffer.from('object attachment').toString('base64'), mimeType: 'text/plain', fileName: 'n8n-object.txt' } };
			const [f] = await run({ resource: 'attachment', operation: 'upload', attachTo: 'object', attachmentObjectId: location.ID, binaryPropertyName: 'data', uploadOptions: {} }, { binary });
			assert(f.UniqueFileId && f.ObjectId === location.ID, short(f));
			const list = await run({ resource: 'attachment', operation: 'getAll', attachTo: 'object', attachmentObjectId: location.ID });
			assert(list.some((x) => x.UniqueFileId === f.UniqueFileId), short(list));
			await run({ resource: 'attachment', operation: 'delete', fileId: f.UniqueFileId });
		});
		await step('object: delete fragment keeps the object, delete full object removes it', async () => {
			const [frag] = await run({ resource: 'object', operation: 'getAll', className: rl('SPSLocationClassBase', 'name'), returnAll: false, limit: 1, columns: 'Name', where: `[Expression-ObjectID] = '${location.ID}'`, sort: '' });
			await run({ resource: 'object', operation: 'delete', className: rl('SPSLocationClassBase', 'name'), fragmentId: frag.ID });
			const [still] = await run({ resource: 'object', operation: 'getFull', ciName: rl('SPSLocationType', 'name'), objectId: location.ID });
			assert(still && still.ID === location.ID, 'object vanished with the fragment');
			await run({ resource: 'object', operation: 'deleteObject', ciName: rl('SPSLocationType', 'name'), objectId: location.ID });
			const [gone] = await run({ resource: 'object', operation: 'getFull', ciName: rl('SPSLocationType', 'name'), objectId: location.ID });
			assert(!gone || Object.keys(gone).length === 0, 'object still exists');
		});
	}
	await step('listSearch types, data queries, import definitions', async () => {
		for (const name of ['searchTypes', 'searchDataQueries', 'searchImportDefinitions']) {
			assert((await method('listSearch', name, {}, '')).results.length > 0, `${name} empty`);
		}
	});
	await step('data query: get data with limit and return all', async () => {
		const dq = await method('listSearch', 'searchDataQueries', {}, 'Configuration Items in Incidents');
		const id = rl(dq.results[0].value, 'list');
		const limited = await run({ resource: 'dataQuery', operation: 'getData', dataQueryId: id, returnAll: false, limit: 3, dataQueryOptions: {} });
		assert(limited.length > 0 && limited.length <= 3, `${limited.length} rows`);
		const all = await run({ resource: 'dataQuery', operation: 'getData', dataQueryId: id, returnAll: true, dataQueryOptions: {} });
		assert(all.length >= limited.length, `${all.length} rows`);
		console.log(`     ${all.length} rows, e.g. ${short(all[0])}`);
	});

	// ------------------------------------------------ approvals
	await step('approval get many (open)', async () => {
		const r = await run({ resource: 'approval', operation: 'getAll', returnAll: true, approvalFilters: { onlyOpen: true } });
		assert(r.every((t) => t.State === 10022), short(r));
		console.log(`     ${r.length} open`);
	});
	if (process.env.M42_TEST_APPROVAL_TASK) {
		await step('approval get + decide (approve)', async () => {
			const task = rl(process.env.M42_TEST_APPROVAL_TASK, 'ticketNumber');
			const [g] = await run({ resource: 'approval', operation: 'get', approvalTaskId: task });
			assert(Array.isArray(g.Bookings), short(g));
			const [d] = await run({ resource: 'approval', operation: 'decide', approvalTaskId: task, decision: 'approve', comments: '[n8n-test] approved by live test', decideOptions: {} });
			assert(d.State === 10024, short(d));
		});
	}

	// ------------------------------------------------ workflows
	await step('workflow argument mapper', async () => {
		const wf = await method('listSearch', 'searchWorkflows', {}, '');
		const fields = await method('resourceMapping', 'getWorkflowArguments', { workflowId: rl(wf.results[0].value, 'list') });
		assert(Array.isArray(fields.fields), short(fields));
	});
	await step('workflow get waiting', async () => {
		await run({ resource: 'workflow', operation: 'getWaiting', returnAll: false, limit: 5, waitingFilters: {} });
	});
	await step('trigger workflowWaiting baseline', async () => {
		resetPoll();
		assert((await poll({ event: 'workflowWaiting' })) === null, 'baseline should not emit');
	});
	if (process.env.M42_TEST_RESUME_BOOKMARK) {
		await step('workflow resume + wait for completion', async () => {
			const [r] = await run({ resource: 'workflow', operation: 'resume', bookmark: rl(process.env.M42_TEST_RESUME_BOOKMARK), inputData: 'n8n live test', waitForCompletion: true, timeout: 60 });
			console.log('    ', short(r));
			assert(r.success && r.Completed, short(r));
		});
	}
	if (process.env.M42_TEST_START_WORKFLOW) {
		await step('workflow start (mapper) + wait', async () => {
			const [r] = await run({ resource: 'workflow', operation: 'start', workflowId: rl(process.env.M42_TEST_START_WORKFLOW), argumentsMode: 'mapper', argumentsMapping: { mappingMode: 'defineBelow', value: {} }, waitForCompletion: true, timeout: 60 });
			assert(r.Completed, short(r));
		});
	}

	// ------------------------------------------------ expired access token (Matrix42 answers 406, not 401)
	await step('expired token: older n8n (renews only on 401) -> node falls back to its own token', async () => {
		runtime.supportsRetryStatusCodes = false;
		credentials.accessToken = 'expired-token';
		const r = await run({ resource: 'user', operation: 'getAll', returnAll: false, limit: 1, userFilters: {} });
		assert(r.length === 1, 'request failed');
		assert(credentials.accessToken === 'expired-token', 'n8n credential should be untouched in this mode');
	});
	await step('expired token: newer n8n (renews on 406) -> credential token is renewed', async () => {
		runtime.supportsRetryStatusCodes = true;
		// a fresh node module instance has no fallback token cached, as after an n8n restart
		for (const key of Object.keys(require.cache)) if (key.includes('/dist/') || key.endsWith('harness.cjs')) delete require.cache[key];
		const fresh = require('./harness.cjs');
		fresh.runtime.supportsRetryStatusCodes = true;
		fresh.credentials.accessToken = 'expired-token';
		const before = fresh.runtime.renewals;
		const r = await fresh.run({ resource: 'user', operation: 'getAll', returnAll: false, limit: 1, userFilters: {} });
		assert(r.length === 1 && fresh.runtime.renewals === before + 1 && fresh.credentials.accessToken !== 'expired-token', 'not renewed');
	});

	// ------------------------------------------------ errors
	await step('unknown ticket number gives a clear error', async () => {
		try {
			await run({ resource: 'incident', operation: 'get', ticketId: rl('INC99999999', 'ticketNumber'), options: {} });
		} catch (e) {
			assert(/No ticket found/.test(e.message), e.message);
			return;
		}
		throw new Error('expected an error');
	});
	await step('Matrix42 error message is surfaced', async () => {
		try {
			await run({ resource: 'object', operation: 'getAll', className: rl('SPSUserClassBase', 'name'), returnAll: false, limit: 1, columns: 'DoesNotExist', where: '', sort: '' });
		} catch (e) {
			assert(/DoesNotExist/.test(e.message), e.message);
			return;
		}
		throw new Error('expected an error');
	});

	// ------------------------------------------------ cleanup
	await step(`cleanup: close ${created.length} test tickets`, async () => {
		for (const objectId of created) {
			await run({ resource: 'ticket', operation: 'close', ticketId: rl(objectId), comments: 'closed by n8n live test', closeOptions: { skipFailIfAlreadyClosed: true } });
		}
	});

	const passed = results.filter(Boolean).length;
	console.log(`\n${passed}/${results.length} passed`);
	process.exit(passed === results.length ? 0 : 1);
})();
