import {untilAborted} from '@/main/nanocoder/abort';
import {
	type ConnectOptions,
	connectNanocoder,
	type NanocoderConnection,
	NanocoderFailure,
} from '@/main/nanocoder/acp-client';
import {type TrustRefusal, trustDirectory} from '@/main/nanocoder/trust';
import type {NanocoderMode, SessionInfo, TurnEvent} from '@/shared/ipc';

export type OpenOutcome =
	| {
			status: 'open';
			connection: NanocoderConnection;
			session: SessionInfo;
			// What a resumed session replayed; empty for a new one.
			history: TurnEvent[];
	  }
	| {status: 'untrusted'; message: string};

interface ProjectOptions extends ConnectOptions {
	confirmTrust: (refusal: TrustRefusal) => Promise<boolean>;
	beforeLaunch?: () => Promise<void>;
}

export async function connectProject(
	options: ProjectOptions,
): Promise<NanocoderConnection | {status: 'untrusted'; message: string}> {
	const connect = async () => {
		await options.beforeLaunch?.();
		options.signal?.throwIfAborted();
		return connectNanocoder(options);
	};
	try {
		return await connect();
	} catch (error) {
		if (!(error instanceof NanocoderFailure) || !error.trust) throw error;
		options.signal?.throwIfAborted();
		const confirmation = options.confirmTrust(error.trust);
		const confirmed = options.signal
			? await untilAborted(confirmation, options.signal)
			: await confirmation;
		if (!confirmed) return {status: 'untrusted', message: error.message};
		options.signal?.throwIfAborted();
		await options.beforeLaunch?.();
		await trustDirectory(options);
		// A second refusal is reported, not asked about again.
		return connect();
	}
}

export async function openProject(
	options: ProjectOptions & {
		mode: NanocoderMode;
		// Resume this session instead of starting a new one.
		resumeSessionId?: string;
	},
): Promise<OpenOutcome> {
	const connection = await connectProject(options);
	if ('status' in connection) return connection;

	try {
		if (options.resumeSessionId) {
			const {session, history} = await connection.resumeSession(
				options.resumeSessionId,
				options.mode,
			);
			return {status: 'open', connection, session, history};
		}
		const session = await connection.newSession(options.mode);
		return {status: 'open', connection, session, history: []};
	} catch (error) {
		await connection.close();
		throw error;
	}
}
