import {randomUUID} from 'node:crypto';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {ProjectService} from '@/main/ipc/workspace-services';
import {untilAborted} from '@/main/nanocoder/abort';
import type {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import {canonicalPath} from '@/main/paths';
import type {DesktopStore} from '@/main/store/contracts';
import type {
	ProjectChoiceResult,
	ProjectInfo,
	ProjectOpenResult,
} from '@/shared/ipc';

interface ProjectOptions {
	store: DesktopStore;
	chooseRoot(): Promise<string | undefined>;
	supervisor: Pick<ProjectSupervisor, 'probeProject' | 'stop'>;
	signal?(): AbortSignal;
	announceProject?(project: ProjectInfo): void;
	beforeOpenProject?(project: ProjectInfo): Promise<void>;
	projectsChanged?(projectId: string): void;
}

type AsyncProjectService = {
	[K in keyof ProjectService]: (
		...args: Parameters<ProjectService[K]>
	) => Promise<Awaited<ReturnType<ProjectService[K]>>>;
};

async function directory(chosen: string): Promise<string> {
	try {
		if (!path.isAbsolute(chosen)) throw new Error();
		const root = await canonicalPath(chosen);
		if (!(await stat(root)).isDirectory()) throw new Error();
		return root;
	} catch {
		throw new IpcFailure('DENIED', 'Choose an available project folder');
	}
}

export function createProjectService(
	options: ProjectOptions,
): AsyncProjectService {
	let busy = false;
	const run = async <T>(
		work: (signal: AbortSignal) => Promise<T>,
	): Promise<T> => {
		if (busy)
			throw new IpcFailure(
				'BUSY',
				'Another project operation is waiting',
				true,
			);
		busy = true;
		const signal = options.signal?.() ?? new AbortController().signal;
		try {
			signal.throwIfAborted();
			return await work(signal);
		} catch (error) {
			if (signal.aborted)
				throw new IpcFailure('AGENT_UNAVAILABLE', 'The project request ended');
			if (error instanceof IpcFailure) throw error;
			throw new IpcFailure('DENIED', 'The project operation could not finish');
		} finally {
			busy = false;
		}
	};
	const get = (id: string) => {
		const project = options.store.projects.get(id);
		if (!project) throw new IpcFailure('NOT_FOUND', 'Project not found');
		return project;
	};
	const validateRoot = async (project: ProjectInfo) => {
		if (
			(await directory(project.canonicalRoot)) !== project.canonicalRoot ||
			project.sessionCwd !== project.canonicalRoot
		) {
			throw new IpcFailure(
				'DENIED',
				'The project root changed; locate and trust the folder again',
			);
		}
	};
	const unavailable = async (): Promise<never> => {
		throw new IpcFailure('UNAVAILABLE', 'This feature is not available yet');
	};
	return {
		addProject: () =>
			run<ProjectChoiceResult>(async signal => {
				const chosen = await untilAborted(options.chooseRoot(), signal);
				if (!chosen) return {status: 'cancelled'};
				const root = await untilAborted(directory(chosen), signal);
				signal.throwIfAborted();
				const existing = options.store.projects
					.list()
					.find(project => project.canonicalRoot === root);
				if (existing) return {status: 'selected', project: existing};
				const now = new Date().toISOString();
				const project: ProjectInfo = {
					id: randomUUID(),
					canonicalRoot: root,
					sessionCwd: root,
					displayName: path.basename(root) || root,
					trusted: false,
					defaultMode: 'normal',
					lastOpenedAt: now,
					createdAt: now,
					availability: 'available',
				};
				options.store.projects.save(project);
				options.projectsChanged?.(project.id);
				return {status: 'selected', project};
			}),
		openProject: ({projectId}) =>
			run<ProjectOpenResult>(async signal => {
				const project = get(projectId);
				await options.beforeOpenProject?.(project);
				signal.throwIfAborted();
				options.announceProject?.(project);
				await untilAborted(validateRoot(project), signal);
				signal.throwIfAborted();
				options.store.projects.save({...project, trusted: false});
				try {
					const state = await untilAborted(
						options.supervisor.probeProject({
							...project,
							trusted: false,
						}),
						signal,
					);
					if (state.status === 'untrusted') {
						return {
							status: 'untrusted',
							message: state.reason ?? 'Trust this project before opening it',
						};
					}
					if (state.status !== 'ready') {
						throw new IpcFailure(
							state.status === 'unsupported'
								? 'UNSUPPORTED'
								: 'AGENT_UNAVAILABLE',
							state.reason ?? 'Nanocoder could not start',
						);
					}
					await untilAborted(validateRoot(project), signal);
					signal.throwIfAborted();
					const current = get(projectId);
					if (current.canonicalRoot !== project.canonicalRoot)
						throw new IpcFailure('DENIED', 'The project changed while opening');
					const opened = {
						...current,
						trusted: true,
						lastOpenedAt: new Date().toISOString(),
					};
					options.store.projects.save(opened);
					options.store.updateUiState({activeProjectId: projectId});
					options.projectsChanged?.(projectId);
					return {status: 'opened', project: opened, supervisor: state};
				} catch (error) {
					await options.supervisor.stop(projectId);
					throw error;
				}
			}),
		locateProject: ({projectId}) =>
			run<ProjectChoiceResult>(async signal => {
				const project = get(projectId);
				const chosen = await untilAborted(options.chooseRoot(), signal);
				if (!chosen) return {status: 'cancelled'};
				const root = await untilAborted(directory(chosen), signal);
				signal.throwIfAborted();
				if (root === project.canonicalRoot)
					return {status: 'selected', project};
				if (
					options.store.projects
						.list()
						.some(
							other => other.id !== projectId && other.canonicalRoot === root,
						)
				) {
					throw new IpcFailure('DENIED', 'That folder is already a project');
				}
				await options.supervisor.stop(projectId);
				signal.throwIfAborted();
				const current = get(projectId);
				if (current.canonicalRoot !== project.canonicalRoot)
					throw new IpcFailure('DENIED', 'The project changed while locating');
				const located = {
					...current,
					canonicalRoot: root,
					sessionCwd: root,
					displayName: path.basename(root) || root,
					trusted: false,
					availability: 'available' as const,
				};
				options.store.projects.save(located);
				options.projectsChanged?.(projectId);
				return {status: 'selected', project: located};
			}),
		removeProject: unavailable,
		setProjectDefaultMode: unavailable,
	};
}
