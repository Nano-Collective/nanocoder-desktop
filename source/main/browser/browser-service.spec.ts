import path from 'node:path';
import test, {type ExecutionContext} from 'ava';
import type {BrowserDownloadItem} from '@/main/browser/browser-service';
import {
	BrowserService,
	type BrowserViewHooks,
} from '@/main/browser/browser-service';
import {browserPartition} from '@/main/browser/profile';
import {BrowserProfiles, type ProfileData} from '@/main/browser/profiles';
import type {BrowserBounds, BrowserEvent} from '@/shared/browser';

const first = '4f6c1f0e-3a55-4a0b-9d1e-0a2b3c4d5e6f';
const second = '9b1d2c3e-4f50-4a6b-8c7d-1e2f3a4b5c6d';

interface FakeView {
	partition: string;
	hooks: BrowserViewHooks;
	loads: string[];
	calls: string[];
	bounds: Array<BrowserBounds | null>;
	destroyed: number;
	finish(): void;
	abort(): void;
	fail(): void;
}

function fixture(
	t: ExecutionContext,
	options: {failCreate?: boolean; publicSites?: boolean} = {},
) {
	const events: BrowserEvent[] = [];
	const views: FakeView[] = [];
	const settings = {
		publicSites: options.publicSites ?? false,
		approveExternal: true,
	};
	const profileData: ProfileData = {profiles: [], assignments: {}};
	const cleared: string[] = [];
	const external: string[] = [];
	const profiles = new BrowserProfiles({
		get: () => structuredClone(profileData),
		set: next => {
			profileData.profiles = next.profiles;
			profileData.assignments = next.assignments;
		},
	});
	const history: {back: string | null; forward: string | null} = {
		back: null,
		forward: null,
	};
	let holdLoads = false;
	const service = new BrowserService({
		project: id =>
			id === first || id === second
				? {id, displayName: `project ${id}`}
				: undefined,
		emit: event => events.push(event),
		publicSites: () => settings.publicSites,
		downloadsPath: () => '/home/user/Downloads',
		profiles,
		clearData: async partition => {
			cleared.push(partition);
		},
		openExternal: async url => {
			external.push(url);
			return settings.approveExternal;
		},
		createView: ({partition, preferences}, hooks) => {
			if (options.failCreate) throw new Error('no window at /secret/path');
			const settled: Array<{
				resolve(outcome: 'loaded' | 'aborted'): void;
				reject(error: Error): void;
			}> = [];
			const view: FakeView = {
				partition: preferences.partition,
				hooks,
				loads: [],
				calls: [],
				bounds: [],
				destroyed: 0,
				finish: () => settled.shift()?.resolve('loaded'),
				abort: () => settled.shift()?.resolve('aborted'),
				fail: () => settled.shift()?.reject(new Error('net::ERR_FAILED')),
			};
			t.is(partition, preferences.partition);
			views.push(view);
			return {
				load: url => {
					view.loads.push(url);
					if (!holdLoads) return Promise.resolve('loaded' as const);
					return new Promise<'loaded' | 'aborted'>((resolve, reject) =>
						settled.push({resolve, reject}),
					);
				},
				goBack: () => view.calls.push('back'),
				goForward: () => view.calls.push('forward'),
				peek: action => history[action],
				reload: () => view.calls.push('reload'),
				stop: () => view.calls.push('stop'),
				setBounds: bounds => view.bounds.push(bounds),
				destroy: () => {
					view.destroyed++;
				},
			};
		},
	});
	t.teardown(() => service.close());
	return {
		service,
		events,
		views,
		settings,
		history,
		profiles,
		cleared,
		external,
		hold: () => {
			holdLoads = true;
		},
	};
}

const code = (error: unknown) => (error as {code?: string}).code;

