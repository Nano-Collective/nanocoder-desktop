import {type FormEvent, useEffect, useState} from 'react';
import {
	addUserMessage,
	applyEvent,
	emptyTranscript,
	type Transcript,
} from '@/renderer/transcript';
import type {
	AppInfo,
	ConnectedAgent,
	ConnectResult,
	IpcResult,
	NanocoderRuntime,
	PermissionRequestInfo,
	SessionInfo,
	TurnResult,
} from '@/shared/ipc';

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

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
	const [transcript, setTranscript] = useState<Transcript>(emptyTranscript);
	const [draft, setDraft] = useState('');
	const [sending, setSending] = useState(false);
	const [turn, setTurn] = useState<IpcResult<TurnResult> | null>(null);

	useEffect(
		() =>
			window.desktop.onNanocoderEvent(event => {
				setTranscript(current => applyEvent(current, event));
			}),
		[],
	);

	useEffect(() => {
		void window.desktop.getAppInfo().then(result => {
			if (result.ok) {
				setInfo(result.value);
			}
		});
		void window.desktop.getNanocoderRuntime().then(setRuntime);
	}, []);

	const connect = async () => {
		setConnecting(true);
		const result = await window.desktop.connectNanocoder();
		setConnecting(false);
		if (!result.ok || result.value.status !== 'cancelled') {
			setOpened(result);
			setTranscript(emptyTranscript);
			setTurn(null);
		}
	};

	const send = async (event: FormEvent) => {
		event.preventDefault();
		const text = draft.trim();
		if (!text || sending) return;
		setDraft('');
		setSending(true);
		setTurn(null);
		setTranscript(current => addUserMessage(current, text));
		setTurn(await window.desktop.sendPrompt(text));
		setSending(false);
	};

	const outcome = opened?.ok ? opened.value : null;

	return (
		<main>
			<h1>{info?.name}</h1>
			{info && <p>Version {info.version}. Pre-v0.1. Nothing here works yet.</p>}
			{runtime?.ok && (
				<p>
					Nanocoder {runtime.value.version} at {runtime.value.cliPath}, on
					Node.js {runtime.value.nodeVersion} at {runtime.value.nodePath}
				</p>
			)}
			{runtime && !runtime.ok && <p role="alert">{runtime.error.message}</p>}
			{runtime?.ok && (
				<button type="button" onClick={connect} disabled={connecting}>
					{connecting ? 'Starting Nanocoder' : 'Open a project folder'}
				</button>
			)}
			{outcome?.status === 'connected' && (
				<AgentDetails agent={outcome.agent} session={outcome.session} />
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
