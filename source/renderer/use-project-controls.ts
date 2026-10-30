import {useEffect, useRef, useState} from 'react';
import {
	createProjectControlsController,
	type ProjectControlsState,
} from '@/renderer/project-controls';
import type {DefaultMode, ProjectConfigSelect} from '@/shared/ipc';

export function useProjectControls(
	projectId: string | null,
	controlReason: string | null,
	ready: boolean,
) {
	const [state, setState] = useState<ProjectControlsState | null>(null);
	const model = useRef<ReturnType<
		typeof createProjectControlsController
	> | null>(null);
	const reason = useRef(controlReason);
	reason.current = controlReason;
	useEffect(() => {
		const current = createProjectControlsController({
			bridge: window.desktop,
			onChange: setState,
			controlReason: () => reason.current,
		});
		model.current = current;
		setState(current.getState());
		return () => {
			current.dispose();
			if (model.current === current) model.current = null;
		};
	}, []);
	useEffect(() => {
		const current = model.current;
		if (!current) return;
		if (current.getState().projectId !== projectId)
			void current.selectProject(projectId);
		else if (ready && !controlReason) void current.reload();
	}, [projectId, controlReason, ready]);
	const scoped = state?.projectId === projectId ? state : null;
	return {
		controls: scoped?.controls ?? null,
		pending: scoped?.pending ?? false,
		loading: scoped?.loading ?? projectId !== null,
		error: scoped?.error ?? null,
		setConfig: (id: ProjectConfigSelect['id'], value: string) =>
			model.current?.setConfig(id, value) ?? Promise.resolve(false),
		setDefault: (mode: DefaultMode) =>
			model.current?.setDefault(mode) ?? Promise.resolve(null),
	};
}
