import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ApprovalRequests} from '@/renderer/approval-requests';
import type {PermissionRequestInfo} from '@/shared/ipc';

const request: PermissionRequestInfo = {
	id: 'fixture-request',
	title: 'fixture command',
	options: [
		{id: 'a', name: 'Allow once', kind: 'allow_once'},
		{id: 'b', name: 'Allow always', kind: 'allow_always'},
		{id: 'c', name: 'Reject once', kind: 'reject_once'},
		{id: 'd', name: 'Reject all', kind: 'reject_always'},
	],
};

test('approval markup preserves every offered label and kind with scoped key hints', t => {
	let calls = 0;
	const markup = renderToStaticMarkup(
		createElement(ApprovalRequests, {
			requests: [request],
			mode: 'normal',
			busy: true,
			onAnswer: async () => {
				calls++;
				return {ok: true, value: null};
			},
		}),
	);
	t.is(calls, 0);
	t.is((markup.match(/<button /g) ?? []).length, 4);
	t.is((markup.match(/ui-button--allow/g) ?? []).length, 2);
	t.is((markup.match(/ui-button--reject/g) ?? []).length, 2);
	for (const option of request.options) t.true(markup.includes(option.name));
	for (const key of ['1', '2', '3', '4'])
		t.true(markup.includes(`aria-keyshortcuts="${key}"`));
	t.true(markup.includes('role="alertdialog"'));
	t.true(markup.includes('approval required · protected tool · normal mode'));
	t.false(/<(?:input|textarea)\b/.test(markup));
});

test('agent-provided titles and option names stay escaped text', t => {
	const markup = renderToStaticMarkup(
		createElement(ApprovalRequests, {
			requests: [
				{
					...request,
					title: '<img src="https://example.invalid/fixture">',
					options: [
						{id: 'a', name: '<script>fixture</script>', kind: 'allow_once'},
					],
				},
			],
			mode: 'plan',
			busy: false,
			onAnswer: async () => ({ok: true, value: null}),
		}),
	);
	t.true(markup.includes('&lt;img'));
	t.true(markup.includes('&lt;script&gt;'));
	t.false(/<(?:img|script)\b/.test(markup));
});

test('no waiting request renders no approval controls', t => {
	t.is(
		renderToStaticMarkup(
			createElement(ApprovalRequests, {
				requests: [],
				mode: 'normal',
				busy: false,
				onAnswer: async () => ({ok: true, value: null}),
			}),
		),
		'',
	);
});

test('SUB-03 child approval names its source without inventing a parent or execution success', t => {
	const markup = renderToStaticMarkup(
		createElement(ApprovalRequests, {
			requests: [
				{
					...request,
					title: 'execute_bash (explore)',
					source: {
						kind: 'subagent',
						toolCallId: 'subagent:fixture',
						label: 'execute_bash (explore)',
					},
				},
			],
			mode: 'normal',
			busy: true,
			onAnswer: async () => ({ok: true, value: null}),
		}),
	);
	t.true(markup.includes('subagent approval'));
	t.true(markup.includes('execute_bash (explore)'));
	t.true(markup.includes('may still fail afterwards'));
	t.true(markup.includes('parent run not reported'));
	t.false(markup.includes('succeeded'));
	t.is((markup.match(/role="alertdialog"/g) ?? []).length, 1);
});
