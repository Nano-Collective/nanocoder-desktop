import type {ChildProcess} from 'node:child_process';
import {
	type ClientCapabilities,
	client,
	type Implementation,
	methods,
	PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';
import {describeAgent} from '@/main/nanocoder/capabilities';
import {launchNanocoder} from '@/main/nanocoder/launch';
import {
	ProtocolViolation,
	protocolStream,
} from '@/main/nanocoder/protocol-stream';
import {StderrRing} from '@/main/nanocoder/stderr-ring';
import type {ConnectedAgent, NanocoderRuntime} from '@/shared/ipc';

const INITIALIZE_TIMEOUT_MS = 60_000;
const SHUTDOWN_GRACE_MS = 5_000;
const NANOCODER_PREFIX = '[nanocoder] ';

// readTextFile is advertised (ACP-02); until ACP-11 the SDK answers it with method-not-found.
const CLIENT_CAPABILITIES: ClientCapabilities = {
	fs: {readTextFile: true, writeTextFile: false},
	terminal: false,
};

export interface Exit {
	code: number | null;
	signal: NodeJS.Signals | null;
}

export class ConnectFailure extends Error {
	constructor(
		readonly code: 'AGENT_UNAVAILABLE' | 'UNSUPPORTED',
		message: string,
	) {
		super(message);
	}
}

export interface NanocoderConnection {
	readonly agent: ConnectedAgent;
	readonly stderr: StderrRing;
	readonly exited: Promise<Exit>;
	close(): Promise<void>;
}

export interface ConnectOptions {
	runtime: Pick<NanocoderRuntime, 'nodePath' | 'cliPath'>;
	root: string;
	clientInfo: Implementation;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
	initializeTimeoutMs?: number;
}

function waitForExit(child: ChildProcess): Promise<Exit> {
	return new Promise(resolve => {
		const done = () =>
			resolve(
				child.pid === undefined
					? {code: null, signal: null}
					: {code: child.exitCode, signal: child.signalCode},
			);
		child.once('close', done);
		child.once('error', done);
	});
}

function describeExit(exit: Exit): string {
	if (exit.signal) {
		return `Nanocoder stopped before it was ready (signal ${exit.signal})`;
	}
	if (exit.code !== null) {
		return `Nanocoder stopped before it was ready (exit code ${exit.code})`;
	}
	return 'Nanocoder could not start';
}

export function nanocoderMessage(lines: readonly string[]): string | undefined {
	return lines
		.filter(line => line.startsWith(NANOCODER_PREFIX))
		.at(-1)
		?.slice(NANOCODER_PREFIX.length);
}

export async function connectNanocoder(
	options: ConnectOptions,
): Promise<NanocoderConnection> {
	const child = launchNanocoder(
		options.runtime,
		['--acp'],
		options.root,
		options.env,
	);
	const exited = waitForExit(child);
	const stderr = new StderrRing({homeDir: options.homeDir});
	let violated = false;

	// EPIPE after Nanocoder exits is reported through the exit, not as a crash.
	child.stdin.on('error', () => {});
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk: string) => stderr.write(chunk));
	child.stderr.on('end', () => stderr.flush());

	const connection = client({name: options.clientInfo.name}).connect(
		protocolStream(child.stdout, child.stdin, line => {
			violated = true;
			stderr.append(`[stdout] ${line}`);
			child.kill();
		}),
	);

	const close = async (): Promise<void> => {
		child.stdin.end();
		connection.close();
		const timer = setTimeout(() => child.kill(), SHUTDOWN_GRACE_MS);
		await exited;
		clearTimeout(timer);
	};

	const timeoutMs = options.initializeTimeoutMs ?? INITIALIZE_TIMEOUT_MS;
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		connection.close();
	}, timeoutMs);
	const response = await connection.agent
		.request(methods.agent.initialize, {
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: CLIENT_CAPABILITIES,
			clientInfo: options.clientInfo,
		})
		.catch(() => undefined);
	clearTimeout(timer);

	if (!response) {
		await close();
		stderr.flush();
		const exit = await exited;
		let message: string;
		if (violated) {
			message = new ProtocolViolation().message;
		} else if (timedOut) {
			message = `Nanocoder did not answer within ${timeoutMs / 1000} seconds`;
		} else {
			message = nanocoderMessage(stderr.lines()) ?? describeExit(exit);
		}
		throw new ConnectFailure('AGENT_UNAVAILABLE', message);
	}

	if (response.protocolVersion !== PROTOCOL_VERSION) {
		await close();
		throw new ConnectFailure(
			'UNSUPPORTED',
			`Nanocoder uses ACP protocol version ${response.protocolVersion}; this app supports version ${PROTOCOL_VERSION}`,
		);
	}

	return {
		agent: describeAgent(options.root, response),
		stderr,
		exited,
		close,
	};
}
