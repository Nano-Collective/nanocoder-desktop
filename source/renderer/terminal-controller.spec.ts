import test from 'ava';
import {
	boundTerminalOutput,
	TerminalController,
} from '@/renderer/terminal-controller';
import type {IpcResult} from '@/shared/ipc';
import type {
	TerminalApi,
	TerminalEvent,
	TerminalSnapshot,
} from '@/shared/terminal';

function snapshot(projectId = 'one', sequence = 1): TerminalSnapshot {
	return {
		projectId,
		sequence,
		status: 'stopped',
		shell: null,
		cols: 80,
		rows: 24,
		output: '',
		truncated: false,
		exitCode: null,
		reason: null,
		agentCommand: null,
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => {
		resolve = done;
	});
	return {promise, resolve};
}
function fixture(overrides: Partial<TerminalApi> = {}) {
	const calls: string[] = [];
	let listener!: (event: TerminalEvent) => void;
	const request = async ({projectId}: {projectId: string}) => ({
		ok: true as const,
		value: snapshot(projectId, 2),
	});
	const bridge: TerminalApi = {
		get: request,
		start: async request => {
			calls.push('start');
			return {
				ok: true,
				value: {...snapshot(request.projectId, 2), status: 'running'},
			};
		},
		stop: request,
		restart: request,
		clear: request,
		write: async request => {
			calls.push(`write:${request.projectId}:${request.data}`);
			return {ok: true, value: snapshot(request.projectId)};
		},
		resize: async request => {
			calls.push(`resize:${request.cols}:${request.rows}`);
			return {ok: true, value: snapshot(request.projectId)};
		},
		onEvent: receive => {
			listener = receive;
			return () => calls.push('unsubscribe');
		},
		...overrides,
	};
	const model = new TerminalController(bridge, () => {});
	return {model, calls, emit: (event: TerminalEvent) => listener(event)};
}

test('terminal selection is read-only and late responses cannot cross projects', async t => {
	const waiting = deferred<IpcResult<TerminalSnapshot>>();
	const {model, calls} = fixture({
		get: ({projectId}) =>
			projectId === 'one'
				? waiting.promise
				: Promise.resolve({ok: true, value: snapshot(projectId)}),
	});
	const old = model.select('one');
	await model.select('two');
	waiting.resolve({
		ok: true,
		value: {...snapshot('one', 99), output: 'old project secret'},
	});
	await old;
	t.is(model.getState().snapshot?.projectId, 'two');
	t.is(model.getState().snapshot?.output, '');
	t.deepEqual(calls, []);
	model.dispose();
	t.deepEqual(calls, ['unsubscribe']);
});

test('terminal events preserve order and cannot roll back clear or another project', async t => {
	const {model, emit} = fixture();
	await model.select('one');
	emit({
		type: 'snapshot',
		snapshot: {...snapshot('one', 3), status: 'running'},
	});
	emit({type: 'data', projectId: 'two', sequence: 999, data: 'foreign'});
	emit({type: 'data', projectId: 'one', sequence: 4, data: 'first'});
	t.is(model.getState().snapshot?.output, 'first');
	emit({
		type: 'snapshot',
		snapshot: {...snapshot('one', 5), status: 'running'},
	});
	emit({type: 'data', projectId: 'one', sequence: 4, data: 'cleared'});
	emit({type: 'snapshot', snapshot: {...snapshot('one', 2), output: 'stale'}});
	t.is(model.getState().snapshot?.output, '');
	emit({type: 'data', projectId: 'one', sequence: 6, data: 'fresh'});
	t.is(model.getState().snapshot?.output, 'fresh');
	model.dispose();
	emit({type: 'data', projectId: 'one', sequence: 7, data: 'disposed'});
	t.is(model.getState().snapshot?.output, 'fresh');
});

