import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {
	bindLaunchIdentity,
	captureLaunchIdentity,
	childEnv,
	createNanocoderLauncher,
	launchNanocoder,
} from '@/main/nanocoder/launch';

for (const trustDirectory of [false, true]) {
	for (const binary of ['cliPath', 'nodePath'] as const) {
		for (const field of [
			'realpath',
			'dev',
			'ino',
			'size',
			'mtimeNs',
			'missing',
		] as const) {
			test(`a ${trustDirectory ? 'trust' : 'project/recovery/idle'} launch refuses a changed ${binary} ${field} at the spawn boundary (ACP-20)`, t => {
				let changed = false;
				const runtime = {
					nodePath: path.resolve('/runtime/node'),
					cliPath: path.resolve('/runtime/cli'),
					version: '1.31.0',
					source: 'override' as const,
				};
				const fs = {
					realpath: (file: string) =>
						changed && file === runtime[binary] && field === 'realpath'
							? `${file}.swapped`
							: file,
					stat: (file: string) => {
						const different = changed && file === runtime[binary];
						return {
							dev: different && field === 'dev' ? 2n : 1n,
							ino: different && field === 'ino' ? 2n : 1n,
							size: different && field === 'size' ? 2n : 1n,
							mtimeNs: different && field === 'mtimeNs' ? 2n : 1n,
							isFile: () => !(different && field === 'missing'),
						};
					},
				};
				const bound = bindLaunchIdentity(
					runtime,
					captureLaunchIdentity(runtime, fs),
				);
				let spawns = 0;
				const launch = createNanocoderLauncher({
					fs,
					spawn: () => {
						spawns++;
						return {} as ReturnType<typeof launchNanocoder>;
					},
				});
				changed = true;
				t.throws(
					() =>
						launch(
							bound,
							['--acp'],
							path.resolve('/project'),
							{},
							{trustDirectory},
						),
					{code: 'UNSUPPORTED'},
				);
				t.is(spawns, 0);
			});
		}
	}
}

test('an unchanged verified runtime reaches spawn synchronously, with no await after the identity check (ACP-20)', async t => {
	const events: string[] = [];
	let yielded = false;
	const runtime = {
		nodePath: path.resolve('/runtime/node'),
		cliPath: path.resolve('/runtime/cli'),
		version: '1.31.0',
		source: 'override' as const,
	};
	const fs = {
		realpath: (file: string) => {
			events.push(`realpath:${file}`);
			return file;
		},
		stat: (file: string) => {
			events.push(`stat:${file}`);
			return {dev: 1n, ino: 2n, size: 3n, mtimeNs: 4n, isFile: () => true};
		},
	};
	const bound = bindLaunchIdentity(runtime, captureLaunchIdentity(runtime, fs));
	events.length = 0;
	const child = {} as ReturnType<typeof launchNanocoder>;
	const launch = createNanocoderLauncher({
		fs,
		spawn: () => {
			t.false(yielded);
			events.push('spawn');
			return child;
		},
	});
	queueMicrotask(() => {
		yielded = true;
	});
	t.is(launch(bound, ['--acp'], path.resolve('/project')), child);
	t.deepEqual(events, [
		`realpath:${runtime.cliPath}`,
		`realpath:${runtime.nodePath}`,
		`stat:${runtime.cliPath}`,
		`stat:${runtime.nodePath}`,
		'spawn',
	]);
	await Promise.resolve();
});

test('drops variables that change how Node loads code or what is trusted', t => {
	t.deepEqual(
		childEnv({
			PATH: '/bin',
			NODE_OPTIONS: '--require=evil',
			node_options: '--require=evil',
			ELECTRON_RUN_AS_NODE: '1',
			NANOCODER_TRUST_DIRECTORY: '1',
			OPENAI_API_KEY: 'kept',
		}),
		{PATH: '/bin', OPENAI_API_KEY: 'kept'},
	);
});

test('sets the trust variable only on the trust launch', async t => {
	const dir = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-launch-')),
	);
	const cli = path.join(dir, 'cli.js');
	writeFileSync(
		cli,
		'process.stdout.write(process.env.NANOCODER_TRUST_DIRECTORY ?? "unset");',
	);
	const run = async (child: ReturnType<typeof launchNanocoder>) => {
		let stdout = '';
		child.stdout.on('data', chunk => {
			stdout += chunk;
		});
		await new Promise(resolve => child.on('close', resolve));
		return stdout;
	};
	const runtime = {nodePath: process.execPath, cliPath: cli};
	const inherited = {...process.env, NANOCODER_TRUST_DIRECTORY: '1'};

	const normal = await run(launchNanocoder(runtime, [], dir, inherited));
	const trusted = await run(
		launchNanocoder(runtime, [], dir, process.env, {trustDirectory: true}),
	);
	rmSync(dir, {recursive: true, force: true});

	t.is(normal, 'unset');
	t.is(trusted, '1');
});

test('passes arguments literally, with no shell', async t => {
	const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'nd-launch-')));
	const cli = path.join(dir, 'cli.js');
	writeFileSync(
		cli,
		'process.stdout.write(JSON.stringify({args: process.argv.slice(2), nodeOptions: process.env.NODE_OPTIONS ?? null, cwd: process.cwd()}));',
	);

	const child = launchNanocoder(
		{nodePath: process.execPath, cliPath: cli},
		['--acp', 'a b; echo pwned', '$(whoami)', '%PATH%'],
		dir,
		{...process.env, NODE_OPTIONS: '--require=/does/not/exist.js'},
	);
	let stdout = '';
	child.stdout.on('data', chunk => {
		stdout += chunk;
	});
	const code = await new Promise(resolve => child.on('close', resolve));
	rmSync(dir, {recursive: true, force: true});

	t.is(code, 0);
	t.deepEqual(JSON.parse(stdout), {
		args: ['--acp', 'a b; echo pwned', '$(whoami)', '%PATH%'],
		nodeOptions: null,
		cwd: dir,
	});
});

test('refuses relative runtime, entry-point and working-directory paths', t => {
	for (const [nodePath, cliPath, cwd] of [
		['node', '/tmp/cli.js', '/tmp'],
		[process.execPath, 'cli.js', '/tmp'],
		[process.execPath, '/tmp/cli.js', '.'],
	]) {
		t.throws(() => launchNanocoder({nodePath, cliPath}, [], cwd), {
			message: /must be absolute/,
		});
	}
});

test('refuses the command-line trust bypass', t => {
	t.throws(
		() =>
			launchNanocoder(
				{nodePath: process.execPath, cliPath: process.execPath},
				['--trust-directory'],
				process.cwd(),
			),
		{message: /confirmed trust launch/},
	);
});
