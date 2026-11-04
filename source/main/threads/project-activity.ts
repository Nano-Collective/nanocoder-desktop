import type {
	ProjectActivityStatus,
	ProjectEvent,
	ThreadRunState,
} from '@/shared/ipc';

const UNFINISHED = new Set<ThreadRunState>(['running', 'waiting-approval']);

export interface ProjectActivityChange {
	projectId: string;
	previous: ProjectActivityStatus;
	status: ProjectActivityStatus;
}

interface ProjectState {
	threads: Map<string, ThreadRunState>;
	// What ended while the user was elsewhere, until they open the project.
	attention: 'finished' | 'failed' | null;
	published: ProjectActivityStatus;
}

// What each project needs from the user, from the thread states main already publishes
// (CHAT-22). Metadata only: no message, command or file name is ever seen here.
export class ProjectActivityTracker {
	private readonly projects = new Map<string, ProjectState>();
	private readonly listeners = new Set<
		(change: ProjectActivityChange) => void
	>();

	constructor(
		private readonly options: {
			active(): string | undefined;
			publish(projectId: string, status: ProjectActivityStatus): void;
		},
	) {}

	observe(event: ProjectEvent): void {
		if (event.type === 'thread') {
			const state = this.state(event.projectId);
			const previous = state.threads.get(event.thread.id);
			const next = event.thread.runState;
			state.threads.set(event.thread.id, next);
			if (
				previous &&
				UNFINISHED.has(previous) &&
				!UNFINISHED.has(next) &&
				this.options.active() !== event.projectId
			) {
				if (next === 'ready') state.attention = 'finished';
				else if (next === 'failed' || next === 'interrupted')
					state.attention = 'failed';
			}
			this.refresh(event.projectId);
		} else if (event.type === 'thread-removed') {
			this.projects.get(event.projectId)?.threads.delete(event.threadId);
			this.refresh(event.projectId);
		} else if (event.type === 'project-removed') {
			const state = this.projects.get(event.projectId);
			if (!state) return;
			state.threads.clear();
			state.attention = null;
			this.refresh(event.projectId);
			this.projects.delete(event.projectId);
		}
	}

	// The user opened the project, so there is nothing left to notice.
	activate(projectId: string): void {
		const state = this.projects.get(projectId);
		if (!state) return;
		state.attention = null;
		this.refresh(projectId);
	}

	// A new renderer knows nothing yet, so it is told what needs attention.
	republish(): void {
		for (const [projectId, state] of this.projects) {
			const status = this.status(state);
			if (status !== 'idle') this.options.publish(projectId, status);
		}
	}

	// No renderer is attached, so there is nobody to mark anything for.
	reset(): void {
		for (const [projectId, state] of this.projects) {
			state.threads.clear();
			state.attention = null;
			this.refresh(projectId);
		}
		this.projects.clear();
	}

	// Projects with a turn that is running or waiting for the user, active or not.
	unfinished(): string[] {
		return [...this.projects]
			.filter(([, state]) =>
				[...state.threads.values()].some(run => UNFINISHED.has(run)),
			)
			.map(([projectId]) => projectId);
	}

	onChange(listener: (change: ProjectActivityChange) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private state(projectId: string): ProjectState {
		let state = this.projects.get(projectId);
		if (!state) {
			state = {threads: new Map(), attention: null, published: 'idle'};
			this.projects.set(projectId, state);
		}
		return state;
	}

	private status(state: ProjectState): ProjectActivityStatus {
		const runs = [...state.threads.values()];
		if (runs.includes('waiting-approval')) return 'needs-approval';
		if (runs.includes('running')) return 'running';
		return state.attention ?? 'idle';
	}

	private refresh(projectId: string): void {
		const state = this.projects.get(projectId);
		if (!state) return;
		const status = this.status(state);
		if (status === state.published) return;
		const previous = state.published;
		state.published = status;
		this.options.publish(projectId, status);
		for (const listener of this.listeners)
			listener({projectId, previous, status});
	}
}
