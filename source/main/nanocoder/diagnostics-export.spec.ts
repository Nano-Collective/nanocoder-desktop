import test from 'ava';
import * as diagnostics from '@/main/nanocoder/diagnostics';
import {FakeClock} from '@/main/nanocoder/fixtures/fake-clock';

test('main reviews the exact captured snapshot before choosing a destination and exporting', async t => {
	const Exporter = diagnostics.DiagnosticsExporter;
	if (!Exporter) {
		t.fail('reviewed diagnostics exporter is not available');
		return;
	}
	const snapshots = new diagnostics.DiagnosticSnapshots();
	const snapshot = snapshots.capture('project', ['original [redacted]'], false);
	const calls: string[] = [];
	const exporter = new Exporter({
		read: (projectId, id) => snapshots.get(projectId, id),
		review: async reviewed => {
			calls.push('review');
			t.deepEqual(reviewed, snapshot);
			reviewed.lines.push('forged');
			snapshots.capture('project', ['newer data not reviewed'], false);
			return true;
		},
		chooseDestination: async () => {
			calls.push('choose');
			return '/tmp/synthetic-diagnostics.txt';
		},
		write: async (destination, text) => {
			calls.push('write');
			t.is(destination, '/tmp/synthetic-diagnostics.txt');
			t.is(text, 'original [redacted]');
		},
	});
	t.deepEqual(
		await exporter.exportDiagnostics({
			projectId: 'project',
			snapshotId: snapshot.id,
		}),
		{status: 'exported'},
	);
	t.deepEqual(calls, ['review', 'choose', 'write']);
});

test('cancelled, foreign, unknown or expired snapshots never write or bypass native review', async t => {
	for (const scenario of [
		'cancel-review',
		'cancel-save',
		'foreign',
		'unknown',
		'expired-before',
		'expired-review',
		'expired-save',
	]) {
		const clock = new FakeClock();
		const snapshots = new diagnostics.DiagnosticSnapshots({clock, ttlMs: 1000});
		const snapshot = snapshots.capture('project', ['synthetic'], false);
		let reviews = 0;
		let destinations = 0;
		let writes = 0;
		const exporter = new diagnostics.DiagnosticsExporter({
			read: (projectId, id) => snapshots.get(projectId, id),
			review: async () => {
				reviews++;
				if (scenario === 'expired-review') clock.advance(1000);
				return scenario !== 'cancel-review';
			},
			chooseDestination: async () => {
				destinations++;
				if (scenario === 'expired-save') clock.advance(1000);
				return scenario === 'cancel-save' ? undefined : '/tmp/synthetic.txt';
			},
			write: async () => {
				writes++;
			},
		});
		if (scenario === 'expired-before') clock.advance(1000);
		const exporting = exporter.exportDiagnostics({
			projectId: scenario === 'foreign' ? 'foreign' : 'project',
			snapshotId: scenario === 'unknown' ? 'unknown' : snapshot.id,
		});
		if (scenario.startsWith('cancel'))
			t.deepEqual(await exporting, {status: 'cancelled'});
		else await t.throwsAsync(exporting, {code: 'NOT_FOUND'});
		t.is(writes, 0);
		if (['foreign', 'unknown', 'expired-before'].includes(scenario))
			t.is(reviews, 0);
		if (scenario === 'expired-review' || scenario === 'cancel-review')
			t.is(destinations, 0);
	}
});

test('only one diagnostics export may own the native review at a time', async t => {
	const snapshots = new diagnostics.DiagnosticSnapshots();
	const snapshot = snapshots.capture('project', ['synthetic'], false);
	let release!: (value: boolean) => void;
	let reviews = 0;
	const exporter = new diagnostics.DiagnosticsExporter({
		read: (projectId, id) => snapshots.get(projectId, id),
		review: () =>
			++reviews > 1
				? Promise.resolve(false)
				: new Promise(resolve => {
						release = resolve;
					}),
		chooseDestination: async () => undefined,
		write: async () => t.fail('cancelled export wrote data'),
	});
	const request = {projectId: 'project', snapshotId: snapshot.id};
	const first = exporter.exportDiagnostics(request);
	await t.throwsAsync(exporter.exportDiagnostics(request), {code: 'BUSY'});
	release(false);
	t.deepEqual(await first, {status: 'cancelled'});
	t.deepEqual(await exporter.exportDiagnostics(request), {status: 'cancelled'});
});

test('native export failures return a safe error instead of paths or underlying details', async t => {
	for (const failing of ['read', 'review', 'destination', 'write']) {
		const snapshots = new diagnostics.DiagnosticSnapshots();
		const snapshot = snapshots.capture('project', ['synthetic'], false);
		const fail = () => {
			throw new Error('synthetic-only-error');
		};
		const exporter = new diagnostics.DiagnosticsExporter({
			read: (projectId, id) =>
				failing === 'read' ? fail() : snapshots.get(projectId, id),
			review: async () => (failing === 'review' ? fail() : true),
			chooseDestination: async () =>
				failing === 'destination' ? fail() : '/tmp/synthetic.txt',
			write: async () => {
				if (failing === 'write') fail();
			},
		});
		await t.throwsAsync(
			exporter.exportDiagnostics({
				projectId: 'project',
				snapshotId: snapshot.id,
			}),
			{code: 'INTERNAL', message: 'Diagnostics could not be exported'},
		);
	}
});
