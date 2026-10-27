import {
	type ConnectOptions,
	connectNanocoder,
	type NanocoderConnection,
	NanocoderFailure,
} from '@/main/nanocoder/acp-client';
import {type TrustRefusal, trustDirectory} from '@/main/nanocoder/trust';
import type {NanocoderMode, SessionInfo} from '@/shared/ipc';

export type OpenOutcome =
	| {status: 'open'; connection: NanocoderConnection; session: SessionInfo}
	| {status: 'untrusted'; message: string};

export async function openProject(
	options: ConnectOptions & {
		mode: NanocoderMode;
		confirmTrust: (refusal: TrustRefusal) => Promise<boolean>;
	},
): Promise<OpenOutcome> {
	let connection: NanocoderConnection;
	try {
		connection = await connectNanocoder(options);
	} catch (error) {
		if (!(error instanceof NanocoderFailure) || !error.trust) throw error;
		if (!(await options.confirmTrust(error.trust))) {
			return {status: 'untrusted', message: error.message};
		}
		await trustDirectory(options);
		// A second refusal is reported, not asked about again, so a failed save cannot loop.
		connection = await connectNanocoder(options);
	}

	try {
		const session = await connection.newSession(options.mode);
		return {status: 'open', connection, session};
	} catch (error) {
		await connection.close();
		throw error;
	}
}
