import * as React from 'react';
import {Button, Card} from '@/renderer/ui';
import type {IpcResult, SupervisorState} from '@/shared/ipc';

interface RecoveryProps {
	state: SupervisorState | null;
	turnFailure?: string | null;
	onRetry(projectId: string): Promise<IpcResult<SupervisorState>>;
	onDiagnostics(): void;
	diagnosticsBusy: boolean;
	diagnosticsMessage: string;
	onNew?(): void;
	newPending?: boolean;
}

export const FAILED_STATUSES = ['failed', 'untrusted', 'unsupported'];

function TurnStopped({title, reason}: {title: string; reason: string}) {
	return (
		<>
			<p className="nc-failure-title">
				<span aria-hidden="true">✕ </span>
				{title}
			</p>
			<p>your thread and unsent draft are still here.</p>
			<p>{reason}</p>
		</>
	);
}

export function TurnFailureNotice({reason}: {reason: string}) {
	return (
		<Card role="alert" className="nc-recovery nc-failure-notice">
			<TurnStopped title="this turn failed" reason={reason} />
		</Card>
	);
}

function ProcessRecovery({
	state,
	busy,
	newPending,
	turnFailure,
	onRetry,
	onDiagnostics,
	onNew,
}: {
	state: SupervisorState;
	busy: boolean;
	newPending: boolean;
	turnFailure: string | null;
	onRetry(): void;
	onDiagnostics(): void;
	onNew?(): void;
}) {
	const failed = FAILED_STATUSES.includes(state.status);
	const preparing = state.status === 'starting' || state.status === 'stopping';
	return (
		<Card
			className={`nc-recovery${state.status === 'ready' ? ' nc-recovery--ready' : ''}${failed ? ' nc-failure-notice' : ''}`}
			aria-label="Nanocoder recovery"
		>
			{failed && turnFailure ? (
				<div role="alert" className="nc-turn-stopped">
					<TurnStopped
						title={
							state.status === 'failed'
								? 'Nanocoder stopped unexpectedly'
								: 'this turn failed'
						}
						reason={turnFailure}
					/>
				</div>
			) : (
				<p role="status" className={failed ? 'nc-failure-title' : undefined}>
					<span aria-hidden="true">
						{failed ? '✕' : preparing ? '◐' : '○'}{' '}
					</span>
					{state.status === 'ready'
						? 'Nanocoder is ready'
						: preparing
							? `${state.status} Nanocoder`
							: 'Nanocoder is not ready'}
				</p>
			)}
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
			{failed && onNew && newPending && (
				<p role="status">waiting for the thread request or native dialog</p>
			)}
			<div className="nc-recovery-actions">
				{state.status !== 'ready' && (
					<Button onClick={onRetry} disabled={busy || preparing}>
						retry Nanocoder
					</Button>
				)}
				<Button onClick={onDiagnostics} disabled={busy}>
					review diagnostics
				</Button>
				{failed && onNew && (
					<Button onClick={onNew} disabled={busy || newPending}>
						start a new thread
					</Button>
				)}
			</div>
		</Card>
	);
}

export function RecoveryTools({
	state,
	turnFailure = null,
	onRetry,
	onDiagnostics,
	diagnosticsBusy,
	diagnosticsMessage,
	onNew,
	newPending = false,
}: RecoveryProps) {
	const [busy, setBusy] = React.useState(false);
	const [message, setMessage] = React.useState('');
	const generation = React.useRef(0);
	const projectId = state?.projectId;
	const selectedProject = React.useRef<string | undefined>(undefined);
	React.useEffect(() => {
		if (selectedProject.current === projectId) return;
		selectedProject.current = projectId;
		generation.current++;
		setMessage('');
		setBusy(false);
	}, [projectId]);
	const processFailed =
		state !== null && FAILED_STATUSES.includes(state.status);
	const notice =
		turnFailure && !processFailed ? (
			<TurnFailureNotice reason={turnFailure} />
		) : null;
	if (!state) return notice;

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
			{notice}
			<ProcessRecovery
				state={state}
				busy={busy || diagnosticsBusy}
				newPending={newPending}
				turnFailure={turnFailure}
				onRetry={() => {
					void retry();
				}}
				onDiagnostics={onDiagnostics}
				onNew={onNew}
			/>
			{shown && <p role="status">{shown}</p>}
		</>
	);
}