test('BRW-01 a page loads in a view on the active project partition', async t => {
	const f = fixture(t);
	f.service.activate(first);
	const snapshot = await f.service.open({
		projectId: first,
		url: 'http://localhost:5173/',
	});
	t.is(f.views.length, 1);
	t.is(f.views[0].partition, browserPartition(first));
	t.deepEqual(f.views[0].loads, ['http://localhost:5173/']);
	t.is(snapshot.status, 'ready');
	t.is(snapshot.url, 'http://localhost:5173/');
	t.is(snapshot.origin, 'http://localhost:5173');
	t.is(snapshot.security, 'local');
	t.is(snapshot.projectId, first);
});

test('BRW-03 a public URL is refused until public browsing is on, and the refusal is remembered for the panel', async t => {
	const f = fixture(t);
	f.service.activate(first);
	const error = await t.throwsAsync(
		f.service.open({projectId: first, url: 'https://example.com/a'}),
	);
	t.is(code(error), 'DENIED');
	t.is(f.views.length, 0);
	t.like(f.service.get({projectId: first}).blocked, {
		url: 'https://example.com/a',
		reason: 'public-off',
	});
	f.settings.publicSites = true;
	const opened = await f.service.open({
		projectId: first,
		url: 'https://example.com/a',
	});
	t.is(opened.status, 'ready');
	t.is(opened.security, 'secure');
	t.is(opened.blocked, null);
});

test('BRW-03 the setting is read at each decision, so turning it off again refuses at once', async t => {
	const f = fixture(t, {publicSites: true});
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'https://example.com/'});
	f.settings.publicSites = false;
	t.false(f.views[0].hooks.allow('https://example.org/'));
	const error = await t.throwsAsync(
		f.service.open({projectId: first, url: 'https://example.org/'}),
	);
	t.is(code(error), 'DENIED');
});

test('BRW-03/SEC-12 a file, script or malformed address never creates a view', async t => {
	const f = fixture(t, {publicSites: true});
	f.service.activate(first);
	for (const url of [
		'file:///etc/passwd',
		'javascript:alert(1)',
		'data:text/html,x',
		'about:blank',
		'ftp://localhost/',
	]) {
		const error = await t.throwsAsync(
			f.service.open({projectId: first, url}),
			undefined,
			url,
		);
		t.is(code(error), 'DENIED', url);
		t.is(f.service.get({projectId: first}).blocked?.reason, 'scheme');
	}
	const invalid = await t.throwsAsync(
		f.service.open({projectId: first, url: 'not a url'}),
	);
	t.is(code(invalid), 'VALIDATION');
	t.is(f.views.length, 0);
});

test('BRW-03 a redirect or link from localhost to a public site stops and is reported while public browsing is off', async t => {
	const f = fixture(t);
	f.hold();
	f.service.activate(first);
	const pending = f.service.open({
		projectId: first,
		url: 'http://localhost:3000/go',
	});
	await Promise.resolve();
	t.true(f.views[0].hooks.allow('http://localhost:3000/next'));
	t.false(f.views[0].hooks.allow('https://example.com/landing'));
	f.views[0].fail();
	const error = await t.throwsAsync(pending);
	t.is(code(error), 'DENIED');
	const snapshot = f.service.get({projectId: first});
	t.is(snapshot.status, 'failed');
	t.like(snapshot.blocked, {
		url: 'https://example.com/landing',
		reason: 'public-off',
	});
});

test('BRW-03 a link clicked later is blocked without failing the page that is showing', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	t.false(f.views[0].hooks.allow('https://example.com/'));
	t.false(f.views[0].hooks.allow('file:///etc/passwd'));
	const snapshot = f.service.get({projectId: first});
	t.is(snapshot.status, 'ready');
	t.is(snapshot.url, 'http://localhost:3000/');
	t.is(snapshot.blocked?.reason, 'scheme');
	f.views[0].hooks.navigated({
		url: 'http://localhost:3000/next',
		title: 'Next',
		canGoBack: true,
		canGoForward: false,
	});
	t.is(f.service.get({projectId: first}).blocked, null);
});

