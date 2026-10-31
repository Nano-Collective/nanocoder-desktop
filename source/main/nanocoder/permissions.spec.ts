import type {RequestPermissionRequest} from '@agentclientprotocol/sdk';
import test from 'ava';
import {PermissionBroker} from '@/main/nanocoder/permissions';
import type {TurnEvent} from '@/shared/ipc';

const request: RequestPermissionRequest = {
	sessionId: 's1',
	toolCall: {toolCallId: 'call_1', title: 'execute_bash: ls'},
	options: [
		{optionId: 'allow', name: 'Allow', kind: 'allow_once'},
		{optionId: 'deny', name: 'Deny', kind: 'reject_once'},
	],
};

function broker() {
	const events: TurnEvent[] = [];
	return {events, broker: new PermissionBroker(event => events.push(event))};
}

test("shows Nanocoder's options unchanged and waits for the user", async t => {
	const {events, broker: b} = broker();
	let settled = false;
	const response = b.request(request).then(value => {
		settled = true;
		return value;
	});
	await Promise.resolve();

	t.false(settled);
	t.deepEqual(events, [
		{
			type: 'permission',
			request: {
				id: 'permission-1',
				title: 'execute_bash: ls',
				options: [
					{id: 'allow', name: 'Allow', kind: 'allow_once'},
					{id: 'deny', name: 'Deny', kind: 'reject_once'},
				],
			},
		},
	]);

	t.true(b.answer('permission-1', 'allow'));
	t.deepEqual(await response, {
		outcome: {outcome: 'selected', optionId: 'allow'},
	});
	t.deepEqual(events.at(-1), {type: 'permission-closed', id: 'permission-1'});
});

test('the question flag is display only and never changes answers', async t => {
	const {events, broker: b} = broker();
	const questionRequest: RequestPermissionRequest = {
		...request,
		toolCall: {toolCallId: 'call_1', title: 'which rows?', status: 'pending'},
		options: [
			{optionId: 'answer-0', name: 'current filtered rows', kind: 'allow_once'},
			{optionId: 'answer-1', name: 'all rows', kind: 'allow_once'},
		],
	};
	const response = b.request(questionRequest, true);
	t.deepEqual(events[0], {
		type: 'permission',
		request: {
			id: 'permission-1',
			title: 'which rows?',
			options: [
				{id: 'answer-0', name: 'current filtered rows', kind: 'allow_once'},
				{id: 'answer-1', name: 'all rows', kind: 'allow_once'},
			],
			question: true,
		},
	});
	t.false(b.answer('permission-1', 'allow'), 'an approval id is not offered');
	t.false(b.answer('permission-1', 'answer-2'), 'an unoffered answer id');
	t.true(b.answer('permission-1', 'answer-1'));
	t.deepEqual(await response, {
		outcome: {outcome: 'selected', optionId: 'answer-1'},
	});
});

test('a question answers only with its offered ids, matched exactly', async t => {
	const {events, broker: b} = broker();
	const response = b.request(
		{
			...request,
			toolCall: {toolCallId: 'call_1', title: 'which rows?', status: 'pending'},
			options: [
				{
					optionId: 'answer-0',
					name: 'current filtered rows',
					kind: 'allow_once',
				},
				{optionId: 'answer-1', name: 'all rows', kind: 'allow_once'},
			],
		},
		true,
	);
	t.is(events.length, 1);
	for (const id of [
		'answer-01',
		'answer-+0',
		'Answer-0',
		'answer-0 ',
		'answer-2',
		'allow',
		'',
	])
		t.false(b.answer('permission-1', id), JSON.stringify(id));
	t.true(b.answer('permission-1', 'answer-0'));
	t.deepEqual(await response, {
		outcome: {outcome: 'selected', optionId: 'answer-0'},
	});
	t.false(
		b.answer('permission-1', 'answer-0'),
		'a closed request stays closed',
	);
});

test('a request is not a question unless main says so', t => {
	const {events, broker: b} = broker();
	void b.request(request);
	t.false('question' in (events[0] as {request: object}).request);
});

test('refuses an option Nanocoder did not offer', async t => {
	const {broker: b} = broker();
	const response = b.request(request);

	t.false(b.answer('permission-1', 'allow_always'));
	t.false(b.answer('permission-1', ''));
	t.true(b.answer('permission-1', 'deny'));
	t.deepEqual(await response, {
		outcome: {outcome: 'selected', optionId: 'deny'},
	});
});

test('refuses an unknown request and a second answer', async t => {
	const {broker: b} = broker();
	const response = b.request(request);

	t.false(b.answer('permission-9', 'allow'));
	t.true(b.answer('permission-1', 'allow'));
	t.false(b.answer('permission-1', 'deny'));
	t.deepEqual(await response, {
		outcome: {outcome: 'selected', optionId: 'allow'},
	});
});

test('keeps requests apart', async t => {
	const {broker: b} = broker();
	const first = b.request(request);
	const second = b.request({
		...request,
		toolCall: {toolCallId: 'call_2'},
	});

	t.true(b.answer('permission-2', 'deny'));
	t.deepEqual(await second, {
		outcome: {outcome: 'selected', optionId: 'deny'},
	});
	t.true(b.answer('permission-1', 'allow'));
	t.deepEqual(await first, {
		outcome: {outcome: 'selected', optionId: 'allow'},
	});
});

test('titles a request by its tool call when it has no title', async t => {
	const {events, broker: b} = broker();
	void b.request({...request, toolCall: {toolCallId: 'call_7'}});

	t.is(
		events[0].type === 'permission' ? events[0].request.title : undefined,
		'call_7',
	);
});

test('answers every waiting request as cancelled on close', async t => {
	const {events, broker: b} = broker();
	const first = b.request(request);
	const second = b.request(request);
	b.cancelAll();

	t.deepEqual(await first, {outcome: {outcome: 'cancelled'}});
	t.deepEqual(await second, {outcome: {outcome: 'cancelled'}});
	t.deepEqual(
		events.filter(event => event.type === 'permission-closed'),
		[
			{type: 'permission-closed', id: 'permission-1'},
			{type: 'permission-closed', id: 'permission-2'},
		],
	);
	t.false(b.answer('permission-1', 'allow'));
});

test('SUB-03 bounded child attribution never changes broker answer authority', async t => {
	const {events, broker: b} = broker();
	const response = b.request({
		...request,
		toolCall: {
			toolCallId: 'subagent:permission-2',
			title: 'execute_bash (explore)',
		},
	});
	const info = events[0].type === 'permission' ? events[0].request : undefined;
	t.deepEqual(info?.source, {
		kind: 'subagent',
		toolCallId: 'subagent:permission-2',
		label: 'execute_bash (explore)',
	});
	t.false(b.answer('subagent:permission-2', 'allow'));
	t.false(b.answer('permission-2', 'allow'));
	t.false(b.answer('explore', 'allow'));
	t.true(b.answer('permission-1', 'deny'));
	t.deepEqual(await response, {
		outcome: {outcome: 'selected', optionId: 'deny'},
	});
});

test('SUB-03 invalid attribution is omitted without dropping an approval', async t => {
	const {events, broker: b} = broker();
	const response = b.request({
		...request,
		toolCall: {
			toolCallId: `subagent:${'x'.repeat(513)}`,
			title: 'unmodified fixture title',
		},
	});
	const info = events[0].type === 'permission' ? events[0].request : undefined;
	t.is(info?.source, undefined);
	t.is(info?.title, 'unmodified fixture title');
	t.true(b.answer('permission-1', 'allow'));
	t.deepEqual(await response, {
		outcome: {outcome: 'selected', optionId: 'allow'},
	});
});
