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

// Header turn states are plain: a coloured glyph and an ink word. ACP states keep their pill.
const badges = {
	running: {glyph: '●', label: 'running', tone: 'running', plain: true},
	approval: {
		glyph: '●',
		label: 'approval required',
		tone: 'approval',
		plain: true,
	},
	ready: {glyph: '●', label: 'ready', tone: 'success', plain: true},
	interrupted: {glyph: '●', label: 'interrupted', tone: 'muted', plain: true},
	'view-only': {glyph: '●', label: 'view-only', tone: 'muted', plain: true},
	failed: {glyph: '●', label: 'failed', tone: 'failed', plain: true},
	'acp-ready': {
		glyph: '✓',
		label: 'acp · ready',
		tone: 'success',
		plain: false,
	},
	'acp-exited': {
		glyph: '○',
		label: 'acp · exited',
		tone: 'muted',
		plain: false,
	},
} as const;

export function StatusBadge({
	status,
	exitCode,
}: {
	status: keyof typeof badges;
	exitCode?: number;
}) {
	const {glyph, label, tone, plain} = badges[status];
	return (
		<span
			className={
				plain
					? `ui-badge ui-badge--plain ui-badge--${status}`
					: `ui-badge ui-badge--${tone} ui-badge--${status}`
			}
			role="status"
		>
			{plain ? (
				<span
					aria-hidden="true"
					className={`ui-badge-glyph ui-badge-glyph--${tone}`}
				>
					{glyph}
				</span>
			) : (
				<span aria-hidden="true">{glyph}</span>
			)}{' '}
			{label}
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
