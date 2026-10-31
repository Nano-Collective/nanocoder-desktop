import {useEffect, useRef, useState} from 'react';
import {Button, Card} from '@/renderer/ui';
import type {IpcResult, SupervisorState} from '@/shared/ipc';
import '@/renderer/styles/recovery-tools.css';

interface RecoveryProps {
	state: SupervisorState | null;
	onRetry(projectId: string): Promise<IpcResult<SupervisorState>>;
	onDiagnostics(): void;
	diagnosticsBusy: boolean;
	diagnosticsMessage: string;
}

function ProcessRecovery({
	state,
	busy,
	onRetry,
	onDiagnostics,
}: {
	state: SupervisorState;
	busy: boolean;
	onRetry(): void;
	onDiagnostics(): void;
}) {
	const failed = ['failed', 'untrusted', 'unsupported'].includes(state.status);
	const preparing = state.status === 'starting' || state.status === 'stopping';
	return (
		<Card
			variant={failed ? 'failure' : 'default'}
			className={`nc-recovery${state.status === 'ready' ? ' nc-recovery--ready' : ''}`}
			aria-label="Nanocoder recovery"
		>
			<p role="status">
				<span aria-hidden="true">{failed ? '✕' : preparing ? '◐' : '○'} </span>
				{state.status === 'ready'
					? 'Nanocoder is ready'
					: preparing
						? `${state.status} Nanocoder`
						: 'Nanocoder is not ready'}
			</p>
			{state.reason && <p>{state.reason}</p>}
			{state.exit && (
				<p>
					{state.exit.signal
						? `signal ${state.exit.signal}`
						: `exit code ${state.exit.code ?? 'unknown'}`}
				</p>
			)}
			{state.restart.nextAttemptAt && (
				<p>
					automatic recovery {state.restart.attempt} of {state.restart.limit} is
					scheduled
				</p>
			)}
			{state.status === 'failed' &&
				state.restart.limit > 0 &&
				state.restart.attempt >= state.restart.limit &&
				!state.restart.nextAttemptAt && (
					<p>automatic recovery stopped after {state.restart.limit} attempts</p>
				)}
			<div className="nc-recovery-actions">
				{state.status !== 'ready' && (
					<Button onClick={onRetry} disabled={busy || preparing}>
						retry Nanocoder
					</Button>
				)}
				<Button onClick={onDiagnostics} disabled={busy}>
					diagnostics
				</Button>
			</div>
		</Card>
	);
}

export function RecoveryTools({
	state,
	onRetry,
	onDiagnostics,
	diagnosticsBusy,
	diagnosticsMessage,
}: RecoveryProps) {
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState('');
	const generation = useRef(0);
	const projectId = state?.projectId;
	const selectedProject = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (selectedProject.current === projectId) return;
		selectedProject.current = projectId;
		generation.current++;
		setMessage('');
		setBusy(false);
	}, [projectId]);
	if (!state) return null;

	const retry = async () => {
		if (busy) return;
		const selected = generation.current;
		setBusy(true);
		setMessage('');
		try {
			const result = await onRetry(state.projectId);
			if (selected === generation.current && !result.ok)
				setMessage(result.error.message);
		} catch {
			if (selected === generation.current)
				setMessage('the request could not finish');
		} finally {
			if (selected === generation.current) setBusy(false);
		}
	};
	const shown = message || diagnosticsMessage;
	return (
		<>
			<ProcessRecovery
				state={state}
				busy={busy || diagnosticsBusy}
				onRetry={() => {
					void retry();
				}}
				onDiagnostics={onDiagnostics}
			/>
			{shown && <p role="status">{shown}</p>}
		</>
	);
}
