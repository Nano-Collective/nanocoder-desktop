import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {
	ApprovalRequests,
	isOutsideShelf,
	openQuestionId,
	reportedToolName,
	shortcutOption,
} from '@/renderer/approval-requests';
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
	t.is((markup.match(/ui-button--allow/g) ?? []).length, 1);
	t.is((markup.match(/ui-button--default/g) ?? []).length, 1);
	t.is((markup.match(/ui-button--reject/g) ?? []).length, 2);
	for (const option of request.options) t.true(markup.includes(option.name));
	for (const key of ['1', '2', '3', '4'])
		t.true(markup.includes(`aria-keyshortcuts="${key}"`));
	t.true(markup.includes('role="alertdialog"'));
	t.regex(
		markup,
		/<h2 [^>]*><span aria-hidden="true">▲ <\/span>approval required<\/h2>/,
	);
	t.true(markup.includes('Nanocoder · normal mode'));
	t.true(
		markup.includes('approval is not a guarantee that the command succeeds.'),
	);
	t.true(
		markup.includes(
			'&quot;allow always&quot; changes Nanocoder&#x27;s policy, not desktop trust.',
		),
	);
	t.false(/[✓✕]/.test(markup));
	t.false(markup.includes('<dialog'));
	t.false(/<(?:input|textarea)\b/.test(markup));
});

test('D-12 policy note appears only when an allow-always option is offered', t => {
	const markup = renderToStaticMarkup(
		createElement(ApprovalRequests, {
			requests: [
				{
					...request,
					options: request.options.filter(
						option => option.kind !== 'allow_always',
					),
				},
			],
			mode: 'normal',
			busy: true,
			onAnswer: async () => ({ok: true, value: null}),
		}),
	);
	t.false(markup.includes('changes Nanocoder'));
	t.false(markup.includes('ui-button--default'));
	t.is((markup.match(/<button /g) ?? []).length, 3);
});

const question: PermissionRequestInfo = {
	id: 'fixture-question',
	title: 'which rows should the export include?',
	question: true,
	options: [
		{id: 'answer-0', name: 'current filtered rows', kind: 'allow_once'},
		{id: 'answer-1', name: 'all rows', kind: 'allow_once'},
	],
};

test('question requests render a modal choice dialog with only the offered numbered choices', t => {
	let calls = 0;
	const markup = renderToStaticMarkup(
		createElement(ApprovalRequests, {
			requests: [question],
			mode: 'normal',
			busy: true,
			onAnswer: async () => {
				calls++;
				return {ok: true, value: null};
			},
		}),
	);
	t.is(calls, 0);
	t.regex(markup, /<dialog [^>]*role="alertdialog"[^>]*aria-modal="true"/);
	t.true(markup.includes('>Nanocoder needs a choice</h2>'));
	t.false(markup.includes('▲'));
	t.true(
		markup.includes(
			'ask_user · ACP supports selectable options only. no free-text answer is invented.',
		),
	);
	t.true(markup.includes(question.title));
	t.true(
		markup.includes(
			'<span aria-hidden="true">1 · </span>current filtered rows',
		),
	);
	t.true(markup.includes('<span aria-hidden="true">2 · </span>all rows'));
	t.is((markup.match(/class="question-choice"/g) ?? []).length, 2);
	t.true(markup.includes('aria-label="close choice"'));
	t.is((markup.match(/<button /g) ?? []).length, 3);
	t.false(/ui-button--(?:allow|reject)/.test(markup));
	t.false(markup.includes('ui-card--approval'));
	t.false(markup.includes('approval required'));
	t.false(/<(?:input|textarea)\b|contenteditable/.test(markup));
});

test('a collapsed question stays pending in the shelf and is never answered by collapsing', t => {
	t.is(openQuestionId([question], new Set()), question.id);
	t.is(openQuestionId([question], new Set([question.id])), undefined);
	t.is(openQuestionId([request, question], new Set()), undefined);
	t.is(
		openQuestionId([{...question, question: undefined}], new Set()),
		undefined,
	);
	const markup = renderToStaticMarkup(
		createElement(ApprovalRequests, {
			requests: [request, question],
			mode: 'normal',
			busy: true,
			onAnswer: async () => ({ok: true, value: null}),
		}),
	);
	t.false(markup.includes('<dialog'));
	t.is((markup.match(/role="alertdialog"/g) ?? []).length, 2);
	t.true(markup.includes('Nanocoder needs a choice'));
	t.true(markup.includes('ask_user · normal mode'));
	t.is((markup.match(/ui-button--default/g) ?? []).length, 3);
});

