import {useCallback, useEffect, useRef, useState} from 'react';
import {AppShell} from '@/renderer/app-shell';
import {ApprovalRequests} from '@/renderer/approval-requests';
import {Composer} from '@/renderer/composer';
import {ConversationStream} from '@/renderer/conversation-stream';
import {OverlayProvider, PaletteButton} from '@/renderer/overlays';
import {projectPalette} from '@/renderer/project-palette';
import {RecentProjects} from '@/renderer/recent-projects';
import {RecoveryTools} from '@/renderer/recovery-tools';
import {
	acpBadge,
	observeSupervisor,
	type SupervisorIndex,
} from '@/renderer/supervisor-state';
import {threadPalette} from '@/renderer/thread-palette';
import {ThreadRail} from '@/renderer/thread-rail';
import {TrustFeedback} from '@/renderer/trust-feedback';
import {Button, Card, Divider, StatusBadge} from '@/renderer/ui';
import {useProjectControls} from '@/renderer/use-project-controls';
import {useProjects} from '@/renderer/use-projects';
import {useThreads} from '@/renderer/use-threads';
import {CONFIG_UNCERTAINTY_REASON} from '@/shared/control-reasons';
import type {
	AppInfo,
	CapabilityGates,
	ConnectedAgent,
	ConnectResult,
	IpcResult,
	NanocoderRuntime,
	ThreadInfo,
} from '@/shared/ipc';

function FeatureDetails({gates}: {gates: CapabilityGates}) {
	return (
		<section aria-label="Nanocoder features">
			{gates.versionPolicy.reason && (
				<p role="status">{gates.versionPolicy.reason}</p>
			)}
			<dl>
				{Object.entries(gates.features).map(([name, gate]) => (
					<div key={name}>
						<dt>{name}</dt>
						<dd>
							{gate.enabled ? 'available' : `unavailable: ${gate.reason}`}
						</dd>
					</div>
				))}
			</dl>
		</section>
	);
}

function AgentDetails({
	agent,
	thread,
}: {
	agent: ConnectedAgent;
	thread: ThreadInfo | null;
}) {
	return (
		<Card aria-label="connected agent">
			<p>
				connected to {agent.name ?? 'an unnamed agent'}{' '}
				{agent.version ?? '(no version)'} over ACP protocol version{' '}
				{agent.protocolVersion} in {agent.root}
			</p>
			{thread?.nanocoderSessionId && (
				<p>
					session {thread.nanocoderSessionId} in {thread.mode} mode
				</p>
			)}
			<Divider soft />
			<dl className="gate-capabilities">
				{Object.entries({
					'resume sessions': agent.capabilities.sessions.resume,
					'close sessions': agent.capabilities.sessions.close,
					'list sessions': agent.capabilities.sessions.list,
					'delete sessions': agent.capabilities.sessions.delete,
					'load sessions': agent.capabilities.loadSession,
				}).map(([name, enabled]) => (
					<div key={name}>
						<dt>{name}</dt>
						<dd>{enabled ? 'yes' : 'no'}</dd>
					</div>
				))}
			</dl>
		</Card>
	);
}

