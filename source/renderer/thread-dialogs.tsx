import * as React from 'react';
import {DialogShell} from '@/renderer/dialog-shell';
import type {DialogApi, ThreadDialog} from '@/renderer/overlay-model';
import {threadMenuReasons} from '@/renderer/thread-actions';
import {Button} from '@/renderer/ui';
import type {ProjectInfo, ThreadInfo} from '@/shared/ipc';

export interface ThreadDialogActions {
	create(): Promise<boolean>;
	setDraft(draft: string): void;
	open(threadId: string): Promise<boolean>;
	rename(threadId: string, title: string): Promise<boolean>;
	archive(threadId: string, archived: boolean): Promise<boolean>;
	remove(threadId: string): Promise<boolean>;
	deleteHistory(threadId: string): Promise<boolean>;
}

export interface ThreadDialogData {
	threads: readonly ThreadInfo[];
	projectId: string | null;
	projectName: string;
	defaultMode?: ProjectInfo['defaultMode'];
	pending: boolean;
	projectBusy: boolean;
	renameDisabledReason?: string;
	deleteHistoryDisabledReason?: string;
	actions: ThreadDialogActions;
}

interface BodyProps {
	thread: ThreadInfo;
	data: ThreadDialogData;
	api: DialogApi;
}

function isRunning(thread: ThreadInfo) {
	return (
		thread.runState === 'running' || thread.runState === 'waiting-approval'
	);
}

function reasonsFor(thread: ThreadInfo, data: ThreadDialogData) {
	return threadMenuReasons(thread, {
		pending: data.pending,
		projectBusy: data.projectBusy,
		renameDisabledReason: data.renameDisabledReason,
		deleteHistoryDisabledReason: data.deleteHistoryDisabledReason,
	});
}

function ThreadMenuDialog({thread, data, api}: BodyProps) {
	const reasons = reasonsFor(thread, data);
	const note = reasons.shared ?? reasons.rename ?? reasons.deleteHistory;
	return (
		<DialogShell
			title="thread actions"
			closeLabel="close thread actions"
			onClose={api.close}
		>
			<div className="thread-menu-items">
				<Button
					className="thread-menu-item"
					disabled={!!reasons.rename}
					onClick={() => api.open({kind: 'rename', threadId: thread.id})}
				>
					rename…
				</Button>
				<Button
					className="thread-menu-item"
					disabled={!!reasons.archive}
					onClick={() => api.open({kind: 'archive', threadId: thread.id})}
				>
					archive thread…
				</Button>
				<Button
					className="thread-menu-item"
					disabled={!!reasons.remove}
					onClick={() => api.open({kind: 'remove', threadId: thread.id})}
				>
					remove from desktop…
				</Button>
				<Button
					className="thread-menu-item thread-menu-item--danger"
					disabled={!!reasons.deleteHistory}
					onClick={() => {
						api.close();
						void data.actions.deleteHistory(thread.id);
					}}
				>
					delete Nanocoder history…
				</Button>
			</div>
			{note && (
				<p className="dialog-reason" role="status">
					{note}
				</p>
			)}
			{!reasons.shared && (
				<p className="dialog-note">
					archive and remove affect desktop metadata. deleting history always
					needs its own confirmation.
				</p>
			)}
		</DialogShell>
	);
}

function RenameDialog({thread, data, api}: BodyProps) {
	const [title, setTitle] = React.useState(thread.title);
	const [saved, setSaved] = React.useState(false);
	const reason = reasonsFor(thread, data).rename;
	const canSave = !reason && !data.pending && title.trim() !== '';
	// Close after the rail re-enables its actions, so focus can return to the opener.
	React.useEffect(() => {
		if (saved && !data.pending) api.close();
	}, [saved, data.pending, api]);
	return (
		<form
			className="dialog-form"
			onSubmit={event => {
				event.preventDefault();
				if (!canSave) return;
				void data.actions.rename(thread.id, title).then(setSaved);
			}}
		>
			<DialogShell
				title="rename thread"
				closeLabel="close rename thread"
				onClose={api.close}
				footer={
					<>
						<Button className="dialog-quiet" onClick={api.close}>
							cancel
						</Button>
						<Button type="submit" disabled={!canSave}>
							save title
						</Button>
					</>
				}
			>
				<label className="dialog-field">
					thread title
					<input
						data-autofocus
						value={title}
						maxLength={200}
						onChange={event => setTitle(event.target.value)}
					/>
				</label>
				<p className="dialog-note">
					manual title takes precedence over later generated titles.
				</p>
				{reason && (
					<p className="dialog-reason" role="status">
						{reason}
					</p>
				)}
			</DialogShell>
		</form>
	);
}

function ArchiveDialog({thread, data, api}: BodyProps) {
	const reason = reasonsFor(thread, data).archive;
	const confirm = () => {
		if (reason) return;
		void data.actions.archive(thread.id, true).then(done => {
			if (done) api.close();
		});
	};
	return (
		<DialogShell
			title="archive this thread?"
			closeLabel="close archive confirmation"
			onClose={api.close}
			footer={
				<>
					<Button className="dialog-quiet" data-autofocus onClick={api.close}>
						cancel
					</Button>
					<Button disabled={!!reason} onClick={confirm}>
						archive thread
					</Button>
				</>
			}
		>
			<p className="dialog-target">
				{thread.title} · {data.projectName}
			</p>
			<p className="dialog-note">
				moves the desktop row to archived threads. it can be unarchived and does
				not change Nanocoder history.
			</p>
			{reason && (
				<p className="dialog-reason" role="status">
					{reason}
				</p>
			)}
		</DialogShell>
	);
}

