import {
	type ClientCapabilities,
	client,
	type Implementation,
	methods,
	PROTOCOL_VERSION,
	RequestError,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type ResumeSessionResponse,
	type SessionNotification,
} from '@agentclientprotocol/sdk';
import {describeAgent} from '@/main/nanocoder/capabilities';
import {type Exit, launchNanocoder, waitForExit} from '@/main/nanocoder/launch';
import {
	ProtocolViolation,
	protocolStream,
} from '@/main/nanocoder/protocol-stream';
import {redact, StderrRing} from '@/main/nanocoder/stderr-ring';
import {type TrustRefusal, trustRefusal} from '@/main/nanocoder/trust';
import {toTurnEvent} from '@/main/nanocoder/turn-events';
import type {
	ConnectedAgent,
	NanocoderMode,
	NanocoderRuntime,
	SessionInfo,
	TurnEvent,
	TurnResult,
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
		readonly code: 'AGENT_UNAVAILABLE' | 'UNSUPPORTED' | 'NOT_FOUND',
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
	resumeSession(
		sessionId: string,
		mode: NanocoderMode,
	): Promise<ResumedSession>;
	deleteSession(sessionId: string): Promise<void>;
	prompt(sessionId: string, text: string): Promise<TurnResult>;
	close(): Promise<void>;
}

export interface ResumedSession {
	session: SessionInfo;
	// What Nanocoder replayed, oldest first. Replayed tool calls are finished history (ACP-07).
	history: TurnEvent[];
}

export interface ConnectOptions {
	runtime: Pick<NanocoderRuntime, 'nodePath' | 'cliPath'>;
	root: string;
	clientInfo: Implementation;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
	initializeTimeoutMs?: number;
	onUpdate?: (update: SessionNotification['update']) => void;
	// Without it, every permission request is answered as cancelled: nothing is allowed by default.
	onPermission?: (
		request: RequestPermissionRequest,
	) => Promise<RequestPermissionResponse>;
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

// Nanocoder answers a missing session with an internal error that says so in `data.details`.
function missingSession(error: unknown): NanocoderFailure | undefined {
	const details =
		error instanceof RequestError
			? (error.data as {details?: unknown} | undefined)?.details
			: undefined;
	return typeof details === 'string' && details.startsWith('Session not found')
		? new NanocoderFailure(
				'NOT_FOUND',
				"Nanocoder no longer has this session. It was deleted, or removed by Nanocoder's retention settings.",
			)
		: undefined;
}

function failedToResume(): NanocoderFailure {
	return new NanocoderFailure(
		'AGENT_UNAVAILABLE',
		'Nanocoder could not resume the session',
	);
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

	// Set while session/resume replays history, so replayed updates are not shown as new activity.
	let replay: SessionNotification['update'][] | undefined;

	const connection = client({name: options.clientInfo.name})
		.onRequest(methods.client.session.requestPermission, ({params}) =>
			options.onPermission
				? options.onPermission(params)
				: {outcome: {outcome: 'cancelled'}},
		)
		.onNotification(methods.client.session.update, ({params}) => {
			if (replay) replay.push(params.update);
			else options.onUpdate?.(params.update);
		})
		.connect(
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
		const trust = own === undefined ? undefined : trustRefusal(own);
		// Nanocoder's advice to pass --trust-directory does not apply here: the desktop records trust itself.
		throw new NanocoderFailure(
			'AGENT_UNAVAILABLE',
			trust?.summary ?? own ?? describeExit(exit),
			trust,
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

	const closeQuietly = async (sessionId: string) => {
		if (!agent.capabilities.sessions.close) return;
		await connection.agent
			.request(methods.agent.session.close, {sessionId})
			.catch(() => undefined);
	};

	// A session is handed out only once its mode is set, so nothing can prompt it before (DEC-31).
	const applyMode = async (
		sessionId: string,
		mode: NanocoderMode,
		availableModes: ReadonlyArray<{id: string}> | undefined,
	): Promise<void> => {
		try {
			if (!availableModes?.some(({id}) => id === mode)) {
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
			await closeQuietly(sessionId);
			throw error;
		}
	};

	const newSession = async (mode: NanocoderMode): Promise<SessionInfo> => {
		const created = await connection.agent
			.request(methods.agent.session.new, {cwd: options.root, mcpServers: []})
			.catch(() => {
				throw new NanocoderFailure(
					'AGENT_UNAVAILABLE',
					'Nanocoder could not start a session',
				);
			});
		await applyMode(created.sessionId, mode, created.modes?.availableModes);
		return {id: created.sessionId, mode};
	};

	// Nanocoder resumes a session in the working directory it saved, and starts it in auto-accept.
	const resumeSession = async (
		sessionId: string,
		mode: NanocoderMode,
	): Promise<ResumedSession> => {
		if (!agent.capabilities.sessions.resume) {
			throw new NanocoderFailure(
				'UNSUPPORTED',
				'This version of Nanocoder cannot resume sessions',
			);
		}
		const replayed: SessionNotification['update'][] = [];
		replay = replayed;
		let resumed: ResumeSessionResponse;
		try {
			resumed = await connection.agent.request(methods.agent.session.resume, {
				sessionId,
				cwd: options.root,
				mcpServers: [],
			});
			// Replayed updates are handled in the same turn of the event loop as the answer.
			await new Promise(resolve => setImmediate(resolve));
		} catch (error) {
			throw missingSession(error) ?? failedToResume();
		} finally {
			replay = undefined;
		}
		await applyMode(sessionId, mode, resumed.modes?.availableModes);
		return {
			session: {id: sessionId, mode},
			history: replayed.flatMap(update => toTurnEvent(update) ?? []),
		};
	};

	const deleteSession = async (sessionId: string): Promise<void> => {
		if (!agent.capabilities.sessions.delete) {
			throw new NanocoderFailure(
				'UNSUPPORTED',
				'This version of Nanocoder cannot delete sessions',
			);
		}
		await connection.agent
			.request(methods.agent.session.delete, {sessionId})
			.catch(() => {
				throw new NanocoderFailure(
					'AGENT_UNAVAILABLE',
					'Nanocoder could not delete the session',
				);
			});
	};

	const prompt = async (
		sessionId: string,
		text: string,
	): Promise<TurnResult> => {
		const response = await connection.agent
			.request(methods.agent.session.prompt, {
				sessionId,
				prompt: [{type: 'text', text}],
			})
			.catch((error: unknown) => {
				// An error answer means Nanocoder is still running; anything else is the connection going.
				throw new NanocoderFailure(
					'AGENT_UNAVAILABLE',
					error instanceof RequestError
						? `Nanocoder could not finish the turn: ${redact(error.message, options.homeDir)}`
						: 'Nanocoder stopped during the turn',
				);
			});
		return {stopReason: response.stopReason};
	};

	return {
		agent,
		stderr,
		exited,
		newSession,
		resumeSession,
		deleteSession,
		prompt,
		close,
	};
}
