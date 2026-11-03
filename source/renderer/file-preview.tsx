import * as React from 'react';
import {CodeView} from '@/renderer/code-view';
import {formatSize} from '@/renderer/file-tree';
import type {PreviewState} from '@/renderer/files-controller';
import {Button} from '@/renderer/ui';
import {displayName, type FilePreview as Preview} from '@/shared/files';

const ENCODINGS = {
	'utf-8': 'UTF-8',
	'utf-8-bom': 'UTF-8 with byte order mark',
	'utf-16le': 'UTF-16 (little endian)',
	'utf-16be': 'UTF-16 (big endian)',
} as const;

const REASONS: Record<Extract<Preview, {kind: 'metadata'}>['reason'], string> =
	{
		binary: 'binary file',
		'too-large': 'too large to preview',
		'unsupported-encoding': 'unsupported text encoding',
		'not-a-file': 'not a regular file',
		'outside-project': 'outside the project',
		unreadable: 'could not be read',
	};

export function FilePreview({
	preview,
	attachReason,
	message,
	onAttach,
	onOpenEditor,
	onReveal,
	onClose,
}: {
	preview: PreviewState;
	attachReason: string | null;
	message: string | null;
	onAttach(path: string): void;
	onOpenEditor(path: string): void;
	onReveal(path: string): void;
	onClose(): void;
}): React.ReactElement {
	const value = preview.value;
	const name = value?.name ?? preview.path.split('/').at(-1) ?? preview.path;
	return (
		<section
			className="file-preview"
			aria-label={`preview of ${displayName(name)}`}
		>
			<header className="file-preview-header">
				<div className="file-preview-title">
					<h3>{displayName(name)}</h3>
					<p className="file-preview-path">{displayName(preview.path)}</p>
				</div>
				<div
					className="file-preview-actions"
					role="group"
					aria-label="file actions"
				>
					<Button
						onClick={() => onAttach(preview.path)}
						disabled={attachReason !== null || preview.value?.kind !== 'text'}
						title={attachReason ?? undefined}
					>
						attach to chat
					</Button>
					<Button onClick={() => onOpenEditor(preview.path)}>
						open in editor
					</Button>
					<Button onClick={() => onReveal(preview.path)}>reveal</Button>
					<Button onClick={onClose}>close preview</Button>
				</div>
			</header>
			{attachReason && value?.kind === 'text' && (
				<p className="files-hint">attach is unavailable: {attachReason}</p>
			)}
			{message && (
				<p role="status" className="files-hint">
					{message}
				</p>
			)}
			{preview.status === 'loading' && <p role="status">reading the file…</p>}
			{preview.status === 'error' && <p role="alert">{preview.error}</p>}
			{value?.kind === 'text' && (
				<>
					<p className="file-preview-meta">
						{formatSize(value.size)} · {ENCODINGS[value.encoding]}
						{!value.highlight && ' · no highlighting (large file)'}
					</p>
					<CodeView
						text={value.text}
						path={value.path}
						highlight={value.highlight}
						label={`contents of ${displayName(value.path)}`}
					/>
				</>
			)}
			{value?.kind === 'metadata' && (
				<div className="preview-metadata" role="status">
					<p className="preview-metadata-reason">
						not previewed: {REASONS[value.reason]}
					</p>
					<p>{value.detail}</p>
					<p className="file-preview-meta">
						{value.size ? `${formatSize(value.size)}` : 'size unknown'}
					</p>
				</div>
			)}
		</section>
	);
}
