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

function serve() {
	if (mode === 'garbage') {
		process.stdout.write('Starting Nanocoder...\n');
	}
	createInterface({input: process.stdin})
		.on('line', line => {
			const {id, method, params} = JSON.parse(line);
			log({method, params});
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
