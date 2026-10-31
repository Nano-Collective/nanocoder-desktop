import {useCallback, useEffect, useRef, useState} from 'react';
import {
	readRecentProjects,
	subscribeProjectRefresh,
} from '@/renderer/project-refresh';
import type {ProjectFeedback} from '@/renderer/trust-feedback';
import type {IpcResult, ProjectChoiceResult, ProjectInfo} from '@/shared/ipc';

export function useProjects(onOpened?: () => void) {
	const [projects, setProjects] = useState<ProjectInfo[]>([]);
	const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
	const [feedback, setFeedback] = useState<ProjectFeedback | null>(null);
	const [pending, setPending] = useState(false);
	const waiting = useRef(false);
	const mounted = useRef(true);
	const refreshSequence = useRef(0);
	const report = useCallback((value: ProjectFeedback) => {
		if (mounted.current) setFeedback(value);
	}, []);
	const refresh = useCallback(async () => {
		const sequence = ++refreshSequence.current;
		await readRecentProjects(window.desktop, {
			current: () => mounted.current && sequence === refreshSequence.current,
			projects: setProjects,
			activeProject: setActiveProjectId,
			failed: message => report({status: 'failed', message}),
		});
	}, [report]);
	useEffect(() => {
		mounted.current = true;
		const unsubscribe = subscribeProjectRefresh(window.desktop, refresh);
		void refresh();
		return () => {
			mounted.current = false;
			unsubscribe();
		};
	}, [refresh]);

	const open = async (projectId: string) => {
		const result = await window.desktop.openProject({projectId});
		if (!result.ok) report({status: 'failed', message: result.error.message});
		else if (result.value.status === 'opened') {
			if (mounted.current) {
				setActiveProjectId(result.value.project.id);
				onOpened?.();
			}
			report({
				status: 'ready',
				message: `project ready: ${result.value.project.displayName}`,
			});
		} else if (result.value.status === 'untrusted') {
			report({
				status: 'untrusted',
				message: `not opened. ${result.value.message}`,
			});
		} else report({status: 'cancelled', message: 'project opening cancelled'});
	};
	const selected = async (result: IpcResult<ProjectChoiceResult>) => {
		if (!result.ok) report({status: 'failed', message: result.error.message});
		else if (result.value.status === 'selected')
			await open(result.value.project.id);
		else report({status: 'cancelled', message: 'no folder selected'});
	};
	const run = async (work: () => Promise<void>) => {
		if (waiting.current) return;
		waiting.current = true;
		setPending(true);
		setFeedback(null);
		try {
			await work();
		} catch {
			report({
				status: 'failed',
				message: 'the project request could not finish',
			});
		} finally {
			await refresh();
			waiting.current = false;
			if (mounted.current) setPending(false);
		}
	};
	return {
		projects,
		activeProjectId,
		pending,
		feedback,
		refresh,
		clearFeedback: () => {
			if (mounted.current) setFeedback(null);
		},
		onAdd: () => {
			void run(async () => selected(await window.desktop.addProject({})));
		},
		onOpen: (id: string) => {
			void run(() => open(id));
		},
		onLocate: (id: string) => {
			void run(async () =>
				selected(await window.desktop.locateProject({projectId: id})),
			);
		},
	};
}
