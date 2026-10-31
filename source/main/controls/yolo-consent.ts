import type {MessageBoxOptions} from 'electron';
import type {ProjectInfo, ThreadInfo} from '@/shared/ipc';

export async function confirmYolo(options: {
	project: Pick<ProjectInfo, 'displayName'>;
	thread: Pick<ThreadInfo, 'title' | 'nanocoderSessionId'>;
	ask(options: MessageBoxOptions): Promise<number>;
}): Promise<boolean> {
	const response = await options.ask({
		type: 'warning',
		title: 'use yolo for this thread?',
		message: `use yolo for "${options.thread.title}" in "${options.project.displayName}"?`,
		detail: [
			'yolo skips Nanocoder tool approvals for this thread only. It does not change the project default and is not restored after resume or restart.',
			options.thread.nanocoderSessionId === null
				? 'this is a pending choice: no session is created until the first message.'
				: "this changes this thread's current session only.",
			"tools in Nanocoder's alwaysAllow list run without asking in every mode.",
		].join('\n\n'),
		buttons: ['cancel', 'use yolo'],
		defaultId: 0,
		cancelId: 0,
		noLink: true,
	});
	return response === 1;
}
