import {type FormEvent, useCallback, useEffect, useRef, useState} from 'react';
import {AppShell} from '@/renderer/app-shell';
import {ConversationStream} from '@/renderer/conversation-stream';
import {legacyMetadataEvent} from '@/renderer/legacy-stream';
import {OverlayProvider, PaletteButton} from '@/renderer/overlays';
import {projectPalette} from '@/renderer/project-palette';
import {RecentProjects} from '@/renderer/recent-projects';
import {RecoveryTools} from '@/renderer/recovery-tools';
import {createStreamBatcher} from '@/renderer/stream-batcher';
import {SlashSuggestions} from '@/renderer/stream-commands';
import {
	acpBadge,
	observeSupervisor,
	type SupervisorIndex,
} from '@/renderer/supervisor-state';
import {
	addUserMessage,
	applyEvents,
	emptyTranscript,
	type Transcript,
} from '@/renderer/transcript';
import {TrustFeedback} from '@/renderer/trust-feedback';
import {Button, Card, Divider, StatusBadge} from '@/renderer/ui';
import {useProjects} from '@/renderer/use-projects';
import type {
	AppInfo,
	CapabilityGates,
	ConnectedAgent,
	ConnectResult,
	IpcResult,
	NanocoderRuntime,
	PermissionRequestInfo,
	SessionInfo,
	TurnResult,
} from '@/shared/ipc';

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

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
	session,
}: {
	agent: ConnectedAgent;
	session: SessionInfo | null;
}) {
	const {capabilities} = agent;
	return (
		<Card aria-label="connected agent">
			<p>
				connected to {agent.name ?? 'an unnamed agent'}{' '}
				{agent.version ?? '(no version)'} over ACP protocol version{' '}
				{agent.protocolVersion} in {agent.root}
			</p>
			{session && (
				<p>
					session {session.id} in {session.mode} mode
				</p>
			)}
			<Divider soft />
			<dl className="gate-capabilities">
				<dt>resume sessions</dt>
				<dd>{yesNo(capabilities.sessions.resume)}</dd>
				<dt>close sessions</dt>
				<dd>{yesNo(capabilities.sessions.close)}</dd>
				<dt>list sessions</dt>
				<dd>{yesNo(capabilities.sessions.list)}</dd>
				<dt>delete sessions</dt>
				<dd>{yesNo(capabilities.sessions.delete)}</dd>
				<dt>load sessions</dt>
				<dd>{yesNo(capabilities.loadSession)}</dd>
			</dl>
		</Card>
	);
}

