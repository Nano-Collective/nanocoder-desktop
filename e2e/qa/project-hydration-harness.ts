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
let release: (() => Promise<void>) | undefined;
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
		let initialUi: ReturnType<DesktopApi['getUiState']> | undefined;
		const initial = new Promise<IpcResult<ProjectInfo[]>>(resolve => {
			release = async () => {
				if (!initialUi) throw new Error('No initial UI state read');
				resolve({ok: true, value: empty});
				await Promise.all([initial, initialUi]);
				// Cross a task boundary after the hook's read continuation.
				await new Promise<void>(settled => {
					const channel = new MessageChannel();
					channel.port1.onmessage = () => {
						channel.port1.close();
						channel.port2.close();
						flushSync(() => root?.render(createElement(Fixture)));
						settled();
					};
					channel.port2.postMessage(null);
				});
			};
		});
		let first = controlled;
		const bridge: Pick<
			DesktopApi,
			'listProjects' | 'getUiState' | 'openProject' | 'onProjectEvent'
		> = {
			listProjects(request) {
				if (!first) return desktop.listProjects(request);
				first = false;
				resolveRequested();
				return initial;
			},
			getUiState(request) {
				const result = desktop.getUiState(request);
				initialUi ??= result;
				return result;
			},
			openProject: request => desktop.openProject(request),
			onProjectEvent: listener => desktop.onProjectEvent(listener),
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
	async releaseEmpty(waitFor: 'applied' | 'settled' = 'applied') {
		if (!release || !applied) throw new Error('No pending empty hydration');
		const settle = release();
		release = undefined;
		await settle;
		if (waitFor === 'applied') await applied;
	},
};
