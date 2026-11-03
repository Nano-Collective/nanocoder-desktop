import test from 'ava';
import {
	FilesController,
	type FilesState,
	flattenTree,
	treeKey,
} from '@/renderer/files-controller';
import type {
	FileEntry,
	FileListing,
	FilePreview,
	FilesEvent,
} from '@/shared/files';
import type {IpcResult} from '@/shared/ipc';

const entry = (
	name: string,
	kind: FileEntry['kind'] = 'file',
	extra: Partial<FileEntry> = {},
): FileEntry => ({
	name,
	kind,
	link: 'none',
	size: kind === 'file' ? 10 : null,
	unreadable: false,
	ignored: false,
	mark: null,
	...extra,
});

const listing = (
	path: string,
	entries: FileEntry[],
	extra: Partial<FileListing> = {},
): FileListing => ({
	path,
	entries,
	notShown: 0,
	incomplete: false,
	watch: 'active',
	...extra,
});

const ok = <T>(value: T): IpcResult<T> => ({ok: true, value});
const fail = (
	code: 'NOT_FOUND' | 'DENIED',
	message: string,
): IpcResult<never> => ({
	ok: false,
	error: {code, message, retryable: false},
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => {
		resolve = done;
	});
	return {promise, resolve};
}

function fixture(tree: Record<string, FileListing | IpcResult<FileListing>>) {
	const calls: string[] = [];
	const gates = new Map<
		string,
		ReturnType<typeof deferred<IpcResult<FileListing>>>
	>();
	let listener: ((event: FilesEvent) => void) | undefined;
	const states: FilesState[] = [];
	const previews = new Map<
		string,
		IpcResult<FilePreview> | ReturnType<typeof deferred<IpcResult<FilePreview>>>
	>();
	const controller = new FilesController(
		{
			list: async ({path}) => {
				calls.push(`list:${path}`);
				const gate = gates.get(path);
				if (gate) {
					// Each gate holds back exactly one call.
					gates.delete(path);
					return gate.promise;
				}
				const value = tree[path];
				if (!value) return fail('NOT_FOUND', 'gone');
				return 'ok' in value ? value : ok(value);
			},
			preview: async ({path}) => {
				calls.push(`preview:${path}`);
				const value = previews.get(path);
				if (value && 'promise' in value) return value.promise;
				return value ?? fail('NOT_FOUND', 'gone');
			},
			onEvent: next => {
				listener = next;
				return () => {
					listener = undefined;
				};
			},
		},
		state => states.push(state),
	);
	const flush = () => new Promise<void>(resolve => setImmediate(resolve));
	return {
		controller,
		calls,
		gates,
		previews,
		states,
		flush,
		emit: (event: FilesEvent) => listener?.(event),
		listening: () => listener !== undefined,
		tree,
	};
}

const text = (path: string, body: string): FilePreview => ({
	path,
	name: path.split('/').at(-1) ?? path,
	size: body.length,
	modified: 1,
	kind: 'text',
	text: body,
	encoding: 'utf-8',
	highlight: true,
});

test('FILE-01 selecting a project lists only its root; folders load when opened', async t => {
	const f = fixture({
		'': listing('', [entry('src', 'directory'), entry('a.ts')]),
		src: listing('src', [entry('b.ts')]),
	});
	f.controller.select('p');
	await f.flush();
	t.deepEqual(f.calls, ['list:']);
	f.controller.toggle('src');
	await f.flush();
	t.deepEqual(f.calls, ['list:', 'list:src']);
	t.deepEqual(
		flattenTree(f.controller.getState()).map(row =>
			row.type === 'entry' ? row.path : row.text,
		),
		['src', 'src/b.ts', 'a.ts'],
	);
	f.controller.toggle('src');
	f.controller.toggle('src');
	await f.flush();
	t.deepEqual(f.calls, ['list:', 'list:src']);
});

test('FILE-01 an answer for a project that was left is dropped', async t => {
	const f = fixture({'': listing('', [entry('old.ts')])});
	const gate = deferred<IpcResult<FileListing>>();
	f.gates.set('', gate);
	f.controller.select('one');
	f.controller.select('two');
	gate.resolve(ok(listing('', [entry('stale.ts')])));
	await f.flush();
	t.false(JSON.stringify(f.controller.getState()).includes('stale.ts'));
	t.is(f.controller.getState().projectId, 'two');
	f.controller.select(null);
	t.deepEqual(f.controller.getState().expanded, []);
});

test('FILE-01 a slow older answer cannot replace a newer listing of the same folder', async t => {
	const f = fixture({'': listing('', [])});
	f.controller.select('p');
	await f.flush();
	const first = deferred<IpcResult<FileListing>>();
	const second = deferred<IpcResult<FileListing>>();
	f.gates.set('', first);
	void f.controller.refresh();
	f.gates.set('', second);
	void f.controller.refresh();
	second.resolve(ok(listing('', [entry('new.ts')])));
	await f.flush();
	first.resolve(ok(listing('', [entry('old.ts')])));
	await f.flush();
	t.true(JSON.stringify(f.controller.getState()).includes('new.ts'));
	t.false(JSON.stringify(f.controller.getState()).includes('old.ts'));
});

