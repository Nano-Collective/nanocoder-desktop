import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {FakeClock} from '@/main/nanocoder/fixtures/fake-clock';
import {launchNanocoder} from '@/main/nanocoder/launch';
import {createTrustPreflight} from '@/main/nanocoder/trust-preflight';

function fixture(t: ExecutionContext, behaviour = 'refuse') {
	const work = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-preflight-test-')),
	);
	t.teardown(() => rmSync(work, {recursive: true, force: true}));
	const cli = path.join(work, 'cli.mjs');
	copyFileSync(
		path.join(import.meta.dirname, 'fixtures/fake-trust-preflight.mjs'),
		cli,
	);
	writeFileSync(path.join(work, 'preflight-behaviour'), behaviour);
	const launches: Array<{
		root: string;
		env: NodeJS.ProcessEnv;
		args: readonly string[];
	}> = [];
	const clock = new FakeClock();
	let started!: () => void;
	const ready = new Promise<void>(resolve => {
		started = resolve;
	});
	const preflight = createTrustPreflight({
		clock,
		launch: (runtime, args, root, env) => {
			launches.push({root, env: env ?? {}, args});
			const child = launchNanocoder(runtime, args, root, env);
			child.stderr.on('data', (chunk: Buffer) => {
				if (chunk.toString().includes('fixture waiting')) started();
			});
			return child;
		},
	});
	const runtime = {nodePath: process.execPath, cliPath: cli, version: '1.31.0'};
	return {
		work,
		cli,
		runtime,
		launches,
		clock,
		ready,
		preflight,
		verify: () => preflight.verify(runtime, work),
		change: (next = 'refuse') => {
			writeFileSync(path.join(work, 'preflight-behaviour'), next);
			writeFileSync(cli, `${readFileSync(cli, 'utf8')}\n// changed fixture\n`);
		},
	};
}

test('an exact not-trusted refusal passes, uses only isolated state and removes both temporary roots (ACP-20)', async t => {
	const previous = process.env.NANOCODER_TRUST_DIRECTORY;
	const api = process.env.OPENAI_API_KEY;
	process.env.NANOCODER_TRUST_DIRECTORY = '1';
	process.env.OPENAI_API_KEY = 'fixture-only-no-key';
	t.teardown(() => {
		if (previous === undefined) delete process.env.NANOCODER_TRUST_DIRECTORY;
		else process.env.NANOCODER_TRUST_DIRECTORY = previous;
		if (api === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = api;
	});
	const f = fixture(t);
	await f.verify();
	t.is(f.launches.length, 1);
	const launch = f.launches[0];
	t.deepEqual(launch.args, ['--acp']);
	t.deepEqual(
		Object.keys(launch.env).sort(),
		[
			'HOME',
			'NANOCODER_CONFIG_DIR',
			'NANOCODER_DATA_DIR',
			'USERPROFILE',
			...(process.platform === 'win32' ? ['SystemRoot'] : []),
		].sort(),
	);
	t.is(launch.env.HOME, launch.env.USERPROFILE);
	t.true(path.isAbsolute(launch.root));
	t.is(
		realpathSync.native(path.dirname(launch.root)),
		realpathSync.native(tmpdir()),
	);
	t.false(existsSync(launch.root));
	t.false(existsSync(launch.env.HOME ?? ''));
	t.is(f.clock.pending, 0);
});

for (const behaviour of [
	'published',
	'unknown',
	'wrong-root',
	'wrong-exit',
	'exit',
	'non-acp',
	'whitespace',
]) {
	test(`${behaviour} trust preflight refuses rather than trusting an unsafe 1.31.x build (ACP-04 ACP-20)`, async t => {
		const f = fixture(t, behaviour);
		await t.throwsAsync(f.verify(), {
			code: 'UNSUPPORTED',
			message: /could not verify.*directory trust check/i,
		});
		t.is(f.launches.length, 1);
		t.false(existsSync(f.launches[0].root));
		t.false(existsSync(f.launches[0].env.HOME ?? ''));
		t.is(f.clock.pending, 0);
	});
}

test('a silent preflight times out with the injected clock and cleans up without sleeps (ACP-20)', async t => {
	const f = fixture(t, 'timeout');
	const rejected = t.throwsAsync(f.verify(), {code: 'UNSUPPORTED'});
	await f.ready;
	f.clock.advance(5000);
	await rejected;
	t.false(existsSync(f.launches[0].root));
	t.false(existsSync(f.launches[0].env.HOME ?? ''));
	t.is(f.clock.pending, 0);
});

test('preflight refuses an OS temp root inside the selected project before launching (ACP-20)', async t => {
	const f = fixture(t);
	await t.throwsAsync(
		f.preflight.verify(f.runtime, realpathSync.native(tmpdir())),
		{code: 'UNSUPPORTED'},
	);
	t.is(f.launches.length, 0);
});

test('only an unchanged realpath, file identity and version can reuse a memory-only preflight verdict (ACP-20)', async t => {
	const f = fixture(t);
	await f.verify();
	await f.verify();
	t.is(f.launches.length, 1);
	f.change();
	await f.verify();
	t.is(f.launches.length, 2);
	const seconds = Date.now() / 1000 + 100;
	utimesSync(f.cli, seconds, seconds);
	await f.verify();
	t.is(f.launches.length, 3);
	const replacement = `${f.cli}.new`;
	copyFileSync(f.cli, replacement);
	renameSync(replacement, f.cli);
	await f.verify();
	t.is(f.launches.length, 4);
	await f.preflight.verify({...f.runtime, version: '1.31.1'}, f.work);
	t.is(f.launches.length, 5);
	const other = path.join(f.work, 'other-cli.mjs');
	copyFileSync(f.cli, other);
	await f.preflight.verify({...f.runtime, cliPath: other}, f.work);
	t.is(f.launches.length, 6);
});

test('a refused verdict is cached only in memory and a changed binary must be checked again (ACP-20)', async t => {
	const f = fixture(t, 'published');
	await t.throwsAsync(f.verify(), {code: 'UNSUPPORTED'});
	await t.throwsAsync(f.verify(), {code: 'UNSUPPORTED'});
	t.is(f.launches.length, 1);
	f.change('refuse');
	await f.verify();
	t.is(f.launches.length, 2);
});

test('an aborted preflight is cleaned up and never leaves a cached success (ACP-20)', async t => {
	const f = fixture(t, 'timeout');
	const controller = new AbortController();
	const rejected = t.throwsAsync(
		f.preflight.verify(f.runtime, f.work, controller.signal),
		{name: 'AbortError'},
	);
	await f.ready;
	controller.abort();
	await rejected;
	t.false(existsSync(f.launches[0].root));
	t.false(existsSync(f.launches[0].env.HOME ?? ''));
	t.is(f.clock.pending, 0);
	f.change();
	await f.verify();
	t.is(f.launches.length, 2);
});
