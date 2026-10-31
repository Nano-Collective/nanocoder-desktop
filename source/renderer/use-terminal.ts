import {useEffect, useRef, useState} from 'react';
import {
	type TerminalAction,
	TerminalController,
	type TerminalState,
} from '@/renderer/terminal-controller';

export function useTerminal(projectId: string | null) {
	const [state, setState] = useState<TerminalState | null>(null);
	const controller = useRef<TerminalController | null>(null);
	useEffect(() => {
		const model = new TerminalController(window.desktop.terminal, setState);
		controller.current = model;
		return () => {
			model.dispose();
			if (controller.current === model) controller.current = null;
		};
	}, []);
	useEffect(() => {
		void controller.current?.select(projectId);
	}, [projectId]);
	return {
		snapshot: state?.projectId === projectId ? state.snapshot : null,
		loading: state?.projectId === projectId ? state.loading : true,
		pending: state?.projectId === projectId ? state.pending : false,
		error: state?.projectId === projectId ? state.error : null,
		action: (action: TerminalAction) =>
			controller.current?.action(action) ?? Promise.resolve(false),
		write: (data: string) => {
			void controller.current?.write(data);
		},
		resize: (cols: number, rows: number) => {
			void controller.current?.resize(cols, rows);
		},
	};
}
