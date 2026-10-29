import * as React from 'react';

type ButtonProps = React.ComponentProps<'button'> & {
	variant?: 'default' | 'allow' | 'reject';
	keyHint?: string;
};

export function Button({
	variant = 'default',
	keyHint,
	className = '',
	children,
	type = 'button',
	...props
}: ButtonProps) {
	return (
		<button
			{...props}
			type={type}
			className={`ui-button ui-button--${variant} ${className}`}
		>
			{children}
			{keyHint && (
				<kbd className="ui-key-hint" aria-hidden="true">
					{keyHint}
				</kbd>
			)}
		</button>
	);
}

const badges = {
	running: {glyph: '●', label: 'running', tone: 'success'},
	approval: {glyph: '◐', label: 'approval', tone: 'warning'},
	idle: {glyph: '○', label: 'idle', tone: 'muted'},
	failed: {glyph: '✕', label: 'failed', tone: 'error'},
	'acp-ready': {glyph: '✓', label: 'acp · ready', tone: 'success'},
	'acp-exited': {glyph: '○', label: 'acp · exited', tone: 'muted'},
} as const;

export function StatusBadge({
	status,
	exitCode,
}: {
	status: keyof typeof badges;
	exitCode?: number;
}) {
	const {glyph, label, tone} = badges[status];
	return (
		<span className={`ui-badge ui-badge--${tone}`} role="status">
			<span aria-hidden="true">{glyph}</span> {label}
			{status === 'acp-exited' && exitCode !== undefined && ` (${exitCode})`}
		</span>
	);
}

export function Card({
	variant = 'default',
	className = '',
	...props
}: React.ComponentProps<'section'> & {
	variant?: 'default' | 'approval' | 'failure';
}) {
	return (
		<section
			{...props}
			className={`ui-card ui-card--${variant} ${className}`}
		/>
	);
}

export function Divider({soft = false}: {soft?: boolean}) {
	return <hr className={`ui-divider${soft ? ' ui-divider--soft' : ''}`} />;
}
