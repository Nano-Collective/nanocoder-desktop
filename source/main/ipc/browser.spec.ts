import test from 'ava';
import type {BrowserService} from '@/main/browser/browser-service';
import {registerBrowserHandlers} from '@/main/ipc/browser';
import {handleRequest, type Sender} from '@/main/ipc/handle-request';
import {APP_ORIGIN} from '@/main/security';
import {BROWSER_CHANNELS} from '@/shared/browser';
import type {IpcResult} from '@/shared/ipc';

const projectId = '11111111-1111-4111-8111-111111111111';
const sender: Sender = {url: `${APP_ORIGIN}/index.html`, isMainFrame: true};
const bounds = {x: 1, y: 2, width: 300, height: 200};

function fixture() {
	let calls = 0;
	const handlers = new Map<
		string,
		(payload: unknown, source?: Sender) => Promise<IpcResult<unknown>>
	>();
	const count = () => {
		calls++;
		return {status: 'closed'};
	};
	const service = {
		get: count,
		open: count,
		navigate: count,
		setBounds: count,
		closeView: count,
		profiles: count,
		setProfile: count,
		createProfile: count,
		deleteProfile: count,
		clearData: count,
		openExternal: count,
	} as unknown as BrowserService;
	registerBrowserHandlers(
		(channel, schema, handler, allowedOrigins) => {
			handlers.set(channel, (payload, source = sender) =>
				handleRequest({
					sender: source,
					payload,
					schema,
					handler,
					allowedOrigins,
				}),
			);
		},
		[APP_ORIGIN],
		service,
	);
	return {
		call: (
			key: keyof typeof BROWSER_CHANNELS,
			payload: unknown,
			source?: Sender,
		) => {
			const handler = handlers.get(BROWSER_CHANNELS[key]);
			if (!handler) throw new Error('Missing browser handler');
			return handler(payload, source);
		},
		calls: () => calls,
	};
}

test('SEC-02/SEC-12 browser schemas refuse extra fields, scripts, preloads and malformed input', async t => {
	const f = fixture();
	for (const key of ['get', 'close'] as const)
		for (const field of [{partition: 'persist:x'}, {preload: '/x.js'}]) {
			const result = await f.call(key, {projectId, ...field});
			t.false(result.ok);
			if (!result.ok) t.is(result.error.code, 'VALIDATION');
		}
	for (const extra of [
		{partition: 'persist:x'},
		{preload: '/x.js'},
		{userAgent: 'x'},
		{profile: 'default'},
	]) {
		const result = await f.call('open', {
			projectId,
			url: 'http://localhost:3000/',
			...extra,
		});
		t.false(result.ok);
	}
	for (const url of [42, null, '', `http://localhost/${'a'.repeat(2_100)}`]) {
		const result = await f.call('open', {projectId, url});
		t.false(result.ok);
		if (!result.ok) t.is(result.error.code, 'VALIDATION');
	}
	for (const value of [
		{...bounds, x: 0.5},
		{...bounds, width: -1},
		{...bounds, height: 16_385},
		{...bounds, x: '1'},
		{...bounds, extra: 1},
		{x: 1, y: 2, width: 3},
	]) {
		const result = await f.call('setBounds', {projectId, bounds: value});
		t.false(result.ok);
	}
	for (const action of ['goto', 'devtools', '', 'RELOAD', 1, null]) {
		const result = await f.call('navigate', {projectId, action});
		t.false(result.ok, String(action));
	}
	t.false(
		(await f.call('navigate', {projectId, action: 'reload', url: 'x'})).ok,
	);
	t.false((await f.call('get', {projectId: 'not-a-uuid'})).ok);
	t.is(f.calls(), 0);
	t.true((await f.call('open', {projectId, url: 'http://localhost:3000/'})).ok);
	t.true((await f.call('setBounds', {projectId, bounds})).ok);
	t.true((await f.call('setBounds', {projectId, bounds: null})).ok);
	for (const action of ['back', 'forward', 'reload', 'stop'])
		t.true((await f.call('navigate', {projectId, action})).ok, action);
	t.is(f.calls(), 7);
});