test('BRW-04 navigation, title and history state come from the view, not the page', async t => {
	const f = fixture(t, {publicSites: true});
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	f.views[0].hooks.navigated({
		url: 'https://example.com/docs?x=1',
		title: 'Docs',
		canGoBack: true,
		canGoForward: false,
	});
	const snapshot = f.service.get({projectId: first});
	t.is(snapshot.url, 'https://example.com/docs?x=1');
	t.is(snapshot.origin, 'https://example.com');
	t.is(snapshot.security, 'secure');
	t.is(snapshot.title, 'Docs');
	t.true(snapshot.canGoBack);
	t.false(snapshot.canGoForward);
});

test('BRW-04 a title is bounded', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	f.views[0].hooks.navigated({
		url: 'http://localhost:3000/',
		title: 'x'.repeat(5_000),
		canGoBack: false,
		canGoForward: false,
	});
	t.is(f.service.get({projectId: first}).title?.length, 200);
});

test('BRW-04 loading starts and stops from the view and a failure carries no network detail', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	f.views[0].hooks.loading(true);
	t.is(f.service.get({projectId: first}).status, 'loading');
	f.views[0].hooks.loading(false);
	t.is(f.service.get({projectId: first}).status, 'ready');
	f.views[0].hooks.loading(true);
	f.views[0].hooks.failed();
	f.views[0].hooks.loading(false);
	const snapshot = f.service.get({projectId: first});
	t.is(snapshot.status, 'failed');
	t.false(JSON.stringify(snapshot).includes('ERR_'));
});

test('BRW-02 back, forward, reload and stop reach the view of the active project', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	for (const action of ['back', 'forward', 'reload', 'stop'] as const)
		f.service.navigate({projectId: first, action});
	t.deepEqual(f.views[0].calls, ['back', 'forward', 'reload', 'stop']);
});

test('BRW-02 navigation with nothing open or for another project is refused', async t => {
	const f = fixture(t);
	f.service.activate(first);
	const none = t.throws(() =>
		f.service.navigate({projectId: first, action: 'reload'}),
	);
	t.is(code(none), 'UNAVAILABLE');
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	const other = t.throws(() =>
		f.service.navigate({projectId: second, action: 'reload'}),
	);
	t.is(code(other), 'DENIED');
	t.deepEqual(f.views[0].calls, []);
});

test('BRW-02 a second address supersedes a load that is still running without failing the page', async t => {
	const f = fixture(t);
	f.hold();
	f.service.activate(first);
	const stale = f.service.open({
		projectId: first,
		url: 'http://localhost:3000/slow',
	});
	await Promise.resolve();
	const fresh = f.service.open({
		projectId: first,
		url: 'http://localhost:3000/fast',
	});
	await Promise.resolve();
	f.views[0].fail();
	const error = await t.throwsAsync(stale);
	t.is(code(error), 'DENIED');
	t.is(f.service.get({projectId: first}).status, 'loading');
	f.views[0].finish();
	const snapshot = await fresh;
	t.is(snapshot.status, 'ready');
	t.is(snapshot.url, 'http://localhost:3000/fast');
});

test('BRW-01 only the active project can use the browser', async t => {
	const f = fixture(t);
	f.service.activate(first);
	const error = await t.throwsAsync(
		f.service.open({projectId: second, url: 'http://localhost:3000/'}),
	);
	t.is(code(error), 'DENIED');
	t.throws(() => f.service.get({projectId: second}));
	t.is(f.views.length, 0);
});

test('BRW-05 switching project destroys the view and the next project uses its own partition', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	f.service.activate(second);
	t.is(f.views[0].destroyed, 1);
	t.is(f.service.get({projectId: second}).status, 'closed');
	await f.service.open({projectId: second, url: 'http://localhost:3000/'});
	t.is(f.views[1].partition, browserPartition(second));
	t.not(f.views[0].partition, f.views[1].partition);
});

test('BRW-01 events from a view of a project that was switched away are ignored', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	const old = f.views[0].hooks;
	f.service.activate(second);
	old.navigated({
		url: 'http://localhost:3000/late',
		title: 'Late',
		canGoBack: true,
		canGoForward: false,
	});
	old.loading(true);
	t.false(old.allow('http://localhost:3000/other'));
	const snapshot = f.service.get({projectId: second});
	t.is(snapshot.status, 'closed');
	t.is(snapshot.url, null);
	t.is(snapshot.blocked, null);
});

