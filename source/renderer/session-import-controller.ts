import type {DesktopApi} from '@/shared/desktop-api';
import type {DiscoveredSession} from '@/shared/ipc';

export interface SessionImportState {
	projectId: string | null;
	ready: boolean;
	sessions: DiscoveredSession[];
	loading: boolean;
	importing: string | null;
	error: string | null;
}

export function emptySessionImports(
	projectId: string | null = null,
	ready = false,
): SessionImportState {
	return {
		projectId,
		ready,
		sessions: [],
		loading: false,
		importing: null,
		error: null,
	};
}

export function createSessionImports(options: {
	bridge: Pick<DesktopApi, 'discoverSessions' | 'importSession'>;
	onChange(state: SessionImportState): void;
}) {
	let state = emptySessionImports();
	let disposed = false;
	let epoch = 0;
	let refreshSequence = 0;
	let known = new Set<string>();
	const getState = () => structuredClone(state);
	const publish = (patch: Partial<SessionImportState>) => {
		state = {...state, ...patch};
		if (!disposed) options.onChange(getState());
	};
	const current = (scope: number, projectId: string) =>
		!disposed &&
		scope === epoch &&
		state.projectId === projectId &&
		state.ready;
	const refresh = async (): Promise<boolean> => {
		const {projectId, ready, importing} = state;
		if (disposed || !projectId || !ready || importing !== null) return false;
		const scope = epoch;
		const sequence = ++refreshSequence;
		publish({loading: true, error: null});
		try {
			const result = await options.bridge.discoverSessions({projectId});
			if (!current(scope, projectId) || sequence !== refreshSequence)
				return false;
			publish({
				loading: false,
				sessions: result.ok
					? structuredClone(result.value.filter(row => !known.has(row.id)))
					: [],
				error: result.ok ? null : result.error.message,
			});
			return result.ok;
		} catch {
			if (current(scope, projectId) && sequence === refreshSequence)
				publish({
					loading: false,
					sessions: [],
					error: 'saved sessions are unavailable',
				});
			return false;
		}
	};
	return {
		getState,
		selectProject: async (projectId: string | null, ready: boolean) => {
			const enabled = projectId !== null && ready;
			if (
				disposed ||
				(state.projectId === projectId && state.ready === enabled)
			)
				return false;
			if (state.projectId !== projectId) known = new Set();
			epoch++;
			refreshSequence++;
			state = emptySessionImports(projectId, enabled);
			publish({});
			return enabled ? refresh() : false;
		},
		refresh,
		importSession: async (sessionId: string): Promise<boolean> => {
			const {projectId, ready, loading, importing, sessions} = state;
			if (
				disposed ||
				!projectId ||
				!ready ||
				loading ||
				importing !== null ||
				known.has(sessionId) ||
				!sessions.some(row => row.id === sessionId)
			)
				return false;
			const scope = epoch;
			publish({importing: sessionId, error: null});
			try {
				const result = await options.bridge.importSession({
					projectId,
					sessionId,
				});
				if (!current(scope, projectId)) return false;
				if (!result.ok) {
					publish({importing: null, error: result.error.message});
					return false;
				}
				if (
					result.value.projectId !== projectId ||
					result.value.nanocoderSessionId !== sessionId
				) {
					publish({
						importing: null,
						error: 'the saved session changed; refresh before importing',
					});
					return false;
				}
				publish({
					importing: null,
					error: null,
					sessions: state.sessions.filter(row => row.id !== sessionId),
				});
				return true;
			} catch {
				if (current(scope, projectId))
					publish({
						importing: null,
						error: 'the saved session could not be imported',
					});
				return false;
			}
		},
		setKnownSessions: (
			projectId: string | null,
			sessionIds: readonly string[],
		) => {
			if (disposed || projectId !== state.projectId) return;
			known = new Set(sessionIds);
			const sessions = state.sessions.filter(row => !known.has(row.id));
			if (sessions.length !== state.sessions.length) publish({sessions});
		},
		dispose: () => {
			disposed = true;
			epoch++;
			refreshSequence++;
			known.clear();
			state = emptySessionImports();
		},
	};
}
