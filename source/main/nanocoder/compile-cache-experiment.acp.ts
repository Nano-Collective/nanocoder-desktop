import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {systemClock} from '@/main/nanocoder/clock';
import {launchNanocoder} from '@/main/nanocoder/launch';
import {StderrRing} from '@/main/nanocoder/stderr-ring';
import {createTrustPreflight} from '@/main/nanocoder/trust-preflight';

const cli = process.env.NANOCODER_CLI ?? '';

for (let index = 1; index <= 20; index++) {
	const enabled = index % 2 === 1;
	test.serial(
		`probe ${index}: compile cache ${enabled ? 'on' : 'off'}`,
		async t => {
			t.true(path.isAbsolute(cli));
			const work = realpathSync.native(
				mkdtempSync(path.join(tmpdir(), 'nd-cache-experiment-')),
			);
			t.teardown(() => rmSync(work, {recursive: true, force: true}));
			const root = path.join(work, 'project');
			const cache = path.join(work, 'cache');
			mkdirSync(root);
			mkdirSync(cache);
			t.is(readdirSync(cache).length, 0);
			const start = performance.now();
			const elapsed = () => Math.round(performance.now() - start);
			const timing = {
				deadlineFired: false,
				deadlineFiredMs: null as number | null,
				deadlineBudgetMs: null as number | null,
				launchMs: null as number | null,
				spawnMs: null as number | null,
				firstStderrMs: null as number | null,
				exitMs: null as number | null,
				closeMs: null as number | null,
				stdoutBytes: 0,
				exit: null as {
					code: number | null;
					signal: NodeJS.Signals | null;
				} | null,
			};
			let stderr: StderrRing | undefined;
			let expected = '';
			let accepted = false;
			try {
				await createTrustPreflight({
					clock: {
						...systemClock,
						setTimeout: (run, milliseconds) => {
							timing.deadlineBudgetMs = milliseconds;
							return systemClock.setTimeout(() => {
								timing.deadlineFired = true;
								timing.deadlineFiredMs = elapsed();
								run();
							}, milliseconds);
						},
					},
					launch: (runtime, args, cwd, env) => {
						timing.launchMs = elapsed();
						const child = launchNanocoder(runtime, args, cwd, {
							...env,
							NODE_COMPILE_CACHE: cache,
							...(enabled ? {} : {NODE_DISABLE_COMPILE_CACHE: '1'}),
						});
						stderr = new StderrRing({homeDir: env?.HOME});
						expected = `[nanocoder] Directory ${cwd} is not trusted. Pass --trust-directory to bypass the disclaimer for this run only, or set NANOCODER_TRUST_DIRECTORY=1 to trust this directory permanently.`;
						child.once('spawn', () => {
							timing.spawnMs = elapsed();
						});
						child.stderr.on('data', (chunk: Buffer) => {
							timing.firstStderrMs ??= elapsed();
							stderr?.write(chunk.toString());
						});
						child.stdout.on('data', (chunk: Buffer) => {
							timing.stdoutBytes += chunk.length;
						});
						child.once('exit', (code, signal) => {
							timing.exitMs = elapsed();
							timing.exit = {code, signal};
						});
						child.once('close', () => {
							timing.closeMs = elapsed();
						});
						return child;
					},
				}).verify(
					{nodePath: process.execPath, cliPath: cli, version: '1.31.0'},
					root,
				);
				accepted = true;
			} catch {
				// Every rejection remains a failed sample; later samples are independent.
			}
			stderr?.flush();
			const exactRefusal =
				stderr?.lines().length === 1 && stderr.lines()[0] === expected;
			const cacheFiles = readdirSync(cache, {
				recursive: true,
				withFileTypes: true,
			}).filter(entry => entry.isFile()).length;
			console.info('[compile-cache experiment] %j', {
				index,
				compileCache: enabled ? 'on' : 'off',
				accepted,
				...timing,
				elapsedMs: elapsed(),
				stderrLines: stderr?.lines().length ?? 0,
				exactRefusal,
				cacheFiles,
			});
			t.is(timing.deadlineBudgetMs, 5000);
			t.is(
				accepted,
				!timing.deadlineFired &&
					timing.stdoutBytes === 0 &&
					timing.exit?.code === 1 &&
					timing.exit.signal === null &&
					timing.closeMs !== null &&
					!stderr?.truncated &&
					exactRefusal,
			);
			if (!enabled) t.is(cacheFiles, 0);
			t.true(
				accepted,
				'The unchanged strict preflight must accept this sample',
			);
		},
	);
}
