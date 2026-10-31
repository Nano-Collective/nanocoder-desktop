import {Button, Card, Divider} from '@/renderer/ui';
import type {
	CapabilityGates,
	ConnectedAgent,
	IpcResult,
	NanocoderRuntime,
	ThreadInfo,
} from '@/shared/ipc';

export function FeatureDetails({gates}: {gates: CapabilityGates}) {
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

export function AgentDetails({
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

export function RuntimeDetails({
	runtime,
	agent,
	gates,
	open = false,
	onCheckRuntime,
}: {
	runtime: IpcResult<NanocoderRuntime> | null;
	agent?: ConnectedAgent;
	gates?: CapabilityGates;
	open?: boolean;
	onCheckRuntime(): void;
}) {
	return (
		<details className="runtime-details" open={open || undefined}>
			<summary>runtime and setup details</summary>
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
						<Button onClick={onCheckRuntime}>check again</Button>
					</>
				)}
			</section>
			{agent && <AgentDetails agent={agent} thread={null} />}
			{gates && <FeatureDetails gates={gates} />}
		</details>
	);
}
