import * as React from 'react';
import {Button, Card} from '@/renderer/ui';
import type {ThreadInfo} from '@/shared/ipc';
import {REPLAY_MISSING_REASON} from '@/shared/thread-replay';

export interface ThreadRecoveryNoticeProps {
	thread: ThreadInfo;
	pending: boolean;
	onRetry(): void;
	onNew(): void;
	onRemove(): void;
}

export function ThreadRecoveryNotice({
	thread,
	pending,
	onRetry,
	onNew,
	onRemove,
}: ThreadRecoveryNoticeProps) {
	const missing = thread.runState === 'view-only';
	if (
		!thread.nanocoderSessionId ||
		(!missing && (thread.runState !== 'failed' || !thread.viewOnlyReason))
	)
		return null;
	return (
		<Card
			aria-label={missing ? 'view-only thread' : 'thread recovery'}
			className={missing ? 'thread-view-only-notice' : ''}
			variant={missing ? 'default' : 'failure'}
		>
			<p>
				<span aria-hidden="true">{missing ? '◍' : '✕'}</span>{' '}
				{missing ? 'view-only' : 'saved history could not be restored'}
			</p>
			<p>{thread.title}</p>
			<p>
				last active{' '}
				<time dateTime={thread.lastActivityAt}>{thread.lastActivityAt}</time>
			</p>
			<p>{thread.viewOnlyReason ?? REPLAY_MISSING_REASON}</p>
			{pending && (
				<p role="status">waiting for the thread request or native dialog</p>
			)}
			{missing ? (
				<React.Fragment>
					<Button disabled={pending} onClick={onNew}>
						start a new thread in this project
					</Button>
					<Button disabled={pending} onClick={onRemove}>
						remove from desktop
					</Button>
				</React.Fragment>
			) : (
				<Button disabled={pending} onClick={onRetry}>
					retry this thread
				</Button>
			)}
		</Card>
	);
}
