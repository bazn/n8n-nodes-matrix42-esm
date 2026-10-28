// Unit tests for pure helpers. Run with `npm test` (builds first, then uses node:test against dist/).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dist = path.join(__dirname, '..', '..', 'dist', 'nodes', 'Matrix42');
const g = require(path.join(dist, 'GenericFunctions.js'));
const { buildTicketWhere, typeCondition } = require(path.join(dist, 'actions', 'ticket.js'));

test('splitTopLevel ignores commas inside parentheses and brackets', () => {
	assert.deepEqual(g.splitTopLevel('A, COALESCE(B, C) as D , [Expression-ObjectID] as E'), [
		'A',
		'COALESCE(B, C) as D',
		'[Expression-ObjectID] as E',
	]);
	assert.deepEqual(g.splitTopLevel(''), []);
});

test('buildColumns always starts with ID and adds missing sort columns', () => {
	assert.deepEqual(g.buildColumns(['Name']), ['ID', 'Name']);
	assert.deepEqual(g.buildColumns(['TicketNumber'], 'CreatedDate DESC, TicketNumber ASC'), [
		'ID',
		'TicketNumber',
		'CreatedDate',
	]);
	// an alias counts as the column name
	assert.deepEqual(g.buildColumns(['T(X).Name as Name'], 'Name ASC'), ['ID', 'T(X).Name as Name']);
	assert.deepEqual(g.buildColumns(['ID', 'id']), ['ID']);
});

test('ASQL literals are escaped', () => {
	assert.equal(g.asqlLiteral("O'Brien"), "'O''Brien'");
	assert.equal(g.asqlLikeContains("50%_[x]'"), "'%50[%][_][[]x]''%'");
});

test('andWhere wraps and joins conditions, skipping empty ones', () => {
	assert.equal(g.andWhere([undefined, '', '  ']), undefined);
	assert.equal(g.andWhere(['A = 1', undefined, 'B = 2 OR C = 3']), '(A = 1) AND (B = 2 OR C = 3)');
});

test('toMatrix42Date passes wall-clock values and converts offsets to the time zone', () => {
	assert.equal(g.toMatrix42Date('2026-11-03T14:30:00', 'Europe/Zurich'), '2026-11-03T14:30:00');
	assert.equal(g.toMatrix42Date('2026-11-03T14:30:00.000+01:00', 'Europe/Zurich'), '2026-11-03T14:30:00');
	assert.equal(g.toMatrix42Date('2026-11-03T13:30:00Z', 'Europe/Zurich'), '2026-11-03T14:30:00');
	assert.equal(g.toMatrix42Date('2026-07-01T12:00:00Z', 'Europe/Zurich'), '2026-07-01T14:00:00');
	assert.equal(g.toMatrix42Date('', 'Europe/Zurich'), undefined);
});

test('resolveLocatorValue reads plain values and resource locators', () => {
	assert.equal(g.resolveLocatorValue({ __rl: true, mode: 'list', value: 'abc' }), 'abc');
	assert.equal(g.resolveLocatorValue({ __rl: true, mode: 'list', value: '' }), undefined);
	assert.equal(g.resolveLocatorValue('xyz'), 'xyz');
	assert.equal(g.resolveLocatorValue(undefined), undefined);
});

test('parseIdList splits comma-separated ids', () => {
	assert.deepEqual(g.parseIdList(' a, b ,,c '), ['a', 'b', 'c']);
	assert.deepEqual(g.parseIdList(['x', '']), ['x']);
});

test('simplifyTicketRow labels the ticket type and drops bookkeeping fields', () => {
	const row = g.simplifyTicketRow({
		ID: '1',
		'Expression-TypeCase': 'x',
		'Expression-TypeID': 'fe098714-ac94-47f1-9724-df5bac86b3fb',
	});
	assert.deepEqual(row, { ID: '1', TypeId: 'fe098714-ac94-47f1-9724-df5bac86b3fb', TicketType: 'Incident' });
});

test('simplifyTicketRow derives Description from DescriptionHTML only when it is empty', () => {
	const html = '<p>Pl&ouml;tzlich steht alles.</p> <p>&nbsp;</p>';
	assert.equal(g.simplifyTicketRow({ Description: null, DescriptionHTML: '<p>Line one<br />line &amp; two</p>' }).Description, 'Line one\nline & two');
	assert.equal(g.simplifyTicketRow({ Description: 'plain', DescriptionHTML: html }).Description, 'plain');
	assert.equal(g.simplifyTicketRow({ Description: null, DescriptionHTML: null }).Description, null);
	assert.equal(g.simplifyTicketRow({ Description: '', DescriptionHTML: html }).DescriptionHTML, html);
});

test('htmlToText turns Matrix42 rich text into readable plain text', () => {
	assert.equal(g.htmlToText('<p>A</p>\r\n<p>&nbsp;</p><p>B&#228;&#x20AC;</p>'), 'A\n\nBä€');
	assert.equal(g.htmlToText('<ul><li>one</li><li>two</li></ul><style>p{}</style>'), '- one\n- two');
	assert.equal(g.htmlToText('a &unknown; b'), 'a &unknown; b');
	assert.equal(g.htmlToText('Gr&uuml;&szlig;e &Ouml;l &NBSP;x'), 'Grüße Öl  x');
});

