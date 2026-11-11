import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import type {InitializeResponse} from '@agentclientprotocol/sdk';
import test from 'ava';
import {connectNanocoder} from '@/main/nanocoder/acp-client';
import {describeAgent} from '@/main/nanocoder/capabilities';
import {
	gatesFor,
	readRecord,
	recordPath,
} from '@/main/nanocoder/conformance/records';
import {
	clientInfo,
	createWorkFolder,
	requireCli,
	runtime,
	setupProject,
} from '@/main/nanocoder/fixtures/real-nanocoder';
import {trustDirectory} from '@/main/nanocoder/trust';

const folder = createWorkFolder('nd-conformance-real-');
test.before(requireCli);
test.after.always(folder.remove);

// Reads the answer straight off the wire, so the record does not depend on the client's own parsing.
function initializeAnswer(
	cwd: string,
	env: NodeJS.ProcessEnv,
): Promise<InitializeResponse> {
	return new Promise((resolve, reject) => {
		const child = spawn(runtime.nodePath, [runtime.cliPath, '--acp'], {
			cwd,
			env,
			stdio: ['pipe', 'pipe', 'ignore'],
			shell: false,
		});
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error('Nanocoder did not answer initialize'));
		}, 30_000);
		let buffer = '';
		child.stdout.on('data', chunk => {
			buffer += chunk;
			const end = buffer.indexOf('\n');
			if (end < 0) return;
			clearTimeout(timer);
			child.kill();
			try {
				resolve(JSON.parse(buffer.slice(0, end)).result);
			} catch (error) {
				reject(error);
			}
		});
		child.stdin.write(
			`${JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {protocolVersion: 1, clientCapabilities: {}, clientInfo},
			})}\n`,
		);
	});
}

test('the Nanocoder under test answers initialize as its recorded version did, and the desktop reads it the same way (ACP-03 ACP-04 ACP-21)', async t => {
	t.timeout(120_000);
	const {root, provider, env} = await setupProject(folder.work, 'record', []);
	t.teardown(() => provider.close());
	await trustDirectory({runtime, root, env});
	const answer = await initializeAnswer(root, env);
	const version = answer.agentInfo?.version;
	if (!version) return t.fail('Nanocoder reported no version');
	const record = {version, initialize: answer, gates: gatesFor(answer)};
	if (process.env.NANOCODER_RECORD_CONFORMANCE === '1') {
		writeFileSync(
			recordPath(version),
			`${JSON.stringify(record, null, '\t')}\n`,
		);
		t.log(`recorded ${recordPath(version)}`);
	} else {
		const kept = readRecord(version);
		// A build that is not a supported release (the Nanocoder main check) only reports a difference.
		const strict = process.env.NANOCODER_CONFORMANCE_STRICT === '1';
		if (!kept) {
			const message = `No conformance record for Nanocoder ${version}. Review its answer, then run NANOCODER_RECORD_CONFORMANCE=1 pnpm test:acp and commit the file.`;
			if (strict) return t.fail(message);
			t.log(message);
		} else if (strict) {
			t.deepEqual(
				answer,
				kept.initialize,
				`Nanocoder ${version} answers initialize differently from its record`,
			);
			t.deepEqual(record.gates, kept.gates);
		} else {
			t.log(
				JSON.stringify({
					version,
					sameAnswer:
						JSON.stringify(answer) === JSON.stringify(kept.initialize),
					sameGates:
						JSON.stringify(record.gates) === JSON.stringify(kept.gates),
				}),
			);
		}
	}
	const connection = await connectNanocoder({runtime, root, env, clientInfo});
	t.teardown(() => connection.close());
	t.deepEqual(connection.agent, describeAgent(root, answer));
});
