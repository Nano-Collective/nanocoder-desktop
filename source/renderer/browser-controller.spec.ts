import test from 'ava';
import {
	BrowserController,
	type BrowserState,
} from '@/renderer/browser-controller';
import type {
	BrowserApi,
	BrowserBounds,
	BrowserEvent,
	BrowserSnapshot,
} from '@/shared/browser';
import type {DesktopSettings, IpcResult} from '@/shared/ipc';

function snapshot(
	projectId = 'one',
	sequence = 1,
	extra: Partial<BrowserSnapshot> = {},
): BrowserSnapshot {
	return {
		projectId,
		sequence,
		status: 'closed',
		url: null,
		title: null,
		origin: null,
		security: null,
		canGoBack: false,
		canGoForward: false,
		blocked: null,
		reason: null,
		...extra,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => {
		resolve = done;
	});
	return {promise, resolve};
}

const ok = <T>(value: T): IpcResult<T> => ({ok: true, value});
const failure = (message: string): IpcResult<never> => ({
	ok: false,
	error: {code: 'DENIED', message, retryable: false},
});

function fixture(
	overrides: {
		get?: BrowserApi['get'];
		open?: BrowserApi['open'];
		navigate?: BrowserApi['navigate'];
		publicSites?: boolean;
	} = {},
) {
	const calls: string[] = [];
	const boundsSent: Array<BrowserBounds | null> = [];
	const settings = {publicBrowsingEnabled: overrides.publicSites ?? false};
	let listener!: (event: BrowserEvent) => void;
	let unsubscribed = 0;
	const bridge = {
		browser: {
			get: overrides.get ?? (async ({projectId}) => ok(snapshot(projectId, 2))),
			open:
				overrides.open ??
				(async ({projectId, url}) => {
					calls.push(`open ${url}`);
					return ok(snapshot(projectId, 3, {status: 'ready', url}));
				}),
			navigate:
				overrides.navigate ??
				(async ({projectId, action}) => {
					calls.push(action);
					return ok(snapshot(projectId, 4));
				}),
			setBounds: async ({bounds}) => {
				boundsSent.push(bounds);
				return ok(null);
			},
			close: async ({projectId}) => ok(snapshot(projectId, 5)),
			onEvent: next => {
				listener = next;
				return () => {
					unsubscribed++;
				};
			},
		} satisfies BrowserApi,
		getSettings: async () => ok(settings as DesktopSettings),
		updateSettings: async ({patch}: {patch: Partial<DesktopSettings>}) => {
			calls.push(`settings ${JSON.stringify(patch)}`);
			Object.assign(settings, patch);
			return ok(settings as DesktopSettings);
		},
	};
	const states: BrowserState[] = [];
	const controller = new BrowserController(bridge, state => states.push(state));
	return {
		controller,
		calls,
		boundsSent,
		states,
		emit: (event: BrowserEvent) => listener(event),
		unsubscribed: () => unsubscribed,
	};
}

test('BRW-04 selecting a project loads its snapshot and the public browsing setting', async t => {
	const f = fixture({publicSites: true});
	await f.controller.select('one');
	const state = f.controller.getState();
	t.is(state.projectId, 'one');
	t.is(state.snapshot?.sequence, 2);
	t.true(state.publicSites);
	t.false(state.loading);
});

test('BRW-04 a late answer for a project that was switched away is dropped', async t => {
	const late = deferred<IpcResult<BrowserSnapshot>>();
	const f = fixture({
		get: ({projectId}) =>
			projectId === 'one'
				? late.promise
				: Promise.resolve(ok(snapshot(projectId, 9))),
	});
	const first = f.controller.select('one');
	await f.controller.select('two');
	late.resolve(ok(snapshot('one', 99)));
	await first;
	t.is(f.controller.getState().projectId, 'two');
	t.is(f.controller.getState().snapshot?.projectId, 'two');
});

