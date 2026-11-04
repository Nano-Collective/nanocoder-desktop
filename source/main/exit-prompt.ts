import type {ExitChoice} from '@/main/exit-guard';

interface MessageBoxOptions {
	type: 'warning';
	title: string;
	message: string;
	detail: string;
	buttons: string[];
	defaultId: number;
	cancelId: number;
	noLink: true;
}

export type ShowMessageBox = (
	options: MessageBoxOptions,
) => Promise<{response: number}>;

const MAX_NAMES = 3;

// The native question when a turn is still unfinished. Keeping the turn running is the
// default and the cancel answer, so closing the box or pressing Escape ends nothing.
// "Leaving ends it" is true for a window close too: the renderer detaches and the thread
// service stops the project's process (thread-service detach), on every platform.
export function createExitPrompt(options: {
	showMessageBox: ShowMessageBox;
	projectName(projectId: string): string | undefined;
}) {
	return async (projectIds: readonly string[]): Promise<ExitChoice> => {
		const names = projectIds
			.slice(0, MAX_NAMES)
			.map(id => options.projectName(id) ?? 'A project');
		const more = projectIds.length - names.length;
		const message =
			projectIds.length === 1
				? `${names[0]} still has a turn that is running or waiting for you.`
				: `${projectIds.length} projects still have turns that are running or waiting for you: ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}.`;
		const {response} = await options.showMessageBox({
			type: 'warning',
			title: 'A turn is still unfinished',
			message,
			detail:
				'Leaving now ends it. You can wait for it to finish, or keep working.',
			buttons: ['Keep working', 'Wait for it to finish', 'Cancel it and leave'],
			defaultId: 0,
			cancelId: 0,
			noLink: true,
		});
		return response === 2 ? 'cancel' : response === 1 ? 'wait' : 'stay';
	};
}