test('BRW-01 a project switch during a load destroys that view and refuses the stale result', async t => {
	const f = fixture(t);
	f.hold();
	f.service.activate(first);
	const pending = f.service.open({
		projectId: first,
		url: 'http://localhost:3000/',
	});
	await Promise.resolve();
	f.service.activate(second);
	f.views[0].finish();
	const error = await t.throwsAsync(pending);
	t.is(code(error), 'DENIED');
	t.is(f.views[0].destroyed, 1);
	t.is(f.service.get({projectId: second}).status, 'closed');
});

test('BRW-04 a failed load is reported without page or network detail', async t => {
	const f = fixture(t);
	f.hold();
	f.service.activate(first);
	const pending = f.service.open({
		projectId: first,
		url: 'http://localhost:3000/',
	});
	await Promise.resolve();
	f.views[0].fail();
	const error = await t.throwsAsync(pending);
	t.is(code(error), 'UNAVAILABLE');
	const snapshot = f.service.get({projectId: first});
	t.is(snapshot.status, 'failed');
	t.false(JSON.stringify(snapshot).includes('ERR_FAILED'));
});

test('BRW-01 opening again reuses the one view', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/a'});
	await f.service.open({projectId: first, url: 'http://localhost:3000/b'});
	t.is(f.views.length, 1);
	t.deepEqual(f.views[0].loads, [
		'http://localhost:3000/a',
		'http://localhost:3000/b',
	]);
});

test('BRW-02 bounds are forwarded as whole numbers and null hides the view', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	f.service.setBounds({
		projectId: first,
		bounds: {x: 10, y: 20, width: 300, height: 200},
	});
	f.service.setBounds({projectId: first, bounds: null});
	t.deepEqual(f.views[0].bounds, [
		{x: 10, y: 20, width: 300, height: 200},
		null,
	]);
	for (const bounds of [
		{x: 0.5, y: 0, width: 10, height: 10},
		{x: 0, y: 0, width: -1, height: 10},
		{x: 0, y: 0, width: 10, height: 100_000},
		{x: Number.NaN, y: 0, width: 10, height: 10},
	])
		t.throws(() => f.service.setBounds({projectId: first, bounds}));
	t.is(f.views[0].bounds.length, 2);
});

test('BRW-01 close destroys the view and keeps nothing open', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	const snapshot = f.service.closeView({projectId: first});
	t.is(snapshot.status, 'closed');
	t.is(snapshot.url, null);
	t.is(snapshot.origin, null);
	t.is(snapshot.title, null);
	t.is(f.views[0].destroyed, 1);
});

test('SEC-12 after the service is closed nothing can open', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	await f.service.close();
	t.is(f.views[0].destroyed, 1);
	const error = await t.throwsAsync(
		f.service.open({projectId: first, url: 'http://localhost:3000/'}),
	);
	t.is(code(error), 'DENIED');
});

test('BRW-04 each change publishes a snapshot with a rising sequence', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	f.service.closeView({projectId: first});
	const sequences = f.events.map(event => event.snapshot.sequence);
	t.true(sequences.length >= 3);
	t.deepEqual(
		sequences,
		[...sequences].sort((a, b) => a - b),
	);
	t.is(new Set(sequences).size, sequences.length);
});

test('BRW-04 a view that cannot be created fails cleanly and never stays loading', async t => {
	const f = fixture(t, {failCreate: true});
	f.service.activate(first);
	const error = await t.throwsAsync(
		f.service.open({projectId: first, url: 'http://localhost:3000/'}),
	);
	t.is(code(error), 'UNAVAILABLE');
	t.false((error as Error).message.includes('/secret/path'));
	const snapshot = f.service.get({projectId: first});
	t.is(snapshot.status, 'failed');
	t.false(JSON.stringify(snapshot).includes('/secret/path'));
});

