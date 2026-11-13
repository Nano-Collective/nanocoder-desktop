import {EditorLauncher} from '@/main/files/editor';
import {FileService} from '@/main/files/file-service';
import {relativeFromAbsolute, relativeSegments} from '@/main/files/safe-path';
import {WatchManager} from '@/main/files/watcher';
import {
	AgentChangesService,
	type AgentSnapshots,
} from '@/main/git/agent-changes';
import {GitService} from '@/main/git/git-service';
import {ReviewService} from '@/main/git/review-service';
import {TurnTracker} from '@/main/git/turn-tracker';
import type {FilesEvent} from '@/shared/files';
import type {DesktopSettings, ProjectInfo} from '@/shared/ipc';

export interface FilesRuntimeOptions {
	projects(): readonly ProjectInfo[];
	project(projectId: string): ProjectInfo | undefined;
	editor(): DesktopSettings['editor'];
	send(event: FilesEvent): void;
	openPath(file: string): Promise<string>;
	showItemInFolder(file: string): void;
	// Nanocoder's pre-edit snapshots for the agent changes view (GIT-09); closed when absent.
	agentChanges?: {
		gate(projectId: string): {enabled: boolean; reason: string | null};
		snapshots(projectId: string, threadId: string): AgentSnapshots | undefined;
	};
}

// Composes the file browser, Git review and editor handoff for the main process.
export function createFilesRuntime(options: FilesRuntimeOptions) {
	const watchers = new WatchManager({
		onChange: (projectId, change) => {
			git.invalidate(projectId);
			options.send({
				type: 'changed',
				projectId,
				directories: change.directories,
				overflow: change.overflow,
			});
			options.send({type: 'review-changed', projectId});
		},
		onLimit: projectId => options.send({type: 'watch-limit', projectId}),
	});
	const files: FileService = new FileService({
		project: options.project,
		marks: (project, directory) => git.marks(project, directory),
		opened: (projectId, root) => {
			watchers.ensure(projectId, root);
		},
		watch: projectId => watchers.state(projectId),
	});
	const git: GitService = new GitService({
		project: options.project,
		roots: () => options.projects().map(project => project.canonicalRoot),
		watchState: projectId => watchers.state(projectId),
		readUntracked: async (project, path) => {
			const preview = await files.preview({projectId: project.id, path});
			return preview.kind === 'text'
				? {kind: 'text', text: preview.text}
				: {kind: 'other', reason: preview.detail};
		},
	});
	const tracker = new TurnTracker({
		head: projectId => git.head(projectId),
		commits: (projectId, before, after) =>
			git.commits(projectId, before, after),
		relative: (projectId, reported) => {
			const root = options.project(projectId)?.canonicalRoot;
			if (!root) return undefined;
			try {
				const relative = relativeFromAbsolute(root, reported);
				return relative || undefined;
			} catch {
				try {
					return relativeSegments(reported).join('/') || undefined;
				} catch {
					return undefined;
				}
			}
		},
		changed: projectId => {
			git.invalidate(projectId);
			options.send({type: 'review-changed', projectId});
		},
	});
	const agentChanges = new AgentChangesService({
		tracker,
		gate: projectId =>
			options.agentChanges?.gate(projectId) ?? {
				enabled: false,
				reason: 'Nanocoder snapshots are unavailable.',
			},
		snapshots: (projectId, threadId) =>
			options.agentChanges?.snapshots(projectId, threadId),
		compare: (projectId, path, before) => git.compare(projectId, path, before),
	});
	const editor = new EditorLauncher({
		editor: options.editor,
		roots: () => options.projects().map(project => project.canonicalRoot),
		openPath: options.openPath,
		showItemInFolder: options.showItemInFolder,
	});
	// Find Git now, so the first turn or review does not wait for the search.
	void git.git().catch(() => undefined);
	return {
		files,
		git,
		tracker,
		editor,
		review: new ReviewService(git, tracker, agentChanges),
		closeProject(projectId: string) {
			watchers.closeProject(projectId);
			git.invalidate(projectId);
			tracker.forget(projectId);
		},
		dispose() {
			watchers.close();
		},
	};
}

export type FilesRuntime = ReturnType<typeof createFilesRuntime>;
