import {
	type ClientCapabilities,
	client,
	type Implementation,
	methods,
	PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';
import {describeAgent} from '@/main/nanocoder/capabilities';
import {type Exit, launchNanocoder, waitForExit} from '@/main/nanocoder/launch';
import {
	ProtocolViolation,
	protocolStream,
} from '@/main/nanocoder/protocol-stream';
import {StderrRing} from '@/main/nanocoder/stderr-ring';
import {type TrustRefusal, trustRefusal} from '@/main/nanocoder/trust';
import type {
	ConnectedAgent,
	NanocoderMode,
	NanocoderRuntime,
	SessionInfo,
} from '@/shared/ipc';

const INITIALIZE_TIMEOUT_MS = 60_000;
const SHUTDOWN_GRACE_MS = 5_000;
const NANOCODER_PREFIX = '[nanocoder] ';

// readTextFile is advertised (ACP-02); until ACP-11 the SDK answers it with method-not-found.
const CLIENT_CAPABILITIES: ClientCapabilities = {
	fs: {readTextFile: true, writeTextFile: false},
	terminal: false,
};

export class NanocoderFailure extends Error {
	constructor(
		readonly code: 'AGENT_UNAVAILABLE' | 'UNSUPPORTED',
		message: string,
		readonly trust?: TrustRefusal,
	) {
		super(message);
	}
}

export interface NanocoderConnection {
	readonly agent: ConnectedAgent;
	readonly stderr: StderrRing;
	readonly exited: Promise<Exit>;
	newSession(mode: NanocoderMode): Promise<SessionInfo>;
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

export function describeExit(exit: Exit): string {
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
		if (violated) {
			throw new NanocoderFailure(
				'AGENT_UNAVAILABLE',
				new ProtocolViolation().message,
			);
		}
		if (timedOut) {
			throw new NanocoderFailure(
				'AGENT_UNAVAILABLE',
				`Nanocoder did not answer within ${timeoutMs / 1000} seconds`,
			);
		}
		const own = nanocoderMessage(stderr.lines());
		throw new NanocoderFailure(
			'AGENT_UNAVAILABLE',
			own ?? describeExit(exit),
			own === undefined ? undefined : trustRefusal(own),
		);
	}

	if (response.protocolVersion !== PROTOCOL_VERSION) {
		await close();
		throw new NanocoderFailure(
			'UNSUPPORTED',
			`Nanocoder uses ACP protocol version ${response.protocolVersion}; this app supports version ${PROTOCOL_VERSION}`,
		);
	}

	const agent = describeAgent(options.root, response);

	// The session is handed out only once its mode is set, so nothing can prompt it before (DEC-31).
	const newSession = async (mode: NanocoderMode): Promise<SessionInfo> => {
		const created = await connection.agent
			.request(methods.agent.session.new, {cwd: options.root, mcpServers: []})
			.catch(() => {
				throw new NanocoderFailure(
					'AGENT_UNAVAILABLE',
					'Nanocoder could not start a session',
				);
			});
		const sessionId = created.sessionId;
		try {
			if (!created.modes?.availableModes.some(({id}) => id === mode)) {
				throw new NanocoderFailure(
					'UNSUPPORTED',
					`Nanocoder does not offer the ${mode} mode`,
				);
			}
			await connection.agent
				.request(methods.agent.session.setMode, {sessionId, modeId: mode})
				.catch(() => {
					throw new NanocoderFailure(
						'AGENT_UNAVAILABLE',
						`Nanocoder did not set the ${mode} mode`,
					);
				});
		} catch (error) {
			if (agent.capabilities.sessions.close) {
				await connection.agent
					.request(methods.agent.session.close, {sessionId})
					.catch(() => undefined);
			}
			throw error;
		}
		return {id: sessionId, mode};
	};

	return {agent, stderr, exited, newSession, close};
}
