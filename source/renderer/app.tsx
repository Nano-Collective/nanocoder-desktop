import {type FormEvent, useCallback, useEffect, useRef, useState} from 'react';
import {
	addUserMessage,
	applyEvent,
	emptyTranscript,
	type Transcript,
} from '@/renderer/transcript';
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
	session: SessionInfo;
}) {
	const {capabilities} = agent;
	return (
		<section aria-label="Connected agent">
			<p>
				Connected to {agent.name ?? 'an unnamed agent'}{' '}
				{agent.version ?? '(no version)'} over ACP protocol version{' '}
				{agent.protocolVersion} in {agent.root}
			</p>
			<p>
				Session {session.id} in {session.mode} mode
			</p>
			<dl>
				<dt>Resume sessions</dt>
				<dd>{yesNo(capabilities.sessions.resume)}</dd>
				<dt>Close sessions</dt>
				<dd>{yesNo(capabilities.sessions.close)}</dd>
				<dt>List sessions</dt>
				<dd>{yesNo(capabilities.sessions.list)}</dd>
				<dt>Delete sessions</dt>
				<dd>{yesNo(capabilities.sessions.delete)}</dd>
				<dt>Load sessions</dt>
				<dd>{yesNo(capabilities.loadSession)}</dd>
			</dl>
		</section>
	);
}

function PermissionCard({request}: {request: PermissionRequestInfo}) {
	return (
		<section aria-label="Permission request">
			<p>Nanocoder asks to run: {request.title}</p>
			{request.options.map(option => (
				<button
					key={option.id}
					type="button"
					onClick={() => {
						void window.desktop.answerPermission(request.id, option.id);
					}}
				>
					{option.name}
				</button>
			))}
		</section>
	);
}

function Conversation({transcript}: {transcript: Transcript}) {
	return (
		<ol aria-label="Conversation">
			{transcript.items.map((item, index) => (
				<li key={item.kind === 'tool' ? item.id : `${item.kind}-${index}`}>
					{item.kind === 'user' && <>You: {item.text}</>}
					{item.kind === 'agent' && <>Nanocoder: {item.text}</>}
					{item.kind === 'tool' && (
						<>
							Tool {item.title}: {item.status}
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
	const roots = useRef(new Map<string, string>());
	const outcome = opened?.ok ? opened.value : null;
	const root = outcome?.status === 'connected' ? outcome.agent.root : '';
	const transcript = transcripts[root] ?? emptyTranscript;
	const sending = running[root] ?? false;
	const turn = turns[root];

	useEffect(
		() =>
			window.desktop.onProjectEvent(event => {
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
		setTranscripts(current => ({
			...current,
			[root]: addUserMessage(current[root] ?? emptyTranscript, text),
		}));
		const result = await window.desktop.sendPrompt(text);
		setTurns(current => ({...current, [root]: result}));
		setRunning(current => ({...current, [root]: false}));
	};

	return (
		<main>
			<h1>{info?.name}</h1>
			{info && (
				<p>
					Version {info.version}. Pre-v0.1: an early build, with most features
					still to come.
				</p>
			)}
			{runtime?.ok && (
				<p>
					Nanocoder {runtime.value.version} at {runtime.value.cliPath}, on
					Node.js {runtime.value.nodeVersion} at {runtime.value.nodePath}
				</p>
			)}
			{runtime && !runtime.ok && (
				<>
					<p role="alert">{runtime.error.message}</p>
					<button type="button" onClick={checkRuntime}>
						Check again
					</button>
				</>
			)}
			{runtime?.ok && (
				<button type="button" onClick={connect} disabled={connecting}>
					{connecting ? 'Starting Nanocoder' : 'Open a project folder'}
				</button>
			)}
			{outcome?.status === 'connected' && (
				<AgentDetails agent={outcome.agent} session={outcome.session} />
			)}
			{outcome?.status === 'connected' && gates[outcome.agent.root] && (
				<FeatureDetails gates={gates[outcome.agent.root]} />
			)}
			{outcome?.status === 'connected' && (
				<form onSubmit={send}>
					<label>
						Message
						<input
							value={draft}
							onChange={event => setDraft(event.target.value)}
							disabled={sending}
						/>
					</label>
					<button type="submit" disabled={sending || draft.trim() === ''}>
						Send
					</button>
				</form>
			)}
			{outcome?.status === 'connected' && (
				<Conversation transcript={transcript} />
			)}
			{transcript.permissions.map(request => (
				<PermissionCard key={request.id} request={request} />
			))}
			{turn?.ok && <p>Turn ended: {turn.value.stopReason}</p>}
			{turn && !turn.ok && <p role="alert">{turn.error.message}</p>}
			{outcome?.status === 'untrusted' && (
				<p role="alert">Not opened. {outcome.message}</p>
			)}
			{opened && !opened.ok && <p role="alert">{opened.error.message}</p>}
		</main>
	);
}
