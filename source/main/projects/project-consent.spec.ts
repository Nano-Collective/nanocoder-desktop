import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {IpcFailure} from '@/main/ipc/handle-request';
import {confirmProjectTrust} from '@/main/projects/project-consent';

function fixture(t: ExecutionContext) {
	const root = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-consent-')),
	);
	t.teardown(() => rmSync(root, {recursive: true, force: true}));
	const abort = new AbortController();
	return {
		root,
		abort,
		signal: abort.signal,
		refusal: {
			reason: 'not-trusted' as const,
			summary: 'Directory fixture is not trusted.',
		},
	};
}

test('main consent names its canonical folder and execution surfaces with cancel as the default (DEC-30)', async t => {
	const options = fixture(t);
	const result = await confirmProjectTrust({
		...options,
		ask: async dialog => {
			t.is(dialog.title, 'Trust this folder?');
			t.is(dialog.message, options.refusal.summary);
			t.true(dialog.detail?.includes(options.root));
			t.true(dialog.detail?.includes('plugins: 0'));
			t.true(dialog.detail?.includes('MCP servers: 0'));
			t.deepEqual(dialog.buttons, ['Trust folder', 'Cancel']);
			t.is(dialog.defaultId, 1);
			t.is(dialog.cancelId, 1);
			return 1;
		},
	});
	t.false(result);
});

test('native acceptance grants consent only for the unchanged displayed snapshot (DEC-30)', async t => {
	t.true(await confirmProjectTrust({...fixture(t), ask: async () => 0}));
});

test('equal-count execution config edits while the native prompt is open refuse consent (SEC-17)', async t => {
	const options = fixture(t);
	const filename = path.join(options.root, 'agents.config.json');
	writeFileSync(
		filename,
		JSON.stringify({nanocoder: {hooks: {start: [{command: 'first'}]}}}),
	);
	const error = await t.throwsAsync(
		confirmProjectTrust({
			...options,
			ask: async () => {
				writeFileSync(
					filename,
					JSON.stringify({nanocoder: {hooks: {start: [{command: 'other'}]}}}),
				);
				return 0;
			},
		}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'DENIED');
});

test('a late native acceptance after renderer detachment cannot grant consent (SEC-17)', async t => {
	const options = fixture(t);
	const error = await t.throwsAsync(
		confirmProjectTrust({
			...options,
			ask: async () => {
				options.abort.abort(new IpcFailure('AGENT_UNAVAILABLE', 'Detached'));
				return 0;
			},
		}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'AGENT_UNAVAILABLE');
});
