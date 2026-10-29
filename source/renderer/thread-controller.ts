import {createThreadStream} from '@/renderer/thread-stream';
import type {DesktopApi} from '@/shared/desktop-api';
import type {
	IpcResult,
	ProjectEvent,
	ThreadInfo,
	ThreadSnapshot,
} from '@/shared/ipc';

type ThreadBridge = Pick<
	DesktopApi,
	| 'listThreads'
	| 'createThread'
	| 'onProjectEvent'
	| 'renameThread'
	| 'archiveThread'
	| 'removeThread'
	| 'deleteThreadHistory'
	| 'openThread'
	| 'getThreadSnapshot'
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
	onSnapshot?(snapshot: ThreadSnapshot): void;
	onTurn?(event: Extract<ProjectEvent, {type: 'turn'}>): void;
	onRemoved?(threadId: string): void;
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
	const forget = (threadId: string) => {
		const existed = state.threads.some(thread => thread.id === threadId);
		stream.remove(threadId);
		changes.set(threadId, {revision: ++revision, thread: null});
		update({
			threads: state.threads.filter(row => row.id !== threadId),
			activeThreadId:
				state.activeThreadId === threadId ? null : state.activeThreadId,
		});
		if (existed) options.onRemoved?.(threadId);
	};
	const accept = (thread: ThreadInfo, started: number, expectedId?: string) => {
		if (
			thread.projectId !== state.projectId ||
			(expectedId && thread.id !== expectedId)
		)
			throw new Error();
		const change = changes.get(thread.id);
		if (!change || change.revision <= started) put(thread);
		else if (!change.thread) return false;
		return true;
	};
	const run = async <T>(
		threadId: string | null,
		work: (projectId: string) => Promise<IpcResult<T>>,
		finish: (value: T, started: number) => boolean,
	) => {
		const projectId = state.projectId;
		if (
			disposed ||
			!projectId ||
			state.pending ||
			state.loading ||
			(threadId !== null && !state.threads.some(row => row.id === threadId))
		)
			return false;
		const current = generation;
		const started = revision;
		update({pending: true, error: null});
		try {
			const result = await work(projectId);
			if (current !== generation) return false;
			if (!result.ok) {
				update({error: result.error.message});
				return false;
			}
			return finish(result.value, started);
		} catch {
			if (current === generation)
				update({error: 'the thread request could not finish'});
			return false;
		} finally {
			if (current === generation) update({pending: false});
		}
	};
	const stream = createThreadStream({
		onSnapshot: snapshot => options.onSnapshot?.(snapshot),
		onTurn: event => options.onTurn?.(event),
		onGap: (threadId, token) => {
			void readGap(threadId, token);
		},
	});
	const replace = (
		snapshot: ThreadSnapshot,
		started: number,
		threadId: string,
		token: number,
	) => {
		if (
			!stream.isCurrent(threadId, token) ||
			!accept(snapshot.thread, started, threadId)
		)
			return false;
		const thread = state.threads.find(row => row.id === threadId);
		return !!thread && stream.replace(token, {...snapshot, thread});
	};
	async function readGap(threadId: string, token: number) {
		const projectId = state.projectId;
		if (
			disposed ||
			!projectId ||
			!state.threads.some(row => row.id === threadId)
		)
			return;
		const current = generation;
		const started = revision;
		try {
			const result = await options.bridge.getThreadSnapshot({
				projectId,
				threadId,
			});
			if (current !== generation || !stream.isCurrent(threadId, token)) return;
			if (!result.ok) {
				if (state.activeThreadId === threadId)
					update({error: result.error.message});
				return;
			}
			replace(result.value, started, threadId, token);
		} catch {
			if (
				current === generation &&
				stream.isCurrent(threadId, token) &&
				state.activeThreadId === threadId
			)
				update({error: 'the thread snapshot is unavailable'});
		}
	}
	const load = (threadId: string, open: boolean) => {
		let token = 0;
		return run(
			threadId,
			projectId => {
				token = stream.begin(threadId);
				return open
					? options.bridge.openThread({projectId, threadId})
					: options.bridge.getThreadSnapshot({projectId, threadId});
			},
			(snapshot, started) => {
				if (!replace(snapshot, started, threadId, token)) return false;
				update({activeThreadId: threadId});
				return true;
			},
		);
	};
	const selectProject = async (projectId: string | null) => {
		if (disposed) return;
		const current = ++generation;
		revision = 0;
		changes.clear();
		stream.selectProject(projectId);
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
		if (disposed || event.projectId !== state.projectId) return;
		if (event.type === 'turn') return stream.receive(event);
		if (event.sequence <= (sequences.get(event.projectId) ?? 0)) return;
		sequences.set(event.projectId, event.sequence);
		if (event.type === 'thread' && event.thread.projectId === event.projectId)
			put(event.thread);
		else if (event.type === 'thread-removed') {
			forget(event.threadId);
		} else if (event.type === 'project-removed') {
			void selectProject(null);
		}
	};
	const unsubscribe = options.bridge.onProjectEvent(onEvent);
	return {
		getState: () => structuredClone(state),
		selectProject,
		open: (threadId: string) => load(threadId, true),
		read: (threadId: string) => load(threadId, false),
		rename: (threadId: string, title: string) =>
			run(
				threadId,
				projectId => options.bridge.renameThread({projectId, threadId, title}),
				(thread, started) => accept(thread, started, threadId),
			),
		archive: (threadId: string, archived: boolean) =>
			run(
				threadId,
				projectId =>
					options.bridge.archiveThread({projectId, threadId, archived}),
				(thread, started) => accept(thread, started, threadId),
			),
		remove: (threadId: string) =>
			run(
				threadId,
				projectId => options.bridge.removeThread({projectId, threadId}),
				() => {
					forget(threadId);
					return true;
				},
			),
		deleteHistory: (threadId: string) =>
			run(
				threadId,
				projectId => options.bridge.deleteThreadHistory({projectId, threadId}),
				value => {
					if (value.status !== 'deleted') return false;
					forget(threadId);
					return true;
				},
			),
		create: () =>
			run(
				null,
				projectId => options.bridge.createThread({projectId}),
				(thread, started) => {
					if (!accept(thread, started)) return false;
					update({activeThreadId: thread.id});
					return true;
				},
			),
		dispose: () => {
			if (disposed) return;
			disposed = true;
			generation++;
			changes.clear();
			sequences.clear();
			stream.selectProject(null);
			unsubscribe();
		},
	};
}
