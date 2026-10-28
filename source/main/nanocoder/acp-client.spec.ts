import path from 'node:path';
import test from 'ava';
import {
	type ConnectOptions,
	connectNanocoder,
	describeExit,
	NanocoderFailure,
	nanocoderMessage,
} from '@/main/nanocoder/acp-client';
import {
	fakeEvents,
	fakeProject,
	fakeRuntime,
	removeFakeProjects,
} from '@/main/nanocoder/fixtures/fake-project';

function connect(root: string, options: Partial<ConnectOptions> = {}) {
	return connectNanocoder({
		runtime: fakeRuntime,
		root,
		clientInfo: {name: 'nanocoder-desktop', version: '0.0.0-test'},
		...options,
	});
}

async function rejection(promise: Promise<unknown>) {
	const error = await promise.then(
		() => undefined,
		(error: unknown) => error,
	);
	if (!(error instanceof NanocoderFailure)) {
		throw new Error(`Expected a NanocoderFailure, got ${String(error)}`);
	}
	return error;
}

const failure = (root: string, options?: Partial<ConnectOptions>) =>
	rejection(connect(root, options));

test.after.always(removeFakeProjects);

test('records the protocol version, agent version and capabilities', async t => {
	const root = fakeProject();
	const connection = await connect(root);
	t.deepEqual(connection.agent, {
		root,
		protocolVersion: 1,
		name: 'nanocoder',
		version: '9.9.9',
		capabilities: {
			loadSession: true,
			sessions: {close: true, delete: true, list: true, resume: true},
			prompt: {image: false, audio: false, embeddedContext: false},
			mcp: {http: false, sse: false},
		},
	});
	await connection.close();
	t.deepEqual(await connection.exited, {code: 0, signal: null});
});

test('starts Nanocoder in the project root with read-only capabilities', async t => {
	const connection = await connect(fakeProject());
	await connection.close();
	const initialize = fakeEvents(connection.stderr.lines()).find(
		event => event.method === 'initialize',
	);
	t.deepEqual(initialize?.params, {
		protocolVersion: 1,
		clientCapabilities: {
			fs: {readTextFile: true, writeTextFile: false},
			terminal: false,
		},
		clientInfo: {name: 'nanocoder-desktop', version: '0.0.0-test'},
	});
});

test("shows Nanocoder's own message when it refuses the folder", async t => {
	const root = fakeProject('refuse');
	const error = await failure(root, {homeDir: path.dirname(root)});
	const folder = `~${path.sep}${path.basename(root)}`;
	t.is(error.code, 'AGENT_UNAVAILABLE');
	t.is(error.message, `Directory ${folder} is not trusted.`);
	t.deepEqual(error.trust, {
		reason: 'not-trusted',
		summary: `Directory ${folder} is not trusted.`,
	});
});

test('tells a changed folder apart from an untrusted one', async t => {
	const error = await failure(fakeProject('changed'));
	t.is(error.trust?.reason, 'changed');
});

test('redacts secrets in the message', async t => {
	const error = await failure(fakeProject('leak'));
	t.is(error.message, 'ACP initialization failed: Authorization: [redacted]');
	t.is(error.trust, undefined);
});

test('falls back to the exit code when Nanocoder leaves no message', async t => {
	const error = await failure(fakeProject('crash'));
	t.is(error.message, 'Nanocoder stopped before it was ready (exit code 3)');
});

test('reports a runtime that cannot start', async t => {
	const error = await failure(fakeProject(), {
		runtime: {
			...fakeRuntime,
			nodePath: path.join(path.dirname(fakeRuntime.cliPath), 'no-such-node'),
		},
	});
	t.is(error.message, 'Nanocoder could not start');
});

test('ends the connection when stdout carries anything but ACP', async t => {
	const error = await failure(fakeProject('garbage'));
	t.is(
		error.message,
		'Nanocoder wrote something other than ACP to standard output',
	);
});

test('refuses another ACP protocol version', async t => {
	const error = await failure(fakeProject('future'));
	t.is(error.code, 'UNSUPPORTED');
	t.is(
		error.message,
		'Nanocoder uses ACP protocol version 2; this app supports version 1',
	);
});

test('gives up when Nanocoder does not answer', async t => {
	const error = await failure(fakeProject('silent'), {
		initializeTimeoutMs: 200,
	});
	t.is(error.message, 'Nanocoder did not answer within 0.2 seconds');
});

test('opens a session at the project root and sets its mode before handing it out', async t => {
	const root = fakeProject();
	const connection = await connect(root);
	const session = await connection.newSession('normal');
	await connection.close();
	t.deepEqual(session, {id: 'fake-session', mode: 'normal'});
	const requests = fakeEvents(connection.stderr.lines()).filter(
		event => event.method,
	);
	t.deepEqual(
		requests.map(event => event.method),
		['initialize', 'session/new', 'session/set_mode'],
	);
	t.like(requests[1].params, {cwd: root, mcpServers: []});
	t.deepEqual(requests[2].params, {
		sessionId: 'fake-session',
		modeId: 'normal',
	});
});

