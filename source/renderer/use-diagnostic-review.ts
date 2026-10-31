import {useEffect, useRef, useState} from 'react';
import type {
	DiagnosticsSnapshot,
	IpcResult,
	WorkspaceRequests,
	WorkspaceValues,
} from '@/shared/ipc';

export interface DiagnosticReviewBridge {
	capture(projectId: string): Promise<IpcResult<DiagnosticsSnapshot>>;
	exportSnapshot(
		request: WorkspaceRequests['exportDiagnostics'],
	): Promise<IpcResult<WorkspaceValues['exportDiagnostics']>>;
}

// Holds the one captured snapshot the user is reviewing; main owns capture and export.
export function useDiagnosticReview(
	projectId: string | null,
	bridge: DiagnosticReviewBridge,
) {
	const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState('');
	const generation = useRef(0);
	const selectedProject = useRef<string | null | undefined>(undefined);
	useEffect(() => {
		if (selectedProject.current === projectId) return;
		selectedProject.current = projectId;
		generation.current++;
		setSnapshot(null);
		setMessage('');
		setBusy(false);
	}, [projectId]);

	const run = async (action: () => Promise<void>) => {
		if (busy) return;
		const selected = generation.current;
		setBusy(true);
		setMessage('');
		try {
			await action();
		} catch {
			if (selected === generation.current)
				setMessage('the request could not finish');
		} finally {
			if (selected === generation.current) setBusy(false);
		}
	};

	return {
		snapshot,
		busy,
		message,
		capture: async (): Promise<boolean> => {
			if (!projectId || busy) return false;
			let captured = false;
			await run(async () => {
				const selected = generation.current;
				const result = await bridge.capture(projectId);
				if (selected !== generation.current) return;
				if (result.ok) {
					setSnapshot(result.value);
					captured = true;
				} else setMessage(result.error.message);
			});
			return captured;
		},
		exportSnapshot: () => {
			void run(async () => {
				if (!snapshot) return;
				const selected = generation.current;
				const result = await bridge.exportSnapshot({
					projectId: snapshot.projectId,
					snapshotId: snapshot.id,
				});
				if (selected === generation.current)
					setMessage(
						result.ok
							? result.value.status === 'exported'
								? 'diagnostics exported'
								: 'export cancelled'
							: result.error.message,
					);
			});
		},
		close: () => {
			setSnapshot(null);
			setMessage('');
		},
	};
}