test('typeCondition supports a fragment prefix', () => {
	assert.equal(typeCondition([]), undefined);
	assert.equal(
		typeCondition(['incident', 'task'], 'T(SPSActivityClassBase).'),
		'T(SPSActivityClassBase).UsedInTypeSPSActivityTypeIncident IS NOT NULL OR T(SPSActivityClassBase).UsedInTypeSPSActivityTypeBase IS NOT NULL',
	);
});

test('buildTicketWhere combines kind, filters and locators', () => {
	const where = buildTicketWhere(
		'incident',
		{
			states: [200, 201],
			subjectContains: 'VPN',
			createdAfter: '2026-10-01T08:00:00',
			responsibleRole: { __rl: true, mode: 'list', value: 'role-1' },
			where: 'Priority >= 2',
		},
		'Europe/Zurich',
	);
	assert.equal(
		where,
		"(UsedInTypeSPSActivityTypeIncident IS NOT NULL) AND (T(SPSCommonClassBase).State IN (200, 201)) AND (Subject LIKE '%VPN%') AND (CreatedDate > '2026-10-01T08:00:00') AND (RecipientRole = 'role-1') AND (Priority >= 2)",
	);
	assert.equal(buildTicketWhere('ticket', {}, 'UTC'), undefined);
});

test('assignmentConditions builds IN filters, optionally with a fragment prefix', () => {
	const { assignmentConditions } = require(path.join(dist, 'actions', 'ticket.js'));
	assert.deepEqual(
		assignmentConditions({ categories: ['c1', 'c2'], responsibleRoles: ['r1'], responsibleUsers: [], priorities: [2, '3'] }).filter(Boolean),
		["Category IN ('c1', 'c2')", "RecipientRole IN ('r1')", 'Priority IN (2, 3)'],
	);
	assert.deepEqual(
		assignmentConditions({
			services: ['s1'],
			assets: [' a1 '],
			orgUnits: ['o1'],
			locations: ['l1'],
			costCenters: ['k1'],
			configurationItems: ['ci1'],
		}).filter(Boolean),
		[
			"Service IN ('s1') OR T(SPSActivityClassIncident).ServiceAffected IN ('s1')",
			"T(SPSActivityClassIncident).Asset IN ('a1') OR T(SPSActivityClassIncident).AssetAffected IN ('a1') OR T(SPSActivityClassIncident).Asset.[Expression-ObjectID] IN ('a1') OR T(SPSActivityClassIncident).AssetAffected.[Expression-ObjectID] IN ('a1')",
			"T(SPSCommonClassBase).OU IN ('o1')",
			"T(SPSCommonClassBase).Location IN ('l1')",
			"T(SPSCommonClassBase).CostCenter IN ('k1')",
			"ConfigurationItems.[Expression-ObjectID] IN ('ci1')",
		],
	);
	assert.deepEqual(assignmentConditions({ locations: ['l1'] }, 'T(SPSActivityClassBase).').filter(Boolean), [
		"T(SPSActivityClassBase).T(SPSCommonClassBase).Location IN ('l1')",
	]);
	assert.deepEqual(assignmentConditions({ categories: ['c1'] }, 'T(SPSActivityClassBase).').filter(Boolean), [
		"T(SPSActivityClassBase).Category IN ('c1')",
	]);
});

test('withSubcategories returns the categories and all descendants', () => {
	const tree = [
		{ id: 'root', name: 'Service Desk' },
		{ id: 'inc', name: 'Störungen', parent: 'root' },
		{ id: 'net', name: 'Netzwerk', parent: 'inc' },
		{ id: 'other', name: 'Other' },
	];
	assert.deepEqual(g.withSubcategories(tree, ['root']).sort(), ['inc', 'net', 'root']);
	assert.deepEqual(g.withSubcategories(tree, ['inc', 'other']).sort(), ['inc', 'net', 'other']);
});

test('rowVersionLiteral converts a base64 rowversion to an ASQL hex literal', () => {
	assert.equal(g.rowVersionLiteral('AAAAAIncUDY='), '0x0000000089dc5036');
	assert.equal(g.rowVersionLiteral('AAAAAAAAAAA='), '0x0000000000000000');
	assert.throws(() => g.rowVersionLiteral("x' OR 1=1 --"));
});

test('matrix42CredentialType picks the credential from the authentication parameter', () => {
	const exec = (value) => ({ getInputData: () => [], getNodeParameter: (_n, _i, fallback) => value ?? fallback });
	const poll = (value) => ({ getNodeParameter: (_n, fallback) => value ?? fallback });
	assert.equal(g.matrix42CredentialType(exec(undefined)), 'matrix42EsmApi');
	assert.equal(g.matrix42CredentialType(exec('basicAuth')), 'matrix42EsmBasicApi');
	assert.equal(g.matrix42CredentialType(poll('basicAuth')), 'matrix42EsmBasicApi');
	assert.equal(g.matrix42CredentialType({ getNodeParameter: () => { throw new Error('no such parameter'); } }), 'matrix42EsmApi');
});
