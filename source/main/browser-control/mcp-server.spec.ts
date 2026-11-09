import {request as httpRequest} from 'node:http';
import test from 'ava';
import {z} from 'zod';
import {
	type BrowserMcpServer,
	type BrowserTool,
	createBrowserMcpServer,
	MCP_BODY_LIMIT,
} from '@/main/browser-control/mcp-server';

interface Reply {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

function send(
	url: string,
	options: {
		method?: string;
		headers?: Record<string, string>;
		body?: string | Buffer;
	} = {},
): Promise<Reply> {
	return new Promise((resolve, reject) => {
		const request = httpRequest(
			url,
			{method: options.method ?? 'POST', headers: options.headers},
			response => {
				const chunks: Buffer[] = [];
				response.on('data', chunk => chunks.push(chunk));
				response.on('end', () =>
					resolve({
						status: response.statusCode ?? 0,
						headers: response.headers,
						body: Buffer.concat(chunks).toString('utf8'),
					}),
				);
			},
		);
		request.on('error', reject);
		request.end(options.body);
	});
}

interface Harness {
	server: BrowserMcpServer;
	calls: Array<{
		projectId: string;
		args: Record<string, unknown>;
		sessionId?: string | null;
	}>;
}

const statusTool = (calls: Harness['calls']): BrowserTool => ({
	name: 'desktop_browser_status',
	description: 'Test status tool',
	readOnly: true,
	call: ({projectId, sessionId}, args) => {
		calls.push({projectId, args, sessionId});
		return {text: `status for ${projectId}`};
	},
});

async function started(tools?: BrowserTool[]): Promise<Harness> {
	const calls: Harness['calls'] = [];
	const server = createBrowserMcpServer({
		version: '0.0.0-test',
		tools: tools ?? [statusTool(calls)],
	});
	await server.start();
	return {server, calls};
}

function lease(harness: Harness, projectId = 'project-a') {
	const leased = harness.server.forProject(projectId).lease();
	if (!leased) throw new Error('Expected a lease');
	const header = leased.server.headers.find(h => h.name === 'Authorization');
	return {...leased, url: leased.server.url, auth: header?.value ?? ''};
}

const rpc = (method: string, params?: unknown, id: number | null = 1) =>
	JSON.stringify({
		jsonrpc: '2.0',
		...(id === null ? {} : {id}),
		method,
		...(params === undefined ? {} : {params}),
	});

function post(
	url: string,
	auth: string,
	body: string,
	headers: Record<string, string> = {},
) {
	return send(url, {
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			authorization: auth,
			...headers,
		},
		body,
	});
}

test.serial(
	'a lease names one loopback HTTP server with a fresh bearer secret in its headers (DEC-47 ACP-22)',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const first = lease(harness);
		const second = lease(harness);
		t.is(first.server.type, 'http');
		t.is(first.server.name, 'nanocoder-desktop-browser');
		t.regex(first.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
		t.is(first.url, second.url);
		t.deepEqual(
			first.server.headers.map(header => header.name),
			['Authorization'],
		);
		t.regex(first.auth, /^Bearer [A-Za-z0-9_-]{43}$/);
		t.not(first.auth, second.auth);
	},
);

test.serial(
	'refuses any request that carries an Origin header, even with a valid secret (DEC-47)',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const {url, auth} = lease(harness);
		for (const origin of [
			'http://127.0.0.1:5173',
			'null',
			'https://evil.test',
		]) {
			const reply = await post(
				url,
				auth,
				rpc('tools/call', {name: 'desktop_browser_status', arguments: {}}),
				{origin},
			);
			t.is(reply.status, 403, origin);
			t.false(reply.body.includes('status for'));
		}
		t.deepEqual(harness.calls, []);
	},
);

test.serial(
	'refuses a missing, malformed, wrong or released secret (DEC-47)',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const leased = lease(harness);
		const body = rpc('tools/call', {
			name: 'desktop_browser_status',
			arguments: {},
		});
		for (const auth of [
			'',
			leased.auth.slice('Bearer '.length),
			`Basic ${leased.auth.slice('Bearer '.length)}`,
			`${leased.auth}x`,
			'Bearer ',
		]) {
			const reply = await post(leased.url, auth, body);
			t.is(reply.status, 401, auth);
			t.is(reply.headers['www-authenticate'], undefined);
		}
		t.is((await post(leased.url, leased.auth, body)).status, 200);
		leased.release();
		t.is((await post(leased.url, leased.auth, body)).status, 401);
		t.deepEqual(harness.calls, [
			{projectId: 'project-a', args: {}, sessionId: null},
		]);
	},
);

