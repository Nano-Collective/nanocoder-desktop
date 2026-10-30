import {untilAborted} from '@/main/nanocoder/abort';
import {
	type ConnectOptions,
	connectNanocoder,
	type NanocoderConnection,
	NanocoderFailure,
} from '@/main/nanocoder/acp-client';
import {type TrustRefusal, trustDirectory} from '@/main/nanocoder/trust';
import {createTrustPreflight} from '@/main/nanocoder/trust-preflight';
import {
	requiresTrustPreflight,
	versionPolicy,
} from '@/main/nanocoder/version-policy';
import type {
	NanocoderMode,
	NanocoderRuntime,
	SessionInfo,
	TurnEvent,
} from '@/shared/ipc';

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
	runtime: ConnectOptions['runtime'] &
		Partial<Pick<NanocoderRuntime, 'source' | 'version'>>;
	confirmTrust: (refusal: TrustRefusal) => Promise<boolean>;
	beforeLaunch?: () => Promise<void>;
}

const trustPreflight = createTrustPreflight();

export async function connectProject(
	options: ProjectOptions,
): Promise<NanocoderConnection | {status: 'untrusted'; message: string}> {
	const version = options.runtime.version;
	const provisional = requiresTrustPreflight(version ?? null);
	const reason = versionPolicy(version ?? null).reason;
	if (
		version &&
		(versionPolicy(version).status === 'refused' ||
			(provisional && options.runtime.source !== 'override'))
	)
		throw new NanocoderFailure(
			'UNSUPPORTED',
			reason ?? 'Nanocoder requires a verified development override',
		);
	const beforeLaunch = async () => {
		await options.beforeLaunch?.();
		options.signal?.throwIfAborted();
		if (provisional && version)
			return trustPreflight.verify(
				{...options.runtime, version},
				options.root,
				options.signal,
			);
		return options.runtime;
	};
	const connect = async () => {
		const runtime = await beforeLaunch();
		const connection = await connectNanocoder({...options, runtime});
		if (
			requiresTrustPreflight(connection.agent.version) &&
			(!provisional ||
				options.runtime.source !== 'override' ||
				connection.agent.version !== version)
		) {
			await connection.close();
			throw new NanocoderFailure(
				'UNSUPPORTED',
				'Nanocoder 1.31.x requires matching override version metadata and a verified ACP directory trust check',
			);
		}
		return connection;
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
		const runtime = await beforeLaunch();
		await trustDirectory({...options, runtime});
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
