import test from 'ava';
import {handleRequest, IpcFailure} from '@/main/ipc/handle-request';
import {
	cancelPromptRequest,
	cancelTechnicalTurn,
} from '@/main/nanocoder/cancel-technical-turn';
import type {SessionInfo} from '@/shared/ipc';

const session: SessionInfo = {id: 'main-owned-session', mode: 'normal'};

test('refuses extra cancellation fields before invoking the handler', async t => {
	for (const payload of [
		{projectId: 'renderer-selected-project'},
		{sessionId: 'renderer-selected-session'},
		{extra: true},
		null,
		[],
	]) {
		let called = false;
		const result = await handleRequest({
			sender: {url: 'app://renderer/index.html', isMainFrame: true},
			allowedOrigins: ['app://renderer'],
			schema: cancelPromptRequest,
			payload,
			handler: () => {
				called = true;
				return null;
			},
		});
		t.false(result.ok);
		if (!result.ok) t.is(result.error.code, 'VALIDATION');
		t.false(called);
	}
});

for (const missing of ['supervisor', 'project', 'session'] as const) {
	test(`refuses technical cancellation without a main-owned ${missing}`, async t => {
		let called = false;
		const supervisor = {
			cancel: async () => {
				called = true;
			},
		};
		const error = await t.throwsAsync(
			() =>
				cancelTechnicalTurn(
					missing === 'supervisor' ? undefined : supervisor,
					missing === 'project' ? undefined : 'main-owned-project',
					missing === 'session' ? undefined : session,
				),
			{instanceOf: IpcFailure},
		);
		t.is(error?.code, 'AGENT_UNAVAILABLE');
		t.false(called);
	});
}

test('cancels only the main-owned project and session', async t => {
	const calls: string[][] = [];
	const result = await cancelTechnicalTurn(
		{
			cancel: async (projectId, sessionId) => {
				calls.push([projectId, sessionId]);
			},
		},
		'main-owned-project',
		session,
	);
	t.deepEqual(calls, [['main-owned-project', 'main-owned-session']]);
	t.is(result, null);
});

test('does not report cancellation complete before the supervisor settles', async t => {
	let finish!: () => void;
	let settled = false;
	const pending = new Promise<void>(resolve => {
		finish = resolve;
	});
	const result = cancelTechnicalTurn(
		{cancel: () => pending},
		'main-owned-project',
		session,
	).then(value => {
		settled = true;
		return value;
	});
	await Promise.resolve();
	t.false(settled);
	finish();
	t.is(await result, null);
});
