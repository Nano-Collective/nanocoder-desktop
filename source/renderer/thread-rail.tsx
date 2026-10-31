import * as React from 'react';
import {
	compactAge,
	threadAppearance,
	threadGroups,
	threadMutationReason,
} from '@/renderer/thread-rail-model';
import {Button} from '@/renderer/ui';
import type {ThreadInfo} from '@/shared/ipc';

interface ThreadRailProps {
	projectId: string | null;
	threads: readonly ThreadInfo[];
	activeThreadId: string | null;
	pending: boolean;
	now: Date;
	importCount: number | null;
	newThreadShortcut?: string;
	renameDisabledReason?: string;
	deleteHistoryDisabledReason?: string;
	onNew(projectId: string): void;
	onOpen(threadId: string): void;
	onOpenArchives(opener: HTMLElement): void;
	onOpenImport(): void;
	onRename(threadId: string): void;
	onArchive(threadId: string, archived: boolean): void;
	onRemove(threadId: string): void;
	onDeleteHistory(threadId: string): void;
}

function RailAction({
	label,
	title,
	reason,
	onClick,
}: {
	label: string;
	title: string;
	reason?: string;
	onClick(): void;
}) {
	return (
		<div className="thread-action">
			<Button
				aria-label={`${label}: ${title}`}
				title={reason}
				disabled={Boolean(reason)}
				onClick={onClick}
			>
				{label}
			</Button>
			{reason && <p className="thread-action-reason">{reason}</p>}
		</div>
	);
}

export function ThreadRail(props: ThreadRailProps): React.ReactElement {
	const groups = threadGroups(props.projectId, props.threads, props.now);
	const archived = groups.find(group => group.id === 'archived')?.threads ?? [];
	const active = groups.filter(
		group => group.id !== 'archived' && group.threads.length > 0,
	);
	const newReason = props.pending
		? 'another thread request is pending'
		: props.projectId
			? undefined
			: 'select a project first';
	const row = (thread: ThreadInfo) => {
		const status = threadAppearance(thread);
		const selected = thread.id === props.activeThreadId;
		const reason = threadMutationReason(thread, props.pending);
		const renameReason =
			reason ??
			(thread.nanocoderSessionId ? props.renameDisabledReason : undefined);
		const deleteReason =
			reason ??
			(thread.nanocoderSessionId
				? props.deleteHistoryDisabledReason
				: 'this thread has no Nanocoder history');
		const age = (
			<time
				className="thread-age"
				dateTime={thread.lastActivityAt}
				title={new Date(thread.lastActivityAt).toLocaleString()}
			>
				{compactAge(thread.lastActivityAt, props.now)}
			</time>
		);
		return (
			<li
				key={thread.id}
				className="thread-row"
				data-thread-id={thread.id}
				data-selected={selected}
			>
				<button
					type="button"
					className="thread-open"
					aria-label={`${thread.title} · ${status.label}`}
					aria-current={selected ? 'true' : undefined}
					title={`${thread.title} · ${status.label}${thread.viewOnlyReason ? `: ${thread.viewOnlyReason}` : ''}`}
					disabled={props.pending}
					onClick={() => props.onOpen(thread.id)}
				>
					<span
						className={`thread-status thread-status--${status.tone}`}
						aria-hidden="true"
					>
						{status.glyph}
					</span>
					<span className="thread-copy">
						<span className="thread-title">{thread.title}</span>
						{selected && (
							<span className="thread-state-label">
								{status.label} · {age}
							</span>
						)}
					</span>
					{!selected && age}
				</button>
				<details className="thread-actions">
					<summary aria-label={`actions for ${thread.title}`}>⋯</summary>
					<div className="thread-action-list">
						<RailAction
							label="rename"
							title={thread.title}
							reason={renameReason}
							onClick={() => props.onRename(thread.id)}
						/>
						<RailAction
							label={
								thread.archiveState === 'archived' ? 'unarchive' : 'archive'
							}
							title={thread.title}
							reason={reason}
							onClick={() =>
								props.onArchive(thread.id, thread.archiveState !== 'archived')
							}
						/>
						<RailAction
							label="remove from desktop"
							title={thread.title}
							reason={reason}
							onClick={() => props.onRemove(thread.id)}
						/>
						<RailAction
							label="delete chat history"
							title={thread.title}
							reason={deleteReason}
							onClick={() => props.onDeleteHistory(thread.id)}
						/>
					</div>
				</details>
			</li>
		);
	};
	return (
		<section className="thread-rail" aria-label="project threads">
			<Button
				aria-label="new thread"
				title={newReason}
				disabled={Boolean(newReason)}
				className="thread-new"
				keyHint={props.newThreadShortcut}
				onClick={() => {
					if (props.projectId) props.onNew(props.projectId);
				}}
			>
				<span aria-hidden="true">＋ </span>new thread
			</Button>
			{newReason && <p className="thread-rail-note">{newReason}</p>}
			{props.projectId && groups.every(group => group.threads.length === 0) && (
				<p className="thread-rail-note">no threads yet</p>
			)}
			{active.map(group => (
				<section
					key={group.id}
					className="thread-group"
					aria-label={`${group.id} threads`}
				>
					<h3 className="thread-group-heading">
						<span>{group.id}</span>
						<span className="thread-group-count">{group.threads.length}</span>
					</h3>
					<ol className="thread-list">{group.threads.map(row)}</ol>
				</section>
			))}
			{props.projectId && (
				<button
					type="button"
					className="sidebar-link"
					aria-haspopup="dialog"
					onClick={event => props.onOpenArchives(event.currentTarget)}
				>
					<span aria-hidden="true">░</span>
					<span className="sidebar-link-label">archived</span>
					<span className="sidebar-link-count">{archived.length}</span>
				</button>
			)}
			{props.projectId && props.importCount !== null && (
				<button
					type="button"
					className="sidebar-link"
					onClick={props.onOpenImport}
				>
					<span aria-hidden="true">↳</span>
					<span className="sidebar-link-label">import sessions</span>
					<span className="sidebar-link-count">{props.importCount}</span>
				</button>
			)}
		</section>
	);
}
