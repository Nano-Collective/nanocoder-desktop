import {mkdtemp, realpath, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import type {PtyHostFactory, PtyLaunch} from '@/main/terminal/pty-contracts';
import {TerminalService} from '@/main/terminal/terminal-service';
import type {ProjectInfo} from '@/shared/ipc';
import type {TerminalEvent} from '@/shared/terminal';

async function fixture(t: {teardown(fn: () => Promise<void>): void}) {
	const root = await realpath(
		await mkdtemp(path.join(tmpdir(), 'terminal-spec-')),
	);
	t.teardown(() => rm(root, {recursive: true, force: true}));
	const project: ProjectInfo = {
		id: 'project',
		canonicalRoot: root,
		sessionCwd: root,
		displayName: 'fixture',
		trusted: true,
		defaultMode: 'normal',
		availability: 'available',
		createdAt: '',
		lastOpenedAt: '',
	};
	const events: TerminalEvent[] = [];
	const launches: PtyLaunch[] = [];
	const writes: string[] = [];
	const sizes: number[][] = [];
	const callbacks: Array<Parameters<PtyHostFactory>[1]> = [];
	let stops = 0;
	const service = new TerminalService({
		project: id => (id === project.id ? project : undefined),
		projects: () => [project],
		emit: event => events.push(event),
		shell: async () => ({file: '/bin/sh', args: ['-l']}),
		env: {LANG: 'en_GB.UTF-8', NODE_OPTIONS: '--require=secret'},
		createHost: async (launch, handlers) => {
			launches.push(launch);
			callbacks.push(handlers);
			return {
				write: data => writes.push(data),
				resize: (cols, rows) => sizes.push([cols, rows]),
				stop: async () => {
					stops++;
				},
			};
		},
	});
	t.teardown(() => service.close());
	await service.activate(project.id);
	return {
		service,
		project,
		events,
		launches,
		writes,
		sizes,
		callbacks,
		stops: () => stops,
	};
}

test('TERM-01/03/04 canonical root, one PTY, UTF-8 and a clean launch environment', async t => {
	const f = await fixture(t);
	const request = {projectId: f.project.id};
	const [first, second] = await Promise.all([
		f.service.start(request),
		f.service.start(request),
	]);
	t.is(first.status, 'running');
	t.is(second.status, 'running');
	t.is(f.launches.length, 1);
	t.is(f.launches[0].root, f.project.canonicalRoot);
	t.deepEqual(f.launches[0].shell, {file: '/bin/sh', args: ['-l']});
	t.deepEqual(f.launches[0].env, {LANG: 'en_GB.UTF-8', TERM: 'xterm-256color'});
	f.service.write({...request, data: 'printf café 😀\r'});
	t.deepEqual(f.writes, ['printf café 😀\r']);
	f.service.resize({...request, cols: 120, rows: 40});
	t.deepEqual(f.sizes, [[120, 40]]);
});

test('TERM-02/06/09 output stays bounded in memory and clear/stop erase it', async t => {
	const f = await fixture(t);
	const request = {projectId: f.project.id};
	await f.service.start(request);
	f.callbacks[0].data('secret fixture\n'.repeat(100_000));
	t.true(f.service.get(request).output.length <= 1_048_576);
	t.true(f.service.get(request).truncated);
	t.is(f.service.clear(request).output, '');
	f.callbacks[0].data('latest');
	await f.service.stop(request);
	t.is(f.service.get(request).output, '');
	t.is(f.stops(), 1);
	await f.service.restart(request);
	t.is(f.launches.length, 2);
	f.callbacks[0].data('stale');
	t.is(f.service.get(request).output, '');
});

test('TERM-07 switching projects and quit await teardown and reject stale input', async t => {
	const f = await fixture(t);
	const request = {projectId: f.project.id};
	await f.service.start(request);
	const switching = f.service.activate('other');
	t.throws(() => f.service.write({...request, data: 'never'}), {
		code: 'DENIED',
	});
	await switching;
	t.is(f.stops(), 1);
	await f.service.activate(f.project.id);
	await f.service.start(request);
	await f.service.close();
	t.is(f.stops(), 2);
	await t.throwsAsync(f.service.start(request), {code: 'DENIED'});
});

test('SEC-03/17 unknown, untrusted, unavailable and changed roots never spawn', async t => {
	const f = await fixture(t);
	await t.throwsAsync(f.service.start({projectId: 'unknown'}), {
		code: 'DENIED',
	});
	f.project.trusted = false;
	await t.throwsAsync(f.service.start({projectId: f.project.id}), {
		code: 'DENIED',
	});
	f.project.trusted = true;
	f.project.availability = 'missing';
	await t.throwsAsync(f.service.start({projectId: f.project.id}), {
		code: 'DENIED',
	});
	f.project.availability = 'available';
	f.project.sessionCwd = path.join(f.project.canonicalRoot, 'nested');
	await t.throwsAsync(f.service.start({projectId: f.project.id}), {
		code: 'DENIED',
	});
	f.project.sessionCwd = f.project.canonicalRoot;
	const alias = `${f.project.canonicalRoot}-alias`;
	await symlink(f.project.canonicalRoot, alias, 'junction');
	t.teardown(() => rm(alias, {force: true}));
	f.project.canonicalRoot = alias;
	f.project.sessionCwd = alias;
	await t.throwsAsync(f.service.start({projectId: f.project.id}), {
		code: 'DENIED',
	});
	t.is(f.launches.length, 0);
});

test('TERM-01 a PTY failure leaves the service alive and explicitly restartable', async t => {
	const f = await fixture(t);
	const request = {projectId: f.project.id};
	await f.service.start(request);
	f.callbacks[0].exit(null, true);
	t.is(f.service.get(request).status, 'failed');
	await f.service.restart(request);
	t.is(f.service.get(request).status, 'running');
	f.project.trusted = false;
	t.throws(() => f.service.write({...request, data: 'never'}), {
		code: 'DENIED',
	});
	t.throws(() => f.service.resize({...request, cols: 80, rows: 24}), {
		code: 'DENIED',
	});
	await f.service.stop(request);
	t.is(f.service.get(request).status, 'stopped');
});

test('TERM-02 invalid sizes and oversized input never reach the PTY', async t => {
	const f = await fixture(t);
	const request = {projectId: f.project.id};
	t.throws(() => f.service.write({...request, data: 'text'}), {
		code: 'UNAVAILABLE',
	});
	await f.service.start(request);
	t.throws(() => f.service.write({...request, data: 'x'.repeat(65_537)}), {
		code: 'LIMIT',
	});
	t.throws(() => f.service.resize({...request, cols: 0, rows: 5000}), {
		code: 'VALIDATION',
	});
	t.deepEqual(f.writes, []);
	t.deepEqual(f.sizes, []);
});
