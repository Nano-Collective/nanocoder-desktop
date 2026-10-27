// Stands in for `nanocoder --acp` in tests. A .fake-nanocoder file in the working directory picks the behaviour.
import {existsSync, readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';

const mode = existsSync('.fake-nanocoder')
	? readFileSync('.fake-nanocoder', 'utf8').trim()
	: 'ok';

const send = message =>
	process.stdout.write(`${JSON.stringify({jsonrpc: '2.0', ...message})}\n`);

function answer(request) {
	if (mode === 'echo') {
		process.stderr.write(`${JSON.stringify(request.params)}\n`);
	}
	send({
		id: request.id,
		result: {
			protocolVersion: mode === 'future' ? 2 : 1,
			agentCapabilities: {
				loadSession: true,
				providers: {},
				sessionCapabilities: {close: {}, list: {}, delete: {}, resume: {}},
			},
			agentInfo: {name: 'nanocoder', title: 'Nanocoder', version: '9.9.9'},
			authMethods: [],
		},
	});
}

if (mode === 'refuse') {
	process.stderr.write('(node:1) Warning: an unrelated warning\n');
	process.stderr.write(
		`[nanocoder] Directory ${process.cwd()} is not trusted. Pass --trust-directory to bypass the disclaimer for this run only, or set NANOCODER_TRUST_DIRECTORY=1 to trust this directory permanently.\n`,
	);
	process.exitCode = 1;
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
} else {
	if (mode === 'garbage') {
		process.stdout.write('Starting Nanocoder...\n');
	}
	createInterface({input: process.stdin})
		.on('line', line => {
			const message = JSON.parse(line);
			if (message.method === 'initialize' && mode !== 'silent') {
				answer(message);
			}
		})
		.on('close', () => process.exit(0));
}
