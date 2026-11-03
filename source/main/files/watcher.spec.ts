import test from 'ava';
import {
	type WatchChange,
	type WatchListener,
	WatchManager,
} from '@/main/files/watcher';

function fixture() {
	const changes: Array<{projectId: string; change: WatchChange}> = [];
	const limits: string[] = [];
	const watches: Array<{
		root: string;
		emit: WatchListener;
		fail(error: Error): void;
		closed: boolean;
	}> = [];
	const timers = new Map<number, () => void>();
	let next = 0;
	let throwOnWatch: Error | undefined;
	const manager = new WatchManager({
		debounceMs: 300,
		maxDirectories: 3,
		onChange: (projectId, change) => changes.push({projectId, change}),
		onLimit: projectId => limits.push(projectId),
		schedule: {
			set: callback => {
				timers.set(++next, callback);
				return next;
			},
			clear: handle => timers.delete(handle as number),
		},
		watch: (root, listener, failed) => {
			if (throwOnWatch) throw throwOnWatch;
			const watch = {
				root,
				emit: listener,
				fail: failed,
				closed: false,
				close() {
					this.closed = true;
				},
			};
			watches.push(watch);
			return watch;
		},
	});
	return {
		manager,
		changes,
		limits,
		watches,
		timers,
		fire: () => {
			for (const [id, callback] of [...timers]) {
				timers.delete(id);
				callback();
			}
		},
		failStart: (error: Error) => {
			throwOnWatch = error;
		},
	};
}

test('FILE-05 a burst of events becomes one change naming each directory once', t => {
	const f = fixture();
	t.is(f.manager.ensure('p', '/work/app'), 'active');
	const [watch] = f.watches;
	watch.emit('change', 'src/a.ts');
	watch.emit('rename', 'src/b.ts');
	watch.emit('change', 'README.md');
	watch.emit('change', 'src\\lib\\c.ts');
	t.is(f.timers.size, 1);
	t.deepEqual(f.changes, []);
	f.fire();
	t.is(f.changes.length, 1);
	t.deepEqual(f.changes[0], {
		projectId: 'p',
		change: {directories: ['', 'src', 'src/lib'], overflow: false, git: false},
	});
});

test('FILE-05 GIT-06 only Git state files inside .git count, and node_modules is ignored', t => {
	const f = fixture();
	f.manager.ensure('p', '/work/app');
	const [watch] = f.watches;
	for (const name of [
		'.git/objects/ab/cdef',
		'.git/logs/HEAD',
		'.git/index.lock',
		'node_modules/pkg/index.js',
		'web/node_modules/x/y.js',
	])
		watch.emit('change', name);
	t.is(f.timers.size, 0);
	watch.emit('change', '.git/HEAD');
	f.fire();
	t.deepEqual(f.changes[0].change, {
		directories: [],
		overflow: false,
		git: true,
	});
	watch.emit('change', '.git/refs/heads/main');
	f.fire();
	t.true(f.changes[1].change.git);
	watch.emit('change', '.git/index');
	watch.emit('change', 'a.txt');
	f.fire();
	t.deepEqual(f.changes[2].change, {
		directories: [''],
		overflow: false,
		git: true,
	});
});

test('FILE-05 too many directories or an unnamed event asks for a full refresh', t => {
	const f = fixture();
	f.manager.ensure('p', '/work/app');
	const [watch] = f.watches;
	for (const name of ['a/1', 'b/1', 'c/1', 'd/1']) watch.emit('change', name);
	f.fire();
	t.deepEqual(f.changes[0].change, {
		directories: [],
		overflow: true,
		git: false,
	});
	watch.emit('change', null);
	f.fire();
	t.true(f.changes[1].change.overflow);
});

test('FILE-05 a watch error reports the limit once and stops watching', t => {
	const f = fixture();
	t.is(f.manager.ensure('p', '/work/app'), 'active');
	const [watch] = f.watches;
	watch.fail(Object.assign(new Error('ENOSPC'), {code: 'ENOSPC'}));
	watch.fail(new Error('again'));
	t.deepEqual(f.limits, ['p']);
	t.true(watch.closed);
	t.is(f.manager.state('p'), 'limited');
	watch.emit('change', 'a.txt');
	t.is(f.timers.size, 0);
});

test('FILE-05 a platform that cannot start a watch is limited from the start', t => {
	const f = fixture();
	f.failStart(Object.assign(new Error('EMFILE'), {code: 'EMFILE'}));
	t.is(f.manager.ensure('p', '/work/app'), 'limited');
	t.deepEqual(f.limits, ['p']);
});

test('FILE-05 switching projects closes the old watch and closing cancels pending work', t => {
	const f = fixture();
	f.manager.ensure('one', '/work/one');
	f.watches[0].emit('change', 'a.txt');
	t.is(f.manager.ensure('one', '/work/one'), 'active');
	t.is(f.watches.length, 1);
	f.manager.ensure('two', '/work/two');
	t.true(f.watches[0].closed);
	t.is(f.timers.size, 0);
	f.watches[1].emit('change', 'b.txt');
	f.manager.closeProject('one');
	t.false(f.watches[1].closed);
	f.manager.closeProject('two');
	t.true(f.watches[1].closed);
	f.fire();
	t.deepEqual(f.changes, []);
	t.is(f.manager.state('two'), 'active');
});

test('FILE-05 the real platform watch reports a file created in a nested folder', async t => {
	const {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} =
		await import('node:fs');
	const {tmpdir} = await import('node:os');
	const path = await import('node:path');
	const root = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-watch-')),
	);
	t.teardown(() => rmSync(root, {recursive: true, force: true}));
	mkdirSync(path.join(root, 'sub'));
	let seen!: (change: WatchChange) => void;
	const first = new Promise<WatchChange>(resolve => {
		seen = resolve;
	});
	const manager = new WatchManager({
		debounceMs: 20,
		onChange: (_project, change) => seen(change),
		onLimit: () => seen({directories: [], overflow: true, git: false}),
	});
	t.teardown(() => manager.close());
	t.is(manager.ensure('p', root), 'active');
	// A watch can start a moment after it is created, so the event repeats until it is seen.
	const repeat = setInterval(
		() => writeFileSync(path.join(root, 'sub', 'a.txt'), String(Date.now())),
		25,
	);
	try {
		const change = await first;
		t.false(change.overflow);
		t.true(
			change.directories.includes('sub') || change.directories.includes(''),
		);
	} finally {
		clearInterval(repeat);
	}
});