test('BRW-04 the address of an error page is never shown as the page', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	f.views[0].hooks.navigated({
		url: 'chrome-error://chromewebdata/',
		title: 'localhost',
		canGoBack: true,
		canGoForward: false,
	});
	const snapshot = f.service.get({projectId: first});
	t.is(snapshot.url, 'http://localhost:3000/');
	t.is(snapshot.title, null);
	t.false(snapshot.canGoBack);
});

test('BRW-02 stopping a load keeps the page that was showing and reports no failure', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/a'});
	f.views[0].hooks.navigated({
		url: 'http://localhost:3000/a',
		title: 'A',
		canGoBack: false,
		canGoForward: false,
	});
	f.hold();
	const pending = f.service.open({
		projectId: first,
		url: 'http://localhost:3000/slow',
	});
	await Promise.resolve();
	f.views[0].hooks.loading(true);
	f.views[0].hooks.loading(false);
	f.views[0].abort();
	const snapshot = await pending;
	t.is(snapshot.status, 'ready');
	t.is(snapshot.url, 'http://localhost:3000/a');
	t.is(snapshot.title, 'A');
	t.is(snapshot.reason, null);
});

test('BRW-02 stopping the first load leaves nothing open rather than a failure', async t => {
	const f = fixture(t);
	f.hold();
	f.service.activate(first);
	const pending = f.service.open({
		projectId: first,
		url: 'http://localhost:3000/slow',
	});
	await Promise.resolve();
	f.views[0].abort();
	const snapshot = await pending;
	t.is(snapshot.status, 'closed');
	t.is(snapshot.url, null);
	t.is(snapshot.reason, null);
});

test('BRW-02 stopping after the page committed keeps that page', async t => {
	const f = fixture(t);
	f.hold();
	f.service.activate(first);
	const pending = f.service.open({
		projectId: first,
		url: 'http://localhost:3000/slow',
	});
	await Promise.resolve();
	f.views[0].hooks.navigated({
		url: 'http://localhost:3000/slow',
		title: 'Slow',
		canGoBack: false,
		canGoForward: false,
	});
	f.views[0].abort();
	const snapshot = await pending;
	t.is(snapshot.status, 'ready');
	t.is(snapshot.url, 'http://localhost:3000/slow');
	t.is(snapshot.title, 'Slow');
});

test('BRW-03 a load that was cancelled because a redirect was blocked still reports the block', async t => {
	const f = fixture(t);
	f.hold();
	f.service.activate(first);
	const pending = f.service.open({
		projectId: first,
		url: 'http://localhost:3000/go',
	});
	await Promise.resolve();
	t.false(f.views[0].hooks.allow('https://example.com/landing'));
	f.views[0].abort();
	const error = await t.throwsAsync(pending);
	t.is(code(error), 'DENIED');
	const snapshot = f.service.get({projectId: first});
	t.is(snapshot.status, 'failed');
	t.is(snapshot.blocked?.reason, 'public-off');
});

test('BRW-03 reload of a public page is refused once public browsing is turned off', async t => {
	const f = fixture(t, {publicSites: true});
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'https://example.com/a'});
	f.settings.publicSites = false;
	const error = t.throws(() =>
		f.service.navigate({projectId: first, action: 'reload'}),
	);
	t.is(code(error), 'DENIED');
	t.deepEqual(f.views[0].calls, []);
	t.like(f.service.get({projectId: first}).blocked, {
		url: 'https://example.com/a',
		reason: 'public-off',
	});
	f.settings.publicSites = true;
	f.service.navigate({projectId: first, action: 'reload'});
	t.deepEqual(f.views[0].calls, ['reload']);
});

test('BRW-03 back and forward check the page they would return to against the live setting', async t => {
	const f = fixture(t, {publicSites: true});
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	f.history.back = 'https://example.com/earlier';
	f.history.forward = 'http://localhost:3000/later';
	f.settings.publicSites = false;
	const back = t.throws(() =>
		f.service.navigate({projectId: first, action: 'back'}),
	);
	t.is(code(back), 'DENIED');
	f.service.navigate({projectId: first, action: 'forward'});
	t.deepEqual(f.views[0].calls, ['forward']);
	f.history.back = null;
	f.service.navigate({projectId: first, action: 'back'});
	t.deepEqual(f.views[0].calls, ['forward', 'back']);
});