export function App() {
	const [info, setInfo] = useState<AppInfo | null>(null);
	const [runtime, setRuntime] = useState<IpcResult<NanocoderRuntime> | null>(
		null,
	);
	const [connecting, setConnecting] = useState(false);
	const [opened, setOpened] = useState<IpcResult<ConnectResult> | null>(null);
	const projectControls = useProjects(() => setOpened(null));
	const [agents, setAgents] = useState<Record<string, ConnectedAgent>>({});
	const [gates, setGates] = useState<Record<string, CapabilityGates>>({});
	const [supervisors, setSupervisors] = useState<SupervisorIndex>({});
	const supervisorIndex = useRef<SupervisorIndex>({});
	const [attemptedProjectId, setAttemptedProjectId] = useState<string | null>(
		null,
	);
	const selectedProject = useRef<string | null>(null);
	const projectId = attemptedProjectId ?? projectControls.activeProjectId;
	const selected = supervisors[projectId ?? ''];
	const processState = selected?.state ?? null;
	const controls = useThreads(projectId, processState?.status === 'ready');
	const {workspace, conversation} = controls;
	const thread =
		workspace.threads.find(row => row.id === workspace.activeThreadId) ?? null;
	const {transcript, draft, turn, cancellation} = conversation;
	const agent = agents[projectId ?? ''];
	const outcome =
		opened?.ok && opened.value.status !== 'cancelled'
			? opened.value
			: agent
				? {status: 'connected' as const, agent}
				: null;
	const accepting =
		processState?.status === 'ready' &&
		processState.agent?.root === agent?.root &&
		!connecting &&
		!projectControls.pending;
	const rootBusy =
		workspace.promptingThreadId !== null ||
		workspace.cancellingThreadIds.length > 0 ||
		(processState?.activeThreadId ?? null) !== null;
	const sending =
		thread !== null &&
		(workspace.promptingThreadId === thread.id ||
			(thread.nanocoderSessionId !== null &&
				thread.nanocoderSessionId === processState?.activeThreadId));
	const stopping =
		thread !== null && workspace.cancellingThreadIds.includes(thread.id);
	const editable =
		accepting &&
		thread?.archiveState === 'active' &&
		thread.runState !== 'view-only' &&
		!workspace.loading &&
		!workspace.pending;
	const rootControlReason = rootBusy
		? 'stop the project turn before changing controls'
		: !accepting
			? 'Nanocoder is not ready'
			: workspace.loading || workspace.pending
				? 'another thread request is pending'
				: null;
	const modelControls = useProjectControls(
		projectId,
		rootControlReason,
		processState?.status === 'ready',
	);
	const currentProject = projectControls.projects.find(
		project => project.id === projectId,
	);
	const configUncertain =
		modelControls.controls?.modelGate.reason === CONFIG_UNCERTAINTY_REASON;
	const failed =
		thread?.runState === 'failed' ||
		(turn !== null && !turn.ok && thread?.runState !== 'ready');
	const processBadge = acpBadge(supervisors, selected?.root ?? '');
	const composerInput = useRef<HTMLTextAreaElement>(null);
	const [renaming, setRenaming] = useState<{
		projectId: string;
		threadId: string;
		title: string;
	} | null>(null);
	const renameDialog = useRef<HTMLDialogElement>(null);
	const renameInput = useRef<HTMLInputElement>(null);
	const renameId = renaming?.threadId;

	useEffect(() => {
		if (!renameId) return;
		const dialog = renameDialog.current;
		dialog?.showModal();
		renameInput.current?.focus();
		return () => dialog?.close();
	}, [renameId]);

	useEffect(() => {
		if (
			!sending &&
			cancellation?.ok &&
			(document.activeElement === document.body ||
				document.activeElement?.matches('.subagent-run-card'))
		)
			composerInput.current?.focus();
	}, [sending, cancellation]);

	useEffect(() => {
		return window.desktop.onProjectEvent(event => {
			const previous = supervisorIndex.current;
			const next = observeSupervisor(previous, event);
			if (next === previous) return;
			supervisorIndex.current = next;
			setSupervisors(next);
			if (event.type === 'project') {
				if (selectedProject.current !== event.projectId) {
					setOpened(null);
					setRenaming(null);
				}
				selectedProject.current = event.projectId;
				setAttemptedProjectId(event.projectId);
			} else if (event.type === 'project-removed') {
				if (selectedProject.current === event.projectId) {
					selectedProject.current = null;
					setAttemptedProjectId(null);
					setOpened(null);
					setRenaming(null);
				}
				void projectControls.refresh();
			} else if (event.type === 'supervisor') {
				const {agent, gates} = event.state;
				if (agent)
					setAgents(current => ({...current, [event.projectId]: agent}));
				if (gates)
					setGates(current => ({...current, [event.projectId]: gates}));
				if (
					event.state.status === 'ready' &&
					previous[event.projectId]?.state?.status === 'starting'
				)
					void controls.reload(event.projectId);
			}
		});
	}, [controls.reload, projectControls.refresh]);

	const checkRuntime = useCallback(() => {
		void window.desktop.getNanocoderRuntime().then(setRuntime);
	}, []);
	useEffect(() => {
		void window.desktop.getAppInfo().then(result => {
			if (result.ok) setInfo(result.value);
		});
		checkRuntime();
	}, [checkRuntime]);
	const connect = async () => {
		setConnecting(true);
		try {
			const result = await window.desktop.connectNanocoder();
			if (!result.ok || result.value.status !== 'cancelled') setOpened(result);
		} finally {
			setConnecting(false);
			void projectControls.refresh();
		}
	};
	const send = () => {
		if (
			editable &&
			!rootBusy &&
			!modelControls.pending &&
			!configUncertain &&
			draft.trim()
		)
			void controls.send();
	};
	const cancel = async () => {
		if (thread) await controls.cancel(thread.id);
	};
	const rename = (threadId: string) => {
		const row = workspace.threads.find(row => row.id === threadId);
		if (row && projectId) setRenaming({projectId, threadId, title: row.title});
	};
	const onNew = () => {
		void controls.create();
	};
	const onArchive = (id: string, archived: boolean) => {
		void controls.archive(id, archived);
	};
	const renameGate = gates[projectId ?? '']?.features.rename;
	const deleteGate = gates[projectId ?? '']?.features.delete;
	const renameDisabledReason = renameGate?.enabled
		? undefined
		: (renameGate?.reason ?? 'Nanocoder is not ready');
	const deleteHistoryDisabledReason = deleteGate?.enabled
		? undefined
		: (deleteGate?.reason ?? 'Nanocoder is not ready');
	const pending =
		workspace.loading ||
		workspace.pending ||
		connecting ||
		projectControls.pending ||
		modelControls.pending;
	const sendReason = !accepting
		? 'Nanocoder is not ready. retry before sending.'
		: thread?.archiveState === 'archived'
			? 'this thread is archived; unarchive it before sending'
			: sending
				? 'waiting for Nanocoder to finish the turn'
				: rootBusy
					? 'another thread is running'
					: modelControls.pending
						? 'a project control change is pending'
						: configUncertain
							? CONFIG_UNCERTAINTY_REASON
							: draft.trim() === ''
								? 'enter a message to send'
								: null;

	return (
		<OverlayProvider
			pendingApprovalCount={transcript.permissions.length}
			actions={[
				...projectPalette({
					...projectControls,
					pending: connecting || projectControls.pending,
				}),
				...threadPalette({
					projectId,
					thread,
					pending,
					renameDisabledReason: thread?.nanocoderSessionId
						? renameDisabledReason
						: undefined,
					onNew,
					onRename: rename,
					onArchive,
				}),
				{
					id: 'open-folder',
					label: 'open a project folder',
					glyph: '⌗',
					keywords: 'add directory',
					disabledReason:
						connecting || projectControls.pending
							? 'another project request or native dialog is pending'
							: !runtime?.ok
								? 'Nanocoder runtime is not available'
								: undefined,
					run: () => {
						void connect();
					},
				},
			]}
		>
			<AppShell
				title={info?.name}
				palette={<PaletteButton />}
				projectRail={
					<RecentProjects
						{...projectControls}
						pending={connecting || projectControls.pending}
					/>
				}
				threadRail={
					<ThreadRail
						projectId={projectId}
						threads={workspace.threads}
						activeThreadId={workspace.activeThreadId}
						pending={pending}
						now={new Date()}
						renameDisabledReason={renameDisabledReason}
						deleteHistoryDisabledReason={deleteHistoryDisabledReason}
						onNew={onNew}
						onOpen={id => {
							setRenaming(null);
							void controls.open(id);
						}}
						onRename={rename}
						onArchive={onArchive}
						onRemove={id => {
							void controls.remove(id);
						}}
						onDeleteHistory={id => {
							void controls.deleteHistory(id);
						}}
					/>
				}
				statusBadges={
					<div className="gate-actions">
						<StatusBadge
							status={
								transcript.permissions.length
									? 'approval'
									: sending
										? 'running'
										: failed || (opened && !opened.ok)
											? 'failed'
											: thread?.runState === 'interrupted'
												? 'interrupted'
												: 'idle'
							}
						/>
						{processBadge && <StatusBadge {...processBadge} />}
					</div>
				}
				streamTools={
					<>
						<TrustFeedback feedback={projectControls.feedback} />
						{info && (
							<p className="gate-meta">
								version {info.version}. pre-v0.1: an early build, with most
								features still to come.
							</p>
						)}
						<section className="gate-runtime" aria-label="Nanocoder runtime">
							{runtime?.ok && (
								<p>
									Nanocoder {runtime.value.version} at {runtime.value.cliPath},
									on Node.js {runtime.value.nodeVersion} at{' '}
									{runtime.value.nodePath}
								</p>
							)}
							{runtime && !runtime.ok && (
								<>
									<p role="alert">{runtime.error.message}</p>
									<Button onClick={checkRuntime}>check again</Button>
								</>
							)}
							{runtime?.ok && (
								<Button
									onClick={connect}
									disabled={connecting || projectControls.pending}
								>
									{connecting ? 'starting Nanocoder' : 'open a project folder'}
								</Button>
							)}
						</section>
						{outcome?.status === 'connected' && (
							<AgentDetails agent={outcome.agent} thread={thread} />
						)}
						{gates[projectId ?? ''] && (
							<FeatureDetails gates={gates[projectId ?? '']} />
						)}
						<RecoveryTools
							state={processState}
							onRetry={async id => {
								const result = await window.desktop.restartProject({
									projectId: id,
								});
								if (
									selectedProject.current === id &&
									result.ok &&
									result.value.status === 'ready' &&
									result.value.agent
								) {
									setOpened(null);
									projectControls.clearFeedback();
									void projectControls.refresh();
									await controls.reload(id);
								}
								return result;
							}}
							onCapture={projectId =>
								window.desktop.getDiagnostics({projectId})
							}
							onExport={request => window.desktop.exportDiagnostics(request)}
						/>
						{workspace.error && <p role="alert">{workspace.error}</p>}
					</>
				}
				composer={
					outcome?.status === 'connected' &&
					thread &&
					thread.runState !== 'view-only' && (
						<Composer
							draft={draft}
							editable={editable}
							sendReason={sendReason}
							controlReason={
								rootControlReason ??
								(modelControls.pending
									? 'a project control change is pending'
									: null)
							}
							projectName={currentProject?.displayName ?? 'selected project'}
							projectControls={modelControls.controls}
							mode={thread.mode}
							defaultMode={currentProject?.defaultMode ?? 'normal'}
							modePending={thread.nanocoderSessionId === null}
							running={sending}
							stopping={connecting || stopping}
							error={
								modelControls.error ??
								(cancellation && !cancellation.ok
									? cancellation.error.message
									: null)
							}
							commands={transcript.commands ?? []}
							context={transcript.context}
							inputRef={composerInput}
							onDraft={controls.setDraft}
							onSend={send}
							onCancel={() => {
								void cancel();
							}}
							onMode={mode => {
								void controls.setMode(thread.id, mode);
							}}
							onDefault={mode => {
								void modelControls.setDefault(mode).then(result => {
									if (result) void projectControls.refresh();
								});
							}}
							onConfig={(id, value) => {
								void modelControls.setConfig(id, value);
							}}
						/>
					)
				}
			>
				{thread && (
					<ConversationStream
						key={`${projectId}:${thread.id}`}
						transcript={transcript}
						running={sending}
						onStopTurn={cancel}
						stopping={stopping}
						outcome={
							turn?.ok
								? turn.value.stopReason === 'cancelled'
									? 'cancelled'
									: 'completed'
								: turn
									? 'failed'
									: undefined
						}
					>
						<ApprovalRequests
							key={`${projectId}:${thread.id}`}
							requests={transcript.permissions}
							mode={thread.mode}
							busy={sending}
							fallbackFocus={composerInput}
							onAnswer={(id, optionId) =>
								controls.answer(thread.id, id, optionId)
							}
						/>
					</ConversationStream>
				)}
				{thread?.runState === 'view-only' && (
					<Card aria-label="view-only thread">
						<p>{thread.viewOnlyReason}</p>
						<Button onClick={onNew}>start a new thread in this project</Button>
						<Button onClick={() => void controls.remove(thread.id)}>
							remove from desktop
						</Button>
					</Card>
				)}
				{turn?.ok && (
					<p role="status">
						{turn.value.stopReason === 'cancelled'
							? 'turn interrupted'
							: 'turn ended'}
						: {turn.value.stopReason}
					</p>
				)}
				{turn && !turn.ok && failed && (
					<Card variant="failure" role="alert">
						<span>
							<span aria-hidden="true">✕ </span>
							{turn.error.message}
						</span>
					</Card>
				)}
				{outcome?.status === 'untrusted' && (
					<Card variant="failure" role="alert">
						<span>
							<span aria-hidden="true">✕ </span>not opened. {outcome.message}
						</span>
					</Card>
				)}
				{opened && !opened.ok && (
					<Card variant="failure" role="alert">
						<span>
							<span aria-hidden="true">✕ </span>
							{opened.error.message}
						</span>
					</Card>
				)}
			</AppShell>
			{renaming && (
				<dialog
					ref={renameDialog}
					className="overlay-dialog"
					aria-label="rename thread"
					onCancel={() => setRenaming(null)}
				>
					<form
						onSubmit={event => {
							event.preventDefault();
							if (renaming.projectId !== projectId) return;
							void controls
								.rename(renaming.threadId, renaming.title)
								.then(saved => {
									if (saved) setRenaming(null);
								});
						}}
					>
						<label>
							thread title
							<input
								ref={renameInput}
								value={renaming.title}
								maxLength={200}
								onChange={event =>
									setRenaming({...renaming, title: event.target.value})
								}
							/>
						</label>
						<Button type="submit" disabled={pending || !renaming.title.trim()}>
							save title
						</Button>
						<Button onClick={() => setRenaming(null)}>cancel</Button>
					</form>
				</dialog>
			)}
		</OverlayProvider>
	);
}
