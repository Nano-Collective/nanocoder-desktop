import type {FilesApi} from '@/shared/files';
import type {
	ReviewApi,
	ReviewDiff,
	ReviewEntry,
	ReviewStatus,
} from '@/shared/review';

export type ReviewFilter = 'all' | 'staged' | 'unstaged' | 'touched';

export interface ReviewState {
	projectId: string | null;
	status: 'idle' | 'loading' | 'ready' | 'error';
	value: ReviewStatus | null;
	error: string | null;
	filter: ReviewFilter;
	selected: {path: string; staged: boolean} | null;
	diff: {
		status: 'loading' | 'ready' | 'error';
		value: ReviewDiff | null;
		error: string | null;
	} | null;
}

export type ReviewBridge = Pick<ReviewApi, 'status' | 'diff'> &
	Pick<FilesApi, 'onEvent'>;

export const emptyReviewState = (projectId: string | null): ReviewState => ({
	projectId,
	status: 'idle',
	value: null,
	error: null,
	filter: 'all',
	selected: null,
	diff: null,
});

// GIT-03: staged and unstaged are separate views of the same paths.
export function visibleEntries(
	value: ReviewStatus | null,
	filter: ReviewFilter,
): ReviewEntry[] {
	if (!value?.available) return [];
	return value.entries.filter(entry => {
		switch (filter) {
			case 'staged':
				return entry.staged !== 'none';
			case 'unstaged':
				return entry.unstaged !== 'none' || entry.untracked || entry.conflicted;
			case 'touched':
				return entry.touched;
			default:
				return true;
		}
	});
}

// Which side opens first: staged only when nothing is left unstaged.
export function defaultSide(entry: ReviewEntry): boolean {
	return (
		entry.staged !== 'none' &&
		entry.unstaged === 'none' &&
		!entry.untracked &&
		!entry.conflicted
	);
}

export class ReviewController {
	private state: ReviewState = emptyReviewState(null);
	private epoch = 0;
	private statusToken = 0;
	private diffToken = 0;
	private running = false;
	private dirty = false;
	private disposed = false;
	private readonly unsubscribe: () => void;

	constructor(
		private readonly bridge: ReviewBridge,
		private readonly changed: (state: ReviewState) => void,
	) {
		this.unsubscribe = bridge.onEvent(event => {
			if (
				!this.disposed &&
				event.type === 'review-changed' &&
				event.projectId === this.state.projectId
			)
				void this.refresh();
		});
	}

	getState(): ReviewState {
		return this.state;
	}

	select(projectId: string | null): void {
		if (projectId === this.state.projectId) return;
		++this.epoch;
		this.running = false;
		this.dirty = false;
		this.update(emptyReviewState(projectId));
		if (projectId) void this.refresh();
	}

	setFilter(filter: ReviewFilter): void {
		this.update({...this.state, filter});
	}

	// Changes that arrive while a read is running are folded into one more read.
	async refresh(): Promise<void> {
		const projectId = this.state.projectId;
		if (!projectId) return;
		if (this.running) {
			this.dirty = true;
			return;
		}
		this.running = true;
		const epoch = this.epoch;
		const token = ++this.statusToken;
		this.update({
			...this.state,
			status: this.state.value ? 'ready' : 'loading',
			error: null,
		});
		const result = await this.bridge.status({projectId}).catch(() => null);
		if (this.disposed || epoch !== this.epoch) return;
		this.running = false;
		if (token === this.statusToken) {
			this.update({
				...this.state,
				status: result?.ok ? 'ready' : 'error',
				value: result?.ok ? result.value : this.state.value,
				error: result?.ok
					? null
					: result
						? result.error.message
						: 'The repository could not be read',
			});
			const selected = this.state.selected;
			if (selected && result?.ok)
				void this.show(selected.path, selected.staged);
		}
		if (this.dirty) {
			this.dirty = false;
			void this.refresh();
		}
	}

	async show(path: string, staged: boolean): Promise<void> {
		const projectId = this.state.projectId;
		if (!projectId) return;
		const epoch = this.epoch;
		const token = ++this.diffToken;
		const reload = this.state.selected?.path === path;
		this.update({
			...this.state,
			selected: {path, staged},
			diff: {
				status: 'loading',
				value: reload ? (this.state.diff?.value ?? null) : null,
				error: null,
			},
		});
		const result = await this.bridge
			.diff({projectId, path, staged})
			.catch(() => null);
		if (this.disposed || epoch !== this.epoch || token !== this.diffToken)
			return;
		this.update({
			...this.state,
			diff: result?.ok
				? {status: 'ready', value: result.value, error: null}
				: {
						status: 'error',
						value: null,
						error: result ? result.error.message : 'The diff could not be read',
					},
		});
	}

	clearSelection(): void {
		++this.diffToken;
		this.update({...this.state, selected: null, diff: null});
	}

	dispose(): void {
		this.disposed = true;
		++this.epoch;
		this.unsubscribe();
	}

	private update(next: ReviewState): void {
		if (this.disposed) return;
		this.state = next;
		this.changed(next);
	}
}

const STATE_WORDS = {
	none: '',
	modified: 'modified',
	added: 'added',
	deleted: 'deleted',
	renamed: 'renamed',
} as const;

// One plain sentence for a row of the review list, used by screen readers and
// as the visible summary, so neither depends on colour.
export function describeEntry(entry: ReviewEntry): string {
	const parts: string[] = [];
	if (entry.conflicted) parts.push('has a merge conflict');
	if (entry.untracked) parts.push('untracked');
	if (entry.staged !== 'none')
		parts.push(`staged ${STATE_WORDS[entry.staged]}`);
	if (entry.unstaged !== 'none')
		parts.push(`unstaged ${STATE_WORDS[entry.unstaged]}`);
	if (entry.oldPath) parts.push(`from ${entry.oldPath}`);
	if (entry.touched) parts.push('touched in the last turn');
	return parts.join(', ');
}
