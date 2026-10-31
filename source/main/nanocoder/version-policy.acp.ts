import test from 'ava';
import {
	clientInfo,
	createWorkFolder,
	setupProject,
} from '@/main/nanocoder/fixtures/real-nanocoder';
import {resolveNanocoder} from '@/main/nanocoder/runtime';
import {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import {createTrustPreflight} from '@/main/nanocoder/trust-preflight';
import type {ProjectInfo} from '@/shared/ipc';

test('the real 1.31.0 override passes isolated preflight and opens a project with normal trust consent and an untested warning (ACP-04 ACP-20 PERF-02)', async t => {
	t.timeout(120_000);
	const folder = createWorkFolder('nd-min-version-real-profile-');
	const f = await setupProject(folder.work, 'fixture', [
		{text: 'fixture provisional minimum accepted'},
	]);
	let confirmations = 0;
	const env = {
		...f.env,
		NANOCODER_DESKTOP_CLI:
			process.env.NANOCODER_DESKTOP_CLI ?? process.env.NANOCODER_CLI,
		NANOCODER_DESKTOP_NODE: process.execPath,
	};
	const resolved = await resolveNanocoder({
		env,
		platform: process.platform,
		untrustedRoots: [f.root],
	});
	if (!resolved.ok) throw new Error(resolved.message);
	t.is(resolved.runtime.version, '1.31.0');
	t.is(resolved.runtime.source, 'override');
	const probe = createTrustPreflight();
	let start = performance.now();
	await probe.verify(resolved.runtime, f.root);
	const coldMs = performance.now() - start;
	start = performance.now();
	await probe.verify(resolved.runtime, f.root);
	const cachedMs = performance.now() - start;
	t.log(
		JSON.stringify({coldMs, cachedMs, scope: '1.31.x trust preflight only'}),
	);
	const supervisor = new ProjectSupervisor({
		resolveRuntime: async () => resolved,
		clientInfo,
		env,
		confirmTrust: async (refusal, root) => {
			confirmations++;
			t.is(root, f.root);
			t.is(refusal.reason, 'not-trusted');
			return true;
		},
	});
	t.teardown(async () => {
		await supervisor.close();
		await f.provider.close();
		folder.remove();
	});
	const project: ProjectInfo = {
		id: 'fixture-project',
		canonicalRoot: f.root,
		sessionCwd: f.root,
		displayName: 'fixture',
		trusted: true,
		defaultMode: 'normal',
		availability: 'available',
		createdAt: '',
		lastOpenedAt: '',
	};
	const state = await supervisor.ensureProcess(project);
	t.is(state.status, 'ready');
	t.is(state.gates?.versionPolicy.status, 'untested');
	t.regex(
		state.gates?.versionPolicy.reason ?? '',
		/NANOCODER_DESKTOP_CLI.*trust/,
	);
	t.is(confirmations, 1);
	const connection = supervisor.getConnection(project.id);
	const session = await connection.newSession('normal');
	const result = await connection.prompt(
		session.id,
		'synthetic fixture for minimum version',
	);
	t.is(session.mode, 'normal');
	t.is(result.stopReason, 'end_turn');
	t.is(f.provider.requests.length, 1);
});
