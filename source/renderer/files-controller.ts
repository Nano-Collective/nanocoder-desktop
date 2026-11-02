import type {
	FileEntry,
	FileListing,
	FilePreview,
	FilesApi,
	FilesEvent,
} from '@/shared/files';
import type {ReviewMark} from '@/shared/review';

export interface DirectoryState {
	status: 'loading' | 'ready' | 'error';
	listing: FileListing | null;
	error: string | null;
}

export interface PreviewState {
	path: string;
	status: 'loading' | 'ready' | 'error';
	value: FilePreview | null;
	error: string | null;
}

export interface FilesState {
	projectId: string | null;
	directories: Record<string, DirectoryState>;
	expanded: string[];
	selected: string | null;
	preview: PreviewState | null;
	watch: 'active' | 'limited';
}

export type FilesBridge = Pick<FilesApi, 'list' | 'preview' | 'onEvent'>;

export const emptyFilesState = (projectId: string | null): FilesState => ({
	projectId,
	directories: {},
	expanded: [],
	selected: null,
	preview: null,
	watch: 'active',
});

const joinPath = (directory: string, name: string): string =>
	directory ? `${directory}/${name}` : name;

const parentPath = (path: string): string =>
	path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

// Lazy project tree state: one directory per request, expanded folders kept,
// and any answer that arrives after the project or folder changed is dropped.
export class FilesController {
	private state: FilesState = emptyFilesState(null);
	private epoch = 0;
	private readonly sequence = new Map<string, number>();
	private previews = 0;
	private disposed = false;
	private readonly unsubscribe: () => void;

	constructor(
		private readonly bridge: FilesBridge,
		private readonly changed: (state: FilesState) => void,
	) {
		this.unsubscribe = bridge.onEvent(event => this.receive(event));
	}

	getState(): FilesState {
		return this.state;
	}

	select(projectId: string | null): void {
		if (projectId === this.state.projectId) return;
		++this.epoch;
		this.sequence.clear();
		this.update(emptyFilesState(projectId));
		if (projectId) void this.load('');
	}

	toggle(path: string): void {
		const open = this.state.expanded.includes(path);
		this.update({
			...this.state,
			expanded: open
				? this.state.expanded.filter(value => value !== path)
				: [...this.state.expanded, path],
			selected: path,
		});
		if (!open && this.state.directories[path]?.status !== 'ready')
			void this.load(path);
	}

	focus(path: string | null): void {
		if (path !== this.state.selected)
			this.update({...this.state, selected: path});
	}

	async open(path: string): Promise<void> {
		const projectId = this.state.projectId;
		if (!projectId) return;
		const epoch = this.epoch;
		const token = ++this.previews;
		this.update({
			...this.state,
			selected: path,
			preview: {path, status: 'loading', value: null, error: null},
		});
		const result = await this.bridge
			.preview({projectId, path})
			.catch(() => null);
		if (this.disposed || epoch !== this.epoch || token !== this.previews)
			return;
		this.update({
			...this.state,
			preview: result?.ok
				? {path, status: 'ready', value: result.value, error: null}
				: {
						path,
						status: 'error',
						value: null,
						error: result ? result.error.message : 'The file could not be read',
					},
		});
	}

	closePreview(): void {
		++this.previews;
		this.update({...this.state, preview: null});
	}

	// Lists the root and every open folder again; folders that vanished close.
	async refresh(): Promise<void> {
		const open = [...this.state.expanded];
		await Promise.all(['', ...open].map(path => this.load(path, true)));
		if (this.state.preview?.status === 'ready')
			void this.open(this.state.preview.path);
	}

	dispose(): void {
		this.disposed = true;
		++this.epoch;
		this.unsubscribe();
	}

	private async load(path: string, keep = false): Promise<void> {
		const projectId = this.state.projectId;
		if (!projectId) return;
		const epoch = this.epoch;
		const token = (this.sequence.get(path) ?? 0) + 1;
		this.sequence.set(path, token);
		const previous = this.state.directories[path];
		this.setDirectory(path, {
			status: keep && previous?.listing ? 'ready' : 'loading',
			listing: previous?.listing ?? null,
			error: null,
		});
		const result = await this.bridge.list({projectId, path}).catch(() => null);
		if (
			this.disposed ||
			epoch !== this.epoch ||
			token !== this.sequence.get(path)
		)
			return;
		if (result?.ok) {
			this.setDirectory(path, {
				status: 'ready',
				listing: result.value,
				error: null,
			});
			if (result.value.watch !== this.state.watch)
				this.update({...this.state, watch: result.value.watch});
			return;
		}
		if (result && !result.ok && result.error.code === 'NOT_FOUND' && path) {
			// The folder is gone: close it and drop what was shown inside it.
			const directories = {...this.state.directories};
			for (const key of Object.keys(directories))
				if (key === path || key.startsWith(`${path}/`)) delete directories[key];
			this.update({
				...this.state,
				directories,
				expanded: this.state.expanded.filter(
					value => value !== path && !value.startsWith(`${path}/`),
				),
			});
			return;
		}
		this.setDirectory(path, {
			status: 'error',
			listing: previous?.listing ?? null,
			error: result ? result.error.message : 'The folder could not be listed',
		});
	}

