import {readFileSync, watch} from 'node:fs';
import {createInterface} from 'node:readline';

let scenario = '';
try {
	scenario = readFileSync('.fake-nanocoder', 'utf8').trim();
} catch {}
let nextSession = 0;
let provider = 'a';
let model = 'old';
const send = body =>
	process.stdout.write(`${JSON.stringify({jsonrpc: '2.0', ...body})}\n`);
const config = () => [
	{
		id: 'provider',
		name: 'provider',
		type: 'select',
		category: 'model',
		currentValue: provider,
		options: [
			{name: 'a', value: 'a'},
			{name: 'b', value: 'b'},
		],
	},
	{
		id: 'model',
		name: 'model',
		type: 'select',
		category: 'model',
		currentValue: model,
		options: [
			{name: 'old', value: 'old'},
			{name: 'confirmed', value: 'confirmed'},
		],
	},
];
const modes = () => ({
	currentModeId: 'normal',
	availableModes: [
		'normal',
		'auto-accept',
		'yolo',
		'plan',
		'architect',
		'future',
	].map(id => ({id, name: id})),
});
const notifyConfig = sessionId =>
	send({
		method: 'session/update',
		params: {
			sessionId,
			update: {
				sessionUpdate: 'config_option_update',
				configOptions:
					scenario === 'config-notify-malformed'
						? [{...config()[1], currentValue: true}]
						: scenario === 'config-notify-malformed-mixed'
							? [config()[0], {...config()[1], currentValue: true}]
							: scenario === 'config-notify-empty'
								? []
								: config(),
			},
		},
	});
const failure = id =>
	send({id, error: {code: -32603, message: 'fixture refusal'}});
watch('.', {persistent: false}, (_event, name) => {
	if (name !== '.fake-control-notification' || !nextSession) return;
	model = 'confirmed';
	notifyConfig(`session-${nextSession}`);
});
createInterface({input: process.stdin}).on('line', line => {
	const {id, method, params} = JSON.parse(line);
	process.stderr.write(`${JSON.stringify({method, params})}\n`);
	if (method === 'initialize') {
		send({
			id,
			result: {
				protocolVersion: 1,
				agentInfo: {name: 'nanocoder', version: '9.9.9'},
				agentCapabilities: {sessionCapabilities: {resume: {}, close: {}}},
				authMethods: [],
			},
		});
	} else if (method === 'session/new') {
		send({
			id,
			result: {
				sessionId: `session-${++nextSession}`,
				modes: modes(),
				configOptions: config(),
			},
		});
	} else if (method === 'session/resume') {
		if (scenario === 'config-notify-replay') {
			model = 'confirmed';
			notifyConfig(params.sessionId);
			model = 'old';
		}
		send({id, result: {modes: modes(), configOptions: config()}});
	} else if (method === 'session/set_config_option') {
		if (params.configId === 'provider') {
			provider = params.value;
			model = 'confirmed';
		} else model = params.value;
		if (scenario === 'config-fails') failure(id);
		else send({id, result: {configOptions: config()}});
	} else if (
		method === 'session/set_mode' &&
		params.modeId === 'plan' &&
		scenario === 'live-mode-fails'
	) {
		failure(id);
	} else if (
		method === 'session/set_mode' &&
		params.modeId === 'plan' &&
		scenario === 'live-mode-waits'
	) {
		send({
			method: 'session/update',
			params: {
				sessionId: params.sessionId,
				update: {
					sessionUpdate: 'agent_message_chunk',
					content: {type: 'text', text: 'mode waiting'},
				},
			},
		});
	} else if (method === 'session/prompt') {
		if (
			scenario.startsWith('config-notify-') &&
			scenario !== 'config-notify-unprompted' &&
			scenario !== 'config-notify-close'
		) {
			model = 'confirmed';
			notifyConfig(
				scenario === 'config-notify-foreign'
					? 'foreign-session'
					: scenario === 'config-notify-old'
						? 'session-1'
						: params.sessionId,
			);
		}
		send({id, result: {stopReason: 'end_turn'}});
	} else if (
		scenario === 'config-notify-unprompted' &&
		method === '_renameSession'
	) {
		if (nextSession) {
			model = 'confirmed';
			notifyConfig(`session-${nextSession}`);
		}
		send({id, error: {code: -32601, message: 'fixture unsupported'}});
	} else if (scenario === 'config-notify-close' && method === 'session/close') {
		model = 'confirmed';
		notifyConfig(params.sessionId);
		send({id, result: {}});
	} else if (id !== undefined) send({id, result: {}});
});
