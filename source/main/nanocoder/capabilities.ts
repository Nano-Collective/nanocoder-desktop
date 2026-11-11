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

function nanocoderMeta(meta: unknown): Record<string, unknown> {
	const nanocoder = present(meta)
		? (meta as Record<string, unknown>).nanocoder
		: undefined;
	return present(nanocoder) ? (nanocoder as Record<string, unknown>) : {};
}

export interface ExtensionProbes {
	rename: boolean;
	timeline: boolean;
	pin: boolean;
}

function limit(value: unknown, max: number): number | null {
	return typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= max
		? value
		: null;
}

function retentionLimits(meta: unknown) {
	const reported = present(meta)
		? (meta as Record<string, unknown>)['nanocoder/retention']
		: undefined;
	if (!present(reported)) return null;
	const days = limit(
		(reported as Record<string, unknown>).retentionDays,
		36500,
	);
	const maxSessions = limit(
		(reported as Record<string, unknown>).maxSessions,
		1_000_000,
	);
	return days !== null && maxSessions !== null ? {days, maxSessions} : null;
}

export function capabilityGates(
	projectId: string,
	agent: ConnectedAgent,
	probes: ExtensionProbes,
	browserServer = false,
	// The version of the Nanocoder the app ships, when this one is it (REL-02).
	bundledVersion?: string,
): CapabilityGates {
	const policy = versionPolicy(agent.version, bundledVersion);
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
			pinSession: gate(
				probes.pin,
				'Nanocoder did not confirm the pinSession extension with a safe probe; saved chats stay subject to its retention.',
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
			perSessionModel:
				nanocoderMeta(capabilities._meta).perSessionModel === true,
			retention: retentionLimits(response._meta),
		},
	};
}
