import test from 'ava';
import {createSessionControls} from '@/main/nanocoder/session-controls';
import type {NanocoderMode, ProjectConfigSelect} from '@/shared/ipc';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return {promise, resolve, reject};
}

function config(provider = 'a', model = 'old') {
	return [
		{
			id: 'provider',
			type: 'select',
			category: 'model',
			name: 'provider',
			currentValue: provider,
			options: [
				{name: 'a', value: 'a'},
				{name: 'b', value: 'b'},
			],
		},
		{
			id: 'model',
			type: 'select',
			category: 'model',
			name: 'model',
			currentValue: model,
			options: [
				{name: 'old', value: 'old'},
				{name: 'confirmed', value: 'confirmed'},
			],
		},
	];
}

function fixture() {
	const ready = new Set(['one', 'two']);
	let prompting = false;
	let transportConfig: (
		sessionId: string,
		id: ProjectConfigSelect['id'],
		value: string,
	) => Promise<unknown> = async () => config('b', 'confirmed');
	let transportMode: (
		sessionId: string,
		mode: NanocoderMode,
	) => Promise<unknown> = async () => ({});
	const calls: unknown[][] = [];
	const updates: string[] = [];
	const current = new Set(['one', 'two']);
	const controls = createSessionControls({
		isReady: id => ready.has(id),
		isPrompting: () => prompting,
		setReady: (id, value) => {
			if (value) ready.add(id);
			else ready.delete(id);
		},
		setMode: (id, mode) => {
			calls.push(['mode', id, mode]);
			return transportMode(id, mode);
		},
		setConfigOption: (id, key, value) => {
			calls.push(['config', id, key, value]);
			return transportConfig(id, key, value);
		},
		failure: (code, message) => Object.assign(new Error(message), {code}),
	});
	controls.remember(
		'one',
		[{id: 'normal'}, {id: 'plan'}, {id: 'yolo'}, {id: 'future'}],
		config(),
	);
	controls.remember('two', [{id: 'normal'}], config());
	const stopObserving = controls.observeConfigOptions({
		isCurrentSession: sessionId => current.has(sessionId),
		onChange: sessionId => updates.push(sessionId),
	});
	return {
		controls,
		calls,
		updates,
		current,
		stopObserving,
		ready,
		prompting: (value: boolean) => {
			prompting = value;
		},
		config: (next: typeof transportConfig) => {
			transportConfig = next;
		},
		mode: (next: typeof transportMode) => {
			transportMode = next;
		},
	};
}

test('retains bounded known modes and current project config without handing out mutable state (ACP-13 ACP-14)', t => {
	const f = fixture();
	const offers = f.controls.getSessionOffers('one');
	t.deepEqual(offers?.offeredModes, ['normal', 'plan', 'yolo']);
	t.is(offers?.configOptions?.[0]?.currentValue, 'a');
	offers?.offeredModes.push('architect');
	if (offers?.configOptions?.[0])
		offers.configOptions[0].currentValue = 'forged';
	t.deepEqual(f.controls.getSessionOffers('one')?.offeredModes, [
		'normal',
		'plan',
		'yolo',
	]);
	t.is(
		f.controls.getSessionOffers('one')?.configOptions?.[0]?.currentValue,
		'a',
	);
	t.is(f.controls.getSessionOffers('unknown'), undefined);
	t.deepEqual(f.calls, []);
});

test('provider switch returns the different model Nanocoder confirms, globally across existing sessions, with one RPC (CHAT-10 ACP-14)', async t => {
	const f = fixture();
	const result = await f.controls.setConfigOption('one', 'provider', 'b');
	t.deepEqual(f.calls, [['config', 'one', 'provider', 'b']]);
	t.is(result.configOptions?.[0]?.currentValue, 'b');
	t.is(result.configOptions?.[1]?.currentValue, 'confirmed');
	t.is(
		f.controls.getSessionOffers('two')?.configOptions?.[1]?.currentValue,
		'confirmed',
	);
});

test('unknown and unoffered mode IDs never reach Nanocoder fallback (ACP-13)', async t => {
	const f = fixture();
	await t.throwsAsync(f.controls.setMode('one', 'future' as NanocoderMode));
	await t.throwsAsync(f.controls.setMode('one', 'architect'));
	t.deepEqual(f.calls, []);
});

test('foreign config IDs and unoffered values refuse without an RPC (ACP-14)', async t => {
	const f = fixture();
	await t.throwsAsync(
		f.controls.setConfigOption(
			'one',
			'credential' as ProjectConfigSelect['id'],
			'b',
		),
	);
	await t.throwsAsync(f.controls.setConfigOption('one', 'provider', 'foreign'));
	t.deepEqual(f.calls, []);
});

