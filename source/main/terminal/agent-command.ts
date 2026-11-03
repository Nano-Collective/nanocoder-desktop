import type {ProjectEvent, WorkspaceRequests} from '@/shared/ipc';
import type {AgentCommandInfo} from '@/shared/terminal';

interface PendingCommand {
	command: AgentCommandInfo;
	options: Map<string, string>;
}

function shellCommand(title: string | undefined): string | undefined {
	const match = /^execute_bash:\s*([\s\S]+)$/u.exec(title ?? '');
	return match?.[1].slice(0, 4096);
}

// Passive display projection. Nothing here calls a tool or writes to the PTY.
export class AgentCommandObserver {
	private projectId: string | null = null;
	private current: AgentCommandInfo | undefined;
	private readonly pending = new Map<string, PendingCommand>();

	constructor(
		private readonly publish: (
			projectId: string,
			command: AgentCommandInfo,
		) => void,
	) {}

	reset(projectId: string | null): void {
		this.projectId = projectId;
		this.current = undefined;
		this.pending.clear();
	}

	observe(event: ProjectEvent): void {
		if (
			event.projectId !== this.projectId ||
			event.type !== 'turn' ||
			event.replay
		)
			return;
		for (const update of event.events) {
			if (update.type === 'tool') {
				const command = shellCommand(update.title);
				if (!command) continue;
				if (
					this.current?.threadId === event.threadId &&
					this.current.command === command
				)
					continue;
				this.current = {threadId: event.threadId, command, approval: 'unknown'};
				this.publish(event.projectId, this.current);
			} else if (update.type === 'permission') {
				const command = shellCommand(update.request.title);
				if (!command || this.pending.size >= 32) continue;
				this.current = {threadId: event.threadId, command, approval: 'pending'};
				this.pending.set(update.request.id, {
					command: this.current,
					options: new Map(
						update.request.options
							.slice(0, 16)
							.map(option => [option.id, option.kind]),
					),
				});
				this.publish(event.projectId, this.current);
			} else if (update.type === 'permission-closed') {
				const pending = this.pending.get(update.id);
				this.pending.delete(update.id);
				if (pending && this.current && pending.command === this.current) {
					this.current.approval = 'unknown';
					this.publish(event.projectId, this.current);
				}
			}
		}
	}

	capture(
		request: WorkspaceRequests['answerThreadPermission'],
	): (() => void) | undefined {
		if (request.projectId !== this.projectId) return;
		const pending = this.pending.get(request.requestId);
		if (!pending || pending.command.threadId !== request.threadId) return;
		const kind = pending.options.get(request.optionId);
		if (!kind) return;
		const projectId = this.projectId;
		return () => {
			if (projectId !== this.projectId || pending.command !== this.current)
				return;
			this.current.approval =
				kind === 'allow_once' || kind === 'allow_always'
					? 'allowed'
					: kind === 'reject_once' || kind === 'reject_always'
						? 'rejected'
						: 'unknown';
			this.publish(projectId, this.current);
		};
	}
}
