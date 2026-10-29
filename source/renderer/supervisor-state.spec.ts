import test from 'ava';
import {acpBadge, observeSupervisor} from '@/renderer/supervisor-state';
import type {ProjectEvent, SupervisorState} from '@/shared/ipc';

function state(
	patch: Partial<SupervisorState> = {},
	root = '/a',
): SupervisorState {
	return {
		projectId: 'a',
		status: 'ready',
		reason: null,
		runtime: null,
		gates: null,
		activeThreadId: null,
		exit: null,
		restart: {attempt: 0, limit: 0, nextAttemptAt: null},
		agent: {
			root,
			name: 'Nanocoder',
			version: '9.9.9',
			protocolVersion: 1,
			capabilities: {
				loadSession: false,
				sessions: {close: false, delete: false, list: false, resume: false},
				prompt: {image: false, audio: false, embeddedContext: false},
				mcp: {http: false, sse: false},
			},
		},
		...patch,
	};
}

const event = (sequence: number, next = state()): ProjectEvent => ({
	type: 'supervisor',
	projectId: next.projectId,
	sequence,
	state: next,
});
const ready = () => observeSupervisor({}, event(1));
const failed = () =>
	state({status: 'failed', agent: null, exit: {code: 3, signal: null}});

test('ready requires the current selected supervisor and a connected agent', t => {
	const current = ready();
	t.deepEqual(acpBadge(current, '/a'), {status: 'acp-ready'});
	t.is(acpBadge(current, ''), null);
	t.is(acpBadge(current, '/unknown'), null);
	for (const status of [
		'stopped',
		'starting',
		'stopping',
		'failed',
		'untrusted',
		'unsupported',
	] as const) {
		t.is(
			acpBadge(observeSupervisor(current, event(2, state({status}))), '/a'),
			null,
		);
	}
	t.is(
		acpBadge(observeSupervisor(current, event(2, state({agent: null}))), '/a'),
		null,
	);
});

test('an exit retains its root and actual code when the agent disappears', t => {
	const current = observeSupervisor(ready(), event(2, failed()));
	t.deepEqual(acpBadge(current, '/a'), {status: 'acp-exited', exitCode: 3});
});

test('signal-only exits never invent an exit code', t => {
	const current = observeSupervisor(
		ready(),
		event(
			2,
			state({
				status: 'stopped',
				agent: null,
				exit: {code: null, signal: 'SIGTERM'},
			}),
		),
	);
	t.deepEqual(acpBadge(current, '/a'), {
		status: 'acp-exited',
		exitCode: undefined,
	});
});

test('stale and duplicate events cannot restore readiness after an exit', t => {
	const current = observeSupervisor(ready(), event(3, failed()));
	const stale = observeSupervisor(current, event(2));
	t.deepEqual(acpBadge(stale, '/a'), {status: 'acp-exited', exitCode: 3});
	t.is(observeSupervisor(current, event(3)), current);
});

test('selecting another project isolates its process state', t => {
	const first = ready();
	const other = state({projectId: 'b'}, '/b');
	const both = observeSupervisor(first, event(1, other));
	const exited = observeSupervisor(both, event(2, failed()));
	t.deepEqual(acpBadge(exited, '/b'), {status: 'acp-ready'});
	t.deepEqual(acpBadge(exited, '/a'), {status: 'acp-exited', exitCode: 3});
});

test('removal hides a process and rejects stale ready replay', t => {
	const current = observeSupervisor(ready(), {
		type: 'project-removed',
		projectId: 'a',
		sequence: 2,
	});
	t.is(acpBadge(current, '/a'), null);
	t.is(observeSupervisor(current, event(1)), current);
	t.deepEqual(acpBadge(observeSupervisor(current, event(3)), '/a'), {
		status: 'acp-ready',
	});
});

test('unrelated events and mismatched IDs cannot change a known process', t => {
	const current = ready();
	t.deepEqual(acpBadge(current, '/a'), {status: 'acp-ready'});
	t.is(
		observeSupervisor(current, {
			type: 'turn',
			projectId: 'a',
			threadId: 't',
			sequence: 9,
			events: [],
		}),
		current,
	);
	t.is(
		observeSupervisor(current, {...event(2, failed()), projectId: 'b'}),
		current,
	);
});

test('a fresh ready event restores readiness after a reported exit', t => {
	const exited = observeSupervisor(ready(), event(2, failed()));
	t.deepEqual(acpBadge(exited, '/a'), {status: 'acp-exited', exitCode: 3});
	t.deepEqual(acpBadge(observeSupervisor(exited, event(3)), '/a'), {
		status: 'acp-ready',
	});
});