test('BRW-03 a public page that commits while public browsing is off is not adopted as the page', async t => {
	const f = fixture(t, {publicSites: true});
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	f.settings.publicSites = false;
	f.views[0].hooks.navigated({
		url: 'https://example.com/back-again',
		title: 'Public',
		canGoBack: true,
		canGoForward: false,
	});
	const snapshot = f.service.get({projectId: first});
	t.is(snapshot.url, 'http://localhost:3000/');
	t.is(snapshot.security, 'local');
	t.is(snapshot.blocked?.reason, 'public-off');
	t.deepEqual(f.views[0].calls, ['stop']);
});

test('BRW-03 every refusal is its own occurrence, even for the same address', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	f.views[0].hooks.allow('https://example.com/x');
	const one = f.service.get({projectId: first}).blocked;
	f.views[0].hooks.allow('https://example.com/x');
	const two = f.service.get({projectId: first}).blocked;
	t.is(one?.url, two?.url);
	t.not(one?.id, two?.id);
});

test('BRW-01 the last viewport survives opening the same or another project, so the next page is placed', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	const bounds = {x: 4, y: 5, width: 320, height: 240};
	f.service.setBounds({projectId: first, bounds});
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	t.deepEqual(f.views[1].bounds, [bounds]);
	f.service.activate(second);
	await f.service.open({projectId: second, url: 'http://localhost:3000/'});
	t.deepEqual(f.views[2].bounds, [bounds]);
});

test('BRW-07 a popup is denied by the view and reported as its own kind of refusal', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	f.views[0].hooks.popup('http://localhost:3000/new-window');
	const snapshot = f.service.get({projectId: first});
	t.is(snapshot.status, 'ready');
	t.like(snapshot.blocked, {
		url: 'http://localhost:3000/new-window',
		reason: 'popup',
	});
	f.service.activate(second);
	f.views[0].hooks.popup('http://localhost:3000/late');
	t.is(f.service.get({projectId: second}).blocked, null);
});

function download(url: string, filename: string, total = 100) {
	const state = {
		cancelled: 0,
		destination: undefined as {defaultPath: string; title: string} | undefined,
		progress: undefined as
			| ((received: number, total: number) => void)
			| undefined,
		done: undefined as
			| ((state: 'completed' | 'cancelled' | 'interrupted') => void)
			| undefined,
	};
	const item: BrowserDownloadItem = {
		url,
		filename,
		totalBytes: total,
		setDestination: options => {
			state.destination = options;
		},
		cancel: () => {
			state.cancelled++;
		},
		onProgress: listener => {
			state.progress = listener;
		},
		onDone: listener => {
			state.done = listener;
		},
	};
	return {item, state};
}

test('BRW-06 a download is listed, asks the system where to save it and follows the item to the end', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	const d = download('http://localhost:3000/report.csv', 'report.csv');
	f.views[0].hooks.download(d.item);
	t.is(
		d.state.destination?.defaultPath,
		path.join('/home/user/Downloads', 'report.csv'),
	);
	t.like(f.service.get({projectId: first}).downloads[0], {
		name: 'report.csv',
		state: 'asking',
		received: 0,
		total: 100,
	});
	d.state.progress?.(40, 100);
	t.like(f.service.get({projectId: first}).downloads[0], {
		state: 'progress',
		received: 40,
	});
	d.state.done?.('completed');
	t.like(f.service.get({projectId: first}).downloads[0], {state: 'done'});
	t.is(d.state.cancelled, 0);
});

test('BRW-06 a cancelled or interrupted download is shown as such', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	const a = download('http://localhost:3000/a.bin', 'a.bin');
	const b = download('http://localhost:3000/b.bin', 'b.bin');
	f.views[0].hooks.download(a.item);
	f.views[0].hooks.download(b.item);
	a.state.done?.('cancelled');
	b.state.done?.('interrupted');
	const states = f.service
		.get({projectId: first})
		.downloads.map(entry => [entry.name, entry.state]);
	t.deepEqual(states, [
		['a.bin', 'cancelled'],
		['b.bin', 'failed'],
	]);
});

