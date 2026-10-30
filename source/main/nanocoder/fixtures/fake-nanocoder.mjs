// Stands in for `nanocoder --acp` in tests. A .fake-nanocoder file in the working directory picks the behaviour.
import {createHash, randomUUID} from 'node:crypto';
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
let nextSession = 0;
const scopedSessions = process.env.NANOCODER_TEST_SCOPED_SESSIONS === '1';
const sessionPrefix = `fake-session-${createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12)}`;

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
		agentCapabilities:
			mode === 'no-gates' || mode === 'minimum-no-gates'
				? {}
				: {
						loadSession: true,
						providers: {},
						sessionCapabilities: {
							...(mode === 'no-close' ? {} : {close: {}}),
							list: {},
							...(mode === 'no-delete' ? {} : {delete: {}}),
							...(mode === 'no-resume' ? {} : {resume: {}}),
						},
					},
		agentInfo: {
			name: 'nanocoder',
			title: 'Nanocoder',
			version:
				mode === 'old-version'
					? '1.30.0'
					: mode === 'minimum-version' || mode === 'minimum-no-gates'
						? '1.32.0'
						: '9.9.9',
		},
		authMethods: [],
	}),
	'session/new': () =>
		mode === 'no-session'
			? undefined
			: {
					sessionId: scopedSessions
						? `${sessionPrefix}-${randomUUID()}`
						: mode === 'multiple-sessions'
							? `fake-session-${++nextSession}`
							: 'fake-session',
					modes: modeState(),
				},
	'session/set_mode': () => (mode === 'mode-fails' ? undefined : {}),
	'session/close': () => ({}),
	'session/delete': () => (mode === 'delete-fails' ? undefined : {}),
};

const modeState = () => ({
	currentModeId: 'auto-accept',
	availableModes: MODES.filter(
		id => mode !== 'no-normal' || id !== 'normal',
	).map(id => ({id, name: id})),
});

// Replays an earlier exchange, as Nanocoder does, then answers with the mode state.
function resume(id, {sessionId}) {
	if (mode === 'die-in-resume') process.exit(3);
	const knownSession = scopedSessions
		? typeof sessionId === 'string' &&
			sessionId.startsWith(`${sessionPrefix}-`) &&
			/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
				sessionId.slice(sessionPrefix.length + 1),
			)
		: sessionId === 'fake-session';
	if (!knownSession || mode === 'missing-session') {
		send({
			id,
			error: {
				code: -32603,
				message: 'Internal error',
				data: {details: `Session not found on disk: ${sessionId}`},
			},
		});
		return;
	}
	if (mode === 'resume-fails') {
		send({id, error: {code: -32603, message: 'Internal error'}});
		return;
	}
	const update = body => notify('session/update', {sessionId, update: body});
	update({
		sessionUpdate: 'user_message_chunk',
		content: {type: 'text', text: 'Earlier question'},
	});
	update({
		sessionUpdate: 'agent_message_chunk',
		content: {type: 'text', text: 'Earlier answer'},
	});
	update({
		sessionUpdate: 'tool_call',
		toolCallId: 'old_call',
		title: 'execute_bash: echo old',
		status: 'completed',
	});
	send({id, result: {modes: modeState()}});
}

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
const permissionOptions =
	mode === 'all-permissions'
		? [
				{optionId: 'allow', name: 'Allow once', kind: 'allow_once'},
				{optionId: 'allow-always', name: 'Allow always', kind: 'allow_always'},
				{optionId: 'deny', name: 'Reject once', kind: 'reject_once'},
				{optionId: 'deny-always', name: 'Reject all', kind: 'reject_always'},
			]
		: mode === 'ask-user'
			? [
					{optionId: 'answer-0', name: 'First choice', kind: 'allow_once'},
					{optionId: 'answer-1', name: 'Second choice', kind: 'allow_once'},
				]
			: OPTIONS;
const cancellations = new Map();
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

