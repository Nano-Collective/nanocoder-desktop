import * as React from 'react';
import {Button} from '@/renderer/ui';
import type {ThreadInfo} from '@/shared/ipc';

export interface ArchivesDialogProps {
	threads: readonly ThreadInfo[];
	projectName: string | undefined;
	now: Date;
	pending: boolean;
	onUnarchive(threadId: string): void;
}

export function archivedAge(lastActivityAt: string, now: Date): string {
	const elapsed = now.getTime() - Date.parse(lastActivityAt);
	if (Number.isNaN(elapsed)) return 'time unknown';
	const days = Math.floor(elapsed / 86400000);
	if (days < 1) return 'today';
	if (days === 1) return '1 day ago';
	if (days < 7) return `${days} days ago`;
	const weeks = Math.floor(days / 7);
	return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
}

export function ArchivesDialogBody({
	threads,
	projectName,
	now,
	pending,
	onUnarchive,
}: ArchivesDialogProps): React.ReactElement {
	const root = React.useRef<HTMLDivElement>(null);
	const rows = threads.length;
	// Disabling the clicked button drops focus, so move it to a neighbouring row.
	const focusIndex = React.useRef<number | null>(null);
	React.useLayoutEffect(() => {
		if (pending || focusIndex.current === null) return;
		const index = focusIndex.current;
		focusIndex.current = null;
		if (rows === 0) {
			root.current
				?.closest('dialog')
				?.querySelector<HTMLButtonElement>('.dialog-close')
				?.focus();
			return;
		}
		root.current
			?.querySelectorAll('button')
			[Math.min(index, rows - 1)]?.focus();
	}, [pending, rows]);
	return (
		<div ref={root}>
			<p>
				desktop metadata only. restoring a row does not select, resume or send
				to Nanocoder.
			</p>
			{rows === 0 ? (
				<p>no archived threads</p>
			) : (
				<ol className="archives-dialog-list" aria-label="archived threads">
					{threads.map((thread, index) => (
						<li key={thread.id} className="archives-dialog-row">
							<span className="archives-dialog-text">
								<span className="archives-dialog-title">{thread.title}</span>
								<span className="archives-dialog-meta">
									{[projectName, archivedAge(thread.lastActivityAt, now)]
										.filter(Boolean)
										.join(' · ')}
								</span>
							</span>
							<Button
								aria-label={`unarchive ${thread.title}`}
								disabled={pending}
								onClick={() => {
									focusIndex.current = index;
									onUnarchive(thread.id);
								}}
							>
								unarchive
							</Button>
						</li>
					))}
				</ol>
			)}
		</div>
	);
}

export function ArchivesDialogFooter({
	onClose,
}: {
	onClose(): void;
}): React.ReactElement {
	return <Button onClick={onClose}>close</Button>;
}
