import {createElement} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {ApprovalRequests} from '@/renderer/approval-requests';
import type {DesktopApi} from '@/shared/desktop-api';
import type {PermissionRequestInfo} from '@/shared/ipc';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let origin: HTMLButtonElement | undefined;

export const approvalHarness = {
	render(requests: PermissionRequestInfo[]) {
		if (!root) {
			origin = document.createElement('button');
			origin.textContent = 'fixture focus origin';
			container = document.createElement('div');
			container.id = 'approval-focus-fixture';
			container.style.position = 'fixed';
			container.style.inset = '0';
			container.style.zIndex = '20';
			container.append(origin);
			document.body.append(container);
			origin.focus();
			root = createRoot(container.appendChild(document.createElement('div')));
		}
		root.render(
			createElement(ApprovalRequests, {
				requests,
				mode: 'normal',
				busy: false,
				onAnswer: async (id, optionId) => {
					const {desktop} = window as unknown as {desktop: DesktopApi};
					const ui = await desktop.getUiState({});
					return desktop.answerThreadPermission({
						projectId:
							(ui.ok && ui.value.activeProjectId) ||
							'11111111-1111-4111-8111-111111111111',
						threadId:
							(ui.ok && ui.value.activeThreadId) ||
							'22222222-2222-4222-8222-222222222222',
						requestId: id,
						optionId,
					});
				},
			}),
		);
	},
	dispose() {
		root?.unmount();
		container?.remove();
		root = undefined;
		container = undefined;
		origin = undefined;
	},
};
