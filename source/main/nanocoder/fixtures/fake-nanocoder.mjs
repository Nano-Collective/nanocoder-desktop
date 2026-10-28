// Stands in for `nanocoder --acp` in tests. A .fake-nanocoder file in the working directory picks the behaviour.
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';

const mode = existsSync('.fake-nanocoder')
	? readFileSync('.fake-nanocoder', 'utf8').trim()
	: 'ok';
const MODES = ['normal', 'auto-accept', 'yolo', 'plan', 'architect'];
const TRUST_REASONS = {
	untrusted: 'is not trusted',
	changed: 'changed since you trusted it',
};

const log = event => process.stderr.write(`${JSON.stringify(event)}\n`);
const send = message =>
	process.stdout.write(`${JSON.stringify({jsonrpc: '2.0', ...message})}\n`);

function refuse(reason) {
	process.stderr.write(
		`[nanocoder] Directory ${process.cwd()} ${reason}. Pass --trust-directory to bypass the disclaimer for this run only, or set NANOCODER_TRUST_DIRECTORY=1 to trust this directory permanently.\n`,
	);
	process.exitCode = 1;
}

const results = {
	initialize: () => ({
		protocolVersion: mode === 'future' ? 2 : 1,
		agentCapabilities: {
			loadSession: true,
			providers: {},
			sessionCapabilities: {close: {}, list: {}, delete: {}, resume: {}},
		},
		agentInfo: {name: 'nanocoder', title: 'Nanocoder', version: '9.9.9'},
		authMethods: [],
	}),
	'session/new': () =>
		mode === 'no-session'
			? undefined
			: {
					sessionId: 'fake-session',
					modes: {
						currentModeId: 'auto-accept',
						availableModes: MODES.filter(
							id => mode !== 'no-normal' || id !== 'normal',
						).map(id => ({id, name: id})),
					},
				},
	'session/set_mode': () => (mode === 'mode-fails' ? undefined : {}),
	'session/close': () => ({}),
};

const waiting = new Map();
let nextId = 1000;
const notify = (method, params) => send({method, params});
const ask = (method, params) =>
	new Promise(resolve => {
		const id = nextId++;
		waiting.set(id, resolve);
		send({id, method, params});
	});

const OPTIONS = [
	{optionId: 'allow', name: 'Allow', kind: 'allow_once'},
	{optionId: 'deny', name: 'Deny', kind: 'reject_once'},
];
const say = (sessionId, text) =>
	notify('session/update', {
		sessionId,
		update: {
			sessionUpdate: 'agent_message_chunk',
			content: {type: 'text', text},
		},
	});
const tool = (sessionId, toolCallId, update) =>
	notify('session/update', {
		sessionId,
		update: {sessionUpdate: 'tool_call_update', toolCallId, ...update},
	});

// One turn: some text, protected tool calls that wait for the client's answers, more text.
async function runTurn(id, {sessionId}) {
	if (mode === 'die-in-turn') process.exit(3);
	if (mode === 'prompt-error') {
		send({
			id,
			error: {code: -32603, message: `Provider failed for ${process.cwd()}`},
		});
		return;
	}
	say(sessionId, 'Working on it. ');
	const calls = mode === 'two-tools' ? ['call_1', 'call_2'] : ['call_1'];
	const title = toolCallId => `execute_bash: echo ${toolCallId}`;
	for (const toolCallId of calls) {
		notify('session/update', {
			sessionId,
			update: {
				sessionUpdate: 'tool_call',
				toolCallId,
				title: calls.length > 1 ? title(toolCallId) : 'execute_bash: echo hi',
				status: 'pending',
			},
		});
	}
	const answers = await Promise.all(
		calls.map(toolCallId =>
			ask('session/request_permission', {
				sessionId,
				toolCall: {
					toolCallId,
					title: calls.length > 1 ? title(toolCallId) : 'execute_bash: echo hi',
					status: 'pending',
				},
				options: OPTIONS,
			}),
		),
	);
	log({answer: answers[0].outcome});
	if (answers.some(({outcome}) => outcome.outcome !== 'selected')) {
		for (const toolCallId of calls)
			tool(sessionId, toolCallId, {status: 'failed'});
		send({id, result: {stopReason: 'cancelled'}});
		return;
	}
	const allowed = answers.map(({outcome}) => outcome.optionId === 'allow');
	calls.forEach((toolCallId, index) =>
		tool(sessionId, toolCallId, {
			status: allowed[index] ? 'completed' : 'failed',
		}),
	);
	say(
		sessionId,
		calls.length > 1
			? 'Both answered.'
			: allowed[0]
				? 'Tool ran.'
				: 'Tool denied.',
	);
	send({id, result: {stopReason: 'end_turn'}});
}

function serve() {
	if (mode === 'garbage') {
		process.stdout.write('Starting Nanocoder...\n');
	}
	createInterface({input: process.stdin})
		.on('line', line => {
			const {id, method, params, result: answered} = JSON.parse(line);
			if (method === undefined) {
				waiting.get(id)?.(answered);
				waiting.delete(id);
				return;
			}
			log({method, params});
			if (method === 'session/prompt') {
				void runTurn(id, params);
				return;
			}
			if (id === undefined || (method === 'initialize' && mode === 'silent')) {
				return;
			}
			const result = results[method]?.();
			send(
				result === undefined
					? {id, error: {code: -32603, message: 'Internal error'}}
					: {id, result},
			);
		})
		.on('close', () => process.exit(0));
}

log({started: true, trustEnv: process.env.NANOCODER_TRUST_DIRECTORY ?? null});

if (mode === 'refuse') {
	process.stderr.write('(node:1) Warning: an unrelated warning\n');
	refuse(TRUST_REASONS.untrusted);
} else if (mode in TRUST_REASONS && !existsSync('.fake-trusted')) {
	if (process.env.NANOCODER_TRUST_DIRECTORY === '1') {
		writeFileSync('.fake-trusted', '');
		serve();
	} else {
		refuse(TRUST_REASONS[mode]);
	}
} else if (mode === 'leak') {
	process.stderr.write(
		'[nanocoder] ACP initialization failed: Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz\n',
	);
	process.exitCode = 1;
} else if (mode === 'crash') {
	process.stderr.write(
		'TypeError: something broke\n    at main (cli.js:1:1)\n',
	);
	process.exitCode = 3;
} else if (mode === 'hang') {
	setInterval(() => {}, 1000);
} else {
	serve();
}
