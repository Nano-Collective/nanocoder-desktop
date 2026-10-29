import test from 'ava';
import {
	DiagnosticSnapshots,
	diagnosticLine,
} from '@/main/nanocoder/diagnostics';
import {FakeClock} from '@/main/nanocoder/fixtures/fake-clock';
import {StderrRing} from '@/main/nanocoder/stderr-ring';

test('diagnostic captures expire and have bounded bytes and retained snapshot counts', t => {
	const clock = new FakeClock();
	const snapshots = new DiagnosticSnapshots({
		clock,
		maxSnapshots: 2,
		maxBytes: 32,
		ttlMs: 1000,
	});
	const first = snapshots.capture(
		'project',
		['x'.repeat(20), 'y'.repeat(20)],
		false,
	);
	t.true(Buffer.byteLength(first.lines.join('\n')) <= 32);
	t.true(first.truncated);
	snapshots.capture('project', ['second'], false);
	const third = snapshots.capture('project', ['third'], false);
	t.throws(() => snapshots.get('project', first.id), {code: 'NOT_FOUND'});
	t.throws(() => snapshots.get('foreign', third.id), {code: 'NOT_FOUND'});
	t.deepEqual(snapshots.get('project', third.id), third);
	clock.advance(1000);
	t.throws(() => snapshots.get('project', third.id), {code: 'NOT_FOUND'});
});

test('diagnostic views exclude ACP stdout and structured conversation, environment and tool payloads', t => {
	for (const line of [
		'[stdout] synthetic conversation',
		'{"nested":{"pro\\u006dpt":"synthetic conversation"}}',
		'[nanocoder] environment: synthetic environment',
		'{"tool_output":{"text":"synthetic tool payload"}}',
	])
		t.is(diagnosticLine(line), '[private payload omitted]');
	const metadata =
		'{"method":"session/close","params":{"sessionId":"synthetic"}}';
	t.is(diagnosticLine(metadata), '{"method":"session/close"}');
});

test('truncated structured payloads fail closed even when their field names are escaped', t => {
	const ring = new StderrRing();
	ring.append(`{"pro\\u006dpt":"${'synthetic '.repeat(600)}"}`);
	t.is(diagnosticLine(ring.lines()[0]), '[private payload omitted]');
});
