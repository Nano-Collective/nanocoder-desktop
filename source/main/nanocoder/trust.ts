import {launchNanocoder, waitForExit} from '@/main/nanocoder/launch';
import type {NanocoderRuntime} from '@/shared/ipc';

const TRUST_TIMEOUT_MS = 60_000;

export type TrustReason = 'not-trusted' | 'changed' | 'needs-re-approval';

export interface TrustRefusal {
	reason: TrustReason;
	summary: string;
}

const REASONS: Record<string, TrustReason> = {
	'is not trusted': 'not-trusted',
	'changed since you trusted it': 'changed',
	'needs re-approval after the upgrade': 'needs-re-approval',
};

// Every startup failure exits with code 1, so the wording is the only signal (nanocoder#1899).
const REFUSAL =
	/^(Directory .+? (is not trusted|changed since you trusted it|needs re-approval after the upgrade))\./;

export function trustRefusal(message: string): TrustRefusal | undefined {
	const match = REFUSAL.exec(message);
	return match
		? {reason: REASONS[match[2]], summary: `${match[1]}.`}
		: undefined;
}

// Its exit status is not checked: the launch that follows reports any problem.
export async function trustDirectory(options: {
	runtime: Pick<NanocoderRuntime, 'nodePath' | 'cliPath'>;
	root: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	signal?: AbortSignal;
}): Promise<void> {
	options.signal?.throwIfAborted();
	const child = launchNanocoder(
		options.runtime,
		['--acp'],
		options.root,
		options.env,
		{trustDirectory: true},
	);
	const exited = waitForExit(child);
	child.stdin.on('error', () => {});
	child.stdin.end();
	child.stdout.resume();
	child.stderr.resume();
	const abort = () => child.kill();
	const forceAbort = () => {
		child.kill('SIGKILL');
		child.stdout.destroy();
		child.stderr.destroy();
	};
	options.signal?.addEventListener('abort', abort, {once: true});
	const timer = setTimeout(abort, options.timeoutMs ?? TRUST_TIMEOUT_MS);
	const kill = setTimeout(
		forceAbort,
		(options.timeoutMs ?? TRUST_TIMEOUT_MS) + 5_000,
	);
	// An aborted trust launch must not retain its normal one-minute timeout.
	options.signal?.addEventListener('abort', forceAbort, {once: true});
	await exited;
	clearTimeout(timer);
	clearTimeout(kill);
	options.signal?.removeEventListener('abort', abort);
	options.signal?.removeEventListener('abort', forceAbort);
	options.signal?.throwIfAborted();
}
