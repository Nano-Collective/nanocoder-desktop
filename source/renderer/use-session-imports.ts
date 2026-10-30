import {useCallback, useEffect, useRef, useState} from 'react';
import {
	createSessionImports,
	emptySessionImports,
	type SessionImportState,
} from '@/renderer/session-import-controller';
import type {ThreadInfo} from '@/shared/ipc';

export function useSessionImports(
	projectId: string | null,
	ready: boolean,
	threads: readonly ThreadInfo[],
) {
	const [state, setState] = useState<SessionImportState | null>(null);
	const model = useRef<ReturnType<typeof createSessionImports> | null>(null);
	useEffect(() => {
		const current = createSessionImports({
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
		void model.current?.selectProject(projectId, ready);
	}, [projectId, ready]);
	useEffect(() => {
		model.current?.setKnownSessions(
			projectId,
			threads.flatMap(thread =>
				thread.projectId === projectId && thread.nanocoderSessionId
					? [thread.nanocoderSessionId]
					: [],
			),
		);
	}, [projectId, threads]);
	const refresh = useCallback(
		() => model.current?.refresh() ?? Promise.resolve(false),
		[],
	);
	const importSession = useCallback(
		(id: string) => model.current?.importSession(id) ?? Promise.resolve(false),
		[],
	);
	return {
		...(state?.projectId === projectId && state.ready === ready
			? state
			: emptySessionImports(projectId, ready)),
		refresh,
		importSession,
	};
}
