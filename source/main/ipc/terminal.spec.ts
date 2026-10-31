import test from 'ava';
import {handleRequest, type Sender} from '@/main/ipc/handle-request';
import {registerTerminalHandlers} from '@/main/ipc/terminal';
import {APP_ORIGIN} from '@/main/security';
import type {TerminalService} from '@/main/terminal/terminal-service';
import type {IpcResult} from '@/shared/ipc';
import {TERMINAL_CHANNELS} from '@/shared/terminal';

const projectId = '11111111-1111-4111-8111-111111111111';
const sender: Sender = {url: `${APP_ORIGIN}/index.html`, isMainFrame: true};

function fixture() {
	let calls = 0;
	const handlers = new Map<
		string,
		(payload: unknown, source?: Sender) => Promise<IpcResult<unknown>>
	>();
	const service = Object.fromEntries(
		['get', 'start', 'stop', 'restart', 'write', 'resize', 'clear'].map(key => [
			key,
			() => {
				calls++;
				return {status: 'stopped'};
			},
		]),
	) as unknown as TerminalService;
	registerTerminalHandlers(
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
			key: keyof typeof TERMINAL_CHANNELS,
			payload: unknown,
			source?: Sender,
		) => {
			const handler = handlers.get(TERMINAL_CHANNELS[key]);
			if (!handler) throw new Error('Missing terminal handler');
			return handler(payload, source);
		},
		calls: () => calls,
	};
}

test('SEC-02 terminal schemas refuse paths, shell flags, PIDs, extra fields and malformed input', async t => {
	const f = fixture();
	for (const key of ['get', 'start', 'stop', 'restart', 'clear'] as const) {
		for (const field of [
			{root: '/secret'},
			{shell: '/bin/sh'},
			{pid: 123},
			{trusted: true},
		]) {
			const result = await f.call(key, {projectId, ...field});
			t.false(result.ok);
			if (!result.ok) t.is(result.error.code, 'VALIDATION');
		}
	}
	for (const data of ['', 'x'.repeat(65_537), '\uD800', '\uDC00']) {
		const result = await f.call('write', {projectId, data});
		t.false(result.ok);
		if (!result.ok) t.is(result.error.code, 'VALIDATION');
	}
	for (const cols of [0, 501, 1.5, '80']) {
		const result = await f.call('resize', {projectId, cols, rows: 24});
		t.false(result.ok);
	}
	t.is(f.calls(), 0);
	t.true((await f.call('write', {projectId, data: 'café 😀\r'})).ok);
	t.is(f.calls(), 1);
});

test('SEC-02 every terminal handler refuses foreign origins and child frames', async t => {
	const f = fixture();
	for (const key of [
		'get',
		'start',
		'stop',
		'restart',
		'write',
		'resize',
		'clear',
	] as const) {
		for (const source of [
			{url: 'https://localhost:3000/', isMainFrame: true},
			{url: `${APP_ORIGIN}/index.html`, isMainFrame: false},
		]) {
			const result = await f.call(key, {projectId}, source);
			t.false(result.ok);
			if (!result.ok) t.is(result.error.code, 'DENIED');
		}
	}
	t.is(f.calls(), 0);
});
