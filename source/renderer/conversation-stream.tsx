import * as React from 'react';
import {AgentMarkdown} from '@/renderer/agent-markdown';
import type {Transcript, TranscriptItem} from '@/renderer/transcript';
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

const StreamRow = React.memo(function StreamRow({
	item,
	streaming,
}: {
	item: TranscriptItem;
	streaming: boolean;
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
		case 'failure':
			content = (
				<>
					<span aria-hidden="true">✕ </span>failed turn: {item.text}
				</>
			);
			break;
		case 'tool': {
			const summary = (
				<>
					<span
						className={`stream-tool-status${item.status === 'in_progress' ? ' spinner' : ''}`}
						aria-hidden="true"
					>
						{glyph(item.status)}{' '}
					</span>
					tool <code className="stream-tool-name">{item.title}</code>:{' '}
					{item.status.replaceAll('_', ' ')}
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
				<>
					<span aria-hidden="true">⌗ </span>subagent: {item.title || 'untitled'}{' '}
					· {item.state?.replaceAll('_', ' ') || 'state not reported'}
					{item.description && <p>{item.description}</p>}
				</>
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
}: {
	transcript: Transcript;
	running: boolean;
	children?: React.ReactNode;
}) {
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
				{transcript.items.map((item, index) => (
					<StreamRow
						key={
							'id' in item
								? `${item.kind}:${item.id}`
								: 'messageId' in item && item.messageId
									? `${item.kind}:${item.messageId}:${index}`
									: `${item.kind}:${index}`
						}
						item={item}
						streaming={
							running &&
							item.kind === 'agent' &&
							index === transcript.items.length - 1
						}
					/>
				))}
			</ol>
			<ReportedMetadata metadata={transcript.metadata} />
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
