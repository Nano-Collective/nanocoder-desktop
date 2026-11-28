import * as React from 'react';
import {
	AgentMarkdown,
	CopyContext,
	LocalUrlContext,
} from '@/renderer/agent-markdown';
import {Icon} from '@/renderer/icons';
import {
	clockTime,
	dayLabel,
	timeStamp,
	untimedHistoryTitle,
} from '@/renderer/message-time';
import {StreamAnnouncements} from '@/renderer/stream-announcements';
import {SubagentRunCard} from '@/renderer/subagent-run-card';
import {type Transcript, type TranscriptItem} from '@/renderer/transcript';
import {
	formatToolLocation,
	type TranscriptFindTarget,
	transcriptFieldId,
	transcriptRowKeys,
} from '@/renderer/transcript-find';
import {
	clearTranscriptFind,
	paintTranscriptFind,
} from '@/renderer/transcript-highlights';
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
				? '●'
				: status === 'pending'
					? '○'
					: '◌';
}

function toolWord(status: string) {
	return status === 'completed'
		? ''
		: status === 'in_progress'
			? 'running'
			: status.replaceAll('_', ' ');
}

function ToolDetails({
	details,
	rowKey,
}: {
	details: StreamToolDetails;
	rowKey: string;
}) {
	return (
		<div className="stream-tool-details">
			{details.locations?.map((location, index) => (
				<p
					key={`${location.path}:${index}`}
					data-find-id={transcriptFieldId(rowKey, 'tool-location', index)}
				>
					{formatToolLocation(location)}
				</p>
			))}
			{details.input !== undefined && (
				<>
					<p>input</p>
					<pre data-find-id={transcriptFieldId(rowKey, 'tool-input')}>
						{details.input}
					</pre>
				</>
			)}
			{details.output !== undefined && (
				<>
					<p>output</p>
					<pre data-find-id={transcriptFieldId(rowKey, 'tool-output')}>
						{details.output}
					</pre>
				</>
			)}
			{details.content?.map((text, index) => (
				<pre
					key={index}
					data-find-id={transcriptFieldId(rowKey, 'tool-content', index)}
				>
					{text}
				</pre>
			))}
		</div>
	);
}

function isSubagentRun(item: TranscriptItem) {
	return (
		item.kind === 'subagent' || (item.kind === 'tool' && !!item.delegation)
	);
}

function isPanelTool(item: TranscriptItem | undefined) {
	return item?.kind === 'tool' && !item.delegation;
}

function isAgentTurnItem(item: TranscriptItem) {
	return (
		item.kind === 'agent' ||
		item.kind === 'thought' ||
		item.kind === 'plan' ||
		isPanelTool(item)
	);
}

// One pass per change to the transcript: the turn start, run counts, label
// owners, row keys and tool groups that the render reads by index.
function indexStream(items: readonly TranscriptItem[]) {
	const keys = transcriptRowKeys(items);
	const runPositions: number[] = [];
	const groups: (string | undefined)[] = [];
	const labels = new Map<number, {at?: number}>();
	let turnStart = -1;
	let lastFailure = -1;
	let runs = 0;
	let dayTime: number | undefined;
	// One agent label per turn, timed from the turn's first live agent message.
	let label: {at?: number} | null = null;
	for (const [index, item] of items.entries()) {
		if (isSubagentRun(item)) runs++;
		runPositions.push(runs);
		groups.push(toolGroup(items, index));
		if (item.kind === 'failure') lastFailure = index;
		if (item.kind === 'user') {
			turnStart = index;
			label = null;
		} else if (isAgentTurnItem(item)) {
			if (!label) {
				label = {};
				labels.set(index, label);
			}
			if (item.kind === 'agent' && label.at === undefined) label.at = item.at;
		}
		if (
			dayTime === undefined &&
			(item.kind === 'user' || item.kind === 'agent') &&
			item.at !== undefined
		)
			dayTime = item.at;
	}
	return {
		turnStart,
		lastFailure,
		runCount: runs,
		labels,
		dayTime,
		keys,
		runPositions,
		groups,
	};
}

function toolGroup(items: readonly TranscriptItem[], index: number) {
	if (!isPanelTool(items[index])) return undefined;
	const first = index === 0 || !isPanelTool(items[index - 1]);
	const last = !isPanelTool(items[index + 1]);
	return first ? (last ? 'only' : 'first') : last ? 'last' : 'middle';
}

