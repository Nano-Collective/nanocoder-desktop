import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {childEnv, launchNanocoder} from '@/main/nanocoder/launch';

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