test('FILE-05 a change event lists only open folders again, and an overflow lists them all', async t => {
	const f = fixture({
		'': listing('', [entry('src', 'directory'), entry('lib', 'directory')]),
		src: listing('src', [entry('a.ts')]),
		lib: listing('lib', [entry('b.ts')]),
	});
	f.controller.select('p');
	f.controller.toggle('src');
	await f.flush();
	f.calls.length = 0;
	f.emit({
		type: 'changed',
		projectId: 'p',
		directories: ['lib', 'src', 'unopened'],
		overflow: false,
	});
	await f.flush();
	t.deepEqual([...f.calls].sort(), ['list:src']);
	f.calls.length = 0;
	f.emit({type: 'changed', projectId: 'p', directories: [], overflow: true});
	await f.flush();
	t.deepEqual([...f.calls].sort(), ['list:', 'list:src']);
	f.calls.length = 0;
	f.emit({
		type: 'changed',
		projectId: 'other',
		directories: [''],
		overflow: false,
	});
	await f.flush();
	t.deepEqual(f.calls, []);
});

test('FILE-05 refresh drops a folder that no longer exists and keeps the rest', async t => {
	const f = fixture({
		'': listing('', [entry('src', 'directory'), entry('lib', 'directory')]),
		src: listing('src', [entry('a.ts')]),
		lib: listing('lib', [entry('b.ts')]),
	});
	f.controller.select('p');
	f.controller.toggle('src');
	f.controller.toggle('lib');
	await f.flush();
	delete f.tree.lib;
	await f.controller.refresh();
	t.deepEqual(f.controller.getState().expanded, ['src']);
	t.false('lib' in f.controller.getState().directories);
});

test('FILE-05 a watch limit is shown and manual refresh keeps working', async t => {
	const f = fixture({'': listing('', [entry('a.ts')])});
	f.controller.select('p');
	await f.flush();
	f.emit({type: 'watch-limit', projectId: 'p'});
	t.is(f.controller.getState().watch, 'limited');
	await f.controller.refresh();
	t.is(f.controller.getState().directories[''].status, 'ready');
	f.tree[''] = listing('', [entry('a.ts')], {watch: 'active'});
	await f.controller.refresh();
	t.is(f.controller.getState().watch, 'active');
});

test('FILE-01 a listing that fails keeps the earlier rows and says why', async t => {
	const f = fixture({'': listing('', [entry('a.ts')])});
	f.controller.select('p');
	await f.flush();
	f.tree[''] = fail('DENIED', 'That folder cannot be read');
	await f.controller.refresh();
	const rows = flattenTree(f.controller.getState());
	t.deepEqual(
		rows.map(row => row.type),
		['entry', 'notice'],
	);
	t.is(rows[1].type === 'notice' && rows[1].text, 'That folder cannot be read');
});

test('FILE-01 entries beyond the limit show a count, and a capped scan says so', t => {
	const state: FilesState = {
		projectId: 'p',
		expanded: [],
		selected: null,
		preview: null,
		watch: 'active',
		directories: {
			'': {
				status: 'ready',
				error: null,
				listing: listing('', [entry('a')], {
					notShown: 18_000,
					incomplete: true,
				}),
			},
		},
	};
	const rows = flattenTree(state);
	t.is(rows[1].type === 'notice' && rows[1].text, '18,000+ more not shown');
});

test('FILE-10 a link outside the project is listed but cannot expand or open', t => {
	const state: FilesState = {
		projectId: 'p',
		expanded: ['escape'],
		selected: null,
		preview: null,
		watch: 'active',
		directories: {
			'': {
				status: 'ready',
				error: null,
				listing: listing('', [
					entry('escape', 'other', {link: 'outside'}),
					entry('inner', 'directory', {link: 'inside'}),
				]),
			},
		},
	};
	const rows = flattenTree(state);
	t.false(rows[0].type === 'entry' && rows[0].expandable);
	t.false(rows[0].type === 'entry' && rows[0].expanded);
	t.true(rows[1].type === 'entry' && rows[1].expandable);
	t.is(treeKey(rows, 'escape', 'Enter'), null);
});

test('FILE-04 opening a file previews it, and a late answer for an earlier file is dropped', async t => {
	const f = fixture({'': listing('', [entry('a.ts'), entry('b.ts')])});
	const slow = deferred<IpcResult<FilePreview>>();
	f.previews.set('a.ts', slow);
	f.previews.set('b.ts', ok(text('b.ts', 'bee')));
	f.controller.select('p');
	await f.flush();
	void f.controller.open('a.ts');
	await f.controller.open('b.ts');
	slow.resolve(ok(text('a.ts', 'ay')));
	await f.flush();
	const preview = f.controller.getState().preview;
	t.is(preview?.path, 'b.ts');
	t.is(preview?.status, 'ready');
	t.is(preview?.value?.kind === 'text' && preview.value.text, 'bee');
	await f.controller.open('missing.ts');
	t.is(f.controller.getState().preview?.status, 'error');
	f.controller.closePreview();
	t.is(f.controller.getState().preview, null);
});