function PermissionCard({
	request,
	onAnswer,
}: {
	request: PermissionRequestInfo;
	onAnswer(id: string, optionId: string): void;
}) {
	return (
		<Card variant="approval" aria-label="permission request">
			<h2>
				<span aria-hidden="true">▲</span> approval required
			</h2>
			<p>Nanocoder asks to run: {request.title}</p>
			<div className="gate-actions">
				{request.options.map(option => (
					<Button
						key={option.id}
						variant={option.kind.startsWith('allow') ? 'allow' : 'reject'}
						onClick={() => {
							onAnswer(request.id, option.id);
						}}
					>
						<span aria-hidden="true">
							{option.kind.startsWith('allow') ? '✓' : '✕'}
						</span>
						{option.name}
					</Button>
				))}
			</div>
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
	const [recoveredAgent, setRecoveredAgent] = useState<{
		projectId: string;
		agent: ConnectedAgent;
	} | null>(null);
	const streamBatcher = useRef<ReturnType<typeof createStreamBatcher> | null>(
		null,
	);
	const projectControls = useProjects(() => {
		streamBatcher.current?.flush();
		setOpened(null);
		setRecoveredAgent(null);
	});
	const [transcripts, setTranscripts] = useState<Record<string, Transcript>>(
		{},
	);
	const [draft, setDraft] = useState('');
	const messageInput = useRef<HTMLInputElement>(null);
	const [running, setRunning] = useState<Record<string, boolean>>({});
	const [turns, setTurns] = useState<
		Record<string, IpcResult<TurnResult> | null>
	>({});
	const [gates, setGates] = useState<Record<string, CapabilityGates>>({});
	const [supervisors, setSupervisors] = useState<SupervisorIndex>({});
	const supervisorIndex = useRef<SupervisorIndex>({});
	const [attemptedProjectId, setAttemptedProjectId] = useState<string | null>(
		null,
	);
	const selectedProject = useRef<string | null>(null);
	const roots = useRef(new Map<string, string>());
	const recoveryReplay = useRef(
		new Map<string, {transcript: Transcript; received: boolean}>(),
	);
	const processGenerations = useRef(new Map<string, number>());
	const outcome =
		recoveredAgent?.projectId === attemptedProjectId && recoveredAgent
			? {
					status: 'connected' as const,
					agent: recoveredAgent.agent,
					session: null,
				}
			: opened?.ok
				? opened.value
				: null;
	const root = outcome?.status === 'connected' ? outcome.agent.root : '';
	const transcript = transcripts[root] ?? emptyTranscript;
	const sending = running[root] ?? false;
	const turn = turns[root];
	const selected =
		supervisors[attemptedProjectId ?? projectControls.activeProjectId ?? ''];
	const processState = selected?.state ?? null;
	const accepting =
		processState?.status === 'ready' &&
		processState.agent?.root === root &&
		!connecting &&
		!projectControls.pending;
	const processBadge = acpBadge(supervisors, selected?.root ?? '');

	useEffect(() => {
		const batcher = createStreamBatcher((root, events) =>
			setTranscripts(current => ({
				...current,
				[root]: applyEvents(current[root] ?? emptyTranscript, events),
			})),
		);
		streamBatcher.current = batcher;
		const unsubscribe = window.desktop.onProjectEvent(event => {
			const next = observeSupervisor(supervisorIndex.current, event);
			if (event.type !== 'turn' && next === supervisorIndex.current) return;
			if (next !== supervisorIndex.current) {
				supervisorIndex.current = next;
				setSupervisors(next);
			}
			if (event.type === 'project') {
				batcher.flush();
				roots.current.set(event.projectId, event.project.canonicalRoot);
				if (selectedProject.current !== event.projectId) {
					setOpened(null);
					setRecoveredAgent(null);
				}
				selectedProject.current = event.projectId;
				setAttemptedProjectId(event.projectId);
				return;
			}
			if (event.type === 'project-removed') {
				const removedRoot = roots.current.get(event.projectId);
				if (removedRoot) batcher.remove(removedRoot);
				roots.current.delete(event.projectId);
				recoveryReplay.current.delete(event.projectId);
				if (selectedProject.current === event.projectId) {
					selectedProject.current = null;
					setAttemptedProjectId(null);
					setRecoveredAgent(null);
					setOpened(null);
				}
				return;
			}
			if (event.type === 'supervisor') {
				const processRoot =
					event.state.agent?.root ?? roots.current.get(event.projectId);
				if (processRoot) batcher.flush(processRoot);
				if (event.state.status === 'starting') {
					recoveryReplay.current.set(event.projectId, {
						transcript: emptyTranscript,
						received: false,
					});
					if (processRoot) {
						processGenerations.current.set(
							processRoot,
							(processGenerations.current.get(processRoot) ?? 0) + 1,
						);
						setRunning(current => ({...current, [processRoot]: false}));
					}
				} else {
					const replayed = recoveryReplay.current.get(event.projectId);
					if (event.state.status === 'ready' && processRoot && replayed) {
						if (replayed.received)
							setTranscripts(current => ({
								...current,
								[processRoot]: {
									...replayed.transcript,
									items: [
										...replayed.transcript.items,
										...(current[processRoot]?.items.filter(
											item => item.kind === 'failure',
										) ?? []),
									],
								},
							}));
						setTurns(current => ({...current, [processRoot]: null}));
						setRunning(current => ({...current, [processRoot]: false}));
					}
					recoveryReplay.current.delete(event.projectId);
				}
			}
			if (
				event.type === 'supervisor' &&
				event.state.agent &&
				event.state.gates
			) {
				const root = event.state.agent.root;
				roots.current.set(event.projectId, root);
				const next = event.state.gates;
				setGates(current => ({...current, [root]: next}));
			}
			if (event.type === 'turn') {
				const replayed = recoveryReplay.current.get(event.projectId);
				if (replayed) {
					recoveryReplay.current.set(event.projectId, {
						transcript: applyEvents(replayed.transcript, event.events),
						received: true,
					});
					return;
				}
				const root = roots.current.get(event.projectId);
				if (root) {
					batcher.enqueue(root, event.events);
					if (
						event.events.some(
							turn =>
								turn.type === 'permission' || turn.type === 'permission-closed',
						)
					)
						batcher.flush(root);
				}
			}
		});
		const unsubscribeLegacy = window.desktop.onNanocoderEvent(event => {
			const metadata = legacyMetadataEvent(event);
			const currentRoot = roots.current.get(selectedProject.current ?? '');
			if (!metadata || !currentRoot) return;
			batcher.enqueue(currentRoot, [metadata]);
			batcher.flush(currentRoot);
		});
		return () => {
			unsubscribe();
			unsubscribeLegacy();
			batcher.dispose();
			if (streamBatcher.current === batcher) streamBatcher.current = null;
		};
	}, []);

	const checkRuntime = useCallback(() => {
		void window.desktop.getNanocoderRuntime().then(setRuntime);
	}, []);

	useEffect(() => {
		void window.desktop.getAppInfo().then(result => {
			if (result.ok) {
				setInfo(result.value);
			}
		});
		checkRuntime();
	}, [checkRuntime]);

	const connect = async () => {
		streamBatcher.current?.flush();
		setConnecting(true);
		const result = await window.desktop.connectNanocoder();
		void projectControls.refresh();
		setConnecting(false);
		if (!result.ok || result.value.status !== 'cancelled') {
			setRecoveredAgent(null);
			setOpened(result);
		}
	};

	const send = async (event: FormEvent) => {
		event.preventDefault();
		const text = draft.trim();
		if (!text || sending || !accepting) return;
		streamBatcher.current?.flush(root);
		const generation = processGenerations.current.get(root) ?? 0;
		setDraft('');
		setRunning(current => ({...current, [root]: true}));
		setTurns(current => ({...current, [root]: null}));
		setTranscripts(current => ({
			...current,
			[root]: addUserMessage(current[root] ?? emptyTranscript, text),
		}));
		const result = await window.desktop.sendPrompt(text);
		streamBatcher.current?.flush(root);
		if (!result.ok)
			setTranscripts(current => {
				const previous = current[root] ?? emptyTranscript;
				return {
					...current,
					[root]: {
						...previous,
						items: [
							...previous.items,
							{kind: 'failure', text: result.error.message},
						],
					},
				};
			});
		if ((processGenerations.current.get(root) ?? 0) !== generation) return;
		setTurns(current => ({...current, [root]: result}));
		setRunning(current => ({...current, [root]: false}));
	};

	const shell = (
		<AppShell
			palette={<PaletteButton />}
			title={info?.name}
			projectRail={
				<RecentProjects
					{...projectControls}
					pending={connecting || projectControls.pending}
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
									: (turn && !turn.ok) || (opened && !opened.ok)
										? 'failed'
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
								Nanocoder {runtime.value.version} at {runtime.value.cliPath}, on
								Node.js {runtime.value.nodeVersion} at {runtime.value.nodePath}
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
								{connecting ? (
									<>
										<span className="spinner" aria-hidden="true">
											◐
										</span>{' '}
										starting Nanocoder
									</>
								) : (
									'open a project folder'
								)}
							</Button>
						)}
					</section>
					{outcome?.status === 'connected' && (
						<AgentDetails agent={outcome.agent} session={outcome.session} />
					)}
					{outcome?.status === 'connected' && gates[outcome.agent.root] && (
						<FeatureDetails gates={gates[outcome.agent.root]} />
					)}
					<RecoveryTools
						state={processState}
						onRetry={async projectId => {
							const result = await window.desktop.restartProject({projectId});
							if (
								selectedProject.current === projectId &&
								result.ok &&
								result.value.status === 'ready' &&
								result.value.agent
							) {
								setRecoveredAgent({projectId, agent: result.value.agent});
								setOpened(null);
								projectControls.clearFeedback();
								void projectControls.refresh();
							}
							return result;
						}}
						onCapture={projectId => window.desktop.getDiagnostics({projectId})}
						onExport={request => window.desktop.exportDiagnostics(request)}
					/>
				</>
			}
			composer={
				outcome?.status === 'connected' && (
					<form className="gate-composer" onSubmit={send}>
						<label>
							message
							<input
								ref={messageInput}
								value={draft}
								onChange={event => setDraft(event.target.value)}
								disabled={!accepting}
								placeholder="ask anything…"
								aria-describedby="composer-hint"
							/>
						</label>
						<SlashSuggestions
							commands={transcript.commands ?? []}
							draft={draft}
							disabled={!accepting}
							onInsert={value => {
								setDraft(value);
								messageInput.current?.focus();
							}}
						/>
						<div className="gate-actions">
							<Button
								type="submit"
								disabled={sending || !accepting || draft.trim() === ''}
							>
								send
							</Button>
							<p id="composer-hint" className="gate-hint">
								{!accepting
									? 'Nanocoder is not ready. retry before sending.'
									: sending
										? 'waiting for Nanocoder to finish the turn'
										: draft.trim() === ''
											? 'enter a message to send'
											: 'ready to send'}
							</p>
						</div>
					</form>
				)
			}
		>
			{outcome?.status === 'connected' && (
				<ConversationStream transcript={transcript} running={sending}>
					{transcript.permissions.map(request => (
						<PermissionCard
							key={request.id}
							request={request}
							onAnswer={(id, optionId) => {
								streamBatcher.current?.flush(root);
								void window.desktop.answerPermission(id, optionId);
							}}
						/>
					))}
				</ConversationStream>
			)}
			{turn?.ok && <p role="status">turn ended: {turn.value.stopReason}</p>}
			{turn && !turn.ok && (
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
	);

	return (
		<OverlayProvider
			actions={[
				...projectPalette({
					...projectControls,
					pending: connecting || projectControls.pending,
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
			{shell}
		</OverlayProvider>
	);
}
