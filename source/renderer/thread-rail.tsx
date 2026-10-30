import * as React from 'react';
import {
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
	renameDisabledReason?: string;
	deleteHistoryDisabledReason?: string;
	onNew(projectId: string): void;
	onOpen(threadId: string): void;
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
	const [query, setQuery] = React.useState('');
	const groups = threadGroups(props.projectId, props.threads, props.now).map(
		group => ({
			...group,
			threads: group.threads.filter(thread =>
				thread.title
					.toLocaleLowerCase()
					.includes(query.trim().toLocaleLowerCase()),
			),
		}),
	);
	const newReason = props.pending
		? 'another thread request is pending'
		: props.projectId
			? undefined
			: 'select a project first';
	const row = (thread: ThreadInfo) => {
		const status = threadAppearance(thread);
		const reason = threadMutationReason(thread, props.pending);
		const renameReason =
			reason ??
			(thread.nanocoderSessionId ? props.renameDisabledReason : undefined);
		const deleteReason =
			reason ??
			(thread.nanocoderSessionId
				? props.deleteHistoryDisabledReason
				: 'this thread has no Nanocoder history');
		return (
			<li
				key={thread.id}
				className="thread-row"
				data-thread-id={thread.id}
				data-selected={thread.id === props.activeThreadId}
			>
				<button
					type="button"
					className="thread-open"
					aria-label={`${thread.title} · ${status.label}`}
					aria-current={thread.id === props.activeThreadId ? 'true' : undefined}
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
						{thread.id === props.activeThreadId && (
							<span className="thread-state-label">{status.label}</span>
						)}
					</span>
					<time
						className="thread-age"
						dateTime={thread.lastActivityAt}
						title={new Date(thread.lastActivityAt).toLocaleString()}
					>
						{Math.max(
							0,
							Math.floor(
								(props.now.getTime() - Date.parse(thread.lastActivityAt)) /
									86400000,
							),
						) > 0
							? `${Math.floor((props.now.getTime() - Date.parse(thread.lastActivityAt)) / 86400000)}d`
							: 'today'}
					</time>
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
			<header className="thread-rail-heading">
				<h2 className="shell-heading">threads</h2>
				<Button
					aria-label="new thread"
					title={newReason}
					disabled={Boolean(newReason)}
					onClick={() => {
						if (props.projectId) props.onNew(props.projectId);
					}}
				>
					＋ new
				</Button>
			</header>
			<input
				className="thread-search"
				aria-label="search thread titles in this project"
				placeholder="search threads…"
				value={query}
				onChange={event => setQuery(event.target.value)}
			/>
			{query.trim() && groups.every(group => group.threads.length === 0) && (
				<p className="thread-rail-note" role="status">
					no matching threads
				</p>
			)}
			{newReason && <p className="thread-rail-note">{newReason}</p>}
			{!query.trim() &&
				props.projectId &&
				groups.every(group => group.threads.length === 0) && (
					<p className="thread-rail-note">no threads yet</p>
				)}
			{groups
				.filter(group => group.threads.length > 0)
				.map(group =>
					group.id === 'archived' ? (
						<details
							key={group.id}
							className="thread-group"
							open={group.threads.some(
								thread => thread.id === props.activeThreadId,
							)}
						>
							<summary className="thread-group-heading">
								archived · {group.threads.length}
							</summary>
							<ol className="thread-list" aria-label="archived threads">
								{group.threads.map(row)}
							</ol>
						</details>
					) : (
						<section
							key={group.id}
							className="thread-group"
							aria-label={`${group.id} threads`}
						>
							<h3 className="thread-group-heading">history · {group.id}</h3>
							<ol className="thread-list">{group.threads.map(row)}</ol>
						</section>
					),
				)}
		</section>
	);
}
