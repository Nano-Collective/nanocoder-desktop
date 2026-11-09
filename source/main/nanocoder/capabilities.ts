import type {InitializeResponse} from '@agentclientprotocol/sdk';
import {
	DISABLED_TOOLS_MIN_VERSION,
	MCP_SERVERS_MIN_VERSION,
	supportsClientMcpServers,
	supportsDisabledTools,
	versionPolicy,
} from '@/main/nanocoder/version-policy';
import type {
	CapabilityGate,
	CapabilityGates,
	ConnectedAgent,
} from '@/shared/ipc';

const text = (value: unknown): string | null =>
	typeof value === 'string' ? value : null;

const present = (value: unknown): boolean =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ExtensionProbes {
	rename: boolean;
	timeline: boolean;
}

export function capabilityGates(
	projectId: string,
	agent: ConnectedAgent,
	probes: ExtensionProbes,
	browserServer = false,
): CapabilityGates {
	const policy = versionPolicy(agent.version);
	const gate = (offered: boolean, reason: string): CapabilityGate =>
		policy.status === 'refused'
			? {enabled: false, reason: policy.reason}
			: offered
				? {enabled: true, reason: null}
				: {enabled: false, reason};
	const advertised = (key: keyof ConnectedAgent['capabilities']['sessions']) =>
		gate(
			agent.capabilities.sessions[key],
			`Nanocoder did not advertise session/${key}.`,
		);
	return {
		projectId,
		versionPolicy: policy,
		features: {
			resume: advertised('resume'),
			close: advertised('close'),
			delete: advertised('delete'),
			list: advertised('list'),
			rename: gate(
				probes.rename,
				'Nanocoder did not confirm the renameSession extension with a safe probe.',
			),
			timeline: gate(
				probes.timeline,
				'Nanocoder did not confirm the timeline/list extension with a safe probe; tool locations remain available.',
			),
			agentChanges: gate(
				false,
				'Nanocoder does not yet offer a verified snapshot-read method.',
			),
			browserControl: browserControlGate(agent, browserServer, gate),
			nanocoderBrowserOff: gate(
				supportsDisabledTools(agent.version),
				`Nanocoder ${agent.version ?? 'without a version'} cannot turn its own browser tool off for a session; that needs ${DISABLED_TOOLS_MIN_VERSION}. Its browser stays on and does not follow the desktop's browser settings.`,
			),
			subagentTree: gate(
				false,
				'Nanocoder does not yet offer a verified child-event projection; subagents remain tool cards.',
			),
		},
	};
}

function browserControlGate(
	agent: ConnectedAgent,
	browserServer: boolean,
	gate: (offered: boolean, reason: string) => CapabilityGate,
): CapabilityGate {
	if (!agent.capabilities.mcp.http)
		return gate(
			false,
			'Nanocoder did not report mcpCapabilities.http, which the desktop browser server needs.',
		);
	if (!supportsClientMcpServers(agent.version))
		return gate(
			false,
			`Nanocoder ${agent.version ?? 'without a version'} predates client mcpServers support, which arrived in ${MCP_SERVERS_MIN_VERSION}.`,
		);
	return gate(
		browserServer,
		'The desktop browser server is not running for this project.',
	);
}

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
