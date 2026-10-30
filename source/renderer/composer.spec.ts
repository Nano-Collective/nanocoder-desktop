import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Composer, type ComposerProps} from '@/renderer/composer';

const props: ComposerProps = {
	draft: 'retained fixture draft',
	editable: true,
	sendReason: null,
	controlReason: null,
	projectName: 'fixture',
	projectControls: null,
	mode: 'normal',
	defaultMode: 'normal',
	modePending: true,
	running: false,
	stopping: false,
	commands: [],
	onDraft() {},
	onSend() {},
	onCancel() {},
	onMode() {},
	onDefault() {},
	onConfig() {},
};
const render = (patch: Partial<ComposerProps> = {}) =>
	renderToStaticMarkup(createElement(Composer, {...props, ...patch}));

test('composer names model/provider scope for every thread and explains missing offers (CHAT-04 CHAT-10)', t => {
	let calls = 0;
	const html = render({
		onConfig: () => {
			calls++;
		},
		onMode: () => {
			calls++;
		},
	});
	t.true(
		html.includes('model and provider for every thread in project fixture'),
	);
	t.true(html.includes('available after the first message'));
	t.true(
		html.includes('Nanocoder supplies model options after a session exists'),
	);
	t.true(html.includes('ask anything…'));
	t.true(html.includes('<textarea'));
	t.is(calls, 0);
});

test('busy composer keeps the editable draft and cancel while blocking controls and send with reasons (CHAT-17)', t => {
	const html = render({
		running: true,
		modePending: false,
		controlReason: 'stop the running turn first',
		sendReason: 'another thread is running',
	});
	t.true(html.includes('retained fixture draft</textarea>'));
	t.notRegex(html, /<textarea[^>]*disabled/);
	t.regex(html, /<button(?=[^>]*aria-label="send")(?=[^>]*disabled="")[^>]*>/);
	t.regex(
		html,
		/<select(?=[^>]*aria-label="mode for this thread")(?=[^>]*disabled="")[^>]*>/,
	);
	t.true(html.includes('another thread is running'));
	t.true(html.includes('stop the running turn first'));
	t.true(html.includes('cancel turn'));
	t.true(html.includes('aria-describedby='));
});

test('mode selection distinguishes pending yolo from a project default and discloses alwaysAllow (CHAT-11 DEC-31)', t => {
	const html = render({mode: 'yolo'});
	t.true(html.includes('yolo · pending first message'));
	t.true(
		html.includes(
			'tools in Nanocoder&#x27;s alwaysAllow list run without asking in every mode',
		),
	);
	t.regex(
		html,
		/<button(?=[^>]*disabled="")[^>]*>use as this project&#x27;s default<\/button>/,
	);
	t.true(html.includes('yolo cannot be a project default'));
	const nonDefault = render({mode: 'plan', modePending: false});
	t.true(nonDefault.includes('use as this project&#x27;s default'));
	t.true(nonDefault.includes('project default: normal'));
});

test('project selects show only confirmed values and escape labels (CHAT-10 ACP-14)', t => {
	const html = render({
		projectName: '<fixture>',
		projectControls: {
			projectId: 'fixture',
			revision: 'fixture-revision',
			modelGate: {enabled: true, reason: null},
			configOptions: [
				{
					id: 'model',
					name: 'model',
					currentValue: 'confirmed',
					options: [
						{name: 'old', value: 'old'},
						{name: '<confirmed>', value: 'confirmed'},
					],
				},
			],
		},
	});
	t.true(html.includes('model for every thread in project &lt;fixture&gt;'));
	t.true(
		html.includes(
			'<option value="confirmed" selected="">&lt;confirmed&gt;</option>',
		),
	);
	t.false(html.includes('<confirmed>'));
});

test('composer context pill and gauge require actual reported context, not draft length (CHAT-19 U.5)', t => {
	const absent = render();
	t.false(absent.includes('role="progressbar"'));
	t.false(absent.includes('ctx '));
	t.false(absent.includes('estimated'));
	const actual = render({context: {used: 32, size: 100}});
	t.true(actual.includes('ctx 32%'));
	t.true(actual.includes('role="progressbar"'));
	t.true(actual.includes('aria-valuenow="32"'));
});
