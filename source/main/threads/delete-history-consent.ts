import type {MessageBoxOptions} from 'electron';

export function deleteHistoryDialog(options: {
	project: {displayName: string; canonicalRoot: string};
	thread: {title: string};
}): MessageBoxOptions {
	return {
		type: 'warning',
		title: 'delete Nanocoder chat history?',
		message: 'delete this chat history from Nanocoder?',
		detail: `${options.thread.title} · ${options.project.displayName}\n${options.project.canonicalRoot}\n\ndeletes the saved Nanocoder session when you confirm. this cannot be undone. if Nanocoder does not offer session/delete, nothing is deleted. removing a thread from the desktop does not do this.`,
		buttons: ['delete chat history', 'cancel'],
		defaultId: 1,
		cancelId: 1,
		noLink: true,
	};
}
