import {useCallback, useEffect, useRef, useState} from 'react';
import {AppShell} from '@/renderer/app-shell';
import {ApprovalRequests} from '@/renderer/approval-requests';
import logoUrl from '@/renderer/assets/nano-collective-avatar.png';
import {Composer} from '@/renderer/composer';
import {ConversationStream} from '@/renderer/conversation-stream';
import type {FocusTarget} from '@/renderer/overlay-model';
import {OverlayProvider, PaletteButton} from '@/renderer/overlays';
import {projectPalette} from '@/renderer/project-palette';
import {ProjectSwitch} from '@/renderer/recent-projects';
import {RecoveryTools} from '@/renderer/recovery-tools';
import {SessionImportList} from '@/renderer/session-import-list';
import {
	acpBadge,
	observeSupervisor,
	type SupervisorIndex,
} from '@/renderer/supervisor-state';
import {threadComposerState} from '@/renderer/thread-composer-state';
import {threadPalette} from '@/renderer/thread-palette';
import {ThreadRail} from '@/renderer/thread-rail';
import {ThreadRecoveryNotice} from '@/renderer/thread-recovery-notice';
import {TrustFeedback} from '@/renderer/trust-feedback';
import {Button, Card, StatusBadge} from '@/renderer/ui';
import {useDiagnosticReview} from '@/renderer/use-diagnostic-review';
import {useProjectControls} from '@/renderer/use-project-controls';
import {useProjects} from '@/renderer/use-projects';
import {useSessionImports} from '@/renderer/use-session-imports';
import {useThreads} from '@/renderer/use-threads';
import {
	type WorkspaceDialogKind,
	WorkspaceDialogs,
} from '@/renderer/workspace-dialogs';
import {CONFIG_UNCERTAINTY_REASON} from '@/shared/control-reasons';
import type {
	AppInfo,
	CapabilityGates,
	ConnectedAgent,
	ConnectResult,
	IpcResult,
	NanocoderRuntime,
} from '@/shared/ipc';
import {REPLAY_FAILURE_REASON, REPLAY_REASON} from '@/shared/thread-replay';

