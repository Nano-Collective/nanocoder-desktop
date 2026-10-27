import {useEffect, useState} from 'react';
import type {
	AppInfo,
	ConnectedAgent,
	ConnectResult,
	IpcResult,
	NanocoderRuntime,
	SessionInfo,
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

export function App() {
	const [info, setInfo] = useState<AppInfo | null>(null);
	const [runtime, setRuntime] = useState<IpcResult<NanocoderRuntime> | null>(
		null,
	);
	const [connecting, setConnecting] = useState(false);
	const [opened, setOpened] = useState<IpcResult<ConnectResult> | null>(null);

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
		}
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
			{outcome?.status === 'untrusted' && (
				<p role="alert">Not opened. {outcome.message}</p>
			)}
			{opened && !opened.ok && <p role="alert">{opened.error.message}</p>}
		</main>
	);
}
