import {useCallback, useEffect, useRef, useState} from 'react';
import {
	createThreadWorkspace,
	type ThreadWorkspaceState,
	threadWorkspaceForProject,
} from '@/renderer/thread-workspace';
import type {IpcResult, NanocoderMode} from '@/shared/ipc';

export function useThreads(projectId: string | null, ready: boolean) {
	const [state, setState] = useState<ThreadWorkspaceState | null>(null);
	const model = useRef<ReturnType<typeof createThreadWorkspace> | null>(null);
	useEffect(() => {
		const current = createThreadWorkspace({
			bridge: window.desktop,
			onChange: setState,
		});
		model.current = current;
		setState(current.getState());
		return () => {
			current.dispose();
			if (model.current === current) model.current = null;
		};
	}, []);
	useEffect(() => {
		void model.current?.selectProject(projectId);
	}, [projectId]);
	const scoped = threadWorkspaceForProject(state, projectId);
	const {workspace} = scoped;
	useEffect(() => {
		if (
			ready &&
			!workspace.loading &&
			!workspace.pending &&
			!workspace.error &&
			!workspace.threads.length
		)
			void model.current?.ensureThread();
	}, [
		ready,
		workspace.loading,
		workspace.pending,
		workspace.error,
		workspace.threads.length,
	]);
	const reload = useCallback(
		(id: string) => model.current?.reload(id) ?? Promise.resolve(false),
		[],
	);
	return {
		...scoped,
		reload,
		setDraft: (draft: string) => model.current?.setDraft(draft),
		create: () => model.current?.create() ?? Promise.resolve(false),
		open: (id: string) => model.current?.open(id) ?? Promise.resolve(false),
		send: () => model.current?.send() ?? Promise.resolve(null),
		cancel: (id: string) => model.current?.cancel(id) ?? Promise.resolve(null),
		answer: (
			id: string,
			requestId: string,
			optionId: string,
		): Promise<IpcResult<null>> =>
			model.current?.answer(id, requestId, optionId) ??
			Promise.resolve({
				ok: false,
				error: {
					code: 'DENIED',
					message: 'this approval is no longer current',
					retryable: false,
				},
			}),
		rename: (id: string, title: string) =>
			model.current?.rename(id, title) ?? Promise.resolve(false),
		setMode: (id: string, mode: NanocoderMode) =>
			model.current?.setMode(id, mode) ?? Promise.resolve(false),
		archive: (id: string, archived: boolean) =>
			model.current?.archive(id, archived) ?? Promise.resolve(false),
		remove: (id: string) => model.current?.remove(id) ?? Promise.resolve(false),
		deleteHistory: (id: string) =>
			model.current?.deleteHistory(id) ?? Promise.resolve(false),
	};
}