// A dialog only needs the current element; the opener is kept across replacements.
function focusedElement(): HTMLElement | null {
	const active = document.activeElement;
	return active instanceof HTMLElement && active !== document.body
		? active
		: null;
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
	const sessionImports = useSessionImports(
		projectId,
		processState?.status === 'ready' &&
			processState.gates?.features.list.enabled === true,
		workspace.threads,
	);
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
	const activeReplay = workspace.replay?.[thread?.id ?? ''];
	const replayReason =
		activeReplay === 'failed'
			? (thread?.viewOnlyReason ?? REPLAY_FAILURE_REASON)
			: Object.values(workspace.replay ?? {}).includes('replaying')
				? processState?.status === 'failed'
					? REPLAY_FAILURE_REASON
					: REPLAY_REASON
				: null;
	const composerState = threadComposerState({
		thread,
		accepting,
		replay: activeReplay,
		pending: workspace.loading || workspace.pending,
	});
	const editable = composerState.editable;
	const centredComposer =
		composerState.visible &&
		activeReplay === undefined &&
		transcript.items.length === 0 &&
		!sending;
	const rootControlReason =
		replayReason ??
		(rootBusy
			? 'model + mode locked until the project turn stops'
			: !accepting
				? 'Nanocoder is not ready'
				: workspace.loading || workspace.pending
					? 'another thread request is pending'
					: null);
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
	const turnStatus = transcript.permissions.length
		? 'approval'
		: sending
			? 'running'
			: failed || (opened && !opened.ok)
				? 'failed'
				: thread?.runState === 'interrupted'
					? 'interrupted'
					: thread?.runState === 'view-only'
						? 'view-only'
						: 'ready';
	const composerInput = useRef<HTMLTextAreaElement>(null);
	const retryFocus = useRef(false);
	const retrying = useRef(false);
	const [renaming, setRenaming] = useState<{
		projectId: string;
		threadId: string;
		title: string;
	} | null>(null);
	const renameDialog = useRef<HTMLDialogElement>(null);
	const renameInput = useRef<HTMLInputElement>(null);
	const renameReturn = useRef<HTMLElement | null>(null);
	const renameId = renaming?.threadId;
	const [dialog, setDialog] = useState<WorkspaceDialogKind | null>(null);
	// The opener of the first dialog stays the return target while dialogs replace each other.
	const dialogOpener = useRef<HTMLElement | null | undefined>(undefined);
	const review = useDiagnosticReview(projectId, {
		capture: id => window.desktop.getDiagnostics({projectId: id}),
		exportSnapshot: request => window.desktop.exportDiagnostics(request),
	});
	const openDialog = (kind: WorkspaceDialogKind, opener = focusedElement()) => {
		if (dialogOpener.current === undefined) dialogOpener.current = opener;
		setDialog(kind);
	};
	const closeDialog = () => {
		if (dialog === 'diagnostics') {
			if (review.busy) return;
			review.close();
		}
		setDialog(null);
	};
	const captureDiagnostics = () => {
		const opener = focusedElement();
		void review.capture().then(captured => {
			if (captured) openDialog('diagnostics', opener);
		});
	};
	useEffect(() => {
		if (dialog !== null || dialogOpener.current === undefined) return;
		const target = dialogOpener.current;
		dialogOpener.current = undefined;
		const focused = document.activeElement;
		if (focused && focused !== document.body) return;
		if (
			target?.isConnected &&
			!target.matches(':disabled') &&
			target.checkVisibility()
		)
			target.focus();
		else
			document
				.querySelector<HTMLButtonElement>('[aria-label="command palette"]')
				?.focus();
	}, [dialog]);
	useEffect(() => {
		if (dialog === 'diagnostics' && !review.snapshot) setDialog(null);
	}, [dialog, review.snapshot]);

	useEffect(() => {
		if (!renameId) return;
		const renameModal = renameDialog.current;
		renameModal?.showModal();
		renameInput.current?.focus();
		return () => {
			const restore =
				document.activeElement === document.body ||
				!!renameModal?.contains(document.activeElement);
			renameModal?.close();
			if (!restore || document.querySelector('dialog[open]')) return;
			const target = renameReturn.current;
			renameReturn.current = null;
			if (
				target?.isConnected &&
				!target.matches(':disabled') &&
				target.checkVisibility()
			)
				target.focus();
			else
				document
					.querySelector<HTMLButtonElement>('[aria-label="command palette"]')
					?.focus();
		};
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
		if (!retryFocus.current) return;
		const composer = composerInput.current;
		if (
			!composer ||
			(!retrying.current && document.activeElement !== document.body)
		) {
			retryFocus.current = false;
			return;
		}
		if (document.activeElement === document.body && !composer.disabled) {
			retryFocus.current = false;
			composer.focus();
		}
	});

	useEffect(() => {
		return window.desktop.onProjectEvent(event => {
			const previous = supervisorIndex.current;
			const next = observeSupervisor(previous, event);
			if (next === previous) return;
			supervisorIndex.current = next;
			setSupervisors(next);
			if (event.type === 'project') {
				if (selectedProject.current !== event.projectId) setRenaming(null);
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
		setOpened(null);
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
			!replayReason &&
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
	const rename = (threadId: string, originalFocus?: FocusTarget) => {
		const row = workspace.threads.find(row => row.id === threadId);
		if (row && projectId) {
			const active = document.activeElement;
			renameReturn.current =
				originalFocus instanceof HTMLElement
					? originalFocus
					: active instanceof HTMLElement &&
							active !== document.body &&
							!active.closest('dialog')
						? active
						: null;
			setRenaming({projectId, threadId, title: row.title});
		}
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
	const waitingForDecision = transcript.permissions.length > 0;
	const sendReason =
		replayReason ??
		(!accepting
			? 'Nanocoder is not ready. retry before sending.'
			: thread?.archiveState === 'archived'
				? 'this thread is archived; unarchive it before sending'
				: sending
					? waitingForDecision
						? 'waiting for your decision · draft is not queued'
						: 'turn in progress · draft is not queued'
					: rootBusy
						? 'another thread is running'
						: modelControls.pending
							? 'a project control change is pending'
							: configUncertain
								? CONFIG_UNCERTAINTY_REASON
								: null);

	const recoveryTools = (
		<RecoveryTools
			state={processState}
			onRetry={async id => {
				retryFocus.current = true;
				retrying.current = true;
				const result = await window.desktop
					.restartProject({projectId: id})
					.finally(() => {
						retrying.current = false;
					});
				if (!result.ok || result.value.status !== 'ready')
					retryFocus.current = false;
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
			onDiagnostics={captureDiagnostics}
			diagnosticsBusy={review.busy}
			diagnosticsMessage={dialog === null ? review.message : ''}
		/>
	);

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
				logoSrc={logoUrl}
				title={info?.name ?? 'Nanocoder'}
				threadTitle={thread?.title}
				projectName={currentProject?.displayName}
				sidebarFooter={
					<>
						{processBadge && <StatusBadge {...processBadge} />}
						{gates[projectId ?? '']?.versionPolicy.reason && (
							<p className="workspace-setup-warning" role="status">
								{gates[projectId ?? '']?.versionPolicy.reason}
							</p>
						)}
						{runtime && !runtime.ok && (
							<>
								<p role="alert">{runtime.error.message}</p>
								<Button onClick={checkRuntime}>check again</Button>
							</>
						)}
						<Button onClick={() => openDialog('runtime')}>
							runtime details
						</Button>
						<span>
							Nanocoder{' '}
							{agent?.version ??
								(runtime?.ok ? runtime.value.version : 'not connected')}
						</span>
						<span>desktop {info?.version ?? 'pre-v0.1'}</span>
					</>
				}
				palette={<PaletteButton />}
				projectRail={
					<ProjectSwitch
						selected={currentProject}
						onOpen={() => openDialog('projects')}
					/>
				}
				threadRail={
					<>
						<ThreadRail
							key={`threads:${projectId}`}
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
						<SessionImportList
							key={projectId}
							{...sessionImports}
							active={sessionImports.ready}
							disabledReason={
								rootBusy
									? 'stop the project turn before importing'
									: (replayReason ??
										(!accepting
											? 'Nanocoder is not ready'
											: pending
												? 'another thread request is pending'
												: undefined))
							}
							onRefresh={sessionImports.refresh}
							onImport={sessionImports.importSession}
						/>
					</>
				}
				statusBadges={thread && <StatusBadge status={turnStatus} />}
				streamTools={
					<>
						<TrustFeedback feedback={projectControls.feedback} />
						{!thread && (
							<section className="workspace-welcome" aria-label="get started">
								<img src={logoUrl} alt="" width="56" height="56" />
								<p className="workspace-eyebrow">
									local-first workspace / pre-v0.1
								</p>
								<h2>what are you working on?</h2>
								<p>
									open a project folder to start a Nanocoder thread. you’ll
									review what can run before you trust the folder.
								</p>
								{runtime?.ok && (
									<Button
										onClick={connect}
										disabled={connecting || projectControls.pending}
									>
										{connecting
											? 'starting Nanocoder'
											: 'open a project folder'}
									</Button>
								)}
								{projectControls.projects.length > 0 && (
									<section
										className="welcome-recents"
										aria-label="recent folders on welcome"
									>
										<h3>recent projects</h3>
										{projectControls.projects.map(project => (
											<div key={project.id}>
												<span>
													<span>{project.displayName}</span>
													<small>{project.canonicalRoot}</small>
												</span>
												<Button
													aria-label={`${project.availability === 'available' ? 'open' : 'locate'} recent project ${project.displayName}`}
													disabled={connecting || projectControls.pending}
													onClick={() =>
														project.availability === 'available'
															? projectControls.onOpen(project.id)
															: projectControls.onLocate(project.id)
													}
												>
													{project.availability === 'available'
														? 'open'
														: 'locate'}
												</Button>
											</div>
										))}
									</section>
								)}
							</section>
						)}
						{processState?.status !== 'ready' && recoveryTools}
						{workspace.error && <p role="alert">{workspace.error}</p>}
					</>
				}
				composerPlacement={centredComposer ? 'centred' : 'bottom'}
				approvalShelf={
					thread && (
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
					)
				}
				composer={
					outcome?.status === 'connected' &&
					thread &&
					composerState.visible && (
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
						stopReason={turn?.ok ? turn.value.stopReason : undefined}
						outcome={
							turn?.ok
								? turn.value.stopReason === 'cancelled'
									? 'cancelled'
									: 'completed'
								: turn
									? 'failed'
									: undefined
						}
					/>
				)}
				{thread && (
					<ThreadRecoveryNotice
						thread={thread}
						pending={workspace.pending}
						onRetry={() => void controls.open(thread.id)}
						onNew={onNew}
						onRemove={() => void controls.remove(thread.id)}
					/>
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
			<WorkspaceDialogs
				kind={dialog}
				onClose={closeDialog}
				projects={{
					projects: projectControls.projects,
					activeProjectId: projectId,
					pending: connecting || projectControls.pending,
					onAdd: () => {
						closeDialog();
						projectControls.onAdd();
					},
					onOpen: id => {
						closeDialog();
						projectControls.onOpen(id);
					},
					onLocate: id => {
						closeDialog();
						projectControls.onLocate(id);
					},
				}}
				runtime={{
					runtime,
					processState,
					projectRoot: currentProject?.canonicalRoot ?? null,
					gates: gates[projectId ?? ''] ?? null,
					diagnosticsBusy: review.busy,
					diagnosticsMessage: review.message,
					onCheckAgain: checkRuntime,
					onCapabilities: () => openDialog('capabilities'),
					onDiagnostics: captureDiagnostics,
				}}
				capabilities={{
					gates: gates[projectId ?? ''] ?? null,
					modelGate: modelControls.controls?.modelGate ?? null,
					agent: agent ?? null,
					thread,
				}}
				archives={{
					threads: workspace.threads.filter(
						row => row.archiveState === 'archived',
					),
					projectName: currentProject?.displayName,
					now: new Date(),
					pending,
					onUnarchive: id => {
						void controls.archive(id, false);
					},
				}}
				diagnostics={
					review.snapshot
						? {
								snapshot: review.snapshot,
								busy: review.busy,
								message: review.message,
								onExport: review.exportSnapshot,
							}
						: null
				}
			/>
			{renaming && (
				<dialog
					ref={renameDialog}
					className="overlay-dialog rename-dialog"
					aria-label="rename thread"
					onCancel={() => setRenaming(null)}
				>
					<form
						className="overlay-content"
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
						<h2>rename thread</h2>
						<p>
							change this thread’s title. its conversation and project stay
							unchanged.
						</p>
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
						<div className="rename-dialog-actions">
							<Button
								type="submit"
								disabled={pending || !renaming.title.trim()}
							>
								save title
							</Button>
							<Button onClick={() => setRenaming(null)}>cancel</Button>
						</div>
					</form>
				</dialog>
			)}
		</OverlayProvider>
	);
}
