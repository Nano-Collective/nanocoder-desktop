import test from 'ava';
import {
	delegationDisplay,
	permissionSource,
} from '@/main/nanocoder/subagent-display';
import {subagentLabel} from '@/shared/subagents';

test('SUB-03 source labels have UTF-8 caps and reject controls without becoming authority', t => {
	for (const value of [
		null,
		{},
		3,
		'',
		'  ',
		'fixture\u202Ename',
		'fixture\nname',
		'x'.repeat(2049),
	])
		t.is(subagentLabel(value), undefined);
	t.is(subagentLabel('é'.repeat(256), 512), 'é'.repeat(256));
	t.is(subagentLabel('é'.repeat(257), 512), undefined);
	const exact = `subagent:${'x'.repeat(503)}`;
	t.deepEqual(permissionSource({toolCallId: exact, title: 'fixture'}), {
		kind: 'subagent',
		toolCallId: exact,
		label: 'fixture',
	});
	for (const toolCallId of [
		'subagent:',
		'ordinary',
		`${exact}x`,
		'subagent:\u202Efixture',
	])
		t.is(permissionSource({toolCallId}), undefined);
	t.deepEqual(
		permissionSource({toolCallId: 'subagent:fixture', title: 'x'.repeat(2049)}),
		{kind: 'subagent', toolCallId: 'subagent:fixture'},
	);
});

test('SUB-01 raw delegation fields are allowlisted, optional and never copied wholesale', t => {
	t.deepEqual(
		delegationDisplay(
			{
				kind: 'think',
				rawInput: {
					subagent_type: 'explore',
					description: 'fixture task',
					prompt: 'forbidden-sentinel',
					context: {secret: 'forbidden-sentinel'},
				},
			},
			false,
		),
		{role: 'explore', task: 'fixture task', history: false},
	);
	t.deepEqual(
		delegationDisplay(
			{
				title: 'agent',
				rawInput: {subagent_type: 'x'.repeat(161), description: '\u202Eunsafe'},
			},
			true,
		),
		{history: true},
	);
	for (const rawInput of [
		[],
		null,
		'fixture',
		{subagent_type: 1},
		Object.create({subagent_type: 'explore'}),
	])
		t.is(delegationDisplay({kind: 'think', rawInput}, false), undefined);
	const getter = {
		get subagent_type() {
			throw new Error('must not execute');
		},
	};
	t.is(delegationDisplay({kind: 'think', rawInput: getter}, false), undefined);
	t.is(
		delegationDisplay(
			{kind: 'execute', title: 'agent', rawInput: {subagent_type: 'explore'}},
			false,
		),
		undefined,
	);
});
