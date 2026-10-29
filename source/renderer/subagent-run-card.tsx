import * as React from 'react';
import {Button} from '@/renderer/ui';
import {subagentLabel} from '@/shared/subagents';

export const SubagentRunCard = React.memo(function SubagentRunCard({
	title,
	role,
	task,
	status,
	history = false,
	running = false,
	stopping = false,
	outcome,
	onStopTurn,
}: {
	title?: string | null;
	role?: string;
	task?: string | null;
	status?: string | null;
	history?: boolean;
	running?: boolean;
	stopping?: boolean;
	outcome?: 'completed' | 'failed' | 'cancelled';
	onStopTurn?: () => void;
}) {
	const unfinished = status === 'pending' || status === 'in_progress';
	const state = history
		? 'historical outcome not reported'
		: unfinished && outcome === 'cancelled'
			? 'interrupted'
			: unfinished && outcome === 'failed'
				? 'failed'
				: unfinished && !running
					? 'result not reported'
					: status === 'in_progress'
						? 'running'
						: status
							? (subagentLabel(status.replaceAll('_', ' '), 80) ??
								'state not reported')
							: 'state not reported';
	const canStop = running && !history && unfinished && onStopTurn;
	const name = subagentLabel(role, 160) ?? 'subagent';
	const progress = subagentLabel(title);
	return (
		<section className="subagent-run-card" aria-label={`subagent run: ${name}`}>
			<header>
				<span className="subagent-task">
					<span aria-hidden="true">⌗ </span>
					{subagentLabel(task) ?? name}
				</span>
				<span className="subagent-depth">depth not reported · limit 2</span>
				<span>
					<span aria-hidden="true">
						{state === 'completed'
							? '✓'
							: state === 'failed'
								? '✕'
								: state === 'running'
									? '◐'
									: '○'}{' '}
					</span>
					{state}
				</span>
				<span>elapsed not reported</span>
				{canStop && (
					<Button
						variant="reject"
						disabled={stopping}
						aria-label={`stop turn: ${name}; stops the entire turn and all subagents`}
						onClick={onStopTurn}
					>
						<span aria-hidden="true">✕ </span>
						{stopping ? 'stopping turn' : 'stop turn'}
					</Button>
				)}
			</header>
			{progress && (
				<p className="subagent-progress">
					<span aria-hidden="true">└ </span>reported: {progress}
				</p>
			)}
			<p className="subagent-fallback">
				child details not available · source bounds: depth 2, batch 5 · not
				configurable here
			</p>
		</section>
	);
});
