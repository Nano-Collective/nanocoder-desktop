import * as React from 'react';
import {composerEnter} from '@/renderer/composer-key';
import {SlashSuggestions} from '@/renderer/stream-commands';
import type {Transcript} from '@/renderer/transcript';
import {Button} from '@/renderer/ui';
import type {
	DefaultMode,
	NanocoderMode,
	ProjectConfigSelect,
	ProjectControls,
	StreamCommand,
} from '@/shared/ipc';

export interface ComposerProps {
	draft: string;
	editable: boolean;
	sendReason: string | null;
	controlReason: string | null;
	projectName: string;
	projectControls: ProjectControls | null;
	mode: NanocoderMode;
	defaultMode: DefaultMode;
	modePending: boolean;
	running: boolean;
	stopping: boolean;
	error?: string | null;
	commands: readonly StreamCommand[];
	context?: Transcript['context'];
	inputRef?: React.RefObject<HTMLTextAreaElement | null>;
	onDraft(value: string): void;
	onSend(): void;
	onCancel(): void;
	onMode(mode: NanocoderMode): void;
	onDefault(mode: DefaultMode): void;
	onConfig(id: ProjectConfigSelect['id'], value: string): void;
}

const modes: NanocoderMode[] = [
	'normal',
	'auto-accept',
	'yolo',
	'plan',
	'architect',
];

export function Composer(props: ComposerProps) {
	const localInput = React.useRef<HTMLTextAreaElement>(null);
	const input = props.inputRef ?? localInput;
	React.useLayoutEffect(() => {
		const element = input.current;
		if (!element || element.value !== props.draft) return;
		element.style.height = 'auto';
		element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
	}, [input, props.draft]);
	const id = React.useId();
	const hintId = `${id}-send`;
	const modelHintId = `${id}-model`;
	const modeHintId = `${id}-mode`;
	const defaultHintId = `${id}-default`;
	const missingOffers =
		'available after the first message: Nanocoder supplies model options after a session exists';
	const options = props.projectControls?.configOptions ?? [];
	const modelReason =
		props.controlReason ??
		(!props.projectControls?.modelGate.enabled
			? (props.projectControls?.modelGate.reason ?? missingOffers)
			: options.length
				? null
				: missingOffers);
	const modeReason =
		props.controlReason ??
		(!props.editable ? 'this thread cannot change mode yet' : null);
	const defaultReason =
		modeReason ??
		(props.mode === 'yolo'
			? 'yolo cannot be a project default'
			: props.mode === props.defaultMode
				? 'already the project default'
				: null);
	const sendReason =
		props.sendReason ??
		(!props.editable
			? 'this thread cannot accept input'
			: !props.draft.trim()
				? 'enter a message to send'
				: null);
	const send = () => {
		if (!sendReason) props.onSend();
	};
	const context =
		props.context &&
		Number.isFinite(props.context.used) &&
		props.context.used >= 0 &&
		Number.isFinite(props.context.size) &&
		props.context.size > 0
			? props.context
			: undefined;
	const percentage = context
		? Math.min(100, Math.round((context.used / context.size) * 100))
		: 0;
	return (
		<form
			className="gate-composer composer"
			data-unavailable={!props.editable || undefined}
			onSubmit={event => {
				event.preventDefault();
				send();
			}}
		>
			<label className="composer-message">
				<span aria-hidden="true" className="composer-prompt">
					›
				</span>
				<span className="sr-only">message</span>
				<textarea
					className="composer-inactive-control"
					ref={input}
					value={props.draft}
					onChange={event => props.onDraft(event.currentTarget.value)}
					onKeyDown={event => {
						if (
							composerEnter({
								key: event.key,
								shiftKey: event.shiftKey,
								altKey: event.altKey,
								ctrlKey: event.ctrlKey,
								metaKey: event.metaKey,
								isComposing: event.nativeEvent.isComposing,
								keyCode: event.nativeEvent.keyCode,
							})
						) {
							event.preventDefault();
							send();
						}
					}}
					disabled={!props.editable}
					placeholder="ask anything…"
					aria-describedby={hintId}
					rows={2}
				/>
			</label>
			<SlashSuggestions
				commands={props.commands}
				draft={props.draft}
				disabled={!props.editable}
				onInsert={value => {
					props.onDraft(value);
					props.inputRef?.current?.focus();
				}}
			/>
			<div className="gate-actions">
				<Button
					type="submit"
					aria-label="send"
					disabled={!!sendReason}
					aria-describedby={hintId}
				>
					<span aria-hidden="true">▶ </span>send
				</Button>
				{props.running && (
					<Button
						variant="reject"
						disabled={props.stopping}
						onClick={props.onCancel}
					>
						{props.stopping ? 'cancelling turn' : 'cancel turn'}
					</Button>
				)}
				<p id={hintId} className="gate-hint">
					{sendReason ?? '⏎ send · ⇧⏎ newline · / commands'}
				</p>
			</div>
			<div className="composer-control-rail">
				{options.length ? (
					options.map(option => (
						<label key={option.id} className="composer-pill">
							<span aria-hidden="true">
								{option.id === 'model' ? '✳ ' : ''}
								{option.id}
							</span>
							<select
								className="composer-inactive-control"
								aria-label={`${option.id} for every thread in project ${props.projectName}`}
								aria-describedby={modelHintId}
								value={option.currentValue}
								disabled={!!modelReason}
								onChange={event =>
									props.onConfig(option.id, event.currentTarget.value)
								}
							>
								{option.options.map(value => (
									<option key={value.value} value={value.value}>
										{value.name}
									</option>
								))}
							</select>
						</label>
					))
				) : (
					<Button
						disabled
						aria-label={`model and provider for every thread in project ${props.projectName}`}
						aria-describedby={modelHintId}
					>
						available after the first message
					</Button>
				)}
				<label className="composer-pill composer-mode">
					<span aria-hidden="true">mode</span>
					<select
						className="composer-inactive-control"
						aria-label="mode for this thread"
						aria-describedby={modeHintId}
						value={props.mode}
						disabled={!!modeReason}
						onChange={event =>
							props.onMode(event.currentTarget.value as NanocoderMode)
						}
					>
						{modes.map(mode => (
							<option key={mode} value={mode}>
								{mode}
							</option>
						))}
					</select>
				</label>
				{context && (
					<span className="composer-pill composer-context">
						⌁ ctx {percentage}%
					</span>
				)}
			</div>
			<p id={modelHintId} className="gate-hint">
				{modelReason ??
					`applies to every thread in project ${props.projectName}`}
			</p>
			<p id={modeHintId} className="gate-hint">
				{modeReason && <>{modeReason}. </>}
				{props.modePending && <>{props.mode} · pending first message. </>}
				tools in Nanocoder's alwaysAllow list run without asking in every mode
			</p>
			<div className="gate-actions">
				<Button
					disabled={!!defaultReason}
					aria-describedby={defaultHintId}
					onClick={() => {
						if (!defaultReason && props.mode !== 'yolo')
							props.onDefault(props.mode);
					}}
				>
					use as this project's default
				</Button>
				<p id={defaultHintId} className="gate-hint">
					project default: {props.defaultMode}
					{defaultReason ? ` · ${defaultReason}` : ''}
				</p>
			</div>
			{props.error && <p role="alert">{props.error}</p>}
			{context && (
				<div
					className="composer-context-gauge"
					role="progressbar"
					aria-label="reported context use"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={percentage}
					aria-valuetext={`${context.used} of ${context.size} reported context tokens`}
				>
					<span style={{width: `${percentage}%`}} />
				</div>
			)}
		</form>
	);
}