test('never sends a mode Nanocoder does not offer', async t => {
	const connection = await connect(fakeProject('no-normal'));
	const error = await rejection(connection.newSession('normal'));
	await connection.close();
	t.is(error.code, 'UNSUPPORTED');
	t.is(error.message, 'Nanocoder does not offer the normal mode');
	const methods = fakeEvents(connection.stderr.lines()).map(e => e.method);
	t.false(methods.includes('session/set_mode'));
	t.true(methods.includes('session/close'));
});

test('closes the session when its mode cannot be set', async t => {
	const connection = await connect(fakeProject('mode-fails'));
	const error = await rejection(connection.newSession('normal'));
	await connection.close();
	t.is(error.message, 'Nanocoder did not set the normal mode');
	const methods = fakeEvents(connection.stderr.lines()).map(e => e.method);
	t.true(methods.includes('session/close'));
});

test('reports a session Nanocoder could not start', async t => {
	const connection = await connect(fakeProject('no-session'));
	const error = await rejection(connection.newSession('normal'));
	await connection.close();
	t.is(error.message, 'Nanocoder could not start a session');
});

async function turn(
	mode: string | undefined,
	answer: string | undefined,
	prompt = 'Run it.',
) {
	const asked: string[] = [];
	const updates: string[] = [];
	const connection = await connect(fakeProject(mode), {
		onUpdate: update => updates.push(update.sessionUpdate),
		onPermission: answer
			? async request => {
					asked.push(request.toolCall.title ?? '');
					return {outcome: {outcome: 'selected', optionId: answer}};
				}
			: undefined,
	});
	const session = await connection.newSession('normal');
	const result = await connection.prompt(session.id, prompt).then(
		value => value,
		(error: unknown) => error,
	);
	await connection.close();
	return {
		asked,
		updates,
		result,
		events: fakeEvents(connection.stderr.lines()),
	};
}

test('sends the prompt and returns how the turn ended', async t => {
	const {asked, updates, result, events} = await turn(
		undefined,
		'allow',
		'Hi there',
	);
	t.deepEqual(result, {stopReason: 'end_turn'});
	t.deepEqual(asked, ['execute_bash: echo hi']);
	t.deepEqual(updates, [
		'agent_message_chunk',
		'tool_call',
		'tool_call_update',
		'agent_message_chunk',
	]);
	const prompt = events.find(event => event.method === 'session/prompt');
	t.deepEqual(prompt?.params, {
		sessionId: 'fake-session',
		prompt: [{type: 'text', text: 'Hi there'}],
	});
});

test('passes the answer on exactly as chosen', async t => {
	const allow = await turn(undefined, 'allow');
	const deny = await turn(undefined, 'deny');
	t.deepEqual(allow.events.find(e => e.answer)?.answer, {
		outcome: 'selected',
		optionId: 'allow',
	});
	t.deepEqual(deny.events.find(e => e.answer)?.answer, {
		outcome: 'selected',
		optionId: 'deny',
	});
});

test('answers as cancelled when nothing is there to ask', async t => {
	const {result, events} = await turn(undefined, undefined);
	t.deepEqual(result, {stopReason: 'cancelled'});
	t.deepEqual(events.find(e => e.answer)?.answer, {outcome: 'cancelled'});
});

test('reports a Nanocoder that stops during the turn', async t => {
	const {result} = await turn('die-in-turn', 'allow');
	t.true(result instanceof NanocoderFailure);
	t.is((result as Error).message, 'Nanocoder stopped during the turn');
});

test('tells an error Nanocoder reports apart from Nanocoder stopping', async t => {
	const root = fakeProject('prompt-error');
	const connection = await connect(root, {homeDir: path.dirname(root)});
	const session = await connection.newSession('normal');
	const error = await rejection(connection.prompt(session.id, 'Hi'));
	const stillRunning = await Promise.race([
		connection.exited.then(() => false),
		new Promise<boolean>(resolve => setTimeout(resolve, 200, true)),
	]);
	await connection.close();
	t.true(stillRunning);
	t.is(
		error.message,
		`Nanocoder could not finish the turn: Provider failed for ~${path.sep}${path.basename(root)}`,
	);
});

test('describes how Nanocoder stopped', t => {
	t.is(
		describeExit({code: null, signal: 'SIGKILL'}),
		'Nanocoder stopped before it was ready (signal SIGKILL)',
	);
	t.is(
		describeExit({code: 2, signal: null}),
		'Nanocoder stopped before it was ready (exit code 2)',
	);
	t.is(describeExit({code: null, signal: null}), 'Nanocoder could not start');
});

test("picks Nanocoder's own line out of other stderr output", t => {
	t.is(
		nanocoderMessage([
			'(node:1) Warning: something',
			'[nanocoder] first',
			'[nanocoder] second',
			'    at main (cli.js:1:1)',
		]),
		'second',
	);
	t.is(nanocoderMessage(['plain output']), undefined);
});
