import {appendFileSync, existsSync, readFileSync, watch} from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline';

const behaviour = readFileSync(
	new URL('./preflight-behaviour', import.meta.url),
	'utf8',
).trim();
const refusal = `[nanocoder] Directory ${process.cwd()} is not trusted. Pass --trust-directory to bypass the disclaimer for this run only, or set NANOCODER_TRUST_DIRECTORY=1 to trust this directory permanently.\n`;
const audit = value =>
	appendFileSync(
		new URL('./preflight-audit', import.meta.url),
		`${JSON.stringify(value)}\n`,
	);
audit({
	kind: 'launch',
	isolated: path.basename(process.cwd()).startsWith('nd-trust-check-root-'),
	trust: process.env.NANOCODER_TRUST_DIRECTORY === '1',
});
if (behaviour === 'refuse') {
	process.stderr.write(refusal);
	process.exitCode = 1;
} else if (behaviour === 'unknown') {
	process.stderr.write('[nanocoder] unrelated startup error\n');
	process.exitCode = 1;
} else if (behaviour === 'wrong-root') {
	process.stderr.write(refusal.replace(process.cwd(), '/different-root'));
	process.exitCode = 1;
} else if (behaviour === 'wrong-exit') {
	process.stderr.write(refusal);
	process.exitCode = 3;
} else if (behaviour === 'exit') {
	process.exitCode = 0;
} else if (behaviour === 'silent-one') {
	process.exitCode = 1;
} else if (behaviour === 'truncated') {
	process.stderr.write(`${'x'.repeat(8192)}\n${refusal}`);
	process.exitCode = 1;
} else if (behaviour === 'refusal-stall') {
	process.stderr.write(refusal);
	setInterval(() => {}, 1000);
} else if (behaviour === 'refusal-late-output') {
	const release = new URL('./preflight-release', import.meta.url);
	const watcher = watch(new URL('./', import.meta.url), () => {
		if (!existsSync(release)) return;
		watcher.close();
		process.stdout.write('late unguarded output\n');
		process.exitCode = 1;
	});
	process.stderr.write(refusal);
} else if (behaviour === 'timeout') {
	process.stderr.write('fixture waiting\n');
	setInterval(() => {}, 1000);
} else if (behaviour === 'non-acp') {
	process.stdout.write('not an ACP frame\n');
	process.stderr.write(refusal);
	process.exitCode = 1;
} else if (behaviour === 'whitespace') {
	process.stdout.write(' \n');
	process.stderr.write(refusal);
	process.exitCode = 1;
} else {
	createInterface({input: process.stdin}).on('line', line => {
		const request = JSON.parse(line);
		audit({kind: 'request', session: request.method.startsWith('session/')});
		process.stdout.write(
			`${JSON.stringify({jsonrpc: '2.0', id: request.id, result: {protocolVersion: 1, agentInfo: {name: 'nanocoder', version: '1.31.0'}, agentCapabilities: {sessionCapabilities: {close: {}}}}})}\n`,
		);
	});
}