test('terminal queues bounded data arriving before the initial snapshot', async t => {
	const waiting = deferred<IpcResult<TerminalSnapshot>>();
	const {model, emit} = fixture({get: () => waiting.promise});
	const selected = model.select('one');
	emit({type: 'data', projectId: 'one', sequence: 3, data: 'already shown'});
	emit({type: 'data', projectId: 'one', sequence: 5, data: ' + queued'});
	waiting.resolve({
		ok: true,
		value: {...snapshot('one', 4), status: 'running', output: 'snapshot'},
	});
	await selected;
	t.is(model.getState().snapshot?.output, 'snapshot + queued');
});

test('TERM-07 late output cannot revive a stopped or exited terminal even with a higher sequence', async t => {
	const {model, emit} = fixture();
	await model.select('one');
	emit({type: 'data', projectId: 'one', sequence: 99, data: 'restarted'});
	t.is(model.getState().snapshot?.output, '');
	emit({
		type: 'snapshot',
		snapshot: {...snapshot('one', 100), status: 'exited'},
	});
	emit({type: 'data', projectId: 'one', sequence: 101, data: 'old batch'});
	t.is(model.getState().snapshot?.output, '');
});

test('terminal pending actions reject duplicate actions and user input, then surface refusals', async t => {
	const waiting = deferred<IpcResult<TerminalSnapshot>>();
	const {model, calls, emit} = fixture({stop: () => waiting.promise});
	await model.select('one');
	emit({
		type: 'snapshot',
		snapshot: {...snapshot('one', 3), status: 'running'},
	});
	const stop = model.action('stop');
	t.false(await model.action('start'));
	await model.write('not sent');
	t.deepEqual(calls, []);
	waiting.resolve({
		ok: false,
		error: {code: 'DENIED', message: 'fixture refusal'},
	});
	t.false(await stop);
	t.is(model.getState().error, 'fixture refusal');
	t.false(model.getState().pending);
});

test('terminal accepts only explicit running input and bounded writes, ignores stale write output', async t => {
	const {model, calls, emit} = fixture();
	await model.select('one');
	await model.write('stopped');
	emit({
		type: 'snapshot',
		snapshot: {...snapshot('one', 3), status: 'running', output: 'current'},
	});
	await model.write('x'.repeat(65_537));
	await model.write('café 😀');
	await model.resize(100, 10);
	t.deepEqual(calls, ['write:one:café 😀', 'resize:100:10']);
	t.is(model.getState().snapshot?.output, 'current');
});

test('terminal start completion and errors cannot revive a switched or disposed project', async t => {
	const waiting = deferred<IpcResult<TerminalSnapshot>>();
	const {model, emit} = fixture({start: () => waiting.promise});
	await model.select('one');
	const start = model.action('start');
	await model.select(null);
	waiting.resolve({
		ok: true,
		value: {...snapshot('one', 20), status: 'running'},
	});
	t.false(await start);
	emit({type: 'snapshot', snapshot: snapshot('one', 21)});
	t.is(model.getState().snapshot, null);
	t.false(model.getState().pending);
	model.dispose();
	t.false(await model.action('start'));
});

test('terminal load and transport failures are visible without rejected promises', async t => {
	const fail = async () => {
		throw new Error('transport');
	};
	const {model, emit} = fixture({
		get: fail,
		start: fail,
		write: fail,
		resize: fail,
	});
	await model.select('one');
	t.is(model.getState().error, 'The terminal could not be loaded');
	t.false(await model.action('start'));
	emit({type: 'snapshot', snapshot: {...snapshot(), status: 'running'}});
	await model.write('x');
	t.is(model.getState().error, 'Terminal input was not delivered');
	await model.resize(100, 10);
	t.is(model.getState().error, 'The terminal could not be resized');
});

test('terminal renderer output bounds lines, large chunks and Unicode', t => {
	t.is(boundTerminalOutput('line\n'.repeat(10_100)).split('\n').length, 10_000);
	const bounded = boundTerminalOutput(`😀${'x'.repeat(1_048_575)}`);
	t.true(bounded.length <= 1_048_576);
	t.false(/^[\uDC00-\uDFFF]/u.test(bounded));
});
