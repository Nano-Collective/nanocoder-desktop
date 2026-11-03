import type {ProjectEvent} from '@/shared/ipc';
import type {TurnCommit, TurnReview} from '@/shared/review';

// Only tool kinds that change a file count as touching it. Reads and searches
// also carry locations, but labelling them would send the user to unchanged files.
const EDITING = new Set(['edit', 'delete', 'move']);
const MAX_TOUCHED = 500;

export interface TrackerOptions {
	head(projectId: string): Promise<string | null>;
	commits(
		projectId: string,
		before: string | null,
		after: string | null,
	): Promise<TurnCommit[]>;
	// A path as the agent reported it, as a project-relative path, or undefined.
	relative(projectId: string, reported: string): string | undefined;
	changed(projectId: string): void;
}

// Honest last-turn labelling (GIT-05, GIT-12): which files tool calls edited and
// which commits appeared while the turn ran. It does not claim to know more:
// files changed by a shell command are shown by Git but not labelled.
export class TurnTracker {
	private readonly turns = new Map<string, TurnReview>();
	// What a turn replaces, and whether it ever produced an event, so a prompt
	// refused before it started leaves the earlier labels in place.
	private readonly started = new Map<
		string,
		{previous: TurnReview | undefined; events: number}
	>();

	constructor(private readonly options: TrackerOptions) {}

	// The turn is registered at once, so edits reported while HEAD is still being
	// read are not missed; the HEAD lookup then runs beside the prompt, never
	// ahead of it. False when a turn is already running here: that turn keeps
	// its record.
	async begin(projectId: string, threadId: string): Promise<boolean> {
		if (this.turns.get(projectId)?.running) return false;
		const review: TurnReview = {
			threadId,
			running: true,
			touched: [],
			headBefore: null,
			headAfter: null,
			commits: [],
		};
		this.started.set(projectId, {
			previous: this.turns.get(projectId),
			events: 0,
		});
		this.turns.set(projectId, review);
		this.options.changed(projectId);
		const head = await this.options.head(projectId).catch(() => null);
		if (this.turns.get(projectId) === review) review.headBefore = head;
		return true;
	}

	observe(event: ProjectEvent): void {
		if (event.type !== 'turn' || event.replay) return;
		const turn = this.turns.get(event.projectId);
		if (!turn?.running || turn.threadId !== event.threadId) return;
		const begun = this.started.get(event.projectId);
		if (begun) begun.events++;
		let added = false;
		for (const update of event.events) {
			if (update.type !== 'tool' || !EDITING.has(update.toolKind ?? ''))
				continue;
			for (const location of update.details?.locations ?? []) {
				const path = this.options.relative(event.projectId, location.path);
				if (
					path &&
					!turn.touched.includes(path) &&
					turn.touched.length < MAX_TOUCHED
				) {
					turn.touched.push(path);
					added = true;
				}
			}
		}
		if (added) this.options.changed(event.projectId);
	}

	async end(
		projectId: string,
		threadId: string,
		succeeded: boolean,
	): Promise<void> {
		const turn = this.turns.get(projectId);
		if (!turn?.running || turn.threadId !== threadId) return;
		const begun = this.started.get(projectId);
		this.started.delete(projectId);
		if (!succeeded && !begun?.events && !turn.touched.length) {
			if (begun?.previous) this.turns.set(projectId, begun.previous);
			else this.turns.delete(projectId);
			this.options.changed(projectId);
			return;
		}
		turn.running = false;
		turn.headAfter = await this.options.head(projectId).catch(() => null);
		turn.commits = await this.options
			.commits(projectId, turn.headBefore, turn.headAfter)
			.catch(() => []);
		this.options.changed(projectId);
	}

	latest(projectId: string): TurnReview | null {
		const turn = this.turns.get(projectId);
		return turn ? structuredClone(turn) : null;
	}

	forget(projectId: string): void {
		this.turns.delete(projectId);
		this.started.delete(projectId);
	}
}