test('FILE-05 a change to the previewed folder reloads the preview', async t => {
	const f = fixture({'': listing('', [entry('a.ts')])});
	f.previews.set('a.ts', ok(text('a.ts', 'one')));
	f.controller.select('p');
	await f.flush();
	await f.controller.open('a.ts');
	f.previews.set('a.ts', ok(text('a.ts', 'two')));
	f.emit({type: 'changed', projectId: 'p', directories: [''], overflow: false});
	await f.flush();
	const value = f.controller.getState().preview?.value;
	t.is(value?.kind === 'text' && value.text, 'two');
});

test('FILE-11 arrow keys move, expand, collapse and open with tree semantics', t => {
	const state: FilesState = {
		projectId: 'p',
		expanded: ['src'],
		selected: null,
		preview: null,
		watch: 'active',
		directories: {
			'': {
				status: 'ready',
				error: null,
				listing: listing('', [
					entry('src', 'directory'),
					entry('lib', 'directory'),
					entry('a.ts'),
				]),
			},
			src: {
				status: 'ready',
				error: null,
				listing: listing('src', [entry('b.ts')]),
			},
		},
	};
	const rows = flattenTree(state);
	t.deepEqual(
		rows.map(row => row.path),
		['src', 'src/b.ts', 'lib', 'a.ts'],
	);
	t.deepEqual(treeKey(rows, null, 'ArrowDown'), {type: 'focus', path: 'src'});
	t.deepEqual(treeKey(rows, 'src', 'ArrowDown'), {
		type: 'focus',
		path: 'src/b.ts',
	});
	t.deepEqual(treeKey(rows, 'a.ts', 'ArrowDown'), {
		type: 'focus',
		path: 'a.ts',
	});
	t.deepEqual(treeKey(rows, 'src', 'ArrowUp'), {type: 'focus', path: 'src'});
	t.deepEqual(treeKey(rows, 'src', 'End'), {type: 'focus', path: 'a.ts'});
	t.deepEqual(treeKey(rows, 'a.ts', 'Home'), {type: 'focus', path: 'src'});
	t.deepEqual(treeKey(rows, 'lib', 'ArrowRight'), {
		type: 'toggle',
		path: 'lib',
	});
	t.deepEqual(treeKey(rows, 'src', 'ArrowRight'), {
		type: 'focus',
		path: 'src/b.ts',
	});
	t.is(treeKey(rows, 'a.ts', 'ArrowRight'), null);
	t.deepEqual(treeKey(rows, 'src', 'ArrowLeft'), {type: 'toggle', path: 'src'});
	t.deepEqual(treeKey(rows, 'src/b.ts', 'ArrowLeft'), {
		type: 'focus',
		path: 'src',
	});
	t.is(treeKey(rows, 'a.ts', 'ArrowLeft'), null);
	t.deepEqual(treeKey(rows, 'a.ts', 'Enter'), {type: 'open', path: 'a.ts'});
	t.deepEqual(treeKey(rows, 'a.ts', ' '), {type: 'open', path: 'a.ts'});
	t.deepEqual(treeKey(rows, 'lib', 'Enter'), {type: 'toggle', path: 'lib'});
	t.deepEqual(treeKey(rows, 'a.ts', 'Enter', true), {
		type: 'attach',
		path: 'a.ts',
	});
	t.is(treeKey(rows, 'lib', 'Enter', true)?.type, 'toggle');
	t.is(treeKey(rows, 'a.ts', 'x'), null);
	t.is(treeKey([], null, 'ArrowDown'), null);
	t.is(treeKey(rows, 'ghost', 'ArrowLeft'), null);
});

test('FILE-01 positions and levels are reported for assistive technology', t => {
	const state: FilesState = {
		projectId: 'p',
		expanded: ['src'],
		selected: null,
		preview: null,
		watch: 'active',
		directories: {
			'': {
				status: 'ready',
				error: null,
				listing: listing('', [entry('src', 'directory'), entry('a.ts')]),
			},
			src: {status: 'loading', error: null, listing: null},
		},
	};
	const rows = flattenTree(state);
	t.is(rows[0].type === 'entry' && rows[0].busy, true);
	t.deepEqual(
		rows.map(row =>
			row.type === 'entry' ? [row.depth, row.index, row.count] : null,
		),
		[
			[0, 1, 2],
			[0, 2, 2],
		],
	);
});

test('FILE-09 disposing stops listening and ignores late answers', async t => {
	const f = fixture({'': listing('', [entry('a.ts')])});
	const gate = deferred<IpcResult<FileListing>>();
	f.gates.set('', gate);
	f.controller.select('p');
	t.true(f.listening());
	f.controller.dispose();
	t.false(f.listening());
	const seen = f.states.length;
	gate.resolve(ok(listing('', [entry('late.ts')])));
	await f.flush();
	t.is(f.states.length, seen);
});