async function streamFixture(id, sessionId) {
	const update = body => notify('session/update', {sessionId, update: body});
	update({
		sessionUpdate: 'available_commands_update',
		availableCommands: [
			{
				name: '/review',
				description: 'review fixture changes',
				input: {hint: 'focus'},
			},
		],
	});
	update({
		sessionUpdate: 'agent_thought_chunk',
		content: {type: 'text', text: 'checking the scripted fixture'},
	});
	update({
		sessionUpdate: 'tool_call',
		toolCallId: 'subagent:fixture',
		title: 'fixture tool',
		kind: 'execute',
		status: 'in_progress',
		content: [
			{type: 'content', content: {type: 'text', text: 'fixture tool detail'}},
		],
		rawInput: {fixture: true},
	});
	say(
		sessionId,
		'# streamed fixture\n\n[fixture link](https://fixture.invalid) ![fixture image](https://fixture.invalid/image)\n\n<script>fixture</script>\n\n',
	);
	await new Promise(resolve => {
		let index = 0;
		const started = performance.now();
		const period = 1000 / 105;
		const tick = () => {
			const due = Math.min(
				300,
				Math.floor((performance.now() - started) / period),
			);
			while (index < due) say(sessionId, `item ${++index}\n\n`);
			if (index === 300) resolve();
			else
				setTimeout(
					tick,
					Math.max(0, started + (index + 1) * period - performance.now()),
				);
		};
		tick();
	});
	tool(sessionId, 'subagent:fixture', {title: 'fixture tool finished'});
	tool(sessionId, 'subagent:fixture', {status: 'completed'});
	update({
		sessionUpdate: 'usage_update',
		used: 1250,
		size: 10000,
		cost: {amount: 0.5, currency: 'USD'},
	});
	send({
		id,
		result: {
			stopReason: 'end_turn',
			usage: {inputTokens: 100, outputTokens: 300, totalTokens: 400},
			_meta: {
				'nanocoder/usage': {cost: 0.01, privatePayload: 'synthetic-private'},
				unknown: 'synthetic-private',
			},
		},
	});
}

let subagentTurn = 0;
async function subagentFixture(id, {sessionId, prompt}) {
	const text = prompt
		.filter(part => part.type === 'text')
		.map(part => part.text)
		.join('');
	const update = body => notify('session/update', {sessionId, update: body});
	const turn = ++subagentTurn;
	const roots = text.includes('two')
		? [`delegate-${turn}-1`, `delegate-${turn}-2`]
		: [`delegate-${turn}-1`];
	const fallback = text.includes('fallback');
	for (const toolCallId of roots) {
		update({
			sessionUpdate: 'tool_call',
			toolCallId,
			title: fallback ? 'agent' : 'explore: inspect fixture',
			kind: 'think',
			status: 'pending',
			rawInput: fallback
				? {}
				: {
						subagent_type: 'explore',
						description: 'inspect fixture',
						prompt: 'private fixture task',
					},
		});
		tool(sessionId, toolCallId, {status: 'in_progress'});
		if (!fallback)
			tool(sessionId, toolCallId, {
				title: 'explore • 1.2k tokens • 3 tools (read_file)',
			});
	}
	if (text.includes('fast')) {
		for (const root of roots) tool(sessionId, root, {status: 'completed'});
		send({id, result: {stopReason: 'end_turn'}});
		return;
	}
	let cancelled = false;
	const cancellation = new Promise(resolve =>
		cancellations.set(sessionId, () => {
			cancelled = true;
			resolve();
		}),
	);
	try {
		if (text.includes('no approval') || fallback) {
			await cancellation;
			send({id, result: {stopReason: 'cancelled'}});
			return;
		}
		const calls = roots.map((_, index) => `subagent:inner-${turn}-${index}`);
		const answers = await Promise.all(
			calls.map(toolCallId => {
				const title = 'execute_bash fixture (explore)';
				update({
					sessionUpdate: 'tool_call',
					toolCallId,
					title,
					kind: 'execute',
					status: 'pending',
				});
				return ask('session/request_permission', {
					sessionId,
					toolCall: {toolCallId, title, status: 'pending'},
					options: OPTIONS,
				});
			}),
		);
		if (
			cancelled ||
			answers.some(answer => answer.outcome.outcome !== 'selected')
		) {
			send({id, result: {stopReason: 'cancelled'}});
			return;
		}
		calls.forEach((call, index) =>
			tool(sessionId, call, {
				status:
					answers[index].outcome.optionId === 'allow' ? 'completed' : 'failed',
			}),
		);
		for (const root of roots)
			tool(sessionId, root, {
				status: text.includes('failure') ? 'failed' : 'completed',
			});
		say(sessionId, 'fixture delegation settled');
		send({id, result: {stopReason: 'end_turn'}});
	} finally {
		cancellations.delete(sessionId);
	}
}

