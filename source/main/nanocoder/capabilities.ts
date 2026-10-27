import type {InitializeResponse} from '@agentclientprotocol/sdk';
import type {ConnectedAgent} from '@/shared/ipc';

const text = (value: unknown): string | null =>
	typeof value === 'string' ? value : null;

const present = (value: unknown): boolean =>
	value !== undefined && value !== null;

export function describeAgent(
	root: string,
	response: InitializeResponse,
): ConnectedAgent {
	const capabilities = response.agentCapabilities ?? {};
	const sessions = capabilities.sessionCapabilities ?? {};
	const prompt = capabilities.promptCapabilities ?? {};
	const mcp = capabilities.mcpCapabilities ?? {};
	return {
		root,
		protocolVersion: response.protocolVersion,
		name: text(response.agentInfo?.name),
		version: text(response.agentInfo?.version),
		capabilities: {
			loadSession: capabilities.loadSession === true,
			sessions: {
				close: present(sessions.close),
				delete: present(sessions.delete),
				list: present(sessions.list),
				resume: present(sessions.resume),
			},
			prompt: {
				image: prompt.image === true,
				audio: prompt.audio === true,
				embeddedContext: prompt.embeddedContext === true,
			},
			mcp: {http: mcp.http === true, sse: mcp.sse === true},
		},
	};
}
