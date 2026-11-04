import test from 'ava';
import {connectNanocoder} from '@/main/nanocoder/acp-client';
import {
	clientInfo,
	createWorkFolder,
	requireCli,
	runtime,
	setupProject,
} from '@/main/nanocoder/fixtures/real-nanocoder';
import {trustDirectory} from '@/main/nanocoder/trust';

// The pinned build is bumped on purpose, so a change upstream that removes a feature
// a recorded decision relies on shows up here and not first in a release.
const folder = createWorkFolder('nd-upstream-');
test.before(requireCli);
test.after.always(folder.remove);

test('the pinned Nanocoder reports HTTP for client MCP servers, which browser control needs (DEC-47)', async t => {
	t.timeout(120_000);
	const {root, provider, env} = await setupProject(folder.work, 'mcp', []);
	await trustDirectory({runtime, root, env});
	const connection = await connectNanocoder({runtime, root, clientInfo, env});
	try {
		t.true(connection.agent.capabilities.mcp.http);
		t.false(connection.agent.capabilities.mcp.sse);
	} finally {
		await connection.close();
		await provider.close();
	}
});
