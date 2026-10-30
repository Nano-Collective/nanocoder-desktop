import {createElement, Fragment} from 'react';
import {flushSync} from 'react-dom';
import {createRoot, type Root} from 'react-dom/client';
import {Composer} from '@/renderer/composer';
import {
	SessionImportList,
	type SessionImportListProps,
} from '@/renderer/session-import-list';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let projectId = 'project-a';
let importing: string | null = null;
let draft = '';
let imported = false;
let release: (() => void) | undefined;
let completion: Promise<boolean> | undefined;

function render() {
	const props: SessionImportListProps = {
		projectId,
		active: true,
		sessions: imported
			? []
			: [
					{
						id: `saved-${projectId}`,
						title: `saved ${projectId}`,
						sessionCwd: `/fixture/${projectId}`,
						lastActivityAt: null,
					},
				],
		loading: false,
		importing,
		error: null,
		onRefresh: async () => true,
		onImport(sessionId) {
			const origin = projectId;
			const mounted = root;
			const wait = new Promise<void>(resolve => {
				release = resolve;
			});
			importing = sessionId;
			render();
			completion = wait.then(() => {
				if (!root || root !== mounted) return false;
				if (projectId === origin) imported = true;
				importing = null;
				render();
				return true;
			});
			return completion;
		},
	};
	flushSync(() => {
		root?.render(
			createElement(
				Fragment,
				null,
				createElement(SessionImportList, props),
				createElement(Composer, {
					draft,
					editable: true,
					sendReason: null,
					controlReason: null,
					projectName: projectId,
					projectControls: null,
					mode: 'normal',
					defaultMode: 'normal',
					modePending: false,
					running: false,
					stopping: false,
					commands: [],
					onDraft(value) {
						draft = value;
						render();
					},
					onSend() {},
					onCancel() {},
					onMode() {},
					onDefault() {},
					onConfig() {},
				}),
			),
		);
	});
}

export const importFocusHarness = {
	mount(theme: 'dark' | 'light') {
		this.dispose();
		projectId = 'project-a';
		importing = null;
		draft = '';
		imported = false;
		completion = undefined;
		document.documentElement.dataset.theme = theme;
		container = document.createElement('div');
		container.id = 'session-import-focus-fixture';
		Object.assign(container.style, {
			position: 'fixed',
			inset: '0',
			zIndex: '100',
			overflow: 'auto',
			padding: '16px',
			background: 'var(--color-surface)',
		});
		document.body.append(container);
		root = createRoot(container);
		render();
	},
	switchProject() {
		// Retain the old pending phase to test the component's own scope guard.
		projectId = 'project-b';
		render();
	},
	async release() {
		if (!release || !completion) throw new Error('No pending fixture import');
		release();
		release = undefined;
		await completion;
	},
	dispose() {
		flushSync(() => root?.unmount());
		root = undefined;
		container?.remove();
		container = undefined;
		release?.();
		release = undefined;
	},
};
