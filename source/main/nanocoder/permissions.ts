import type {
	RequestPermissionRequest,
	RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import {permissionSource} from '@/main/nanocoder/subagent-display';
import type {PermissionRequestInfo, TurnEvent} from '@/shared/ipc';

interface Pending {
	optionIds: ReadonlySet<string>;
	resolve(response: RequestPermissionResponse): void;
}

const CANCELLED: RequestPermissionResponse = {outcome: {outcome: 'cancelled'}};

// Holds each request until the user answers it. Nothing answers on the user's behalf (ACP-10).
export class PermissionBroker {
	private readonly pending = new Map<string, Pending>();
	private counter = 0;

	constructor(
		private readonly emit: (event: TurnEvent) => void,
		private readonly nextId = () => `permission-${++this.counter}`,
	) {}

	request(
		params: RequestPermissionRequest,
		question = false,
	): Promise<RequestPermissionResponse> {
		const id = this.nextId();
		const source = permissionSource(params.toolCall);
		const info: PermissionRequestInfo = {
			id,
			title: params.toolCall.title ?? params.toolCall.toolCallId,
			options: params.options.map(option => ({
				id: option.optionId,
				name: option.name,
				kind: option.kind,
			})),
			...(source ? {source} : {}),
			...(question ? {question: true} : {}),
		};
		return new Promise(resolve => {
			this.pending.set(id, {
				optionIds: new Set(info.options.map(option => option.id)),
				resolve,
			});
			this.emit({type: 'permission', request: info});
		});
	}

	// Only an option Nanocoder offered for a request that is still waiting counts.
	answer(id: string, optionId: string): boolean {
		const entry = this.pending.get(id);
		if (!entry?.optionIds.has(optionId)) return false;
		this.pending.delete(id);
		entry.resolve({outcome: {outcome: 'selected', optionId}});
		this.emit({type: 'permission-closed', id});
		return true;
	}

	cancelAll(): void {
		for (const [id, entry] of this.pending) {
			entry.resolve(CANCELLED);
			this.emit({type: 'permission-closed', id});
		}
		this.pending.clear();
	}
}
