import {createElement, Fragment, useEffect} from 'react';
import {flushSync} from 'react-dom';
import {createRoot, type Root} from 'react-dom/client';
import type {} from '@/renderer/env';
import {RecentProjects} from '@/renderer/recent-projects';
import {TrustFeedback} from '@/renderer/trust-feedback';
import {useProjects} from '@/renderer/use-projects';
import type {DesktopApi} from '@/shared/desktop-api';
import type {IpcResult, ProjectInfo} from '@/shared/ipc';

let root: Root | undefined;
let requested: Promise<void> | undefined;
let release: (() => void) | undefined;
let applied: Promise<void> | undefined;

export const projectHydrationHarness = {
	mount(controlled: boolean) {
		flushSync(() => root?.unmount());
		const desktop = Reflect.get(window, 'desktop') as DesktopApi;
		const empty: ProjectInfo[] = [];
		let resolveRequested!: () => void;
		let resolveApplied!: () => void;
		requested = new Promise<void>(resolve => {
			resolveRequested = resolve;
		});
		applied = new Promise<void>(resolve => {
			resolveApplied = resolve;
		});
		const initial = new Promise<IpcResult<ProjectInfo[]>>(resolve => {
			release = () => resolve({ok: true, value: empty});
		});
		let first = controlled;
		const bridge: Pick<
			DesktopApi,
			'listProjects' | 'getUiState' | 'openProject'
		> = {
			listProjects(request) {
				if (!first) return desktop.listProjects(request);
				first = false;
				resolveRequested();
				return initial;
			},
			getUiState: request => desktop.getUiState(request),
			openProject: request => desktop.openProject(request),
		};
		Reflect.set(window, 'projectHydrationBridge', bridge);
		function Fixture() {
			const controls = useProjects();
			useEffect(() => {
				if (controls.projects === empty) resolveApplied();
			}, [controls.projects]);
			return createElement(
				Fragment,
				null,
				createElement(RecentProjects, {...controls, compact: true}),
				createElement(TrustFeedback, {feedback: controls.feedback}),
			);
		}
		const container = document.createElement('div');
		container.id = 'project-hydration-fixture';
		document.body.replaceChildren(container);
		root = createRoot(container);
		flushSync(() => root?.render(createElement(Fixture)));
	},
	waitForEmptyRead() {
		if (!requested) throw new Error('No mounted hydration fixture');
		return requested;
	},
	async releaseEmpty() {
		if (!release || !applied) throw new Error('No pending empty hydration');
		release();
		release = undefined;
		await applied;
	},
};