test('BRW-06 the offered file name is made safe before it reaches the dialog', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	const cases: Array<[string, string]> = [
		['../../etc/passwd', 'passwd'],
		['..\\..\\Windows\\win.ini', 'win.ini'],
		['   ', 'download'],
		['..', 'download'],
		['a\u0000b\nc.txt', 'abc.txt'],
		['x'.repeat(300), 'x'.repeat(120)],
		['CON', '_CON'],
		['con.txt', '_con.txt'],
		['NUL.tar.gz', '_NUL.tar.gz'],
		['com1', '_com1'],
		['LPT9.log', '_LPT9.log'],
		['console.log', 'console.log'],
		['report.', 'report'],
		['report. . ', 'report'],
		['...', 'download'],
	];
	for (const [raw, safe] of cases) {
		const d = download('http://localhost:3000/f', raw);
		f.views[0].hooks.download(d.item);
		t.is(
			d.state.destination?.defaultPath,
			path.join('/home/user/Downloads', safe),
			JSON.stringify(raw),
		);
	}
});

test('BRW-06 BRW-03 a download from a refused origin is cancelled before anything is saved and says why', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	for (const url of [
		'https://example.com/a.zip',
		'blob:https://example.com/1234',
		'data:text/plain;base64,AAAA',
		'ftp://localhost/a.zip',
	]) {
		const d = download(url, 'a.zip');
		f.views[0].hooks.download(d.item);
		t.is(d.state.cancelled, 1, url);
		t.is(d.state.destination, undefined, url);
	}
	t.deepEqual(f.service.get({projectId: first}).downloads, []);
	t.is(f.service.get({projectId: first}).blocked?.reason, 'scheme');
	const local = download('blob:http://localhost:3000/abcd', 'made.txt');
	f.views[0].hooks.download(local.item);
	t.is(local.state.cancelled, 0);
	t.is(f.service.get({projectId: first}).downloads.length, 1);
});

test('BRW-06 only the last five downloads are kept and a project switch forgets them', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	for (let i = 1; i <= 7; i++)
		f.views[0].hooks.download(
			download(`http://localhost:3000/${i}`, `f${i}.txt`).item,
		);
	t.deepEqual(
		f.service.get({projectId: first}).downloads.map(entry => entry.name),
		['f3.txt', 'f4.txt', 'f5.txt', 'f6.txt', 'f7.txt'],
	);
	const stale = download('http://localhost:3000/late', 'late.txt');
	f.service.activate(second);
	f.views[0].hooks.download(stale.item);
	t.is(stale.state.cancelled, 1);
	t.deepEqual(f.service.get({projectId: second}).downloads, []);
});

test('BRW-05 a page opens in the partition of the profile the project uses', async t => {
	const f = fixture(t);
	const made = f.profiles.create('Docs');
	f.service.activate(first);
	f.profiles.assign(first, {kind: 'default'});
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	t.is(f.views[0].partition, 'persist:browser-default');
	f.service.activate(first);
	f.profiles.assign(first, {kind: 'named', id: made.id});
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	t.is(f.views[1].partition, `persist:browser-profile-${made.id}`);
	f.service.activate(first);
	f.profiles.assign(first, {kind: 'incognito'});
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	t.is(f.views[2].partition, `browser-incognito-${first}`);
});

test('BRW-05 choosing another profile closes the page, uses the new partition next, and refuses unknown choices', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	const none = f.service.setProfile({projectId: first, profile: 'project'});
	t.is(none.status, 'ready');
	t.is(f.views[0].destroyed, 0);
	const snapshot = f.service.setProfile({projectId: first, profile: 'default'});
	t.is(snapshot.status, 'closed');
	t.is(f.views[0].destroyed, 1);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	t.is(f.views[1].partition, 'persist:browser-default');
	t.is(
		code(
			t.throws(() => f.service.setProfile({projectId: first, profile: 'x'})),
		),
		'VALIDATION',
	);
	t.is(
		code(
			t.throws(() =>
				f.service.setProfile({
					projectId: first,
					profile: '0c7b2a54-1d6e-4f8a-9b3c-5e2d1a0f9c88',
				}),
			),
		),
		'NOT_FOUND',
	);
	t.is(
		code(
			t.throws(() =>
				f.service.setProfile({projectId: second, profile: 'default'}),
			),
		),
		'DENIED',
	);
});

