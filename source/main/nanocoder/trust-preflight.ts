import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PROTOCOL_VERSION} from '@agentclientprotocol/sdk';
import {NanocoderFailure} from '@/main/nanocoder/acp-client';
import {type SupervisorClock, systemClock} from '@/main/nanocoder/clock';
import {
	bindLaunchIdentity,
	captureLaunchIdentity,
	launchNanocoder,
	waitForExit,
} from '@/main/nanocoder/launch';
import {StderrRing} from '@/main/nanocoder/stderr-ring';
import {canonicalPath, isInside} from '@/main/paths';

interface Runtime {
	nodePath: string;
	cliPath: string;
	version: string;
}

type Verdict = 'verified' | 'rejected' | 'inconclusive';
const refusalPrefix = '[nanocoder] Directory ';
const refusalSuffix =
	' is not trusted. Pass --trust-directory to bypass the disclaimer for this run only, or set NANOCODER_TRUST_DIRECTORY=1 to trust this directory permanently.';

const refused = () =>
	new NanocoderFailure(
		'UNSUPPORTED',
		'Could not verify the Nanocoder 1.31.x ACP directory trust check. Use a trust-check development build through NANOCODER_DESKTOP_CLI, or upgrade to 1.32.0 when released.',
	);

function identity(runtime: Runtime) {
	try {
		return captureLaunchIdentity(runtime);
	} catch {
		throw refused();
	}
}

export function createTrustPreflight(
	options: {
		clock?: SupervisorClock;
		launch?: typeof launchNanocoder;
		remove?: typeof rm;
	} = {},
) {
	const clock = options.clock ?? systemClock;
	const launch = options.launch ?? launchNanocoder;
	const remove = options.remove ?? rm;
	const cache = new Map<
		string,
		{fingerprint: string; verdict: Exclude<Verdict, 'inconclusive'>}
	>();
	const pending = new Map<string, symbol>();
	return {
		async verify<T extends Runtime>(
			runtime: T,
			projectRoot: string,
			signal?: AbortSignal,
		): Promise<T> {
			signal?.throwIfAborted();
			const before = identity(runtime);
			const cached = cache.get(before.key);
			if (cached?.fingerprint === before.fingerprint) {
				if (cached.verdict !== 'verified') throw refused();
				return bindLaunchIdentity(runtime, before);
			}
			cache.delete(before.key);
			const generation = Symbol();
			pending.set(before.key, generation);
			try {
				const temporary: string[] = [];
				let verdict: Verdict = 'inconclusive';
				try {
					const rawRoot = await mkdtemp(
						path.join(tmpdir(), 'nd-trust-check-root-'),
					);
					temporary.push(rawRoot);
					const rawState = await mkdtemp(
						path.join(tmpdir(), 'nd-trust-check-state-'),
					);
					temporary.push(rawState);
					const [root, home, project] = await Promise.all(
						[rawRoot, rawState, projectRoot].map(file => canonicalPath(file)),
					);
					if (
						isInside(root, [project], process.platform) ||
						isInside(home, [project], process.platform)
					)
						throw refused();
					const config = path.join(home, 'config');
					const data = path.join(home, 'data');
					const env: NodeJS.ProcessEnv = {
						HOME: home,
						USERPROFILE: home,
						NANOCODER_CONFIG_DIR: config,
						NANOCODER_DATA_DIR: data,
					};
					if (process.platform === 'win32') {
						env.SystemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
						env.NODE_DISABLE_COMPILE_CACHE = '1';
					}
					await Promise.all([mkdir(config), mkdir(data)]);
					signal?.throwIfAborted();
					const child = launch(
						bindLaunchIdentity(runtime, before),
						['--acp'],
						root,
						env,
					);
					const exited = waitForExit(child);
					const ring = new StderrRing({homeDir: home});
					let timedOut = false;
					let output = false;
					let observationFailed = false;
					let terminating = false;
					const terminate = () => {
						terminating = true;
						child.kill('SIGKILL');
						child.stdin.destroy();
						child.stdout.destroy();
						child.stderr.destroy();
					};
					const streamFailed = () => {
						if (!terminating) observationFailed = true;
						terminate();
					};
					child.stdin.on('error', streamFailed);
					child.stdout.on('error', streamFailed);
					child.stderr.on('error', streamFailed);
					child.stderr.on('data', (chunk: Buffer) =>
						ring.write(chunk.toString()),
					);
					child.stderr.on('end', () => ring.flush());
					child.stdout.on('data', () => {
						output = true;
						terminate();
					});
					const cancelTimer = clock.setTimeout(() => {
						timedOut = true;
						terminate();
					}, 5000);
					signal?.addEventListener('abort', terminate, {once: true});
					try {
						signal?.throwIfAborted();
						const writing = new Promise<void>(resolve => {
							child.stdin.write(
								`${JSON.stringify({
									jsonrpc: '2.0',
									id: 1,
									method: 'initialize',
									params: {
										protocolVersion: PROTOCOL_VERSION,
										clientInfo: {
											name: 'nanocoder-desktop-trust-check',
											version: '0.0.0',
										},
										clientCapabilities: {},
									},
								})}\n`,
								error => {
									if (error && !terminating) observationFailed = true;
									resolve();
								},
							);
						});
						const exit = await exited;
						await writing;
						ring.flush();
						const expected = `${refusalPrefix}${root}${refusalSuffix}`;
						const accepted =
							!timedOut &&
							!output &&
							!ring.truncated &&
							exit.code === 1 &&
							exit.signal === null &&
							ring.lines().length === 1 &&
							ring.lines()[0] === expected;
						const lines = ring.lines();
						const recognisableRefusal =
							lines.length === 1 &&
							lines[0].length > refusalPrefix.length + refusalSuffix.length &&
							lines[0].startsWith(refusalPrefix) &&
							lines[0].endsWith(refusalSuffix);
						if (!timedOut && !observationFailed && !ring.truncated) {
							if (accepted) verdict = 'verified';
							else if (
								output ||
								(exit.code !== null &&
									exit.signal === null &&
									recognisableRefusal)
							)
								verdict = 'rejected';
						}
					} finally {
						cancelTimer();
						signal?.removeEventListener('abort', terminate);
						terminate();
						await exited;
					}
				} catch {
					signal?.throwIfAborted();
					throw refused();
				} finally {
					const cleanup = await Promise.allSettled(
						temporary.map(async file =>
							remove(file, {recursive: true, force: true}),
						),
					);
					if (cleanup.some(result => result.status === 'rejected')) {
						signal?.throwIfAborted();
						throw refused();
					}
				}
				signal?.throwIfAborted();
				const after = identity(runtime);
				if (
					after.key !== before.key ||
					after.fingerprint !== before.fingerprint
				)
					throw refused();
				if (pending.get(before.key) !== generation) throw refused();
				if (verdict !== 'inconclusive') {
					if (cache.size >= 32) cache.clear();
					cache.set(before.key, {fingerprint: before.fingerprint, verdict});
				}
				if (verdict !== 'verified') throw refused();
				return bindLaunchIdentity(runtime, before);
			} finally {
				if (pending.get(before.key) === generation) pending.delete(before.key);
			}
		},
	};
}
