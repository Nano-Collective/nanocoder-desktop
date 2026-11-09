import test from 'ava';
import {
	type AgentQuestion,
	AgentRefusal,
	createAgentPolicy,
	localOnlyPolicy,
} from '@/main/browser/agent-policy';
import {SiteAccess} from '@/main/browser/site-access';
import type {NanocoderMode} from '@/shared/ipc';

const context = {projectId: 'p1', sessionId: 's1'};

function policy(
	options: {
		publicSites?: boolean;
		mode?: NanocoderMode | undefined;
		answers?: Array<string | null>;
	} = {},
) {
	let saved: string[] = [];
	const asked: AgentQuestion[] = [];
	const answers = [...(options.answers ?? [])];
	const sites = new SiteAccess({
		get: () => saved,
		set: list => {
			saved = list;
		},
	});
	const settings = {publicSites: options.publicSites ?? true};
	const made = createAgentPolicy({
		publicSites: () => settings.publicSites,
		mode: () => ('mode' in options ? options.mode : 'normal'),
		ask: async (_context, question) => {
			asked.push(question);
			return answers.shift() ?? null;
		},
		sites,
	});
	return {policy: made, asked, sites, settings, saved: () => saved};
}

const refusal = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => undefined,
		(caught: unknown) => caught,
	);
	if (!(error instanceof AgentRefusal)) throw new Error(String(error));
	return error.message;
};

test('local addresses never ask, and other schemes or bad addresses are refused (BRW-16)', async t => {
	const p = policy();
	await p.policy.admit(context, 'http://localhost:5173/a');
	await p.policy.admit(context, 'http://[::1]:3000/');
	t.true(p.policy.admitted(context, 'http://127.0.0.1:1/'));
	t.regex(
		await refusal(p.policy.admit(context, 'file:///etc/passwd')),
		/Only http and https/,
	);
	t.regex(await refusal(p.policy.admit(context, 'nope')), /not a valid/);
	t.deepEqual(p.asked, []);
});

test('public sites need the public sites setting, whatever the user answered before (BRW-03)', async t => {
	const p = policy({publicSites: false});
	t.regex(
		await refusal(p.policy.admit(context, 'https://example.com/')),
		/Public sites are off/,
	);
	t.deepEqual(p.asked, []);
});

test('SEC-11 public sites need normal mode, checked at every call', async t => {
	for (const mode of ['auto-accept', 'yolo', 'plan', undefined] as const) {
		const p = policy({mode});
		t.regex(
			await refusal(p.policy.admit(context, 'https://example.com/')),
			/only in normal mode/,
		);
		t.false(p.policy.admitted(context, 'https://example.com/'));
		t.deepEqual(p.asked, []);
	}
});

test('DEC-50 the first visit to a public site asks for this chat, always, or block', async t => {
	const p = policy({answers: ['thread']});
	await p.policy.admit(context, 'https://example.com/a');
	t.deepEqual(p.asked, [
		{
			title: 'Let the agent use https://example.com in the in-app browser?',
			options: [
				{id: 'thread', name: 'allow for this chat', kind: 'allow_once'},
				{id: 'always', name: 'always allow', kind: 'allow_always'},
				{id: 'block', name: 'block', kind: 'reject_once'},
			],
		},
	]);
	await p.policy.admit(context, 'https://example.com/b');
	t.is(p.asked.length, 1);
	t.true(p.policy.admitted(context, 'https://example.com/c'));
	t.false(
		p.policy.admitted({...context, sessionId: 's2'}, 'https://example.com/'),
	);
});

test('DEC-50 always allow is saved, and block refuses for the rest of the chat', async t => {
	const p = policy({answers: ['always', 'block']});
	await p.policy.admit(context, 'https://docs.example.com/');
	t.deepEqual(p.saved(), ['https://docs.example.com']);
	t.regex(
		await refusal(p.policy.admit(context, 'https://shop.example.com/')),
		/blocked https:\/\/shop.example.com for this chat/,
	);
	t.regex(
		await refusal(p.policy.admit(context, 'https://shop.example.com/again')),
		/blocked/,
	);
	t.is(p.asked.length, 2);
});

test('no answer, or no chat to ask in, refuses without remembering anything', async t => {
	const p = policy({answers: [null]});
	t.regex(
		await refusal(p.policy.admit(context, 'https://example.com/')),
		/did not allow https:\/\/example.com/,
	);
	t.is(p.sites.state('s1', 'https://example.com'), 'unknown');
	t.regex(
		await refusal(
			p.policy.admit(
				{projectId: 'p1', sessionId: null},
				'https://example.com/',
			),
		),
		/did not allow/,
	);
});

test('a public site stays admitted only while public sites are on', async t => {
	const p = policy({answers: ['thread']});
	await p.policy.admit(context, 'https://example.com/');
	p.settings.publicSites = false;
	t.false(p.policy.admitted(context, 'https://example.com/'));
});

test('BRW-13 an approval is yes only when the user picks allow', async t => {
	const p = policy({answers: ['allow', 'reject', null]});
	t.true(await p.policy.approve(context, 'Submit the form?'));
	t.false(await p.policy.approve(context, 'Submit the form?'));
	t.false(await p.policy.approve(context, 'Submit the form?'));
	t.deepEqual(p.asked[0], {
		title: 'Submit the form?',
		options: [
			{id: 'allow', name: 'allow once', kind: 'allow_once'},
			{id: 'reject', name: 'reject', kind: 'reject_once'},
		],
	});
});

test('without a policy the agent stays local and nothing is approved', async t => {
	await localOnlyPolicy.admit(context, 'http://localhost:1/');
	t.regex(
		await refusal(localOnlyPolicy.admit(context, 'https://example.com/')),
		/local addresses/,
	);
	t.false(localOnlyPolicy.admitted(context, 'https://example.com/'));
	t.false(await localOnlyPolicy.approve(context, 'x'));
});
