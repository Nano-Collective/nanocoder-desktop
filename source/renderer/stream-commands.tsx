import * as React from 'react';
import {Button} from '@/renderer/ui';
import type {StreamCommand} from '@/shared/ipc';

export function suggestedCommands(
	commands: readonly StreamCommand[],
	draft: string,
): StreamCommand[] {
	if (!draft.startsWith('/') || /\s/.test(draft)) return [];
	const prefix = draft.slice(1).toLowerCase();
	return commands
		.filter(
			command =>
				commandDraft(command.name) !== undefined &&
				command.name.replace(/^\//, '').toLowerCase().startsWith(prefix),
		)
		.slice(0, 8);
}

export function commandDraft(name: string): string | undefined {
	return /^\/?[a-z0-9][\w.:/-]{0,63}$/i.test(name)
		? `/${name.replace(/^\//, '')} `
		: undefined;
}

export function SlashSuggestions({
	commands,
	draft,
	disabled,
	onInsert,
}: {
	commands: readonly StreamCommand[];
	draft: string;
	disabled: boolean;
	onInsert(text: string): void;
}): React.ReactElement | null {
	const suggestions = suggestedCommands(commands, draft);
	return suggestions.length ? (
		<ul className="stream-commands" aria-label="available slash commands">
			{suggestions.map(command => (
				<li key={command.name}>
					<Button
						type="button"
						disabled={disabled}
						aria-label={`insert ${commandDraft(command.name)?.trim()} into message`}
						onClick={() => {
							const text = commandDraft(command.name);
							if (text) onInsert(text);
						}}
					>
						/{command.name.replace(/^\//, '')} · {command.description}
						{command.inputHint && <> · {command.inputHint}</>}
					</Button>
				</li>
			))}
		</ul>
	) : null;
}