test.serial(
	'refuses a Host that is not the loopback address and port, so DNS rebinding cannot reach it',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const {url, auth} = lease(harness);
		const port = new URL(url).port;
		for (const host of [
			`localhost:${port}`,
			`evil.test:${port}`,
			'127.0.0.1',
			`127.0.0.1:${Number(port) + 1}`,
		]) {
			const reply = await post(url, auth, rpc('ping'), {host});
			t.is(reply.status, 403, host);
		}
		t.is((await post(url, auth, rpc('ping'))).status, 200);
	},
);

test.serial(
	'serves only POST on its one path, after the secret check',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const {url, auth} = lease(harness);
		const other = url.replace(/\/mcp$/, '/other');
		t.is((await post(other, auth, rpc('ping'))).status, 404);
		t.is(
			(await send(url, {method: 'GET', headers: {authorization: 'Bearer no'}}))
				.status,
			401,
		);
		for (const method of ['GET', 'DELETE', 'PUT']) {
			const reply = await send(url, {method, headers: {authorization: auth}});
			t.is(reply.status, 405, method);
			t.is(reply.headers.allow, 'POST');
		}
	},
);

test.serial(
	'refuses bodies that are not bounded single JSON-RPC objects',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const {url, auth} = lease(harness);
		t.is(
			(await post(url, auth, rpc('ping'), {'content-type': 'text/plain'}))
				.status,
			415,
		);
		const huge = JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'ping',
			params: {pad: 'x'.repeat(MCP_BODY_LIMIT)},
		});
		t.is((await post(url, auth, huge)).status, 413);
		const malformed = await post(url, auth, '{"jsonrpc":');
		t.is(malformed.status, 400);
		t.is(JSON.parse(malformed.body).error.code, -32700);
		for (const body of [
			`[${rpc('ping')}]`,
			'"ping"',
			JSON.stringify({jsonrpc: '1.0', id: 1, method: 'ping'}),
			JSON.stringify({jsonrpc: '2.0', id: 1, method: 7}),
			JSON.stringify({jsonrpc: '2.0', id: {}, method: 'ping'}),
		]) {
			const reply = await post(url, auth, body);
			t.is(reply.status, 400, body);
			t.is(JSON.parse(reply.body).error.code, -32600, body);
		}
		t.deepEqual(harness.calls, []);
	},
);

test.serial(
	'refuses an MCP protocol version header it does not speak',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const {url, auth} = lease(harness);
		const refused = await post(url, auth, rpc('ping'), {
			'mcp-protocol-version': '1999-01-01',
		});
		t.is(refused.status, 400);
		const accepted = await post(url, auth, rpc('ping'), {
			'mcp-protocol-version': '2025-06-18',
		});
		t.is(accepted.status, 200);
	},
);

test.serial(
	'initialize offers tools only and keeps a protocol version both sides speak',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const {url, auth} = lease(harness);
		const answer = async (protocolVersion: string) =>
			JSON.parse(
				(
					await post(
						url,
						auth,
						rpc('initialize', {
							protocolVersion,
							capabilities: {},
							clientInfo: {name: 'test', version: '1'},
						}),
					)
				).body,
			).result;
		const known = await answer('2025-03-26');
		t.is(known.protocolVersion, '2025-03-26');
		t.deepEqual(known.capabilities, {tools: {listChanged: false}});
		t.deepEqual(known.serverInfo, {
			name: 'nanocoder-desktop-browser',
			version: '0.0.0-test',
		});
		t.is((await answer('2099-01-01')).protocolVersion, '2025-06-18');
	},
);

