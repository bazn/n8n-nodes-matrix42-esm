// Minimal n8n runtime stub to exercise the compiled Matrix42 nodes against a live instance.
// Configure with the environment variables M42_URL, M42_API_TOKEN and optionally M42_LANGUAGE / M42_TIMEZONE.
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { Matrix42Esm: Matrix42 } = require(path.join(ROOT, 'dist/nodes/Matrix42/Matrix42Esm.node.js'));
const { Matrix42EsmTrigger: Matrix42Trigger } = require(path.join(ROOT, 'dist/nodes/Matrix42EsmTrigger/Matrix42EsmTrigger.node.js'));
const { Matrix42EsmApi } = require(path.join(ROOT, 'dist/credentials/Matrix42EsmApi.credentials.js'));

if (!process.env.M42_URL || !process.env.M42_API_TOKEN) {
	console.error('Set M42_URL and M42_API_TOKEN to run the live tests.');
	process.exit(2);
}
const credentials = {
	url: process.env.M42_URL,
	apiToken: process.env.M42_API_TOKEN,
	language: process.env.M42_LANGUAGE || 'de-DE',
	accessToken: '',
};
const credType = new Matrix42EsmApi();

async function httpRequest(options) {
	const url = new URL(options.url);
	for (const [k, v] of Object.entries(options.qs || {})) if (v !== undefined) url.searchParams.set(k, String(v));
	const headers = { ...(options.headers || {}) };
	let body;
	if (Buffer.isBuffer(options.body)) {
		body = options.body;
	} else if (options.body !== undefined) {
		body = JSON.stringify(options.body);
		headers['content-type'] = 'application/json';
	}
	const res = await fetch(url, { method: options.method || 'GET', headers, body });
	if (options.encoding === 'arraybuffer' && res.status < 400) {
		const buffer = Buffer.from(await res.arrayBuffer());
		const responseHeaders = Object.fromEntries(res.headers.entries());
		return options.returnFullResponse ? { body: buffer, headers: responseHeaders, statusCode: res.status } : buffer;
	}
	const text = await res.text();
	let parsed = text;
	try { parsed = text ? JSON.parse(text) : ''; } catch {}
	if (res.status >= 400) {
		const err = new Error(`Request failed with status code ${res.status}`);
		err.httpCode = String(res.status);
		err.response = { body: parsed, status: res.status };
		throw err;
	}
	return parsed;
}

let requestLog = [];
// Simulates n8n's credential handling. With `supportsRetryStatusCodes` false it behaves like older n8n
// versions that renew a pre-authentication token only on 401.
const runtime = { supportsRetryStatusCodes: false, renewals: 0 };
async function httpRequestWithAuthentication(_name, options, additional = {}) {
	if (!credentials.accessToken) {
		Object.assign(credentials, await credType.preAuthentication.call({ helpers: { httpRequest } }, credentials));
	}
	const send = () =>
		httpRequest({
			...options,
			headers: { ...(options.headers || {}), Authorization: `Bearer ${credentials.accessToken}`, 'Explicit-Language': credentials.language },
		});
	requestLog.push(`${options.method} ${options.url.replace(/^.*m42Services\/api\//, '')}`);
	try {
		return await send();
	} catch (error) {
		const retryOn = runtime.supportsRetryStatusCodes ? [].concat(additional.preAuthenticationRetryStatusCode ?? 401) : [401];
		if (!retryOn.includes(Number(error.httpCode))) throw error;
		runtime.renewals++;
		Object.assign(credentials, await credType.preAuthentication.call({ helpers: { httpRequest } }, credentials));
		return send();
	}
}

const node = { name: 'Matrix42', type: 'n8n-nodes-matrix42.matrix42', typeVersion: 1, parameters: {} };

function baseContext(params, extra = {}) {
	return {
		getNode: () => node,
		getTimezone: () => process.env.M42_TIMEZONE || 'Europe/Zurich',
		getCredentials: async () => credentials,
		getNodeParameter(name, itemIndex, fallback, opts) {
			if (typeof itemIndex !== 'number') { opts = fallback; fallback = itemIndex; }
			const nested = name.split('.').reduce((obj, key) => (obj && typeof obj === 'object' ? obj[key] : undefined), params);
			let v = nested !== undefined ? nested : fallback;
			if (v === undefined) throw new Error(`Missing parameter ${name}`);
			if (opts && opts.extractValue && v && typeof v === 'object' && '__rl' in v) v = v.value;
			return v;
		},
		getCurrentNodeParameter: (name) => params[name],
		continueOnFail: () => false,
		getInputData: () => [{ json: {}, ...(extra.binary ? { binary: extra.binary } : {}) }],
		helpers: {
			assertBinaryData: (_i, name) => {
				const data = extra.binary && extra.binary[name];
				if (!data) throw new Error(`No binary data in field "${name}"`);
				return data;
			},
			getBinaryDataBuffer: async (_i, name) => Buffer.from(extra.binary[name].data, 'base64'),
			prepareBinaryData: async (buffer, fileName, mimeType) => ({
				data: buffer.toString('base64'),
				fileName,
				mimeType,
				fileSize: String(buffer.length),
			}),
			httpRequest,
			httpRequestWithAuthentication,
			returnJsonArray: (d) => (Array.isArray(d) ? d : [d]).map((json) => ({ json })),
			constructExecutionMetaData: (items, { itemData }) => items.map((i) => ({ ...i, pairedItem: itemData })),
		},
		...Object.fromEntries(Object.entries(extra).filter(([k]) => !['binary', 'raw'].includes(k))),
	};
}

async function run(params, extra = {}) {
	requestLog = [];
	const out = await new Matrix42().execute.call(baseContext(params, extra));
	return out[0].map((i) => (extra.raw ? i : i.json));
}

async function method(kind, name, params = {}, filter) {
	const fn = new Matrix42().methods[kind][name];
	const ctx = baseContext(params);
	// resource mapper methods read parameters without an item index
	ctx.getNodeParameter = (n, _i, opts) => {
		let v = params[n];
		if (opts && opts.extractValue && v && typeof v === 'object' && '__rl' in v) v = v.value;
		return v;
	};
	return fn.call(ctx, filter);
}

const staticData = {};
async function poll(params, mode = 'trigger') {
	params = { ticketTypes: [], filters: {}, journalFilters: {}, workflowFilters: {}, ...params };
	const ctx = baseContext(params, { getWorkflowStaticData: () => staticData, getMode: () => mode });
	// IPollFunctions.getNodeParameter has no item index: (name, fallback, options)
	const byItem = ctx.getNodeParameter;
	ctx.getNodeParameter = (name, fallback, opts) => byItem(name, 0, fallback, opts);
	const out = await new Matrix42Trigger().poll.call(ctx);
	return out ? out[0].map((i) => i.json) : null;
}

const rl = (value, mode = 'id') => ({ __rl: true, mode, value });

module.exports = { run, method, poll, rl, staticData, getLog: () => requestLog, credentials, runtime };
