import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TerminalPanel} from '@/renderer/terminal-panel';
import {leavesTerminal} from '@/renderer/terminal-view';
import type {TerminalSnapshot} from '@/shared/terminal';

const snapshot: TerminalSnapshot = {
	projectId: 'one',
	sequence: 1,
	status: 'stopped',
	shell: null,
	cols: 80,
	rows: 24,
	output: '',
	truncated: false,
	exitCode: null,
	reason: null,
	agentCommand: null,
};
const render = (state = snapshot, disabledReason: string | null = null) =>
	renderToStaticMarkup(
		createElement(TerminalPanel, {
			snapshot: state,
			loading: false,
			pending: false,
			error: null,
			disabledReason,
			projectName: 'fixture',
			onAction: async () => true,
			onData() {},
			onResize() {},
			onClose() {},
		}),
	);

test('terminal panel offers explicit lifecycle controls and documented screen-reader and keyboard access', t => {
	const html = render();
	for (const label of [
		'start terminal',
		'clear',
		'stop',
		'screen-reader mode',
		'ctrl+shift+tab',
		'close terminal panel',
		'your terminal',
	])
		t.true(html.includes(label));
	t.true(html.includes('aria-pressed="false"'));
	t.false(html.includes('open preview'));
	t.true(render({...snapshot, status: 'running'}).includes('restart'));
	t.true(
		render(snapshot, 'trust before starting').includes('trust before starting'),
	);
});

test('agent strip is inert escaped display, with truthful unknown approval and separate ownership', t => {
	const html = render({
		...snapshot,
		agentCommand: {
			threadId: 'thread',
			command: '<img src=x onerror=alert(1)>',
			approval: 'unknown',
		},
	});
	t.true(html.includes('Nanocoder’s last command'));
	t.true(html.includes('agent activity only, not input into your terminal.'));
	t.true(html.includes('&lt;img'));
	t.false(html.includes('<img'));
	t.true(html.includes('? approval unknown'));
	t.false(html.includes('allowed'));
});

test('terminal escape chord is exact and does not consume normal tab or shell escape', t => {
	const event = {
		key: 'Tab',
		ctrlKey: true,
		shiftKey: true,
		altKey: false,
		metaKey: false,
	};
	t.true(leavesTerminal(event));
	t.false(leavesTerminal({...event, key: 'Escape'}));
	t.false(leavesTerminal({...event, ctrlKey: false}));
	t.false(leavesTerminal({...event, shiftKey: false}));
	t.false(leavesTerminal({...event, metaKey: true}));
	t.false(leavesTerminal({...event, altKey: true}));
});
