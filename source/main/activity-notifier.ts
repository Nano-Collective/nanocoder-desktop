import type {ProjectActivityChange} from '@/main/threads/project-activity';

const MAX_NAME = 60;

export interface ActivityNotifierOptions {
	supported(): boolean;
	windowFocused(): boolean;
	active(): string | undefined;
	projectName(projectId: string): string | undefined;
	show(notification: {title: string; body: string}, onClick: () => void): void;
	open(projectId: string): void;
}

const WORDING = {
	'needs-approval': 'is waiting for your approval',
	finished: 'has finished',
	failed: 'stopped with an error',
} as const;

// An extra beside the rail marker, never the only signal: macOS shows notifications only
// for a signed app. The text is generic (CHAT-22, SEC-07), so it names the project and
// nothing the agent did.
export function createActivityNotifier(options: ActivityNotifierOptions) {
	return (change: ProjectActivityChange): void => {
		const wording = WORDING[change.status as keyof typeof WORDING] as
			| string
			| undefined;
		if (
			!wording ||
			!options.supported() ||
			options.windowFocused() ||
			change.projectId === options.active()
		)
			return;
		const name = (options.projectName(change.projectId) ?? 'A project').slice(
			0,
			MAX_NAME,
		);
		options.show({title: 'Nanocoder', body: `${name} ${wording}`}, () =>
			options.open(change.projectId),
		);
	};
}
