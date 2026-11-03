import type {IpcResult} from '@/shared/ipc';
import type {ReviewMark} from '@/shared/review';

export const FILES_CHANNELS = {
	list: 'files:list',
	preview: 'files:preview',
	openInEditor: 'files:open-in-editor',
	reveal: 'files:reveal',
	// Pushed from main to the renderer.
	event: 'files:event',
} as const;

export interface FileEntry {
	name: string;
	kind: 'directory' | 'file' | 'other';
	// A link that resolves outside the project is listed but never followed (FILE-10).
	link: 'none' | 'inside' | 'outside';
	size: number | null;
	unreadable: boolean;
	ignored: boolean;
	mark: ReviewMark | null;
}

export interface FileListing {
	path: string;
	entries: FileEntry[];
	// Entries beyond the per-directory limit that are not listed (FILE-01).
	notShown: number;
	// The scan stopped at its safety cap, so notShown is a lower bound.
	incomplete: boolean;
	// 'limited' means the platform watch limit was reached; manual refresh still works (FILE-05).
	watch: 'active' | 'limited';
}

export type PreviewReason =
	| 'binary'
	| 'too-large'
	| 'unsupported-encoding'
	| 'not-a-file'
	| 'outside-project'
	| 'unreadable';

export type TextEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be';

interface PreviewBase {
	path: string;
	name: string;
	size: number;
	modified: number;
}

export type FilePreview =
	| (PreviewBase & {
			kind: 'text';
			text: string;
			encoding: TextEncoding;
			// Highlighting is only offered up to its own, smaller size limit.
			highlight: boolean;
	  })
	| (PreviewBase & {
			kind: 'metadata';
			reason: PreviewReason;
			detail: string;
	  });

export type FilesEvent =
	| {
			type: 'changed';
			projectId: string;
			// Directories to list again; '' is the project root.
			directories: string[];
			// Too many changes to name: list every open directory again.
			overflow: boolean;
	  }
	| {type: 'watch-limit'; projectId: string}
	| {type: 'review-changed'; projectId: string};

export interface FilesRequests {
	list: {projectId: string; path: string};
	preview: {projectId: string; path: string};
	openInEditor: {projectId: string; path: string; line?: number};
	reveal: {projectId: string; path: string};
}

export interface FilesValues {
	list: FileListing;
	preview: FilePreview;
	openInEditor: {editor: 'system' | 'code' | 'cursor' | 'zed'};
	reveal: null;
}

export type FilesApi = {
	[K in keyof FilesRequests]: (
		request: FilesRequests[K],
	) => Promise<IpcResult<FilesValues[K]>>;
} & {onEvent(listener: (event: FilesEvent) => void): () => void};

const CONTROL_OR_BIDI =
	/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

// Names are shown to the user exactly as they exist, except that characters
// which can reorder or hide text are made visible (SEC-04).
export function displayName(name: string): string {
	return name.replace(
		CONTROL_OR_BIDI,
		character =>
			`\u2039U+${(character.codePointAt(0) ?? 0)
				.toString(16)
				.toUpperCase()
				.padStart(4, '0')}\u203a`,
	);
}
