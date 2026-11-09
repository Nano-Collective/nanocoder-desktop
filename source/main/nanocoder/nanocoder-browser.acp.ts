import test from 'ava';
import {connectNanocoder} from '@/main/nanocoder/acp-client';
import {
	clientInfo,
	createWorkFolder,
	requireCli,
	runtime,
	setupProject,
} from '@/main/nanocoder/fixtures/real-nanocoder';
import type {ChatRequest} from '@/main/nanocoder/fixtures/scripted-provider';
import {trustDirectory} from '@/main/nanocoder/trust';

const folder = createWorkFolder('nd-nanocoder-browser-');
test.before(requireCli);
test.after.always(folder.remove);

const toolNames = (request: ChatRequest | undefined): string[] =>
	(request?.tools ?? []).flatMap(tool => {
		const name = (tool as {function?: {name?: unknown}}).function?.name;
		return typeof name === 'string' ? [name] : [];
	});

async function sessionTools(name: string, disabled: string[], resume: boolean) {
	const {root, provider, env} = await setupProject(folder.work, name, [
		{text: 'first'},
		{text: 'second'},
	]);
	await trustDirectory({runtime, root, env});
	const connect = () =>
		connectNanocoder({
			runtime,
			root,
			clientInfo,
			env,
			disabledTools: () => disabled,
		});
	let connection = await connect();
	try {
		const session = await connection.newSession('auto-accept');
		await connection.prompt(session.id, 'first');
		if (resume) {
			await connection.close();
			connection = await connect();
			await connection.resumeSession(session.id, 'auto-accept');
			await connection.prompt(session.id, 'second');
		}
		return provider.requests
			.filter(request => (request.tools ?? []).length > 0)
			.map(toolNames);
	} finally {
		await connection.close();
		await provider.close();
	}
}

test("the pinned Nanocoder confirms its own browser tool off and leaves it out of the model's tools, on new and resumed sessions (BRW-18 DEC-48)", async t => {
	t.timeout(120_000);
	const turns = await sessionTools('off', ['browser'], true);
	t.is(turns.length, 2);
	for (const tools of turns) {
		t.true(tools.length > 0);
		t.false(tools.includes('browser'));
	}
});

test('with the setting on, the pinned Nanocoder offers its own browser tool (BRW-18)', async t => {
	t.timeout(120_000);
	const [tools] = await sessionTools('on', [], false);
	t.true(tools?.includes('browser'));
});
