import test from 'ava';
import {capabilityGates, describeAgent} from '@/main/nanocoder/capabilities';

test('records what Nanocoder 1.31.0 answers to initialize', t => {
	t.deepEqual(
		describeAgent('/work/project', {
			protocolVersion: 1,
			agentCapabilities: {
				loadSession: true,
				providers: {},
				sessionCapabilities: {close: {}, list: {}, delete: {}, resume: {}},
			},
			agentInfo: {name: 'nanocoder', title: 'Nanocoder', version: '1.31.0'},
			authMethods: [],
		}),
		{
			root: '/work/project',
			protocolVersion: 1,
			name: 'nanocoder',
			version: '1.31.0',
			capabilities: {
				loadSession: true,
				sessions: {close: true, delete: true, list: true, resume: true},
				prompt: {image: false, audio: false, embeddedContext: false},
				mcp: {http: false, sse: false},
				perSessionModel: false,
				retention: null,
			},
		},
	);
});

test('treats anything missing or malformed as not offered', t => {
	const response = {
		protocolVersion: 1,
		agentCapabilities: {
			loadSession: 'yes',
			sessionCapabilities: {close: null},
			promptCapabilities: {image: true},
		},
		agentInfo: {name: 7, version: null},
	} as unknown as Parameters<typeof describeAgent>[1];
	t.deepEqual(describeAgent('/p', response), {
		root: '/p',
		protocolVersion: 1,
		name: null,
		version: null,
		capabilities: {
			loadSession: false,
			sessions: {close: false, delete: false, list: false, resume: false},
			prompt: {image: true, audio: false, embeddedContext: false},
			mcp: {http: false, sse: false},
			perSessionModel: false,
			retention: null,
		},
	});
});

test('reads per-session model state as offered only when Nanocoder advertises it as exactly true (ACP-14 CHAT-10)', t => {
	const offered = (nanocoder: unknown) =>
		describeAgent('/p', {
			protocolVersion: 1,
			agentCapabilities: {_meta: {nanocoder}},
		} as unknown as Parameters<typeof describeAgent>[1]).capabilities
			.perSessionModel;
	t.true(offered({perSessionModel: true}));
	for (const value of [false, 'true', 1, null, {}, undefined])
		t.false(offered({perSessionModel: value}));
	t.false(offered(undefined));
	t.false(offered('nanocoder'));
	t.false(offered(null));
});

test('reads HTTP client MCP servers as offered only when it is exactly true (DEC-47)', t => {
	const offered = (mcpCapabilities: unknown) =>
		describeAgent('/p', {
			protocolVersion: 1,
			agentCapabilities: {mcpCapabilities},
		} as unknown as Parameters<typeof describeAgent>[1]).capabilities.mcp;
	t.deepEqual(offered({http: true}), {http: true, sse: false});
	t.deepEqual(offered({http: true, sse: true}), {http: true, sse: true});
	t.deepEqual(offered({http: 'yes', sse: 1}), {http: false, sse: false});
	t.deepEqual(offered(undefined), {http: false, sse: false});
});

test('copes with no capabilities or agent info at all', t => {
	const agent = describeAgent('/p', {protocolVersion: 1});
	t.is(agent.name, null);
	t.false(agent.capabilities.sessions.resume);
});

test('each disabled feature carries a reason, never a privileged fallback', t => {
	const agent = describeAgent('/p', {
		protocolVersion: 1,
		agentInfo: {name: 'nanocoder', version: '1.32.0'},
	});
	const gates = capabilityGates('project', agent, {
		rename: false,
		timeline: false,
		pin: false,
		read: false,
	});
	t.is(gates.versionPolicy.status, 'supported');
	// The browser switch depends on the version alone, which 1.32.0 meets.
	const {nanocoderBrowserOff, ...rest} = gates.features;
	t.true(nanocoderBrowserOff.enabled);
	for (const gate of Object.values(rest)) {
		t.false(gate.enabled);
		t.truthy(gate.reason);
	}
});

test('advertised sessions and positively probed extensions enable only those features', t => {
	const agent = describeAgent('/p', {
		protocolVersion: 1,
		agentInfo: {name: 'nanocoder', version: '9.9.9'},
		agentCapabilities: {
			sessionCapabilities: {resume: {}, close: {}, delete: {}, list: {}},
		},
	});
	const gates = capabilityGates('project', agent, {
		rename: true,
		timeline: true,
		pin: true,
		read: true,
	});
	for (const key of [
		'resume',
		'close',
		'delete',
		'list',
		'rename',
		'timeline',
		'pinSession',
		'agentChanges',
	] as const) {
		t.deepEqual(gates.features[key], {enabled: true, reason: null});
	}
	for (const key of ['browserControl', 'subagentTree'] as const) {
		t.false(gates.features[key].enabled);
		t.truthy(gates.features[key].reason);
	}
});

test('refused versions turn every feature off even when advertised or probed', t => {
	const agent = describeAgent('/p', {
		protocolVersion: 1,
		agentInfo: {name: 'nanocoder', version: '1.30.0'},
		agentCapabilities: {
			sessionCapabilities: {resume: {}, close: {}, delete: {}, list: {}},
		},
	});
	const gates = capabilityGates('project', agent, {
		rename: true,
		timeline: true,
		pin: true,
		read: true,
	});
	t.true(
		Object.values(gates.features).every(
			gate => !gate.enabled && gate.reason === gates.versionPolicy.reason,
		),
	);
});

test('malformed capability flags never count as offered', t => {
	const response = {
		protocolVersion: 1,
		agentCapabilities: {
			sessionCapabilities: {
				resume: true,
				close: false,
				delete: [],
				list: 'yes',
			},
		},
	} as unknown as Parameters<typeof describeAgent>[1];
	t.deepEqual(describeAgent('/p', response).capabilities.sessions, {
		resume: false,
		close: false,
		delete: false,
		list: false,
	});
});