// One turn: some text, protected tool calls that wait for the client's answers, more text.
async function runTurn(id, params) {
	const {sessionId} = params;
	if (mode === 'die-in-turn') process.exit(3);
	if (mode === 'streaming') return streamFixture(id, sessionId);
	if (mode === 'subagents') return subagentFixture(id, params);
	if (mode === 'reported-usage') {
		say(sessionId, 'Reported usage fixture.');
		send({
			id,
			result: {
				stopReason: 'end_turn',
				usage: {inputTokens: 12, outputTokens: 8, totalTokens: 20},
				_meta: {
					'nanocoder/usage': {cost: 0.01, privatePayload: 'synthetic-private'},
				},
			},
		});
		return;
	}
	if (mode === 'prompt-error') {
		send({
			id,
			error: {code: -32603, message: `Provider failed for ${process.cwd()}`},
		});
		return;
	}
	say(sessionId, 'Working on it. ');
	if (mode === 'wait-for-cancel') {
		await new Promise(resolve => cancellations.set(sessionId, resolve));
		cancellations.delete(sessionId);
		send({id, result: {stopReason: 'cancelled'}});
		return;
	}
	const calls = mode === 'two-tools' ? ['call_1', 'call_2'] : ['call_1'];
	const title = toolCallId =>
		mode === 'ask-user'
			? 'Which fixture option?'
			: calls.length > 1
				? `execute_bash: echo ${toolCallId}`
				: 'execute_bash: echo hi';
	for (const toolCallId of calls) {
		notify('session/update', {
			sessionId,
			update: {
				sessionUpdate: 'tool_call',
				toolCallId,
				title: title(toolCallId),
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
					title: title(toolCallId),
					status: 'pending',
				},
				options: permissionOptions,
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
	const allowed = answers.map(({outcome}) =>
		permissionOptions
			.find(option => option.optionId === outcome.optionId)
			?.kind.startsWith('allow'),
	);
	calls.forEach((toolCallId, index) =>
		tool(sessionId, toolCallId, {
			status: allowed[index] ? 'completed' : 'failed',
			...(mode === 'all-permissions' || mode === 'ask-user'
				? {title: `selected ${answers[index].outcome.optionId}`}
				: {}),
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
			if (
				[
					'renameSession',
					'_renameSession',
					'timeline/list',
					'_timeline/list',
				].includes(method)
			) {
				if (mode === 'silent-probes') return;
				if (mode === 'ambiguous-probes') {
					send({id, error: {code: -32603, message: 'Internal error'}});
					return;
				}
				if (mode === 'successful-probes') {
					send({id, result: {}});
					return;
				}
				const bare = method.replace(/^_/, '');
				const supported =
					(mode === 'extensions' && !method.startsWith('_')) ||
					mode === 'prefixed-extensions';
				send({
					id,
					error: supported
						? {
								code: -32603,
								message: 'Internal error',
								data: {
									details:
										bare === 'renameSession'
											? 'renameSession requires string sessionId and title params'
											: 'timeline/list requires a string sessionId',
								},
							}
						: {code: -32601, message: 'Method not found'},
				});
				return;
			}
			if (method === 'session/set_mode' && mode === 'slow-mode') {
				say(params.sessionId, 'mode waiting');
				return;
			}
			if (
				(method === 'session/new' && mode === 'slow-new') ||
				(method === 'session/resume' && mode === 'slow-resume')
			) {
				say('fake-session', `${method} waiting`);
				return;
			}
			if (method === 'session/prompt') {
				void runTurn(id, params);
				return;
			}
			if (method === 'session/cancel') {
				cancellations.get(params.sessionId)?.();
				return;
			}
			if (method === 'session/resume') {
				resume(id, params);
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
		.on('close', () => {
			if (mode === 'multiple-sessions') log({stdinClosed: true});
			if (mode !== 'ignore-shutdown') process.exit(0);
		});
}

log({
	started: true,
	pid: process.pid,
	cwd: process.cwd(),
	trustEnv: process.env.NANOCODER_TRUST_DIRECTORY ?? null,
});

if (mode === 'ignore-shutdown') {
	process.on('SIGTERM', () => {});
	setInterval(() => {}, 1000);
}

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
