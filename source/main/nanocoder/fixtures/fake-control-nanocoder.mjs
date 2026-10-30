import {readFileSync} from 'node:fs';
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
const failure = id =>
	send({id, error: {code: -32603, message: 'fixture refusal'}});
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
		send({id, result: {stopReason: 'end_turn'}});
	} else if (id !== undefined) send({id, result: {}});
});
