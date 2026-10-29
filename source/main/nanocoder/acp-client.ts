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
import {
	describeAgent,
	type ExtensionProbes,
} from '@/main/nanocoder/capabilities';
import {type Exit, launchNanocoder, waitForExit} from '@/main/nanocoder/launch';
import {
	ProtocolViolation,
	protocolStream,
} from '@/main/nanocoder/protocol-stream';
import {
	type SessionTitleChange,
	sessionTitle,
} from '@/main/nanocoder/session-title';
import {redact, StderrRing} from '@/main/nanocoder/stderr-ring';
import {type TrustRefusal, trustRefusal} from '@/main/nanocoder/trust';
import {toTurnEvent} from '@/main/nanocoder/turn-events';
import {parsePromptMetadata} from '@/main/nanocoder/turn-metadata';
import type {
	ConnectedAgent,
	NanocoderMode,
	NanocoderRuntime,
	SessionInfo,
	StreamMetadata,
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
	renameSession(sessionId: string, title: string): Promise<string>;
	prompt(sessionId: string, text: string): Promise<NanocoderTurnResult>;
	cancel(sessionId: string): Promise<void>;
	probeExtensions(): Promise<ExtensionProbes>;
	close(): Promise<void>;
}

export interface NanocoderTurnResult extends TurnResult {
	metadata?: StreamMetadata;
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
	stderr?: StderrRing;
	initializeTimeoutMs?: number;
	shutdownGraceMs?: number;
	probeTimeoutMs?: number;
	signal?: AbortSignal;
	onUpdate?: (update: SessionNotification['update']) => void;
	onSessionUpdate?: (notification: SessionNotification) => void;
	onTitleChanged?: (change: SessionTitleChange) => void;
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
	options.signal?.throwIfAborted();
	const child = launchNanocoder(
		options.runtime,
		['--acp'],
		options.root,
		options.env,
	);
	const exited = waitForExit(child);
	const stderr = options.stderr ?? new StderrRing({homeDir: options.homeDir});
	let violated = false;

