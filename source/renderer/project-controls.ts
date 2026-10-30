import type {DesktopApi} from '@/shared/desktop-api';
import type {
	DefaultMode,
	ProjectConfigSelect,
	ProjectControls,
	ProjectEvent,
	ProjectInfo,
} from '@/shared/ipc';

export interface ProjectControlsState {
	projectId: string | null;
	controls: ProjectControls | null;
	loading: boolean;
	pending: boolean;
	error: string | null;
}

type Bridge = Pick<
	DesktopApi,
	| 'getProjectControls'
	| 'setProjectConfigOption'
	| 'setProjectDefaultMode'
	| 'onProjectEvent'
>;

export function createProjectControlsController(options: {
	bridge: Bridge;
	onChange(state: ProjectControlsState): void;
	controlReason?(): string | null;
}) {
	let state: ProjectControlsState = {
		projectId: null,
		controls: null,
		loading: false,
		pending: false,
		error: null,
	};
	let disposed = false;
	let generation = 0;
	let readVersion = 0;
	let offersVersion = 0;
	const sequences = new Map<string, number>();
	const update = (patch: Partial<ProjectControlsState>) => {
		state = {...state, ...patch};
		options.onChange(structuredClone(state));
	};
	const current = (scope: number) => !disposed && scope === generation;
	const reload = async () => {
		const projectId = state.projectId;
		if (disposed || !projectId || state.pending) return;
		const scope = generation;
		const ticket = ++readVersion;
		const offers = offersVersion;
		update({loading: true, error: null});
		try {
			const result = await options.bridge.getProjectControls({projectId});
			if (!current(scope) || ticket !== readVersion || offers !== offersVersion)
				return;
			if (result.ok && result.value.projectId === projectId)
				update({controls: structuredClone(result.value)});
			else
				update({
					error: result.ok
						? 'project controls are unavailable'
						: result.error.message,
				});
		} catch {
			if (current(scope) && ticket === readVersion && offers === offersVersion)
				update({error: 'project controls are unavailable'});
		} finally {
			if (current(scope) && ticket === readVersion && offers === offersVersion)
				update({loading: false});
		}
	};
	const selectProject = async (projectId: string | null) => {
		if (disposed || projectId === state.projectId) return;
		generation++;
		offersVersion++;
		update({
			projectId,
			controls: null,
			loading: false,
			pending: false,
			error: null,
		});
		await reload();
	};
	const onEvent = (event: ProjectEvent) => {
		if (
			disposed ||
			event.projectId !== state.projectId ||
			event.type === 'turn'
		)
			return;
		if (
			event.type === 'project-controls' &&
			event.controls.projectId !== event.projectId
		)
			return;
		if (event.sequence <= (sequences.get(event.projectId) ?? 0)) return;
		sequences.set(event.projectId, event.sequence);
		if (event.type === 'project-controls') {
			offersVersion++;
			update({controls: structuredClone(event.controls), loading: false});
		} else if (event.type === 'project-removed') void selectProject(null);
	};
	const unsubscribe = options.bridge.onProjectEvent(onEvent);
	return {
		getState: () => structuredClone(state),
		selectProject,
		reload,
		setDefault: async (mode: DefaultMode): Promise<ProjectInfo | null> => {
			const projectId = state.projectId;
			if (disposed || !projectId || state.loading || state.pending) return null;
			const reason = options.controlReason?.();
			if (
				reason ||
				!['normal', 'auto-accept', 'plan', 'architect'].includes(mode)
			) {
				update({error: reason ?? 'choose a non-yolo project default'});
				return null;
			}
			const scope = generation;
			update({pending: true, error: null});
			try {
				const result = await options.bridge.setProjectDefaultMode({
					projectId,
					mode,
				});
				if (!current(scope)) return null;
				if (!result.ok) {
					update({error: result.error.message});
					return null;
				}
				if (result.value.id !== projectId) {
					update({error: 'the project default could not change'});
					return null;
				}
				return structuredClone(result.value);
			} catch {
				if (current(scope))
					update({error: 'the project default could not change'});
				return null;
			} finally {
				if (current(scope)) update({pending: false});
			}
		},
		setConfig: async (id: ProjectConfigSelect['id'], value: string) => {
			const snapshot = state.controls;
			const projectId = state.projectId;
			if (disposed || !projectId || !snapshot || state.loading || state.pending)
				return false;
			const reason =
				options.controlReason?.() ??
				(!snapshot.modelGate.enabled
					? (snapshot.modelGate.reason ?? 'model controls are unavailable')
					: null);
			if (reason) {
				update({error: reason});
				return false;
			}
			const offered = snapshot.configOptions.find(option => option.id === id);
			if (!offered?.options.some(option => option.value === value)) {
				update({error: 'this model option was not offered by Nanocoder'});
				return false;
			}
			if (offered.currentValue === value) return false;
			const scope = generation;
			const offers = offersVersion;
			update({pending: true, error: null});
			try {
				const result = await options.bridge.setProjectConfigOption({
					projectId,
					revision: snapshot.revision,
					configId: id,
					value,
				});
				if (!current(scope)) return false;
				if (!result.ok) {
					update({error: result.error.message});
					return false;
				}
				if (result.value.projectId !== projectId) {
					update({error: 'the model change could not finish'});
					return false;
				}
				if (offers === offersVersion)
					update({controls: structuredClone(result.value)});
				return true;
			} catch {
				if (current(scope))
					update({error: 'the model change could not finish'});
				return false;
			} finally {
				if (current(scope)) update({pending: false});
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			generation++;
			sequences.clear();
			state = {
				...state,
				projectId: null,
				controls: null,
				loading: false,
				pending: false,
			};
			unsubscribe();
		},
	};
}
