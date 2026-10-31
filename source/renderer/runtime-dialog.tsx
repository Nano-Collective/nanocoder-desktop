import * as React from 'react';
import {Button, Card} from '@/renderer/ui';
import type {
	CapabilityGates,
	ConnectedAgent,
	IpcResult,
	NanocoderRuntime,
	SupervisorState,
	ThreadInfo,
} from '@/shared/ipc';

export const runtimeDialogTitle = 'runtime details';

export interface RuntimeDialogProps {
	runtime: IpcResult<NanocoderRuntime> | null;
	processState: SupervisorState | null;
	projectRoot: string | null;
	gates: CapabilityGates | null;
	agent: ConnectedAgent | null;
	thread: ThreadInfo | null;
	diagnosticsBusy: boolean;
	diagnosticsMessage: string;
	onCheckAgain(): void;
	onCapabilities(): void;
	onDiagnostics(): void;
}

function processLabel(state: SupervisorState | null): string {
	if (state?.status === 'ready') return '✓ ACP connected';
	return `○ ${state?.status ?? 'not started'}`;
}

function sourceLabel(runtime: NanocoderRuntime): string {
	return runtime.source === 'override'
		? 'set by NANOCODER_DESKTOP_CLI'
		: 'found on this machine';
}

export function RuntimeDialogBody({
	runtime,
	processState,
	projectRoot,
	gates,
	agent,
	thread,
	diagnosticsMessage,
	onCheckAgain,
}: RuntimeDialogProps): React.ReactElement {
	const reason = gates?.versionPolicy.reason;
	return (
		<>
			{reason && <p role="status">{reason}</p>}
			{runtime?.ok && (
				<dl className="runtime-rows">
					<div>
						<dt>Nanocoder</dt>
						<dd>
							{runtime.value.version} · {sourceLabel(runtime.value)}
						</dd>
					</div>
					<div>
						<dt>Node.js</dt>
						<dd>{runtime.value.nodeVersion}</dd>
					</div>
					<div>
						<dt>process</dt>
						<dd>{processLabel(processState)}</dd>
					</div>
					<div>
						<dt>project root</dt>
						<dd>{projectRoot ?? 'no project selected'}</dd>
					</div>
					<div>
						<dt>CLI path</dt>
						<dd>{runtime.value.cliPath}</dd>
					</div>
					<div>
						<dt>runtime path</dt>
						<dd>{runtime.value.nodePath}</dd>
					</div>
				</dl>
			)}
			{runtime && !runtime.ok && (
				<>
					<p role="alert">{runtime.error.message}</p>
					<div>
						<Button onClick={onCheckAgain}>check again</Button>
					</div>
				</>
			)}
			{agent && (
				<Card aria-label="connected agent" className="runtime-agent">
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
				</Card>
			)}
			{diagnosticsMessage && <p role="status">{diagnosticsMessage}</p>}
		</>
	);
}

export function RuntimeDialogFooter({
	diagnosticsBusy,
	onCapabilities,
	onDiagnostics,
	onClose,
}: Pick<
	RuntimeDialogProps,
	'diagnosticsBusy' | 'onCapabilities' | 'onDiagnostics'
> & {onClose(): void}): React.ReactElement {
	return (
		<>
			<Button
				className="dialog-foot-start"
				onClick={onDiagnostics}
				disabled={diagnosticsBusy}
			>
				diagnostics
			</Button>
			<Button onClick={onCapabilities}>capabilities</Button>
			<Button onClick={onClose}>close</Button>
		</>
	);
}
