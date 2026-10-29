import {useEffect, useRef, useState} from 'react';
import {Button, Card} from '@/renderer/ui';
import type {
	DiagnosticsSnapshot,
	IpcResult,
	SupervisorState,
} from '@/shared/ipc';
import '@/renderer/styles/recovery-tools.css';

interface RecoveryProps {
	state: SupervisorState | null;
	onRetry(projectId: string): Promise<IpcResult<SupervisorState>>;
	onCapture(projectId: string): Promise<IpcResult<DiagnosticsSnapshot>>;
	onExport(request: {
		projectId: string;
		snapshotId: string;
	}): Promise<IpcResult<{status: 'exported' | 'cancelled'}>>;
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
			className="nc-recovery"
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

function DiagnosticsView({
	snapshot,
	busy,
	message,
	onExport,
	onClose,
}: {
	snapshot: DiagnosticsSnapshot;
	busy: boolean;
	message: string;
	onExport(): void;
	onClose(): void;
}) {
	return (
		<Card className="nc-diagnostics" aria-label="redacted diagnostics">
			<h2>redacted diagnostics</h2>
			<p>
				review this captured snapshot. exporting asks again in a native dialog,
				then asks where to save it. nothing is sent automatically.
			</p>
			{snapshot.truncated && <p>older or oversized diagnostics were omitted</p>}
			<pre tabIndex={0} role="region" aria-label="captured diagnostics">
				{snapshot.lines.join('\n') || 'No diagnostics were captured.'}
			</pre>
			<div className="nc-recovery-actions">
				<Button onClick={onExport} disabled={busy}>
					review and export
				</Button>
				<Button onClick={onClose} disabled={busy}>
					close diagnostics
				</Button>
			</div>
			{message && <p role="status">{message}</p>}
		</Card>
	);
}

export function RecoveryTools({
	state,
	onRetry,
	onCapture,
	onExport,
}: RecoveryProps) {
	const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState('');
	const generation = useRef(0);
	const projectId = state?.projectId;
	const selectedProject = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (selectedProject.current === projectId) return;
		selectedProject.current = projectId;
		generation.current++;
		setSnapshot(null);
		setMessage('');
		setBusy(false);
	}, [projectId]);
	if (!state) return null;

	const run = async (action: () => Promise<void>) => {
		if (busy) return;
		const selected = generation.current;
		setBusy(true);
		setMessage('');
		try {
			await action();
		} catch {
			if (selected === generation.current)
				setMessage('the request could not finish');
		} finally {
			if (selected === generation.current) setBusy(false);
		}
	};
	const retry = () =>
		run(async () => {
			const selected = generation.current;
			const result = await onRetry(state.projectId);
			if (selected === generation.current && !result.ok)
				setMessage(result.error.message);
		});
	const capture = () =>
		run(async () => {
			const selected = generation.current;
			const result = await onCapture(state.projectId);
			if (selected !== generation.current) return;
			if (result.ok) setSnapshot(result.value);
			else setMessage(result.error.message);
		});
	const exportSnapshot = () =>
		run(async () => {
			if (!snapshot) return;
			const selected = generation.current;
			const result = await onExport({
				projectId: snapshot.projectId,
				snapshotId: snapshot.id,
			});
			if (selected === generation.current)
				setMessage(
					result.ok
						? result.value.status === 'exported'
							? 'diagnostics exported'
							: 'export cancelled'
						: result.error.message,
				);
		});
	return (
		<>
			<ProcessRecovery
				state={state}
				busy={busy}
				onRetry={() => {
					void retry();
				}}
				onDiagnostics={() => {
					void capture();
				}}
			/>
			{snapshot?.projectId === state.projectId ? (
				<DiagnosticsView
					snapshot={snapshot}
					busy={busy}
					message={message}
					onExport={() => {
						void exportSnapshot();
					}}
					onClose={() => {
						setSnapshot(null);
						setMessage('');
					}}
				/>
			) : (
				message && <p role="status">{message}</p>
			)}
		</>
	);
}
