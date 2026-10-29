import type {DesktopApi} from '@/shared/desktop-api';
import type {ProjectEvent, ThreadInfo} from '@/shared/ipc';

type ThreadBridge = Pick<
	DesktopApi,
	'listThreads' | 'createThread' | 'onProjectEvent'
>;

export interface ThreadControllerState {
	projectId: string | null;
	threads: ThreadInfo[];
	activeThreadId: string | null;
	loading: boolean;
	pending: boolean;
	error: string | null;
}

export function createThreadController(options: {
	bridge: ThreadBridge;
	onChange(state: ThreadControllerState): void;
}) {
	let state: ThreadControllerState = {
		projectId: null,
		threads: [],
		activeThreadId: null,
		loading: false,
		pending: false,
		error: null,
	};
	let generation = 0;
	let disposed = false;
	let revision = 0;
	const sequences = new Map<string, number>();
	const changes = new Map<
		string,
		{revision: number; thread: ThreadInfo | null}
	>();
	const update = (patch: Partial<ThreadControllerState>) => {
		state = {...state, ...patch};
		options.onChange(structuredClone(state));
	};
	const put = (thread: ThreadInfo) => {
		changes.set(thread.id, {
			revision: ++revision,
			thread: structuredClone(thread),
		});
		update({
			threads: [
				...state.threads.filter(row => row.id !== thread.id),
				structuredClone(thread),
			],
		});
	};
	const selectProject = async (projectId: string | null) => {
		if (disposed) return;
		const current = ++generation;
		revision = 0;
		changes.clear();
		update({
			projectId,
			threads: [],
			activeThreadId: null,
			loading: projectId !== null,
			pending: false,
			error: null,
		});
		if (!projectId) return;
		try {
			const results = await Promise.all([
				options.bridge.listThreads({projectId, archiveState: 'active'}),
				options.bridge.listThreads({projectId, archiveState: 'archived'}),
			]);
			if (current !== generation) return;
			const failure = results.find(result => !result.ok);
			if (failure && !failure.ok) {
				update({error: failure.error.message});
				return;
			}
			const rows = new Map(
				results
					.flatMap(result => (result.ok ? result.value : []))
					.filter(row => row.projectId === projectId)
					.map(row => [row.id, structuredClone(row)]),
			);
			for (const [id, change] of changes) {
				if (change.thread) rows.set(id, structuredClone(change.thread));
				else rows.delete(id);
			}
			update({threads: [...rows.values()]});
		} catch {
			if (current === generation)
				update({error: 'the thread list is unavailable'});
		} finally {
			if (current === generation) update({loading: false});
		}
	};
	const onEvent = (event: ProjectEvent) => {
		if (
			disposed ||
			event.projectId !== state.projectId ||
			event.type === 'turn'
		)
			return;
		if (event.sequence <= (sequences.get(event.projectId) ?? 0)) return;
		sequences.set(event.projectId, event.sequence);
		if (event.type === 'thread' && event.thread.projectId === event.projectId)
			put(event.thread);
		else if (event.type === 'thread-removed') {
			changes.set(event.threadId, {revision: ++revision, thread: null});
			update({
				threads: state.threads.filter(row => row.id !== event.threadId),
				activeThreadId:
					state.activeThreadId === event.threadId ? null : state.activeThreadId,
			});
		} else if (event.type === 'project-removed') {
			void selectProject(null);
		}
	};
	const unsubscribe = options.bridge.onProjectEvent(onEvent);
	return {
		getState: () => structuredClone(state),
		selectProject,
		create: async () => {
			const projectId = state.projectId;
			if (disposed || !projectId || state.pending || state.loading)
				return false;
			const current = generation;
			const started = revision;
			update({pending: true, error: null});
			try {
				const result = await options.bridge.createThread({projectId});
				if (current !== generation) return false;
				if (!result.ok) {
					update({error: result.error.message});
					return false;
				}
				if (result.value.projectId !== projectId) throw new Error();
				const change = changes.get(result.value.id);
				if (!change || change.revision <= started) put(result.value);
				else if (!change.thread) return false;
				update({activeThreadId: result.value.id});
				return true;
			} catch {
				if (current === generation)
					update({error: 'the thread request could not finish'});
				return false;
			} finally {
				if (current === generation) update({pending: false});
			}
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			generation++;
			changes.clear();
			sequences.clear();
			unsubscribe();
		},
	};
}