test('mode acknowledgement temporarily removes prompt readiness and restores it only on success (DEC-31)', async t => {
	const f = fixture();
	const pending = deferred<unknown>();
	f.mode(() => pending.promise);
	const changing = f.controls.setMode('one', 'plan');
	void changing.catch(() => undefined);
	t.false(f.ready.has('one'));
	t.is(f.controls.getSessionOffers('one'), undefined);
	pending.resolve({});
	t.deepEqual(await changing, {id: 'one', mode: 'plan'});
	t.true(f.ready.has('one'));
});

test('failed live mode remains unready and does not leak upstream details (DEC-31)', async t => {
	const f = fixture();
	f.mode(async () => {
		throw new Error('private fixture internals');
	});
	const error = await t.throwsAsync(f.controls.setMode('one', 'plan'));
	t.is(error?.message, 'Nanocoder did not set the plan mode');
	t.false(f.ready.has('one'));
	t.is(f.controls.getSessionOffers('one'), undefined);
});

test('an uncertain config failure blocks every project prompt and cannot be cleared by another same-process session (ACP-14)', async t => {
	const f = fixture();
	f.config(async () => {
		throw new Error('private fixture internals');
	});
	const error = await t.throwsAsync(
		f.controls.setConfigOption('one', 'provider', 'b'),
	);
	t.is(
		error?.message,
		'Nanocoder did not confirm the model change; restart Nanocoder before sending',
	);
	t.false(f.controls.canPrompt());
	t.is(f.controls.getSessionOffers('two')?.configOptions, undefined);
	f.controls.remember('two', [{id: 'normal'}], config('b', 'confirmed'));
	t.false(f.controls.canPrompt());
	await t.throwsAsync(f.controls.setConfigOption('two', 'provider', 'a'));
	t.is(f.calls.length, 1);
	t.true(fixture().controls.canPrompt());
});

test('malformed actual config response is not a success and marks prompt state uncertain (ACP-14)', async t => {
	const f = fixture();
	f.config(async () => [{...config()[0], currentValue: true}]);
	await t.throwsAsync(f.controls.setConfigOption('one', 'provider', 'b'));
	t.false(f.controls.canPrompt());
	t.is(f.controls.getSessionOffers('one')?.configOptions, undefined);
});

test('active prompts refuse config and mode mutations without an RPC or readiness changes (CHAT-17)', async t => {
	const f = fixture();
	f.prompting(true);
	await t.throwsAsync(f.controls.setConfigOption('one', 'provider', 'b'));
	await t.throwsAsync(f.controls.setMode('one', 'plan'));
	t.deepEqual(f.calls, []);
	t.true(f.ready.has('one'));
});

test('unready, deleted and missing sessions cannot supply offers or mutate controls (ACP-13 ACP-14)', async t => {
	const f = fixture();
	f.ready.delete('one');
	t.is(f.controls.getSessionOffers('one'), undefined);
	await t.throwsAsync(f.controls.setConfigOption('one', 'provider', 'b'));
	await t.throwsAsync(f.controls.setMode('one', 'plan'));
	f.controls.forget('two');
	t.is(f.controls.getSessionOffers('two'), undefined);
	await t.throwsAsync(f.controls.setMode('two', 'normal'));
	await t.throwsAsync(f.controls.setConfigOption('unknown', 'provider', 'b'));
	t.deepEqual(f.calls, []);
});

test('current-session config notifications replace bounded process offers without changing mode authority (ACP-14 DEC-31)', t => {
	const f = fixture();
	f.prompting(true);
	const modes = f.controls.getSessionOffers('one')?.offeredModes;
	const next = config('b', 'confirmed');
	t.true(f.controls.updateConfigOptions('two', next));
	next[1].currentValue = 'old';
	t.is(
		f.controls.getSessionOffers('one')?.configOptions?.[1]?.currentValue,
		'confirmed',
	);
	t.deepEqual(f.controls.getSessionOffers('one')?.offeredModes, modes);
	t.true(f.controls.canPrompt());
	t.deepEqual(f.calls, []);
	t.deepEqual(f.updates, ['two']);
	t.false(f.controls.updateConfigOptions('two', config('b', 'confirmed')));
	t.deepEqual(f.updates, ['two']);
});

