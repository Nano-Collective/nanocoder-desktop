import {createElement} from 'react';
import {flushSync} from 'react-dom';
import {createRoot, type Root} from 'react-dom/client';
import {ConversationStream} from '@/renderer/conversation-stream';
import type {TranscriptItem} from '@/renderer/transcript';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let settle: (() => void) | undefined;
const calls: string[] = [];
const items: TranscriptItem[] = ['first', 'second'].map(id => ({
	kind: 'tool',
	id,
	title: `${id} • 1k tokens`,
	status: 'in_progress',
	delegation: {role: 'explore', task: `fixture ${id}`, history: false},
}));

export const subagentHarness = {
	render(owner: string, reject = false) {
		if (!root) {
			container = document.createElement('div');
			container.id = 'subagent-stop-fixture';
			container.style.position = 'fixed';
			container.style.inset = '0';
			container.style.zIndex = '30';
			document.body.append(container);
			root = createRoot(container);
		}
		flushSync(() =>
			root?.render(
				createElement(ConversationStream, {
					transcript: {items, permissions: []},
					running: true,
					onStopTurn: () => {
						calls.push(owner);
						return reject
							? Promise.reject(new Error('fixture failure'))
							: new Promise<void>(resolve => {
									settle = resolve;
								});
					},
				}),
			),
		);
	},
	calls: () => [...calls],
	release() {
		settle?.();
		settle = undefined;
	},
	dispose() {
		settle?.();
		settle = undefined;
		root?.unmount();
		container?.remove();
		root = undefined;
		container = undefined;
		calls.length = 0;
	},
};