test('SEC-02 every browser handler refuses foreign origins and child frames', async t => {
	const f = fixture();
	const payloads = {
		get: {projectId},
		open: {projectId, url: 'http://localhost:3000/'},
		navigate: {projectId, action: 'reload'},
		setBounds: {projectId, bounds},
		profiles: {projectId},
		setProfile: {projectId, profile: 'default'},
		createProfile: {projectId, name: 'Docs'},
		deleteProfile: {projectId, id: '0c7b2a54-1d6e-4f8a-9b3c-5e2d1a0f9c88'},
		clearData: {projectId, profile: 'default'},
		openExternal: {projectId},
		close: {projectId},
	} as const;
	for (const key of Object.keys(payloads) as Array<keyof typeof payloads>)
		for (const source of [
			{url: 'http://localhost:3000/', isMainFrame: true},
			{url: `${APP_ORIGIN}/index.html`, isMainFrame: false},
		]) {
			const result = await f.call(key, payloads[key], source);
			t.false(result.ok);
			if (!result.ok) t.is(result.error.code, 'DENIED');
		}
	t.is(f.calls(), 0);
});

test('SEC-02 unexpected browser errors return a generic failure without their message', async t => {
	const handlers = new Map<
		string,
		(payload: unknown) => Promise<IpcResult<unknown>>
	>();
	const register = (service?: BrowserService) =>
		registerBrowserHandlers(
			(channel, schema, handler, allowedOrigins) => {
				handlers.set(channel, payload =>
					handleRequest({sender, payload, schema, handler, allowedOrigins}),
				);
			},
			[APP_ORIGIN],
			service,
		);
	register({
		get: () => {
			throw new Error('/secret/path leaked');
		},
	} as unknown as BrowserService);
	const failed = await handlers.get(BROWSER_CHANNELS.get)?.({projectId});
	t.is(
		failed?.ok ? null : failed?.error.message,
		'The browser request could not finish',
	);
	register();
	const missing = await handlers.get(BROWSER_CHANNELS.get)?.({projectId});
	t.is(
		missing?.ok ? null : missing?.error.message,
		'The browser is unavailable',
	);
});

test('SEC-16 SEC-02 profile, data and external calls refuse extra fields, so an address can never be supplied', async t => {
	const f = fixture();
	const id = '0c7b2a54-1d6e-4f8a-9b3c-5e2d1a0f9c88';
	const bad: Array<[keyof typeof BROWSER_CHANNELS, unknown]> = [
		['openExternal', {projectId, url: 'https://evil.example/'}],
		['openExternal', {projectId, command: 'open'}],
		['profiles', {projectId, partition: 'persist:x'}],
		['setProfile', {projectId, profile: ''}],
		['setProfile', {projectId, profile: 'x'.repeat(41)}],
		['setProfile', {projectId, profile: 'default', path: '/x'}],
		['createProfile', {projectId, name: ''}],
		['createProfile', {projectId, name: 'x'.repeat(81)}],
		['createProfile', {projectId, name: 'ok', id}],
		['deleteProfile', {projectId, id: 'not-a-uuid'}],
		['deleteProfile', {projectId, id, partition: 'persist:browser-default'}],
		['clearData', {projectId, profile: ''}],
		['clearData', {projectId, profile: 'default', all: true}],
		['clearData', {projectId, partition: 'persist:browser-default'}],
	];
	for (const [key, payload] of bad) {
		const result = await f.call(key, payload);
		t.false(result.ok, `${key} ${JSON.stringify(payload)}`);
		if (!result.ok) t.is(result.error.code, 'VALIDATION');
	}
	t.is(f.calls(), 0);
	for (const [key, payload] of [
		['openExternal', {projectId}],
		['profiles', {projectId}],
		['setProfile', {projectId, profile: id}],
		['createProfile', {projectId, name: 'Docs'}],
		['deleteProfile', {projectId, id}],
		['clearData', {projectId, profile: 'incognito'}],
	] as const)
		t.true((await f.call(key, payload)).ok, key);
	t.is(f.calls(), 6);
});