function RemoveDialog({thread, data, api}: BodyProps) {
	const reason = reasonsFor(thread, data).remove;
	const confirm = () => {
		if (reason) return;
		void data.actions.remove(thread.id).then(done => {
			if (done) api.close();
		});
	};
	return (
		<DialogShell
			title="remove this thread from desktop?"
			closeLabel="close remove confirmation"
			onClose={api.close}
			footer={
				<>
					<Button className="dialog-quiet" data-autofocus onClick={api.close}>
						cancel
					</Button>
					<Button disabled={!!reason} onClick={confirm}>
						remove from desktop
					</Button>
				</>
			}
		>
			<p className="dialog-target">
				{thread.title} · {data.projectName}
			</p>
			<p className="dialog-note">
				removes this thread&apos;s desktop metadata only. Nanocoder&apos;s chat
				history stays where it is.
			</p>
			{reason && (
				<p className="dialog-reason" role="status">
					{reason}
				</p>
			)}
		</DialogShell>
	);
}

function OtherThreadDialog({thread, data, api}: BodyProps) {
	return (
		<DialogShell
			title="another thread is running"
			closeLabel="close notice"
			onClose={api.close}
			footer={
				<>
					<Button className="dialog-quiet" onClick={api.close}>
						keep reading
					</Button>
					<Button
						onClick={() => {
							api.close();
							void data.actions.open(thread.id);
						}}
					>
						return to active turn
					</Button>
				</>
			}
		>
			<p className="dialog-note">
				you can read other threads while {data.projectName} is running. sending
				is unavailable because another thread owns the project turn.
			</p>
			<div className="dialog-card">
				<p>
					<span aria-hidden="true">○ </span>another thread is running
				</p>
				<p className="dialog-note">
					{thread.title} · return there to cancel or answer its approval.
				</p>
			</div>
		</DialogShell>
	);
}

function NewThreadDialog({data, api}: Pick<BodyProps, 'data' | 'api'>) {
	const [draft, setDraft] = React.useState('');
	const [creating, setCreating] = React.useState(false);
	const [failed, setFailed] = React.useState(false);
	const reason = !data.projectId
		? 'select a project first'
		: data.pending
			? 'another thread request is pending'
			: undefined;
	const create = async () => {
		if (reason || creating) return;
		setCreating(true);
		setFailed(false);
		const created = await data.actions.create();
		setCreating(false);
		if (!created) {
			setFailed(true);
			return;
		}
		if (draft.trim()) data.actions.setDraft(draft);
		api.close();
	};
	return (
		<form
			className="dialog-form"
			onSubmit={event => {
				event.preventDefault();
				void create();
			}}
		>
			<DialogShell
				title={
					data.projectId ? `new thread in ${data.projectName}` : 'new thread'
				}
				closeLabel="close new thread"
				onClose={api.close}
				footer={
					<>
						<Button className="dialog-quiet" onClick={api.close}>
							cancel
						</Button>
						<Button type="submit" disabled={!!reason || creating}>
							keep as new thread draft
						</Button>
					</>
				}
			>
				<p className="dialog-note">
					the session will be created on the first send, not when you open this
					draft.
				</p>
				<label className="dialog-field">
					draft
					<textarea
						data-autofocus
						rows={4}
						placeholder="what would you like to work on?"
						value={draft}
						onChange={event => setDraft(event.target.value)}
					/>
				</label>
				{data.defaultMode && (
					<p className="dialog-note">
						project default · {data.defaultMode}. yolo is never restored or used
						as a default.
					</p>
				)}
				{(reason || failed) && (
					<p className="dialog-reason" role="status">
						{reason ?? 'the draft could not be created. try again.'}
					</p>
				)}
			</DialogShell>
		</form>
	);
}

export function ThreadDialogs({
	request,
	data,
	api,
}: {
	request: ThreadDialog;
	data: ThreadDialogData;
	api: DialogApi;
}): React.ReactElement | null {
	const {close} = api;
	const thread =
		request.kind === 'new-thread'
			? null
			: (data.threads.find(row => row.id === request.threadId) ?? null);
	const stale =
		request.kind !== 'new-thread' &&
		(!thread || (request.kind === 'other-thread' && !isRunning(thread)));
	React.useEffect(() => {
		if (stale) close();
	}, [stale, close]);
	if (request.kind === 'new-thread')
		return <NewThreadDialog data={data} api={api} />;
	if (!thread || stale) return null;
	switch (request.kind) {
		case 'thread-menu':
			return (
				<ThreadMenuDialog
					key={thread.id}
					thread={thread}
					data={data}
					api={api}
				/>
			);
		case 'rename':
			return (
				<RenameDialog key={thread.id} thread={thread} data={data} api={api} />
			);
		case 'archive':
			return (
				<ArchiveDialog key={thread.id} thread={thread} data={data} api={api} />
			);
		case 'remove':
			return (
				<RemoveDialog key={thread.id} thread={thread} data={data} api={api} />
			);
		case 'other-thread':
			return (
				<OtherThreadDialog
					key={thread.id}
					thread={thread}
					data={data}
					api={api}
				/>
			);
	}
}
