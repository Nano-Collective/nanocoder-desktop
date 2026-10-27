import test from 'ava';
import {describeAgent} from '@/main/nanocoder/capabilities';

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
