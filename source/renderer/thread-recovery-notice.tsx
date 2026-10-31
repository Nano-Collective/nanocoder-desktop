import * as React from 'react';
import {recencyLabel} from '@/renderer/recency';
import {Button, Card} from '@/renderer/ui';
import type {ThreadInfo} from '@/shared/ipc';
import {REPLAY_MISSING_REASON} from '@/shared/thread-replay';

export interface ThreadRecoveryNoticeProps {
	thread: ThreadInfo;
	projectName?: string;
	pending: boolean;
	onRetry(): void;
	onNew(): void;
	onRemove(): void;
}

export function ThreadRecoveryNotice({
	thread,
	projectName,
	pending,
	onRetry,
	onNew,
	onRemove,
}: ThreadRecoveryNoticeProps): React.ReactElement | null {
	const missing = thread.runState === 'view-only';
	if (
		!thread.nanocoderSessionId ||
		(!missing && (thread.runState !== 'failed' || !thread.viewOnlyReason))
	)
		return null;
	if (!missing)
		return (
			<Card
				aria-label="thread recovery"
				className="thread-recovery-notice nc-failure-notice"
			>
				<p>
					<span aria-hidden="true">✕ </span>saved history could not be restored
				</p>
				<h2>{thread.title}</h2>
				<dl className="thread-recovery-metadata">
					<div>
						<dt>last active</dt>
						<dd>
							<time dateTime={thread.lastActivityAt}>
								{new Date(thread.lastActivityAt).toLocaleString()}
							</time>
						</dd>
					</div>
				</dl>
				<p>{thread.viewOnlyReason ?? REPLAY_MISSING_REASON}</p>
				{pending && (
					<p role="status">waiting for the thread request or native dialog</p>
				)}
				<Button disabled={pending} onClick={onRetry}>
					retry this thread
				</Button>
			</Card>
		);
	const when = recencyLabel(thread.lastActivityAt, new Date());
	return (
		<section className="thread-view-only" aria-label="view-only thread">
			<p className="workspace-eyebrow">thread metadata / history unavailable</p>
			<h2 className="thread-view-only-title">{thread.title}</h2>
			<div className="thread-view-only-notice">
				<p className="thread-view-only-status">
					<span aria-hidden="true">● </span>this thread is view-only
				</p>
				<p>
					Nanocoder could not find this session. its retention policy or a
					deletion outside the desktop may have removed it.
				</p>
				<p>
					there is no saved conversation to display. the desktop has the
					thread’s metadata only.
				</p>
			</div>
			<dl className="thread-recovery-metadata">
				{projectName && (
					<div>
						<dt>project</dt>
						<dd>{projectName}</dd>
					</div>
				)}
				<div>
					<dt>last activity</dt>
					<dd>
						<time dateTime={thread.lastActivityAt}>
							{when ?? 'unavailable'}
						</time>
					</dd>
				</div>
				<div>
					<dt>history</dt>
					<dd>not found by Nanocoder</dd>
				</div>
			</dl>
			{pending && (
				<p role="status">waiting for the thread request or native dialog</p>
			)}
			<div className="thread-recovery-actions">
				<Button
					className="thread-recovery-primary"
					disabled={pending}
					onClick={onNew}
				>
					start a new thread in this project
				</Button>
				<Button variant="reject" disabled={pending} onClick={onRemove}>
					remove from desktop
				</Button>
			</div>
			<p className="thread-recovery-note">
				remove affects desktop metadata only. deleting Nanocoder history is a
				separate, confirmed action.
			</p>
		</section>
	);
}

export function ViewOnlyFooter(): React.ReactElement {
	return (
		<p className="view-only-footer">
			<span aria-hidden="true">● </span>composer hidden. saved history is
			unavailable from Nanocoder. any messages still shown are held in memory in
			this window only. removing desktop metadata does not delete Nanocoder
			history.
		</p>
	);
}