function AgentLabel({at}: {at?: number}) {
	return (
		<li className="gate-message-label">
			<div className="stream-author stream-author-agent">
				Nanocoder
				{at !== undefined && (
					<>
						{' '}
						<time className="stream-time" dateTime={timeStamp(at)}>
							{clockTime(at)}
						</time>
					</>
				)}
			</div>
		</li>
	);
}

function CopyMessage({text}: {text: string}) {
	const copy = React.useContext(CopyContext);
	if (!copy || !text.length) return null;
	return (
		<div className="stream-message-actions">
			<button
				type="button"
				className="stream-copy"
				aria-label="copy text"
				title="copy text"
				onClick={() => copy(text)}
			>
				<Icon name="copy" size={14} />
			</button>
		</div>
	);
}

const StreamRow = React.memo(function StreamRow({
	rowKey,
	item,
	runPosition,
	runCount,
	streaming,
	active,
	stopping,
	onStopTurn,
	outcome,
	group,
	notice,
	findOpen,
}: {
	rowKey: string;
	item: TranscriptItem;
	runPosition: number;
	runCount: number;
	streaming: boolean;
	active: boolean;
	stopping: boolean;
	onStopTurn?: () => void;
	outcome?: 'completed' | 'failed' | 'cancelled';
	group?: string;
	notice?: React.ReactNode;
	findOpen: boolean;
}) {
	let content: React.ReactNode;
	switch (item.kind) {
		case 'user':
			content = (
				<>
					<div className="stream-author">
						you
						{item.at !== undefined && (
							<>
								{' '}
								<time className="stream-time" dateTime={timeStamp(item.at)}>
									{clockTime(item.at)}
								</time>
							</>
						)}
					</div>
					<CopyMessage text={item.text} />
					<div
						className="stream-plain"
						data-find-id={transcriptFieldId(rowKey, 'user')}
					>
						{item.text}
					</div>
					{item.attachmentSummary?.length ? (
						<div className="stream-plain">
							{item.attachmentSummary.join('\n')}
						</div>
					) : null}
				</>
			);
			break;
		case 'agent':
			content = (
				<>
					<CopyMessage text={item.text} />
					<ReportedMetadata metadata={item.metadata} />
					<div data-find-id={transcriptFieldId(rowKey, 'agent')}>
						<AgentMarkdown text={item.text} />
					</div>
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
				<details className="stream-reasoning" open={streaming || undefined}>
					<summary>
						<span className="stream-disclosure" aria-hidden="true" />
						<span aria-hidden="true">◌ </span>reasoning · reported by Nanocoder
					</summary>
					<p>{item.text}</p>
				</details>
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
			content = notice ?? (
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
						historyOutcome={item.historyOutcome}
						running={active}
						stopping={stopping}
						outcome={item.turnOutcome ?? outcome}
						onStopTurn={onStopTurn}
						findId={transcriptFieldId(rowKey, 'tool-title')}
					/>
				);
				break;
			}
			const details = item.details;
			const hasDetails =
				!!details &&
				(!!details.content?.length ||
					!!details.locations?.length ||
					details.input !== undefined ||
					details.output !== undefined);
			const running = item.status === 'in_progress';
			const kindInTitle =
				!running &&
				!!item.toolKind &&
				item.title.startsWith(`${item.toolKind} `);
			const word =
				item.approvalOnly && item.status === 'completed'
					? 'approved · execution result not reported'
					: toolWord(item.status);
			const foldable = hasDetails || running;
			const summary = (
				<>
					{foldable && (
						<span className="stream-disclosure" aria-hidden="true" />
					)}
					<span
						className={`stream-tool-status${running ? ' spinner' : ''}`}
						aria-hidden="true"
					>
						{glyph(item.status)}
					</span>
					{item.status === 'completed' && (
						<span className="sr-only">completed </span>
					)}
					{word && <span className="stream-tool-state">{word} </span>}
					{item.toolKind && !kindInTitle && (
						<span className="stream-tool-verb">{item.toolKind} </span>
					)}
					{!running && (
						<code
							className="stream-tool-name"
							data-find-id={transcriptFieldId(rowKey, 'tool-title')}
						>
							{item.title}
						</code>
					)}
				</>
			);
			content = foldable ? (
				<details
					open={
						running ||
						item.status === 'failed' ||
						item.status === 'cancelled' ||
						findOpen ||
						undefined
					}
				>
					<summary>{summary}</summary>
					{running && (
						<p
							className="stream-tool-detail"
							data-find-id={transcriptFieldId(rowKey, 'tool-title')}
						>
							{item.title}
						</p>
					)}
					{details && hasDetails && (
						<ToolDetails details={details} rowKey={rowKey} />
					)}
					{running && (
						<p className="stream-tool-wait">
							waiting for Nanocoder's tool result
						</p>
					)}
				</details>
			) : (
				<div className="stream-tool-summary">{summary}</div>
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
			className={`gate-message-${item.kind}${group ? ` stream-tool-${group}` : ''}`}
			data-row-key={rowKey}
			data-status={'status' in item ? item.status : undefined}
		>
			{content}
		</li>
	);
});

const streamPaintMs = 150;

// The transcript find as the stream shows it: the query, the active match and
// a revision that asks for a reveal on each step.
interface StreamFind {
	query: string;
	activeId: string | null;
	activeTarget: TranscriptFindTarget | null;
	revision: number;
}

export function ConversationStream({
	transcript,
	running,
	children,
	onStopTurn,
	stopping = false,
	outcome,
	stopReason,
	failureNotice,
	onOpenLocalUrl,
	onCopy,
	find,
	now = Date.now,
}: {
	transcript: Transcript;
	running: boolean;
	children?: React.ReactNode;
	onStopTurn?: () => Promise<void>;
	stopping?: boolean;
	outcome?: 'completed' | 'failed' | 'cancelled';
	stopReason?: string;
	failureNotice?: React.ReactNode;
	onOpenLocalUrl?: (url: string) => void;
	onCopy?: (text: string) => void;
	find?: StreamFind;
	now?: () => number;
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
	const stream = React.useMemo(
		() => indexStream(transcript.items),
		[transcript.items],
	);
	const list = React.useRef<HTMLOListElement>(null);
	const findQuery = find?.query ?? '';
	const findActiveId = find?.activeId ?? null;
	const findRow = find?.activeTarget?.rowKey ?? null;
	const findField = find?.activeTarget
		? transcriptFieldId(
				find.activeTarget.rowKey,
				find.activeTarget.field,
				find.activeTarget.fieldIndex,
			)
		: null;
	const findOpenRow = find?.activeTarget?.folded ? findRow : null;
	const findRevision = find?.revision ?? 0;
	const paintedRevision = React.useRef(0);
	const findPaint = React.useRef({key: '', at: Number.NEGATIVE_INFINITY});
	// biome-ignore lint/correctness/useExhaustiveDependencies: marks are repainted when the rows change
	React.useEffect(() => {
		const scope = list.current;
		if (!scope || !findQuery) {
			clearTranscriptFind();
			return;
		}
		const scroller = scope.closest<HTMLElement>('.shell-stream-scroll');
		const shouldReveal =
			findRevision > 0 && findRevision !== paintedRevision.current;
		if (shouldReveal) {
			paintedRevision.current = findRevision;
			const field = findField
				? scope.querySelector(`[data-find-id="${CSS.escape(findField)}"]`)
				: null;
			const row = findRow
				? scope.querySelector(`[data-row-key="${CSS.escape(findRow)}"]`)
				: null;
			(field ?? row)?.scrollIntoView({block: 'center'});
		}
		let timer = 0;
		const paintMarks = () => {
			window.clearTimeout(timer);
			findPaint.current.at = performance.now();
			return paintTranscriptFind(
				scope,
				findQuery,
				findActiveId,
				scroller,
				findField,
			);
		};
		// Only a find change repaints at once. Streamed rows repaint the marks
		// at most once per interval, with a trailing repaint for the last batch.
		const key = [
			findQuery,
			findActiveId,
			findRevision,
			findRow,
			findField,
		].join('\n');
		const moved = findPaint.current.key !== key;
		const wait = findPaint.current.at + streamPaintMs - performance.now();
		findPaint.current.key = key;
		let painted: ReturnType<typeof paintMarks> = null;
		if (moved || wait <= 0) painted = paintMarks();
		else timer = window.setTimeout(paintMarks, wait);
		// A long message, code block or tool output can exceed the viewport; centre
		// the active range vertically and inside any horizontally scrollable container.
		if (shouldReveal && painted?.activeRange) {
			let scrolled = false;
			if (scroller) {
				const rangeRect = painted.activeRange.getBoundingClientRect();
				const viewRect = scroller.getBoundingClientRect();
				if (
					rangeRect.height > 0 &&
					(rangeRect.top < viewRect.top || rangeRect.bottom > viewRect.bottom)
				) {
					const delta =
						rangeRect.top -
						viewRect.top -
						(viewRect.height - rangeRect.height) / 2;
					scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
					scrolled = true;
				}
			}
			const startNode = painted.activeRange.startContainer;
			let container =
				startNode.nodeType === Node.ELEMENT_NODE
					? (startNode as HTMLElement)
					: startNode.parentElement;
			while (container && container !== scroller && scope.contains(container)) {
				if (container.scrollWidth > container.clientWidth) {
					const rangeRect = painted.activeRange.getBoundingClientRect();
					const boxRect = container.getBoundingClientRect();
					if (
						rangeRect.width > 0 &&
						(rangeRect.left < boxRect.left || rangeRect.right > boxRect.right)
					) {
						const delta =
							rangeRect.left -
							boxRect.left -
							(boxRect.width - rangeRect.width) / 2;
						container.scrollLeft = Math.max(0, container.scrollLeft + delta);
						scrolled = true;
					}
					break;
				}
				container = container.parentElement;
			}
			if (scrolled) paintMarks();
		}
		let frame = 0;
		const scheduleRepaint = () => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				paintMarks();
			});
		};
		if (scroller) {
			scroller.addEventListener('scroll', scheduleRepaint, {passive: true});
			window.addEventListener('resize', scheduleRepaint, {passive: true});
		}
		return () => {
			window.clearTimeout(timer);
			if (frame) cancelAnimationFrame(frame);
			scroller?.removeEventListener('scroll', scheduleRepaint);
			window.removeEventListener('resize', scheduleRepaint);
		};
	}, [
		transcript.items,
		findQuery,
		findActiveId,
		findRevision,
		findRow,
		findField,
	]);
	React.useEffect(() => clearTranscriptFind, []);
	const context = transcript.context;
	const percentage = context
		? Math.min(
				100,
				Math.max(0, Math.round((context.used / context.size) * 100)),
			)
		: 0;
	return (
		<CopyContext.Provider value={onCopy}>
			<LocalUrlContext.Provider value={onOpenLocalUrl}>
				<section
					className="conversation-stream"
					data-stop-reason={stopReason}
					data-empty={transcript.items.length === 0 || undefined}
				>
					{transcript.items.length > 0 &&
						(stream.dayTime === undefined ? (
							<p className="stream-day-label" title={untimedHistoryTitle}>
								saved history
							</p>
						) : (
							<p className="stream-day-label">
								{dayLabel(stream.dayTime, now())}
							</p>
						))}
					<ol ref={list} className="gate-transcript" aria-label="conversation">
						{transcript.items.map((item, index) => {
							const key = stream.keys[index];
							const label = stream.labels.get(index);
							const row = (
								<StreamRow
									key={key}
									rowKey={key}
									findOpen={findOpenRow === key}
									item={item}
									runPosition={stream.runPositions[index]}
									runCount={stream.runCount}
									active={running && index > stream.turnStart}
									outcome={index > stream.turnStart ? outcome : undefined}
									stopping={stopping || localStopping}
									onStopTurn={onStopTurn ? stopTurn : undefined}
									group={stream.groups[index]}
									notice={
										index === stream.lastFailure ? failureNotice : undefined
									}
									streaming={
										running &&
										(item.kind === 'agent' || item.kind === 'thought') &&
										index === transcript.items.length - 1
									}
								/>
							);
							return label ? (
								<React.Fragment key={key}>
									<AgentLabel at={label.at} />
									{row}
								</React.Fragment>
							) : (
								row
							);
						})}
					</ol>
					<StreamAnnouncements
						transcript={transcript}
						running={running}
						outcome={outcome}
					/>
					{stopError && <p role="alert">{stopError}</p>}
					{stopReason !== undefined && stopReason !== 'end_turn' && (
						<p className="stream-turn-note">
							{stopReason === 'cancelled'
								? 'turn interrupted'
								: 'turn stopped early'}
						</p>
					)}
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
										· session cost: {context.cost.amount}{' '}
										{context.cost.currency}
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
			</LocalUrlContext.Provider>
		</CopyContext.Provider>
	);
}
