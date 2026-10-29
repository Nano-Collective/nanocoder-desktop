import {type FormEvent, useCallback, useEffect, useState} from 'react';
import {
	addUserMessage,
	applyEvent,
	emptyTranscript,
	type Transcript,
} from '@/renderer/transcript';
import {Button, Card, Divider, StatusBadge} from '@/renderer/ui';
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

function PermissionCard({request}: {request: PermissionRequestInfo}) {
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
							void window.desktop.answerPermission(request.id, option.id);
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
		<main className="technical-gate">
			<header className="gate-header">
				<h1>{info?.name}</h1>
				{info && (
					<p className="gate-meta">
						version {info.version}. pre-v0.1: an early build, with most features
						still to come.
					</p>
				)}
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
				</div>
			</header>
			<Divider />
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
			{outcome?.status === 'connected' && (
				<form className="gate-composer" onSubmit={send}>
					<label>
						message
						<input
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
						<p id="composer-hint" className="gate-hint">
							{sending
								? 'waiting for Nanocoder to finish the turn'
								: draft.trim() === ''
									? 'enter a message to send'
									: 'ready to send'}
						</p>
					</div>
				</form>
			)}
			{outcome?.status === 'connected' && (
				<Conversation transcript={transcript} />
			)}
			{transcript.permissions.map(request => (
				<PermissionCard key={request.id} request={request} />
			))}
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
		</main>
	);
}