test('malformed, excessive, foreign, old, forgotten and disposed config notifications leave offers unchanged (ACP-14)', t => {
	const f = fixture();
	const before = f.controls.getSessionOffers('two');
	const malformed = [
		undefined,
		[{...config()[1], currentValue: true}],
		[{...config()[1], name: 'x'.repeat(257)}],
		[
			{
				...config()[1],
				options: Array.from({length: 257}, (_, i) => ({
					name: String(i),
					value: String(i),
				})),
			},
		],
		[config()[1], config()[1]],
	];
	for (const raw of malformed) {
		t.false(f.controls.updateConfigOptions('two', raw));
		t.deepEqual(f.controls.getSessionOffers('two'), before);
	}
	t.false(f.controls.updateConfigOptions('foreign', config('b', 'confirmed')));
	f.current.delete('one');
	t.false(f.controls.updateConfigOptions('one', config('b', 'confirmed')));
	t.deepEqual(f.controls.getSessionOffers('two'), before);
	f.controls.forget('two');
	t.false(f.controls.updateConfigOptions('two', config('b', 'confirmed')));
	t.deepEqual(f.controls.getSessionOffers('one'), {
		...before,
		offeredModes: ['normal', 'plan', 'yolo'],
	});
	f.controls.dispose();
	const stopped = f.controls.getSessionOffers('one');
	t.false(f.controls.updateConfigOptions('one', config('b', 'confirmed')));
	t.deepEqual(f.controls.getSessionOffers('one'), stopped);
	t.deepEqual(f.updates, []);
});

test('notifications cannot clear uncertain config or restore mode readiness (ACP-14 DEC-31)', async t => {
	const f = fixture();
	f.config(async () => {
		throw new Error('fixture refusal');
	});
	await t.throwsAsync(f.controls.setConfigOption('two', 'provider', 'b'));
	t.false(f.controls.updateConfigOptions('two', config('b', 'confirmed')));
	t.false(f.controls.canPrompt());
	t.is(f.controls.getSessionOffers('two')?.configOptions, undefined);
	const unready = fixture();
	unready.ready.delete('two');
	t.false(
		unready.controls.updateConfigOptions('two', config('b', 'confirmed')),
	);
	t.is(unready.controls.getSessionOffers('two'), undefined);
	t.deepEqual(f.updates, []);
	t.deepEqual(unready.updates, []);
});

test('another currently owned ready thread may report project-wide config, but replay and released owners cannot (ACP-14)', t => {
	const f = fixture();
	const before = f.controls.getSessionOffers('two');
	t.false(
		f.controls.updateConfigOptions('one', config('b', 'confirmed'), true),
	);
	t.deepEqual(f.controls.getSessionOffers('two'), before);
	t.true(f.controls.updateConfigOptions('one', config('b', 'confirmed')));
	t.is(
		f.controls.getSessionOffers('two')?.configOptions?.[1]?.currentValue,
		'confirmed',
	);
	t.deepEqual(f.updates, ['one']);
	f.stopObserving();
	t.false(f.controls.updateConfigOptions('two', config()));
	t.is(
		f.controls.getSessionOffers('two')?.configOptions?.[1]?.currentValue,
		'confirmed',
	);
});

test('raw notification frames require own valid notification fields and non-empty bounded config before changing the cache (ACP-14)', t => {
	const f = fixture();
	const before = f.controls.getSessionOffers('two');
	const frame = {
		jsonrpc: '2.0',
		method: 'session/update',
		params: {
			sessionId: 'two',
			update: {
				sessionUpdate: 'config_option_update',
				configOptions: config('b', 'confirmed'),
			},
		},
	};
	for (const invalid of [
		undefined,
		{},
		{...frame, jsonrpc: '1.0'},
		{...frame, method: 'other'},
		{...frame, id: 1},
		{...frame, id: null},
		{...frame, params: {...frame.params, sessionId: 1}},
		Object.create(frame),
		{
			...frame,
			params: {
				...frame.params,
				update: {sessionUpdate: 'current_mode_update', currentModeId: 'yolo'},
			},
		},
		{
			...frame,
			params: {
				...frame.params,
				update: {...frame.params.update, configOptions: []},
			},
		},
		{
			...frame,
			params: {
				...frame.params,
				update: {
					...frame.params.update,
					configOptions: [config()[0], {...config()[1], currentValue: true}],
				},
			},
		},
	]) {
		t.false(f.controls.receiveConfigNotification(invalid));
		t.deepEqual(f.controls.getSessionOffers('two'), before);
	}
	let getters = 0;
	t.false(
		f.controls.receiveConfigNotification({
			...frame,
			params: {
				sessionId: 'two',
				get update() {
					getters++;
					return frame.params.update;
				},
			},
		}),
	);
	t.is(getters, 0);
	t.true(f.controls.receiveConfigNotification(frame));
	t.is(
		f.controls.getSessionOffers('one')?.configOptions?.[1]?.currentValue,
		'confirmed',
	);
	t.deepEqual(f.updates, ['two']);
});
