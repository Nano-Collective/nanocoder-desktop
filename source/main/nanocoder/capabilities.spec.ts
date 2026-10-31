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
		},
	});
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
	});
	t.is(gates.versionPolicy.status, 'untested');
	for (const gate of Object.values(gates.features)) {
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
	});
	for (const key of [
		'resume',
		'close',
		'delete',
		'list',
		'rename',
		'timeline',
	] as const) {
		t.deepEqual(gates.features[key], {enabled: true, reason: null});
	}
	for (const key of [
		'agentChanges',
		'browserControl',
		'subagentTree',
	] as const) {
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
