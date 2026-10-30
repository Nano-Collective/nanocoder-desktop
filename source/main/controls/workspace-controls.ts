import {createProjectControls} from '@/main/controls/project-controls';
import {createThreadModes} from '@/main/controls/thread-modes';
import type {NanocoderConnection} from '@/main/nanocoder/acp-client';
import type {DesktopStore} from '@/main/store/contracts';
import type {ProjectOperationLease} from '@/main/threads/project-operations';
import type {
	createThreadService,
	OwnedSessionContext,
} from '@/main/threads/thread-service';
import type {ProjectControls, ProjectInfo, ThreadInfo} from '@/shared/ipc';

export function createWorkspaceControls(options: {
	store: DesktopStore;
	threads: Pick<
		ReturnType<typeof createThreadService>,
		'projectOperations' | 'runProjectOperation'
	>;
	getConnection(projectId: string): NanocoderConnection | undefined;
	publishControls(controls: ProjectControls): void;
	publishThread(thread: ThreadInfo): void;
	publishProject(project: ProjectInfo): void;
	confirmYolo?: Parameters<typeof createThreadModes>[0]['confirmYolo'];
}) {
	const shared = {
		operations: options.threads.projectOperations,
		runProjectOperation: options.threads.runProjectOperation,
		getProject: (id: string) => options.store.projects.get(id),
		getThread: (projectId: string, threadId: string) =>
			options.store.threads.get(projectId, threadId),
		getConnection: options.getConnection,
	};
	const controls = createProjectControls({
		...shared,
		publishControls: options.publishControls,
	});
	const modes = createThreadModes({
		...shared,
		saveThread: thread => options.store.threads.save(thread),
		saveProject: project => options.store.projects.save(project),
		publishThread: options.publishThread,
		publishProject: options.publishProject,
		confirmYolo: options.confirmYolo,
	});
	return {
		controls: {
			getProjectControls: controls.getProjectControls,
			setProjectConfigOption: controls.setProjectConfigOption,
		},
		setThreadMode: modes.setThreadMode,
		setProjectDefaultMode: modes.setProjectDefaultMode,
		hooks: {
			onSessionPrepared(context: OwnedSessionContext) {
				modes.onSessionPrepared(context);
				controls.onSessionPrepared(context);
			},
			async beforeFirstPrompt(context: OwnedSessionContext) {
				controls.assertPromptAllowed(context);
				await modes.beforeFirstPrompt(context);
			},
			validateBeforePrepare(lease: ProjectOperationLease, thread: ThreadInfo) {
				const connection = options.getConnection(thread.projectId);
				if (connection) controls.assertPromptAllowed({lease, connection});
				modes.validateBeforePrepare(lease, thread);
			},
			resolveLiveMode: modes.resolveLiveMode,
		},
		invalidate(projectId: string) {
			modes.invalidate(projectId);
			controls.invalidate(projectId);
		},
		invalidateThread(projectId: string, threadId: string) {
			modes.invalidateThread(projectId, threadId);
			controls.invalidateThread(projectId, threadId);
		},
		dispose() {
			modes.dispose();
			controls.dispose();
		},
	};
}
