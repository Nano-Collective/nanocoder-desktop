import {randomUUID} from 'node:crypto';
import test from 'ava';
import {DiagnosticsExporter} from '@/main/nanocoder/diagnostics';
import {
	fakeProject,
	fakeRuntime,
	removeFakeProjects,
} from '@/main/nanocoder/fixtures/fake-project';
import {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import type {ProjectInfo} from '@/shared/ipc';

test.after.always(removeFakeProjects);

for (const fixture of [
	{
		name: 'Unicode-escaped credential field names',
		input: '{"api\\u004bey":"fixture-private-decoded-key"}\n',
		secret: 'fixture-private-decoded-key',
	},
	{
		name: 'multiline tool output continuations',
		input:
			'tool_output: fixture\nfixture-private-continuation\nanother private line\n',
		secret: 'fixture-private-continuation',
	},
	{
		name: 'JSON-escaped API key values',
		input: String.raw`\"apiKey\":\"fixture-private-escaped-key\"` + '\n',
		secret: 'fixture-private-escaped-key',
	},
	{
		name: 'Groq key shapes',
		input: `failure gsk_${'a'.repeat(48)}\n`,
		secret: `gsk_${'a'.repeat(48)}`,
	},
	{
		name: 'Hugging Face key shapes',
		input: `failure hf_${'b'.repeat(32)}\n`,
		secret: `hf_${'b'.repeat(32)}`,
	},
	{
		name: 'URL credentials cut off at EOF',
		input: 'connection failed https://alice:fixture-cutoff-value',
		secret: 'fixture-cutoff-value',
	},
]) {
	test(`reviewed export refuses ${fixture.name}`, async t => {
		const root = fakeProject();
		const project: ProjectInfo = {
			id: randomUUID(),
			canonicalRoot: root,
			sessionCwd: root,
			displayName: 'fixture',
			trusted: true,
			defaultMode: 'normal',
			availability: 'available',
			createdAt: '',
			lastOpenedAt: '',
		};
		const supervisor = new ProjectSupervisor({
			resolveRuntime: async () => ({
				ok: true,
				runtime: {
					...fakeRuntime,
					version: '9.9.9',
					nodeVersion: process.version,
					source: 'override',
				},
			}),
			clientInfo: {name: 'test', version: '0'},
			confirmTrust: async () => false,
		});
		t.teardown(() => supervisor.close());
		await supervisor.ensureProcess(project);
		const ring = supervisor.getConnection(project.id).stderr;
		ring.write(fixture.input);
		ring.flush();
		const snapshot = supervisor.getDiagnostics(project.id);
		let reviewed: string | undefined;
		let exported: string | undefined;
		const exporter = new DiagnosticsExporter({
			read: (id, snapshotId) =>
				supervisor.getCapturedDiagnostics(id, snapshotId),
			review: async capture => {
				reviewed = capture.lines.join('\n');
				return true;
			},
			chooseDestination: async () => '/tmp/fake-reviewed-diagnostics.txt',
			write: async (_destination, contents) => {
				exported = contents;
			},
		});
		t.deepEqual(
			await exporter.exportDiagnostics({
				projectId: project.id,
				snapshotId: snapshot.id,
			}),
			{status: 'exported'},
		);
		t.is(reviewed, exported);
		t.is(exported, snapshot.lines.join('\n'));
		t.false(reviewed?.includes(fixture.secret));
		t.false(exported?.includes(fixture.secret));
		if (
			fixture.name !== 'multiline tool output continuations' &&
			fixture.name !== 'Unicode-escaped credential field names'
		)
			t.false(ring.lines().join('\n').includes(fixture.secret));
	});
}
