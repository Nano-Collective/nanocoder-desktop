import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RecoveryTools} from '@/renderer/recovery-tools';
import type {SupervisorState} from '@/shared/ipc';

const failure = 'redacted turn error';
const unused = () => Promise.reject(new Error('static markup never acts'));

function supervisor(status: SupervisorState['status']): SupervisorState {
	return {
		projectId: 'project-fixture',
		status,
		reason: null,
		runtime: null,
		agent: null,
		gates: null,
		activeThreadId: null,
		exit: null,
		restart: {attempt: 0, limit: 3, nextAttemptAt: null},
	};
}

function render(state: SupervisorState | null, turnFailure: string | null) {
	return renderToStaticMarkup(
		createElement(RecoveryTools, {
			state,
			turnFailure,
			onRetry: unused,
			onCapture: unused,
			onExport: unused,
		}),
	);
}

const count = (html: string, text: string) => html.split(text).length - 1;

test('a failed process names the stop and merges the turn failure into one alert', t => {
	const html = render(supervisor('failed'), failure);
	t.is(count(html, 'role="alert"'), 1);
	t.true(html.includes('Nanocoder stopped unexpectedly'));
	t.false(html.includes('this turn failed'));
	t.true(html.includes(failure));
});

test('untrusted and unsupported processes name the turn failure, not a process stop', t => {
	for (const status of ['untrusted', 'unsupported'] as const) {
		const html = render(supervisor(status), failure);
		t.is(count(html, 'role="alert"'), 1, status);
		t.true(html.includes('this turn failed'), status);
		t.false(html.includes('Nanocoder stopped unexpectedly'), status);
		t.true(html.includes(failure), status);
	}
});

test('a turn failure with a running process shows one standalone notice', t => {
	const html = render(supervisor('ready'), failure);
	t.is(count(html, 'role="alert"'), 1);
	t.true(html.includes('nc-failure-notice'));
	t.true(html.includes('this turn failed'));
	t.false(html.includes('Nanocoder stopped unexpectedly'));
	t.true(html.includes('Nanocoder is ready'));
});

test('a turn failure before any process state shows the standalone notice', t => {
	const html = render(null, failure);
	t.is(count(html, 'role="alert"'), 1);
	t.true(html.includes('this turn failed'));
	t.true(html.includes(failure));
});

function renderWithNew(status: SupervisorState['status'], newPending = false) {
	return renderToStaticMarkup(
		createElement(RecoveryTools, {
			state: supervisor(status),
			turnFailure: null,
			onRetry: unused,
			onCapture: unused,
			onExport: unused,
			onNew() {},
			newPending,
		}),
	);
}

test('a failed process offers a metadata-only new thread after diagnostics, refused with its reason while a thread request is pending', t => {
	const idle = renderWithNew('failed');
	t.true(idle.includes('start a new thread in this project'));
	t.true(
		idle.indexOf('review diagnostics') <
			idle.indexOf('start a new thread in this project'),
	);
	t.false(idle.includes('waiting for the thread request'));
	const pending = renderWithNew('failed', true);
	t.true(pending.includes('waiting for the thread request or native dialog'));
	const button =
		pending
			.split('<button')
			.find(part => part.includes('start a new thread in this project')) ?? '';
	t.true(button.includes('disabled=""'));
});

test('a process that is not failed offers no new thread action', t => {
	t.false(
		renderWithNew('ready').includes('start a new thread in this project'),
	);
});
