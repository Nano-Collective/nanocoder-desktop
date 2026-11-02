import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {connectNanocoder} from '@/main/nanocoder/acp-client';
import {
	clientInfo,
	createWorkFolder,
	requireCli,
	runtime,
	setupProject,
} from '@/main/nanocoder/fixtures/real-nanocoder';
import {PermissionBroker} from '@/main/nanocoder/permissions';
import {trustDirectory} from '@/main/nanocoder/trust';
import {toTurnEvent} from '@/main/nanocoder/turn-events';
import type {PermissionRequestInfo, TurnEvent} from '@/shared/ipc';

const folder = createWorkFolder('nd-subagents-acp-');
test.before(requireCli);
test.after.always(folder.remove);

for (const action of ['allow', 'deny', 'cancel'] as const) {
	test(`real delegation has polled progress and a name-attributed ${action} path (SUB-01/02/03/04)`, async t => {
		t.timeout(120_000);
		const {root, provider, env} = await setupProject(folder.work, action, [
			{
				toolCall: {
					name: 'agent',
					arguments: {
						subagent_type: 'fixture',
						description: 'inspect fixture',
						prompt: 'perform the fixture command',
					},
				},
			},
			{
				toolCall: {
					name: 'execute_bash',
					arguments: {command: 'echo fixture>marker.txt'},
				},
			},
			{text: 'fixture child finished'},
			{text: 'fixture parent finished'},
		]);
		const agents = path.join(root, '.nanocoder/agents');
		mkdirSync(agents, {recursive: true});
		writeFileSync(
			path.join(agents, 'fixture.md'),
			'---\nname: fixture\ndescription: synthetic ACP fixture\nmodel: inherit\ntools:\n  - execute_bash\n---\nPerform the scripted fixture command.\n',
		);
		const events: TurnEvent[] = [];
		let pending: PermissionRequestInfo | undefined;
		let polled = false;
		let acted = false;
		let sessionId = '';
		let cancelOperation: Promise<void> | undefined;
		const maybeAnswer = () => {
			if (!pending || !polled || acted) return;
			acted = true;
			if (action === 'cancel') {
				cancelOperation = connection.cancel(sessionId);
				broker.cancelAll();
			} else t.true(broker.answer(pending.id, action));
		};
		const broker = new PermissionBroker(event => {
			events.push(event);
			if (event.type === 'permission') pending = event.request;
			maybeAnswer();
		});
		await trustDirectory({runtime, root, env});
		const connection = await connectNanocoder({
			runtime,
			root,
			env,
			clientInfo,
			onPermission: request => broker.request(request),
			onUpdate: update => {
				const event = toTurnEvent(update);
				if (event) events.push(event);
				if (event?.type === 'tool' && event.title?.includes(' tokens'))
					polled = true;
				maybeAnswer();
			},
		});
		try {
			sessionId = (await connection.newSession('normal')).id;
			const result = await connection.prompt(
				sessionId,
				'Delegate the synthetic fixture.',
			);
			await cancelOperation;
			t.true(acted);
			t.true(polled);
			t.true(
				events.some(
					event =>
						event.type === 'tool' && event.delegation?.role === 'fixture',
				),
			);
			t.is(pending?.source?.kind, 'subagent');
			t.true(pending?.source?.toolCallId.startsWith('subagent:'));
			t.regex(pending?.title ?? '', /\(fixture\)$/);
			t.is(existsSync(path.join(root, 'marker.txt')), action === 'allow');
			t.is(result.stopReason, action === 'cancel' ? 'cancelled' : 'end_turn');
			if (action === 'allow')
				t.true(
					events.some(
						event =>
							event.type === 'tool' &&
							event.approvalOnly &&
							event.status === 'completed',
					),
				);
		} finally {
			broker.cancelAll();
			await connection.close();
			await provider.close();
		}
	});
}