test('digit shortcuts select only offered options and never modified, repeated or Escape keys', t => {
	const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({
		key: value,
		repeat: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		...extra,
	});
	t.is(shortcutOption(key('1'), question.options)?.id, 'answer-0');
	t.is(shortcutOption(key('2'), question.options)?.id, 'answer-1');
	for (const value of ['0', '3', '9', '12', '', 'Escape', 'Enter', 'a'])
		t.is(shortcutOption(key(value), question.options), undefined);
	for (const extra of [
		{repeat: true},
		{altKey: true},
		{ctrlKey: true},
		{metaKey: true},
		{shiftKey: true},
	])
		t.is(shortcutOption(key('1', extra), question.options), undefined);
	t.is(shortcutOption(key('1'), []), undefined);
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

test('D-05 meta names the reported tool and leaves it out when none is reported', t => {
	const markupFor = (title: string) =>
		renderToStaticMarkup(
			createElement(ApprovalRequests, {
				requests: [{...request, title}],
				mode: 'normal',
				busy: false,
				onAnswer: async () => ({ok: true, value: null}),
			}),
		);
	t.true(
		markupFor('execute_bash: echo old').includes(
			'Nanocoder · execute_bash · normal mode',
		),
	);
	for (const title of ['fixture command', 'call_1', 'Execute: ls']) {
		const markup = markupFor(title);
		t.true(markup.includes('Nanocoder · normal mode'));
		t.false(markup.includes('undefined'));
	}
	t.is(reportedToolName('execute_bash: echo old'), 'execute_bash');
	t.is(reportedToolName('execute_bash fixture (explore)'), undefined);
	t.is(reportedToolName('execute_bash:echo old'), undefined);
	t.is(
		reportedToolName('<img src="https://example.invalid/fixture">'),
		undefined,
	);
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

test('A11Y-03 queued approval landmarks have unique payload-free positions', t => {
	const markup = renderToStaticMarkup(
		createElement(ApprovalRequests, {
			requests: [
				{...request, id: 'private-first-request-id'},
				{...request, id: 'private-second-request-id'},
			],
			mode: 'normal',
			busy: true,
			onAnswer: async () => ({ok: true, value: null}),
		}),
	);
	const names = [
		...markup.matchAll(/aria-label="(permission request[^"]*)"/g),
	].map(match => match[1]);
	t.deepEqual(names, [
		'permission request 1 of 2',
		'permission request 2 of 2',
	]);
	t.false(names.join().includes('private-'));
	t.false(names.join().includes(request.title));
	t.is((markup.match(/role="alertdialog"/g) ?? []).length, 2);
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

test('a question-shaped request without the main-process flag keeps the approval card', t => {
	for (const [allow, deny] of [
		['allow', 'deny'],
		['answer-0', 'answer-1'],
	]) {
		const markup = renderToStaticMarkup(
			createElement(ApprovalRequests, {
				requests: [
					{
						id: `fixture-lookalike-${allow}`,
						title: 'which rows should the export include?',
						options: [
							{id: allow, name: 'current filtered rows', kind: 'allow_once'},
							{id: deny, name: 'all rows', kind: 'reject_once'},
						],
					},
				],
				mode: 'normal',
				busy: true,
				onAnswer: async () => ({ok: true, value: null}),
			}),
		);
		t.false(markup.includes('<dialog'));
		t.false(markup.includes('question-choice'));
		t.false(markup.includes('Nanocoder needs a choice'));
		t.regex(
			markup,
			/<h2 [^>]*><span aria-hidden="true">▲ <\/span>approval required<\/h2>/,
		);
		t.true(
			markup.includes('<code>which rows should the export include?</code>'),
		);
		t.is((markup.match(/ui-button--allow/g) ?? []).length, 1);
		t.is((markup.match(/ui-button--reject/g) ?? []).length, 1);
	}
});

test('a subagent question names its source inside the dialog it is described by', t => {
	const markup = renderToStaticMarkup(
		createElement(ApprovalRequests, {
			requests: [
				{
					...question,
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
	const dialog = /<dialog [^>]*>/.exec(markup)?.[0] ?? '';
	const describedBy = /aria-describedby="([^"]+)"/.exec(dialog)?.[1] ?? '';
	const sourceId = /<p id="([^"]+-source)"/.exec(markup)?.[1];
	t.regex(dialog, /role="alertdialog"/);
	t.true(markup.includes('subagent approval'));
	t.true(markup.includes('parent run not reported'));
	t.true(markup.includes(question.title));
	t.true(sourceId !== undefined && describedBy.split(' ').includes(sourceId));
	t.is((markup.match(/class="question-choice"/g) ?? []).length, 2);
});

test('focus outside the shelf is an origin, but focus inside it never is (ask_user focus return)', t => {
	const body = {closest: () => null} as unknown as Element;
	const outside = {closest: () => null} as unknown as Element;
	const inside = {
		closest: (selector: string) =>
			selector === '.approval-requests' ? {} : null,
	} as unknown as Element;
	t.true(isOutsideShelf(outside, body));
	t.false(isOutsideShelf(inside, body));
	t.false(isOutsideShelf(body, body));
	t.false(isOutsideShelf(null, body));
});