test.serial(
	'answers notifications with 202 and no body, and unknown methods with method-not-found',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const {url, auth} = lease(harness);
		const notified = await post(
			url,
			auth,
			rpc('notifications/initialized', undefined, null),
		);
		t.is(notified.status, 202);
		t.is(notified.body, '');
		const unknown = await post(url, auth, rpc('resources/list', {}, 4));
		t.is(unknown.status, 200);
		t.like(JSON.parse(unknown.body), {
			jsonrpc: '2.0',
			id: 4,
			error: {code: -32601},
		});
		t.like(JSON.parse((await post(url, auth, rpc('ping'))).body), {
			id: 1,
			result: {},
		});
	},
);

test.serial(
	'lists its tools with read-only hints and an argument-free schema',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const {url, auth} = lease(harness);
		const reply = JSON.parse(
			(await post(url, auth, rpc('tools/list', {}))).body,
		);
		t.deepEqual(reply.result.tools, [
			{
				name: 'desktop_browser_status',
				description: 'Test status tool',
				inputSchema: {
					type: 'object',
					properties: {},
					additionalProperties: false,
				},
				annotations: {readOnlyHint: true},
			},
		]);
	},
);

test.serial(
	'a call reaches the tool only for the project its secret was issued to',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const a = lease(harness, 'project-a');
		const b = lease(harness, 'project-b');
		const call = (auth: string) =>
			post(
				a.url,
				auth,
				rpc('tools/call', {name: 'desktop_browser_status', arguments: {}}),
			).then(reply => JSON.parse(reply.body).result);
		t.deepEqual(await call(a.auth), {
			content: [{type: 'text', text: 'status for project-a'}],
			isError: false,
		});
		t.deepEqual(await call(b.auth), {
			content: [{type: 'text', text: 'status for project-b'}],
			isError: false,
		});
		t.deepEqual(
			harness.calls.map(entry => entry.projectId),
			['project-a', 'project-b'],
		);
	},
);

test.serial(
	'refuses unknown tools and unexpected arguments without calling anything',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const {url, auth} = lease(harness);
		const unknown = JSON.parse(
			(
				await post(
					url,
					auth,
					rpc('tools/call', {name: 'browser_eval', arguments: {}}),
				)
			).body,
		);
		t.is(unknown.error.code, -32602);
		for (const params of [
			{name: 'desktop_browser_status', arguments: {script: 'alert(1)'}},
			{name: 'desktop_browser_status', arguments: []},
			{name: 7},
			{},
		]) {
			const reply = JSON.parse(
				(await post(url, auth, rpc('tools/call', params))).body,
			);
			t.is(reply.error?.code, -32602, JSON.stringify(params));
		}
		const absent = JSON.parse(
			(
				await post(
					url,
					auth,
					rpc('tools/call', {name: 'desktop_browser_status'}),
				)
			).body,
		);
		t.false(absent.result.isError);
		t.deepEqual(harness.calls, [
			{projectId: 'project-a', args: {}, sessionId: null},
		]);
	},
);

test.serial(
	'a failing tool reports a generic error result, never its exception text',
	async t => {
		const harness = await started([
			{
				name: 'desktop_browser_status',
				description: 'Fails',
				readOnly: true,
				call: () => {
					throw new Error('secret internal detail /Users/someone');
				},
			},
		]);
		t.teardown(() => harness.server.close());
		const {url, auth} = lease(harness);
		const reply = JSON.parse(
			(
				await post(
					url,
					auth,
					rpc('tools/call', {name: 'desktop_browser_status', arguments: {}}),
				)
			).body,
		);
		t.true(reply.result.isError);
		t.false(JSON.stringify(reply).includes('secret internal detail'));
	},
);

test.serial(
	'is not ready and leases nothing before start or after close, and close revokes every secret',
	async t => {
		const server = createBrowserMcpServer({version: '0', tools: []});
		const sessions = server.forProject('project-a');
		t.false(sessions.ready());
		t.is(sessions.lease(), undefined);
		await server.start();
		t.true(sessions.ready());
		const leased = sessions.lease();
		if (!leased) throw new Error('Expected a lease');
		await server.close();
		t.false(sessions.ready());
		t.is(sessions.lease(), undefined);
		await t.throwsAsync(
			send(leased.server.url, {
				headers: {
					authorization:
						leased.server.headers.find(h => h.name === 'Authorization')
							?.value ?? '',
				},
				body: rpc('ping'),
			}),
		);
		leased.release();
		await server.close();
		await t.throwsAsync(server.start());
	},
);

