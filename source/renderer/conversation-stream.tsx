import * as React from 'react';
import {AgentMarkdown} from '@/renderer/agent-markdown';
import {StreamAnnouncements} from '@/renderer/stream-announcements';
import {SubagentRunCard} from '@/renderer/subagent-run-card';
import {
	currentTurnStart,
	type Transcript,
	type TranscriptItem,
} from '@/renderer/transcript';
import type {StreamMetadata, StreamToolDetails} from '@/shared/ipc';

function ReportedMetadata({metadata}: {metadata?: StreamMetadata}) {
	if (!metadata) return null;
	const usage = metadata.usage;
	const tokens = usage?.totalTokens;
	const tokenLabel =
		tokens !== undefined
			? `+${tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tok`
			: [
					usage?.inputTokens === undefined ? '' : `${usage.inputTokens} in`,
					usage?.outputTokens === undefined ? '' : `${usage.outputTokens} out`,
				]
					.filter(Boolean)
					.join(' · ');
	return (
		<div className="stream-reported">
			{tokenLabel && (
				<span className="stream-token-chip" title="reported token usage">
					{tokenLabel}
				</span>
			)}
			{usage?.cost !== undefined && <span>reported cost: {usage.cost}</span>}
			{metadata.durationMs !== undefined && (
				<span>reported duration: {metadata.durationMs} ms</span>
			)}
			{metadata.outcome && <span>{metadata.outcome}</span>}
			{metadata.artifacts?.map(artifact => (
				<span key={`${artifact.kind}:${artifact.path}`}>
					{artifact.kind}: {artifact.path} (not opened)
				</span>
			))}
		</div>
	);
}

function glyph(status: string) {
	return status === 'completed'
		? '✓'
		: status === 'failed' || status === 'cancelled'
			? '✕'
			: status === 'in_progress'
				? '◐'
				: status === 'pending'
					? '○'
					: '◌';
}

function ToolDetails({details}: {details: StreamToolDetails}) {
	return (
		<div className="stream-tool-details">
			{details.locations?.map((location, index) => (
				<p key={`${location.path}:${index}`}>
					{location.path}
					{location.line === undefined ? '' : `:${location.line}`}
				</p>
			))}
			{details.input !== undefined && (
				<>
					<p>input</p>
					<pre>{details.input}</pre>
				</>
			)}
			{details.output !== undefined && (
				<>
					<p>output</p>
					<pre>{details.output}</pre>
				</>
			)}
			{details.content?.map((text, index) => (
				<pre key={index}>{text}</pre>
			))}
		</div>
	);
}

function isSubagentRun(item: TranscriptItem) {
	return (
		item.kind === 'subagent' || (item.kind === 'tool' && !!item.delegation)
	);
}

const StreamRow = React.memo(function StreamRow({
	item,
	runPosition,
	runCount,
	streaming,
	active,
	stopping,
	onStopTurn,
	outcome,
}: {
	item: TranscriptItem;
	runPosition: number;
	runCount: number;
	streaming: boolean;
	active: boolean;
	stopping: boolean;
	onStopTurn?: () => void;
	outcome?: 'completed' | 'failed' | 'cancelled';
}) {
	let content: React.ReactNode;
	switch (item.kind) {
		case 'user':
			content = (
				<>
					<div className="stream-author">you</div>
					<div className="stream-plain">{item.text}</div>
				</>
			);
			break;
		case 'agent':
			content = (
				<>
					<div className="stream-author stream-author-agent">
						<span aria-hidden="true">✱ </span>Nanocoder
					</div>
					<ReportedMetadata metadata={item.metadata} />
					<AgentMarkdown text={item.text} />
					{streaming && (
						<span className="stream-cursor" aria-label="streaming">
							▌
						</span>
					)}
				</>
			);
			break;
		case 'thought':
			content = (
				<div className="stream-reasoning">
					<span aria-hidden="true">◌ </span>
					<span className="stream-author">reasoning</span>
					<p>{item.text}</p>
				</div>
			);
			break;
		case 'turn-metadata':
			content = (
				<>
					<div className="stream-author">turn details</div>
					<ReportedMetadata metadata={item.metadata} />
				</>
			);
			break;
		case 'failure':
			content = (
				<>
					<span aria-hidden="true">✕ </span>failed turn: {item.text}
				</>
			);
			break;
		case 'tool': {
			if (item.delegation) {
				content = (
					<SubagentRunCard
						position={runPosition}
						total={runCount}
						title={item.title}
						role={item.delegation.role}
						task={item.delegation.task}
						status={item.status}
						history={item.delegation.history}
						running={active}
						stopping={stopping}
						outcome={item.turnOutcome ?? outcome}
						onStopTurn={onStopTurn}
					/>
				);
				break;
			}
			const summary = (
				<>
					<span
						className={`stream-tool-status${item.status === 'in_progress' ? ' spinner' : ''}`}
						aria-hidden="true"
					>
						{glyph(item.status)}{' '}
					</span>
					tool <code className="stream-tool-name">{item.title}</code>:{' '}
					{item.approvalOnly && item.status === 'completed'
						? 'approved · execution result not reported'
						: item.status.replaceAll('_', ' ')}
				</>
			);
			const details = item.details;
			content =
				details &&
				(details.content?.length ||
					details.locations?.length ||
					details.input !== undefined ||
					details.output !== undefined) ? (
					<details>
						<summary>
							<span className="stream-disclosure" aria-hidden="true" />
							{summary}
						</summary>
						<ToolDetails details={details} />
					</details>
				) : (
					<div>{summary}</div>
				);
			break;
		}
		case 'plan':
			content = (
				<>
					<div className="stream-author">plan</div>
					{item.content.kind === 'items' ? (
						<ul>
							{item.content.entries.map((entry, index) => (
								<li key={index}>
									<span aria-hidden="true">{glyph(entry.status)} </span>
									{entry.content} · {entry.status.replaceAll('_', ' ')} ·{' '}
									{entry.priority}
								</li>
							))}
						</ul>
					) : item.content.kind === 'markdown' ? (
						<AgentMarkdown text={item.content.text} />
					) : (
						<p>
							plan file not opened: <code>{item.content.uri}</code>
						</p>
					)}
				</>
			);
			break;
		case 'notice':
			content = (
				<>
					<span aria-hidden="true">
						{item.severity === 'error'
							? '✕'
							: item.severity === 'warning'
								? '▲'
								: '○'}{' '}
					</span>
					{item.severity}: {item.title}
					{item.description && <p>{item.description}</p>}
				</>
			);
			break;
		case 'compaction':
			content = (
				<details>
					<summary>
						<span aria-hidden="true">{glyph(item.status)} </span>context
						compaction: {item.status.replaceAll('_', ' ')}
					</summary>
					{item.summary && <div className="stream-plain">{item.summary}</div>}
					{item.error && <p>{item.error}</p>}
				</details>
			);
			break;
		case 'subagent':
			content = (
				<SubagentRunCard
					position={runPosition}
					total={runCount}
					title={item.title}
					task={item.description}
					status={item.state}
				/>
			);
			break;
		case 'session-message':
			content = (
				<>
					<div className="stream-author">inter-session message</div>
					<div className="stream-plain">
						{item.text || 'content not reported'}
					</div>
				</>
			);
			break;
	}
	return (
		<li
			className={`gate-message-${item.kind}`}
			data-status={'status' in item ? item.status : undefined}
		>
			{content}
		</li>
	);
});