test('BRW-04 events apply only for the selected project and only when newer', async t => {
	const f = fixture();
	await f.controller.select('one');
	f.emit({type: 'snapshot', snapshot: snapshot('one', 7, {status: 'ready'})});
	t.is(f.controller.getState().snapshot?.sequence, 7);
	f.emit({type: 'snapshot', snapshot: snapshot('one', 5, {status: 'failed'})});
	t.is(f.controller.getState().snapshot?.sequence, 7);
	f.emit({type: 'snapshot', snapshot: snapshot('two', 50)});
	t.is(f.controller.getState().snapshot?.projectId, 'one');
});

test('BRW-02 an address is normalised, an empty one is ignored and a refusal is shown', async t => {
	const f = fixture();
	await f.controller.select('one');
	t.false(await f.controller.open('   '));
	t.true(await f.controller.open('localhost:5173'));
	t.deepEqual(f.calls, ['open http://localhost:5173']);
	const refused = fixture({
		open: async () =>
			failure('Public sites are off. Turn them on to open this page.'),
	});
	await refused.controller.select('one');
	t.false(await refused.controller.open('example.com'));
	t.is(
		refused.controller.getState().error,
		'Public sites are off. Turn them on to open this page.',
	);
});

test('BRW-02 back, forward, reload and stop go to the bridge for the project', async t => {
	const f = fixture();
	await f.controller.select('one');
	for (const action of ['back', 'forward', 'reload', 'stop'] as const)
		await f.controller.navigate(action);
	t.deepEqual(f.calls, ['back', 'forward', 'reload', 'stop']);
	const none = fixture();
	t.false(await none.controller.navigate('reload'));
	t.deepEqual(none.calls, []);
});

test('BRW-03 allowing public sites saves the setting and then opens the blocked address', async t => {
	const f = fixture();
	await f.controller.select('one');
	t.false(f.controller.getState().publicSites);
	t.true(await f.controller.allowAndOpen('https://example.com/a'));
	t.deepEqual(f.calls, [
		'settings {"publicBrowsingEnabled":true}',
		'open https://example.com/a',
	]);
	t.true(f.controller.getState().publicSites);
});

test('BRW-03 turning public sites off is saved without opening anything', async t => {
	const f = fixture({publicSites: true});
	await f.controller.select('one');
	t.true(await f.controller.setPublicSites(false));
	t.deepEqual(f.calls, ['settings {"publicBrowsingEnabled":false}']);
	t.false(f.controller.getState().publicSites);
});

test('BRW-02 bounds are sent once per change, wait for a project, and a switch resends', async t => {
	const f = fixture();
	const early = {x: 1, y: 2, width: 3, height: 4};
	f.controller.setBounds(early);
	t.deepEqual(f.boundsSent, []);
	await f.controller.select('one');
	t.deepEqual(f.boundsSent, [early]);
	const bounds = {x: 1, y: 2, width: 300, height: 200};
	f.controller.setBounds(bounds);
	f.controller.setBounds({...bounds});
	f.controller.setBounds(null);
	await Promise.resolve();
	t.deepEqual(f.boundsSent, [early, bounds, null]);
	await f.controller.select('two');
	f.controller.setBounds(null);
	await Promise.resolve();
	t.deepEqual(f.boundsSent, [early, bounds, null, null]);
});

test('BRW-01 disposing stops listening and ignores later answers', async t => {
	const late = deferred<IpcResult<BrowserSnapshot>>();
	const f = fixture({get: () => late.promise});
	const pending = f.controller.select('one');
	f.controller.dispose();
	late.resolve(ok(snapshot('one', 9)));
	await pending;
	t.is(f.unsubscribed(), 1);
	t.is(f.controller.getState().snapshot, null);
	t.false(await f.controller.open('localhost:3000'));
});

test('BRW-01 the last viewport is sent again for the next project, so its page is placed without a resize', async t => {
	const f = fixture();
	await f.controller.select('one');
	const bounds = {x: 4, y: 5, width: 320, height: 240};
	f.controller.setBounds(bounds);
	await f.controller.select('two');
	t.deepEqual(f.boundsSent, [bounds, bounds]);
	f.controller.setBounds({...bounds});
	t.is(f.boundsSent.length, 2);
	await f.controller.select(null);
	t.is(f.boundsSent.length, 2);
});
