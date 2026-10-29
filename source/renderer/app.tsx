import {type FormEvent, useCallback, useEffect, useRef, useState} from 'react';
import {AppShell} from '@/renderer/app-shell';
import {ApprovalRequests} from '@/renderer/approval-requests';
import {
	acpBadge,
	observeSupervisor,
	type SupervisorIndex,
} from '@/renderer/supervisor-state';
import {
	addUserMessage,
	applyEvent,
	emptyTranscript,
	type Transcript,
} from '@/renderer/transcript';
import {Button, Card, Divider, StatusBadge} from '@/renderer/ui';
import type {
	AppInfo,
	CapabilityGates,
	ConnectedAgent,
	ConnectResult,
	IpcResult,
	NanocoderRuntime,
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
	session: SessionInfo;
}) {
	const {capabilities} = agent;
	return (
		<Card aria-label="connected agent">
			<p>
				connected to {agent.name ?? 'an unnamed agent'}{' '}
				{agent.version ?? '(no version)'} over ACP protocol version{' '}
				{agent.protocolVersion} in {agent.root}
			</p>
			<p>
				session {session.id} in {session.mode} mode
			</p>
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

function Conversation({transcript}: {transcript: Transcript}) {
	return (
		<ol className="gate-transcript" aria-label="conversation">
			{transcript.items.map((item, index) => (
				<li
					className={`gate-message-${item.kind}`}
					key={item.kind === 'tool' ? item.id : `${item.kind}-${index}`}
				>
					{item.kind === 'user' && <>you: {item.text}</>}
					{item.kind === 'agent' && (
						<>
							<span aria-hidden="true">✱ </span>Nanocoder: {item.text}
						</>
					)}
					{item.kind === 'tool' && (
						<>
							<span aria-hidden="true">
								{item.status === 'completed'
									? '✓'
									: item.status === 'failed'
										? '✕'
										: '◐'}{' '}
							</span>
							tool <code>{item.title}</code>: {item.status}
						</>
					)}
				</li>
			))}
		</ol>
	);
}

export function App() {
	const [info, setInfo] = useState<AppInfo | null>(null);
	const [runtime, setRuntime] = useState<IpcResult<NanocoderRuntime> | null>(
		null,
	);
	const [connecting, setConnecting] = useState(false);
	const [opened, setOpened] = useState<IpcResult<ConnectResult> | null>(null);
	const [transcripts, setTranscripts] = useState<Record<string, Transcript>>(
		{},
	);
	const [draft, setDraft] = useState('');
	const [running, setRunning] = useState<Record<string, boolean>>({});
	const [turns, setTurns] = useState<
		Record<string, IpcResult<TurnResult> | null>
	>({});
	const [gates, setGates] = useState<Record<string, CapabilityGates>>({});
	const [supervisors, setSupervisors] = useState<SupervisorIndex>({});
	const [cancellations, setCancellations] = useState<
		Record<string, IpcResult<null> | 'pending' | null>
	>({});
	const composerInput = useRef<HTMLInputElement>(null);
	const roots = useRef(new Map<string, string>());
	const outcome = opened?.ok ? opened.value : null;
	const root = outcome?.status === 'connected' ? outcome.agent.root : '';
	const transcript = transcripts[root] ?? emptyTranscript;
	const sending = running[root] ?? false;
	const turn = turns[root];
	const cancellation = cancellations[root];
	const processBadge = acpBadge(supervisors, root);

	useEffect(() => {
		if (
			!sending &&
			cancellation &&
			cancellation !== 'pending' &&
			cancellation.ok &&
			document.activeElement === document.body
		)
			composerInput.current?.focus();
	}, [sending, cancellation]);

	useEffect(
		() =>
			window.desktop.onProjectEvent(event => {
				if (event.type === 'supervisor' || event.type === 'project-removed') {
					setSupervisors(current => observeSupervisor(current, event));
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
					const root = roots.current.get(event.projectId);
					if (root)
						setTranscripts(current => ({
							...current,
							[root]: event.events.reduce(
								applyEvent,
								current[root] ?? emptyTranscript,
							),
						}));
				}
			}),
		[],
	);

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
		setConnecting(true);
		const result = await window.desktop.connectNanocoder();
		setConnecting(false);
		if (!result.ok || result.value.status !== 'cancelled') {
			setOpened(result);
		}
	};

	const send = async (event: FormEvent) => {
		event.preventDefault();
		const text = draft.trim();
		if (!text || sending) return;
		setDraft('');
		setRunning(current => ({...current, [root]: true}));
		setTurns(current => ({...current, [root]: null}));
		setCancellations(current => ({...current, [root]: null}));
		setTranscripts(current => ({
			...current,
			[root]: addUserMessage(current[root] ?? emptyTranscript, text),
		}));
		const result = await window.desktop.sendPrompt(text);
		setTurns(current => ({...current, [root]: result}));
		setRunning(current => ({...current, [root]: false}));
	};

	const cancel = async () => {
		if (cancellation === 'pending') return;
		setCancellations(current => ({...current, [root]: 'pending'}));
		let result: IpcResult<null>;
		try {
			result = await window.desktop.cancelPrompt();
		} catch {
			result = {
				ok: false,
				error: {
					code: 'AGENT_UNAVAILABLE',
					message: 'could not cancel the turn. try again.',
					retryable: true,
				},
			};
		}
		setCancellations(current => ({...current, [root]: result}));
	};

	return (
		<AppShell
			title={info?.name}
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
										: turn?.ok && turn.value.stopReason === 'cancelled'
											? 'interrupted'
											: 'idle'
						}
					/>
					{processBadge && <StatusBadge {...processBadge} />}
				</div>
			}
			streamTools={
				<>
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
							<Button onClick={connect} disabled={connecting}>
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
				</>
			}
			composer={
				outcome?.status === 'connected' && (
					<form className="gate-composer" onSubmit={send}>
						<label>
							message
							<input
								ref={composerInput}
								value={draft}
								onChange={event => setDraft(event.target.value)}
								disabled={sending}
								placeholder="ask anything…"
								aria-describedby="composer-hint"
							/>
						</label>
						<div className="gate-actions">
							<Button type="submit" disabled={sending || draft.trim() === ''}>
								send
							</Button>
							{sending && (
								<Button
									variant="reject"
									disabled={connecting || cancellation === 'pending'}
									onClick={() => {
										void cancel();
									}}
								>
									{cancellation === 'pending'
										? 'cancelling turn'
										: 'cancel turn'}
								</Button>
							)}
							<p id="composer-hint" className="gate-hint">
								{sending
									? 'waiting for Nanocoder to finish the turn'
									: draft.trim() === ''
										? 'enter a message to send'
										: 'ready to send'}
							</p>
						</div>
						{cancellation && cancellation !== 'pending' && !cancellation.ok && (
							<p role="alert">{cancellation.error.message}</p>
						)}
					</form>
				)
			}
		>
			{outcome?.status === 'connected' && (
				<Conversation transcript={transcript} />
			)}
			<ApprovalRequests
				key={root}
				requests={transcript.permissions}
				mode={outcome?.status === 'connected' ? outcome.session.mode : 'normal'}
				busy={sending}
				fallbackFocus={composerInput}
				onAnswer={(id, optionId) =>
					window.desktop.answerPermission(id, optionId)
				}
			/>
			{turn?.ok && (
				<p role="status">
					{turn.value.stopReason === 'cancelled'
						? 'turn interrupted'
						: 'turn ended'}
					: {turn.value.stopReason}
				</p>
			)}
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
}