export function ConversationStream({
	transcript,
	running,
	children,
	onStopTurn,
	stopping = false,
	outcome,
}: {
	transcript: Transcript;
	running: boolean;
	children?: React.ReactNode;
	onStopTurn?: () => Promise<void>;
	stopping?: boolean;
	outcome?: 'completed' | 'failed' | 'cancelled';
}) {
	const stop = React.useRef(onStopTurn);
	const pending = React.useRef(false);
	const [localStopping, setLocalStopping] = React.useState(false);
	const [stopError, setStopError] = React.useState('');
	React.useEffect(() => {
		stop.current = onStopTurn;
	}, [onStopTurn]);
	const stopTurn = React.useCallback(() => {
		const action = stop.current;
		if (pending.current || !action) return;
		pending.current = true;
		setLocalStopping(true);
		setStopError('');
		void (async () => {
			try {
				await action();
			} catch {
				setStopError('could not stop the turn. try again.');
			} finally {
				pending.current = false;
				setLocalStopping(false);
			}
		})();
	}, []);
	const turnStart = currentTurnStart(transcript.items);
	const keyOccurrences = new Map<string, number>();
	const runCount = transcript.items.filter(isSubagentRun).length;
	let runPosition = 0;
	const context = transcript.context;
	const percentage = context
		? Math.min(
				100,
				Math.max(0, Math.round((context.used / context.size) * 100)),
			)
		: 0;
	return (
		<section className="conversation-stream">
			<ol className="gate-transcript" aria-label="conversation">
				{transcript.items.map((item, index) => {
					if (isSubagentRun(item)) runPosition++;
					const base =
						'id' in item
							? `${item.kind}:${item.id}`
							: 'messageId' in item && item.messageId
								? `${item.kind}:${item.messageId}:${index}`
								: `${item.kind}:${index}`;
					const occurrence = keyOccurrences.get(base) ?? 0;
					keyOccurrences.set(base, occurrence + 1);
					return (
						<StreamRow
							key={`${base}:${occurrence}`}
							item={item}
							runPosition={runPosition}
							runCount={runCount}
							active={running && index > turnStart}
							outcome={index > turnStart ? outcome : undefined}
							stopping={stopping || localStopping}
							onStopTurn={onStopTurn ? stopTurn : undefined}
							streaming={
								running &&
								item.kind === 'agent' &&
								index === transcript.items.length - 1
							}
						/>
					);
				})}
			</ol>
			<StreamAnnouncements
				transcript={transcript}
				running={running}
				outcome={outcome}
			/>
			{stopError && <p role="alert">{stopError}</p>}
			{transcript.mode && (
				<p className="stream-session">reported mode: {transcript.mode}</p>
			)}
			{!!transcript.config?.length && (
				<details className="stream-session">
					<summary>reported configuration</summary>
					<dl>
						{transcript.config.map(option => (
							<React.Fragment key={option.id}>
								<dt>{option.name}</dt>
								<dd>{String(option.value)}</dd>
							</React.Fragment>
						))}
					</dl>
				</details>
			)}
			{context && (
				<div className="stream-context">
					<p>
						reported context: {context.used} / {context.size} tokens
						{context.cost && (
							<>
								{' '}
								· session cost: {context.cost.amount} {context.cost.currency}
							</>
						)}
					</p>
					<div
						role="progressbar"
						aria-label="reported context use"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={percentage}
						aria-valuetext={`${context.used} of ${context.size} reported context tokens`}
					>
						<span style={{width: `${percentage}%`}} />
					</div>
				</div>
			)}
			{children}
		</section>
	);
}
