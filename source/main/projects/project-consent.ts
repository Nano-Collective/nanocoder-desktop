import type {MessageBoxOptions} from 'electron';
import {IpcFailure} from '@/main/ipc/handle-request';
import {untilAborted} from '@/main/nanocoder/abort';
import type {TrustRefusal} from '@/main/nanocoder/trust';
import {readTrustSummary} from '@/main/projects/trust-summary';

interface ConsentOptions {
	root: string;
	refusal: TrustRefusal;
	signal: AbortSignal;
	ask(options: MessageBoxOptions): Promise<number>;
}

export async function confirmProjectTrust(
	options: ConsentOptions,
): Promise<boolean> {
	const {root, refusal, signal} = options;
	signal.throwIfAborted();
	const summary = await untilAborted(readTrustSummary(root), signal);
	signal.throwIfAborted();
	const response = await untilAborted(
		options.ask({
			type: 'question',
			title: {
				'not-trusted': 'trust this project folder?',
				changed: 'trust this changed folder?',
				'needs-re-approval': 'approve this folder again?',
			}[refusal.reason],
			message: refusal.summary,
			detail: [
				`canonical root · resolved folder\n${root}`,
				summary.details,
				'trusting this folder allows project-defined code to run on this computer.',
			].join('\n\n'),
			buttons: ['trust folder and open', 'cancel'],
			defaultId: 1,
			cancelId: 1,
			noLink: true,
		}),
		signal,
	);
	signal.throwIfAborted();
	if (response !== 0) return false;
	const current = await untilAborted(readTrustSummary(root), signal);
	signal.throwIfAborted();
	if (current.fingerprint !== summary.fingerprint)
		throw new IpcFailure(
			'DENIED',
			'Project declarations changed while asking for trust; review and try again',
		);
	return true;
}