	private setDirectory(path: string, value: DirectoryState): void {
		this.update({
			...this.state,
			directories: {...this.state.directories, [path]: value},
		});
	}

	private receive(event: FilesEvent): void {
		if (this.disposed || event.projectId !== this.state.projectId) return;
		if (event.type === 'watch-limit') {
			this.update({...this.state, watch: 'limited'});
			return;
		}
		if (event.type !== 'changed') return;
		if (event.overflow) {
			void this.refresh();
			return;
		}
		const open = new Set(['', ...this.state.expanded]);
		for (const directory of event.directories)
			if (open.has(directory)) void this.load(directory, true);
		const preview = this.state.preview;
		if (
			preview?.status === 'ready' &&
			event.directories.includes(parentPath(preview.path))
		)
			void this.open(preview.path);
	}

	private update(next: FilesState): void {
		if (this.disposed) return;
		this.state = next;
		this.changed(next);
	}
}

export interface EntryRow {
	type: 'entry';
	path: string;
	name: string;
	depth: number;
	parent: string;
	kind: FileEntry['kind'];
	link: FileEntry['link'];
	expandable: boolean;
	expanded: boolean;
	busy: boolean;
	mark: ReviewMark | null;
	ignored: boolean;
	unreadable: boolean;
	size: number | null;
	index: number;
	count: number;
}

export interface NoticeRow {
	type: 'notice';
	path: string;
	depth: number;
	parent: string;
	text: string;
}

export type TreeRow = EntryRow | NoticeRow;

// The visible rows in order, with the position data tree semantics need.
export function flattenTree(state: FilesState): TreeRow[] {
	const rows: TreeRow[] = [];
	const walk = (directory: string, depth: number) => {
		const node = state.directories[directory];
		if (!node?.listing) {
			if (node?.status === 'error')
				rows.push({
					type: 'notice',
					path: `${directory}\u0000error`,
					depth,
					parent: directory,
					text: node.error ?? 'This folder could not be listed',
				});
			return;
		}
		const {entries, notShown, incomplete} = node.listing;
		entries.forEach((entry, index) => {
			const path = joinPath(directory, entry.name);
			const followable = entry.kind === 'directory' && entry.link !== 'outside';
			const expanded = followable && state.expanded.includes(path);
			rows.push({
				type: 'entry',
				path,
				name: entry.name,
				depth,
				parent: directory,
				kind: entry.kind,
				link: entry.link,
				expandable: followable,
				expanded,
				busy: expanded && state.directories[path]?.status === 'loading',
				mark: entry.mark,
				ignored: entry.ignored,
				unreadable: entry.unreadable,
				size: entry.size,
				index: index + 1,
				count: entries.length,
			});
			if (expanded) walk(path, depth + 1);
		});
		if (notShown > 0)
			rows.push({
				type: 'notice',
				path: `${directory}\u0000more`,
				depth,
				parent: directory,
				text: `${notShown.toLocaleString('en')}${incomplete ? '+' : ''} more not shown`,
			});
		if (node.status === 'error')
			rows.push({
				type: 'notice',
				path: `${directory}\u0000error`,
				depth,
				parent: directory,
				text: node.error ?? 'This folder could not be refreshed',
			});
	};
	walk('', 0);
	return rows;
}

export type TreeAction =
	| {type: 'focus'; path: string}
	| {type: 'toggle'; path: string}
	| {type: 'open'; path: string}
	| {type: 'attach'; path: string};

// WAI-ARIA tree keys: arrows move and expand, Enter opens, Shift+Enter attaches.
export function treeKey(
	rows: readonly TreeRow[],
	focused: string | null,
	key: string,
	shift = false,
): TreeAction | null {
	const entries = rows.filter((row): row is EntryRow => row.type === 'entry');
	if (!entries.length) return null;
	const at = entries.findIndex(row => row.path === focused);
	const current = at >= 0 ? entries[at] : undefined;
	const go = (index: number): TreeAction => ({
		type: 'focus',
		path: entries[Math.max(0, Math.min(entries.length - 1, index))].path,
	});
	switch (key) {
		case 'ArrowDown':
			return go(at < 0 ? 0 : at + 1);
		case 'ArrowUp':
			return go(at < 0 ? 0 : at - 1);
		case 'Home':
			return go(0);
		case 'End':
			return go(entries.length - 1);
		case 'ArrowRight':
			if (!current) return go(0);
			if (current.expandable && !current.expanded)
				return {type: 'toggle', path: current.path};
			if (current.expanded) {
				const child = entries[at + 1];
				return child?.parent === current.path ? go(at + 1) : null;
			}
			return null;
		case 'ArrowLeft':
			if (!current) return null;
			if (current.expanded) return {type: 'toggle', path: current.path};
			return current.parent ? {type: 'focus', path: current.parent} : null;
		case 'Enter':
		case ' ':
			if (!current) return null;
			if (shift && current.kind === 'file')
				return {type: 'attach', path: current.path};
			return current.expandable
				? {type: 'toggle', path: current.path}
				: current.kind === 'file'
					? {type: 'open', path: current.path}
					: null;
		default:
			return null;
	}
}