	// EPIPE after Nanocoder exits is reported through the exit, not as a crash.
	child.stdin.on('error', () => {});
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk: string) => stderr.write(chunk));
	child.stderr.on('end', () => stderr.flush());

	// Set while session/resume replays history, so replayed updates are not shown as new activity.
	let replay: SessionNotification['update'][] | undefined;
	const readySessions = new Set<string>();
	const activePrompts = new Set<Promise<unknown>>();
	let canCloseSession = false;

	const connection = client({name: options.clientInfo.name})
		.onRequest(methods.client.session.requestPermission, ({params}) =>
			options.onPermission
				? options.onPermission(params)
				: {outcome: {outcome: 'cancelled'}},
		)
		.onNotification(methods.client.session.update, ({params}) => {
			if (replay) replay.push(params.update);
			else {
				options.onUpdate?.(params.update);
				options.onSessionUpdate?.(params);
			}
		})
		.onNotification(
			'_nanocoder/sessionTitleChanged',
			sessionTitle,
			({params}) => {
				if (params) options.onTitleChanged?.(params);
			},
		)
		.connect(
			protocolStream(child.stdout, child.stdin, line => {
				violated = true;
				stderr.append(`[stdout] ${line}`);
				child.kill();
			}),
		);

	const closeQuietly = async (sessionId: string) => {
		if (!canCloseSession) return;
		await connection.agent
			.request(methods.agent.session.close, {sessionId})
			.catch(() => undefined);
	};

	let closing: Promise<void> | undefined;
	const close = (): Promise<void> => {
		closing ??= (async () => {
			const grace = options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS;
			const terminate = () => {
				connection.close();
				child.stdin.end();
				child.kill();
			};
			const timer = setTimeout(terminate, grace);
			const kill = setTimeout(() => {
				child.kill('SIGKILL');
				child.stdin.destroy();
				child.stdout.destroy();
				child.stderr.destroy();
			}, grace * 2);
			await Promise.all([...readySessions].map(closeQuietly));
			await Promise.allSettled([...activePrompts]);
			readySessions.clear();
			child.stdin.end();
			connection.close();
			await exited;
			clearTimeout(timer);
			clearTimeout(kill);
		})();
		return closing;
	};
	const abort = () => {
		void close();
	};
	options.signal?.addEventListener('abort', abort, {once: true});
	void exited.then(() => options.signal?.removeEventListener('abort', abort));

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
	canCloseSession = agent.capabilities.sessions.close;

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
		readySessions.add(created.sessionId);
		return {id: created.sessionId, mode};
	};

	// The project root is sent, but Nanocoder ignores it and resumes in the directory it saved (the desktop
	// only creates sessions at the root, DEC-30), then starts the session in auto-accept.
	const resumeSession = async (
		sessionId: string,
		mode: NanocoderMode,
	): Promise<ResumedSession> => {
		if (mode === 'yolo') mode = 'normal';
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
		readySessions.add(sessionId);
		return {
			session: {id: sessionId, mode},
			history: replayed.flatMap(
				update => toTurnEvent(update, {history: true}) ?? [],
			),
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
		readySessions.delete(sessionId);
	};

	const prompt = async (
		sessionId: string,
		text: string,
	): Promise<NanocoderTurnResult> => {
		if (!readySessions.has(sessionId) || closing) {
			throw new NanocoderFailure(
				'AGENT_UNAVAILABLE',
				'The session cannot accept a prompt until its mode is set',
			);
		}
		const pending = connection.agent
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
		activePrompts.add(pending);
		try {
			const response = await pending;
			const metadata = parsePromptMetadata(response);
			return {
				stopReason: response.stopReason,
				...(metadata ? {metadata} : {}),
			};
		} finally {
			activePrompts.delete(pending);
		}
	};

	let renameMethod: string | undefined;
	const renameSession = async (
		sessionId: string,
		title: string,
	): Promise<string> => {
		if (!renameMethod)
			throw new NanocoderFailure(
				'UNSUPPORTED',
				'Session rename is unavailable',
			);
		const change = sessionTitle({sessionId, title});
		if (!change)
			throw new NanocoderFailure(
				'UNSUPPORTED',
				'Choose a non-empty, bounded title',
			);
		try {
			const response: unknown = await connection.agent.request(
				renameMethod,
				change,
			);
			const renamed = sessionTitle({
				sessionId: change.sessionId,
				title:
					typeof response === 'object' &&
					response !== null &&
					'title' in response
						? response.title
						: undefined,
			});
			if (!renamed) throw new Error();
			return renamed.title;
		} catch (error) {
			throw (
				missingSession(error) ??
				new NanocoderFailure(
					'AGENT_UNAVAILABLE',
					'Nanocoder could not rename the session',
				)
			);
		}
	};
	const probeExtensions = async (): Promise<ExtensionProbes> => {
		const probe = async (
			name: string,
			expected: string,
		): Promise<string | undefined> => {
			for (const method of [`_${name}`, name]) {
				try {
					// No session ID or title: the pinned implementation refuses before any I/O.
					await connection.agent.request(method, {});
					return undefined;
				} catch (error) {
					if (!(error instanceof RequestError)) return undefined;
					const details = (error.data as {details?: unknown} | undefined)
						?.details;
					if (error.code === -32602 || details === expected) return method;
					if (
						error.code !== -32601 &&
						details !== `Unknown extension method: ${method}`
					)
						return undefined;
				}
			}
			return undefined;
		};
		let timer: ReturnType<typeof setTimeout> | undefined;
		const probes = Promise.all([
			probe(
				'renameSession',
				'renameSession requires string sessionId and title params',
			),
			probe('timeline/list', 'timeline/list requires a string sessionId'),
		]).then(([rename, timeline]) => ({rename, timeline}));
		try {
			const result = await Promise.race([
				probes,
				new Promise<undefined>(resolve => {
					timer = setTimeout(
						() => resolve(undefined),
						options.probeTimeoutMs ?? 2_000,
					);
				}),
			]);
			renameMethod = result?.rename;
			return {rename: !!result?.rename, timeline: !!result?.timeline};
		} finally {
			clearTimeout(timer);
		}
	};

	return {
		agent,
		stderr,
		exited,
		newSession,
		resumeSession,
		deleteSession,
		renameSession,
		prompt,
		cancel: sessionId =>
			connection.agent.notify(methods.agent.session.cancel, {sessionId}),
		probeExtensions,
		close,
	};
}
