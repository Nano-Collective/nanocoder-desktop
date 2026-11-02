import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
	emptyFilesState,
	FilesController,
	type FilesState,
	flattenTree,
} from '@/renderer/files-controller';

export function useFiles(projectId: string | null, enabled: boolean) {
	const [state, setState] = useState<FilesState>(() => emptyFilesState(null));
	const controller = useRef<FilesController | null>(null);
	useEffect(() => {
		const next = new FilesController(window.desktop.files, setState);
		controller.current = next;
		return () => {
			next.dispose();
			controller.current = null;
		};
	}, []);
	useEffect(() => {
		controller.current?.select(enabled ? projectId : null);
	}, [projectId, enabled]);
	const rows = useMemo(() => flattenTree(state), [state]);
	return {
		state,
		rows,
		toggle: useCallback((path: string) => controller.current?.toggle(path), []),
		focus: useCallback(
			(path: string | null) => controller.current?.focus(path),
			[],
		),
		open: useCallback((path: string) => {
			void controller.current?.open(path);
		}, []),
		closePreview: useCallback(() => controller.current?.closePreview(), []),
		refresh: useCallback(() => {
			void controller.current?.refresh();
		}, []),
	};
}