test("BRW-05 the profile list reports the project's current choice", t => {
	const f = fixture(t);
	f.service.activate(first);
	const made = f.service.createProfile({projectId: first, name: 'Docs'});
	t.deepEqual(
		made.profiles.map(entry => entry.name),
		['Docs'],
	);
	t.is(made.current, 'project');
	f.service.setProfile({projectId: first, profile: made.profiles[0].id});
	t.is(f.service.profiles({projectId: first}).current, made.profiles[0].id);
});

test('BRW-05 leaving an incognito page wipes its partition', async t => {
	const f = fixture(t);
	f.profiles.assign(first, {kind: 'incognito'});
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	t.deepEqual(f.cleared, []);
	f.service.closeView({projectId: first});
	t.deepEqual(f.cleared, [`browser-incognito-${first}`]);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	f.service.activate(second);
	t.is(f.cleared.length, 2);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	await f.service.close();
	t.is(f.cleared.length, 3);
});

test('BRW-08 clearing data wipes only that profile and closes the page that is using it', async t => {
	const f = fixture(t);
	f.service.activate(first);
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	const other = await f.service.clearData({
		projectId: first,
		profile: 'default',
	});
	t.deepEqual(f.cleared, ['persist:browser-default']);
	t.is(other.status, 'ready');
	t.is(f.views[0].destroyed, 0);
	const own = await f.service.clearData({projectId: first, profile: 'project'});
	t.deepEqual(f.cleared, [
		'persist:browser-default',
		`persist:browser-${first}`,
	]);
	t.is(own.status, 'closed');
	t.is(f.views[0].destroyed, 1);
	t.is(
		code(
			await t.throwsAsync(
				f.service.clearData({projectId: first, profile: 'nonsense'}),
			),
		),
		'VALIDATION',
	);
	t.is(
		code(
			await t.throwsAsync(
				f.service.clearData({
					projectId: first,
					profile: '0c7b2a54-1d6e-4f8a-9b3c-5e2d1a0f9c88',
				}),
			),
		),
		'NOT_FOUND',
	);
});

test('BRW-08 removing a profile wipes its data, sends its projects home and closes a page that was using it', async t => {
	const f = fixture(t);
	f.service.activate(first);
	const made = f.service.createProfile({projectId: first, name: 'Docs'});
	const id = made.profiles[0].id;
	f.service.setProfile({projectId: first, profile: id});
	await f.service.open({projectId: first, url: 'http://localhost:3000/'});
	const after = await f.service.deleteProfile({projectId: first, id});
	t.deepEqual(after.profiles, []);
	t.is(after.current, 'project');
	t.deepEqual(f.cleared, [`persist:browser-profile-${id}`]);
	t.is(f.views[0].destroyed, 1);
	t.is(f.service.get({projectId: first}).status, 'closed');
});

test('BRW-09 SEC-16 opening externally uses the address the browser itself holds, only for web pages, and honours a refusal', async t => {
	const f = fixture(t);
	f.service.activate(first);
	t.is(
		code(await t.throwsAsync(f.service.openExternal({projectId: first}))),
		'UNAVAILABLE',
	);
	await f.service.open({projectId: first, url: 'http://localhost:3000/a?b=1'});
	t.deepEqual(await f.service.openExternal({projectId: first}), {opened: true});
	t.deepEqual(f.external, ['http://localhost:3000/a?b=1']);
	f.settings.approveExternal = false;
	t.deepEqual(await f.service.openExternal({projectId: first}), {
		opened: false,
	});
	t.is(
		code(await t.throwsAsync(f.service.openExternal({projectId: second}))),
		'DENIED',
	);
});
