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
		setBounds: count,
		closeView: count,
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
	t.false((await f.call('get', {projectId: 'not-a-uuid'})).ok);
	t.is(f.calls(), 0);
	t.true((await f.call('open', {projectId, url: 'http://localhost:3000/'})).ok);
	t.true((await f.call('setBounds', {projectId, bounds})).ok);
	t.true((await f.call('setBounds', {projectId, bounds: null})).ok);
	t.is(f.calls(), 3);
});

test('SEC-02 every browser handler refuses foreign origins and child frames', async t => {
	const f = fixture();
	const payloads = {
		get: {projectId},
		open: {projectId, url: 'http://localhost:3000/'},
		setBounds: {projectId, bounds},
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