test.serial(
	'releasing a lease twice is harmless and does not revoke another lease',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const first = lease(harness);
		const second = lease(harness);
		first.release();
		first.release();
		t.is((await post(second.url, second.auth, rpc('ping'))).status, 200);
		t.is((await post(first.url, first.auth, rpc('ping'))).status, 401);
	},
);

test.serial('a secret released while its call runs gets no answer', async t => {
	let finish!: () => void;
	const waiting = new Promise<void>(resolve => {
		finish = resolve;
	});
	let entered!: () => void;
	const started_ = new Promise<void>(resolve => {
		entered = resolve;
	});
	const harness = await started([
		{
			name: 'desktop_browser_status',
			description: 'Slow',
			readOnly: true,
			call: async () => {
				entered();
				await waiting;
				return {text: 'late page data'};
			},
		},
	]);
	t.teardown(() => harness.server.close());
	const leased = lease(harness);
	const pending = post(
		leased.url,
		leased.auth,
		rpc('tools/call', {name: 'desktop_browser_status', arguments: {}}),
	);
	await started_;
	leased.release();
	finish();
	const reply = await pending;
	t.is(reply.status, 401);
	t.false(reply.body.includes('late page data'));
});

test.serial(
	'a tool with arguments publishes its schema and gets only arguments that match it',
	async t => {
		const seen: unknown[] = [];
		const harness = await started([
			{
				name: 'desktop_browser_open',
				description: 'Open',
				readOnly: false,
				input: z.strictObject({url: z.string().max(20)}),
				call: (_projectId, args) => {
					seen.push(args);
					return {text: 'opened'};
				},
			},
		]);
		t.teardown(() => harness.server.close());
		const {url, auth} = lease(harness);
		const listed = JSON.parse(
			(await post(url, auth, rpc('tools/list', {}))).body,
		);
		t.deepEqual(listed.result.tools[0].inputSchema, {
			type: 'object',
			properties: {url: {type: 'string', maxLength: 20}},
			required: ['url'],
			additionalProperties: false,
		});
		t.deepEqual(listed.result.tools[0].annotations, {readOnlyHint: false});
		for (const args of [
			{},
			{url: 7},
			{url: 'x'.repeat(21)},
			{url: 'a', extra: 1},
		]) {
			const reply = JSON.parse(
				(
					await post(
						url,
						auth,
						rpc('tools/call', {name: 'desktop_browser_open', arguments: args}),
					)
				).body,
			);
			t.is(reply.error?.code, -32602, JSON.stringify(args));
			t.regex(
				reply.error?.message ?? '',
				/^Invalid arguments for desktop_browser_open/,
			);
		}
		await post(
			url,
			auth,
			rpc('tools/call', {name: 'desktop_browser_open', arguments: {url: 'a'}}),
		);
		t.deepEqual(seen, [{url: 'a'}]);
	},
);

test.serial(
	'an image result follows its text label, so a client that reads only the first block still gets the label',
	async t => {
		const harness = await started([
			{
				name: 'desktop_browser_screenshot',
				description: 'Shot',
				readOnly: true,
				call: () => ({
					text: 'Screenshot label',
					image: {data: 'aGk=', mimeType: 'image/jpeg'},
				}),
			},
		]);
		t.teardown(() => harness.server.close());
		const {url, auth} = lease(harness);
		const reply = JSON.parse(
			(
				await post(
					url,
					auth,
					rpc('tools/call', {
						name: 'desktop_browser_screenshot',
						arguments: {},
					}),
				)
			).body,
		);
		t.deepEqual(reply.result, {
			content: [
				{type: 'text', text: 'Screenshot label'},
				{type: 'image', data: 'aGk=', mimeType: 'image/jpeg'},
			],
			isError: false,
		});
	},
);

test.serial(
	'a call carries the session its secret was bound to, and the first binding holds',
	async t => {
		const harness = await started();
		t.teardown(() => harness.server.close());
		const leased = lease(harness);
		leased.bind('session-1');
		leased.bind('session-2');
		await post(
			leased.url,
			leased.auth,
			rpc('tools/call', {name: 'desktop_browser_status', arguments: {}}),
		);
		t.deepEqual(harness.calls, [
			{projectId: 'project-a', args: {}, sessionId: 'session-1'},
		]);
	},
);
