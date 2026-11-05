import test, {type ExecutionContext} from 'ava';
import {BrowserService} from '@/main/browser/browser-service';
import {browserPartition} from '@/main/browser/profile';
import type {BrowserBounds, BrowserEvent} from '@/shared/browser';

const first = '4f6c1f0e-3a55-4a0b-9d1e-0a2b3c4d5e6f';
const second = '9b1d2c3e-4f50-4a6b-8c7d-1e2f3a4b5c6d';

interface FakeView {
	partition: string;
	loads: string[];
	bounds: Array<BrowserBounds | null>;
	destroyed: number;
	finish(): void;
	fail(): void;
}

function fixture(t: ExecutionContext, options: {failCreate?: boolean} = {}) {
	const events: BrowserEvent[] = [];
	const views: FakeView[] = [];
	let holdLoads = false;
	const service = new BrowserService({
		project: id =>
			id === first || id === second
				? {id, displayName: `project ${id}`}
				: undefined,
		emit: event => events.push(event),
		createView: ({partition, preferences}) => {
			if (options.failCreate) throw new Error('no window at /secret/path');
			const settled: Array<{resolve(): void; reject(error: Error): void}> = [];
			const view: FakeView = {
				partition: preferences.partition,
				loads: [],
				bounds: [],
				destroyed: 0,
				finish: () => settled.shift()?.resolve(),
				fail: () => settled.shift()?.reject(new Error('net::ERR_FAILED')),
			};
			t.is(partition, preferences.partition);
			views.push(view);
			return {
				load: url => {
					view.loads.push(url);
					if (!holdLoads) return Promise.resolve();
					return new Promise<void>((resolve, reject) =>
						settled.push({resolve, reject}),
					);
				},
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
		hold: () => {
			holdLoads = true;
		},
	};
}

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
	t.is(snapshot.projectId, first);
});

test('BRW-03/SEC-12 a public, file or script URL never creates a view', async t => {
	const f = fixture(t);
	f.service.activate(first);
	for (const url of [
		'https://example.com/',
		'file:///etc/passwd',
		'javascript:alert(1)',
		'http://localhost.evil.com/',
	]) {
		const error = await t.throwsAsync(
			f.service.open({projectId: first, url}),
			undefined,
			url,
		);
		t.is((error as {code?: string}).code, 'DENIED');
	}
	t.is(f.views.length, 0);
});

test('BRW-01 only the active project can use the browser', async t => {
	const f = fixture(t);
	f.service.activate(first);
	const error = await t.throwsAsync(
		f.service.open({projectId: second, url: 'http://localhost:3000/'}),
	);
	t.is((error as {code?: string}).code, 'DENIED');
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
	t.is((error as {code?: string}).code, 'DENIED');
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
	t.is((error as {code?: string}).code, 'UNAVAILABLE');
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
	t.is((error as {code?: string}).code, 'DENIED');
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
	t.is((error as {code?: string}).code, 'UNAVAILABLE');
	t.false((error as Error).message.includes('/secret/path'));
	const snapshot = f.service.get({projectId: first});
	t.is(snapshot.status, 'failed');
	t.false(JSON.stringify(snapshot).includes('/secret/path'));
});