test('agent browser control is on only with HTTP MCP servers, Nanocoder 1.32.0 or later and the desktop server attached (ACP-22 BRW-17)', t => {
	const agent = (version: string, http: boolean) =>
		describeAgent('/p', {
			protocolVersion: 1,
			agentInfo: {name: 'nanocoder', version},
			agentCapabilities: {mcpCapabilities: {http}},
		});
	const probes = {rename: false, timeline: false, pin: false, read: false};
	const gate = (version: string, http: boolean, attached: boolean) =>
		capabilityGates('project', agent(version, http), probes, attached).features
			.browserControl;
	t.deepEqual(gate('1.32.0', true, true), {enabled: true, reason: null});
	t.deepEqual(gate('1.32.0', false, true), {
		enabled: false,
		reason:
			'Nanocoder did not report mcpCapabilities.http, which the desktop browser server needs.',
	});
	t.deepEqual(gate('1.31.0', true, true), {
		enabled: false,
		reason:
			'Nanocoder 1.31.0 predates client mcpServers support, which arrived in 1.32.0.',
	});
	t.deepEqual(gate('1.32.0', true, false), {
		enabled: false,
		reason: 'The desktop browser server is not running for this project.',
	});
	t.false(gate('1.30.0', true, true).enabled);
	t.false(
		capabilityGates('project', agent('1.32.0', true), probes).features
			.browserControl.enabled,
	);
});

test("BRW-18 the switch for Nanocoder's own browser is gated on 1.32.0, with the reason (DEC-48)", t => {
	const gate = (version: string) =>
		capabilityGates(
			'project',
			describeAgent('/p', {
				protocolVersion: 1,
				agentInfo: {name: 'nanocoder', version},
			}),
			{rename: false, timeline: false, pin: false, read: false},
		).features.nanocoderBrowserOff;
	t.deepEqual(gate('1.32.0'), {enabled: true, reason: null});
	t.deepEqual(gate('1.31.0'), {
		enabled: false,
		reason:
			"Nanocoder 1.31.0 cannot turn its own browser tool off for a session; that needs 1.32.0. Its browser stays on and does not follow the desktop's browser settings.",
	});
});

test('REL-02 the exact bundled version carries no untested warning, and any other version still does', t => {
	const agent = (version: string) =>
		describeAgent('/p', {
			protocolVersion: 1,
			agentInfo: {name: 'nanocoder', version},
		});
	const probes = {rename: false, timeline: false, pin: false, read: false};
	t.deepEqual(
		capabilityGates('p', agent('1.32.0'), probes, false, '1.32.0')
			.versionPolicy,
		{status: 'bundled', version: '1.32.0', reason: null},
	);
	t.is(
		capabilityGates('p', agent('1.33.0'), probes, false, '1.32.0').versionPolicy
			.status,
		'untested',
	);
	t.is(
		capabilityGates('p', agent('1.33.0'), probes).versionPolicy.status,
		'untested',
	);
	t.is(
		capabilityGates('p', agent('1.32.0'), probes).versionPolicy.status,
		'supported',
	);
});

test('reads the retention limits Nanocoder reports, and nothing it could not have meant (DEC-45)', t => {
	const reported = (value: unknown) =>
		describeAgent('/p', {
			protocolVersion: 1,
			_meta: {'nanocoder/retention': value},
		} as unknown as Parameters<typeof describeAgent>[1]).capabilities.retention;
	t.deepEqual(reported({retentionDays: 30, maxSessions: 100}), {
		days: 30,
		maxSessions: 100,
	});
	t.deepEqual(reported({retentionDays: 90, maxSessions: 500, extra: 'x'}), {
		days: 90,
		maxSessions: 500,
	});
	for (const bad of [
		undefined,
		null,
		'30',
		[],
		{},
		{retentionDays: 30},
		{retentionDays: 0, maxSessions: 100},
		{retentionDays: 30, maxSessions: 0},
		{retentionDays: 1.5, maxSessions: 100},
		{retentionDays: '30', maxSessions: 100},
		{retentionDays: 30, maxSessions: Number.POSITIVE_INFINITY},
		{retentionDays: 1e9, maxSessions: 100},
	])
		t.is(reported(bad), null);
});

test('session pinning is offered only when the pin probe answered, with a reason otherwise (CHAT-23 ACP-03)', t => {
	const agent = describeAgent('/p', {
		protocolVersion: 1,
		agentInfo: {name: 'nanocoder', version: '1.32.0'},
	});
	const off = capabilityGates('project', agent, {
		rename: true,
		timeline: true,
		pin: false,
		read: false,
	});
	t.false(off.features.pinSession.enabled);
	t.truthy(off.features.pinSession.reason);
	const on = capabilityGates('project', agent, {
		rename: false,
		timeline: false,
		pin: true,
		read: true,
	});
	t.deepEqual(on.features.pinSession, {enabled: true, reason: null});
});

test('GIT-09 the agent changes view needs both the timeline list and read probes, with a reason otherwise', t => {
	const agent = describeAgent('/p', {
		protocolVersion: 1,
		agentInfo: {name: 'nanocoder', version: '1.32.0'},
	});
	const gate = (timeline: boolean, read: boolean) =>
		capabilityGates('project', agent, {
			rename: false,
			timeline,
			pin: false,
			read,
		}).features.agentChanges;
	t.deepEqual(gate(true, true), {enabled: true, reason: null});
	for (const [timeline, read] of [
		[true, false],
		[false, true],
		[false, false],
	] as const) {
		t.false(gate(timeline, read).enabled);
		t.truthy(gate(timeline, read).reason);
	}
});
