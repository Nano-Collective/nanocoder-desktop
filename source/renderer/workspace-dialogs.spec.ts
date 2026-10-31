import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ArchivesDialogBody, archivedAge} from '@/renderer/archives-dialog';
import {
	CapabilitiesDialogBody,
	capabilityRows,
} from '@/renderer/capabilities-dialog';
import {DiagnosticsDialogBody} from '@/renderer/diagnostics-dialog';
import type {WorkspaceDialog} from '@/renderer/overlay-model';
import {RuntimeDialogBody} from '@/renderer/runtime-dialog';
import {WorkspaceDialogs} from '@/renderer/workspace-dialogs';
import type {
	CapabilityGates,
	ConnectedAgent,
	DiagnosticsSnapshot,
	NanocoderRuntime,
	ThreadInfo,
} from '@/shared/ipc';

const enabled = {enabled: true, reason: null} as const;
const gates: CapabilityGates = {
	projectId: '11111111-1111-4111-8111-111111111111',
	versionPolicy: {status: 'supported', version: '1.31.0', reason: null},
	features: {
		resume: enabled,
		close: {enabled: false, reason: 'the agent does not report close'},
		delete: enabled,
		list: enabled,
		rename: enabled,
		timeline: enabled,
		agentChanges: enabled,
		browserControl: {enabled: false, reason: 'milestone 3'},
		subagentTree: enabled,
	},
};
const runtime: NanocoderRuntime = {
	nodePath: '/usr/local/bin/node',
	nodeVersion: 'v22.1.0',
	cliPath: '/opt/nanocoder/dist/cli.js',
	version: '1.31.0',
	source: 'override',
};
const thread: ThreadInfo = {
	id: '33333333-3333-4333-8333-333333333333',
	projectId: gates.projectId,
	nanocoderSessionId: null,
	title: '<script>thread</script>',
	archiveState: 'archived',
	runState: 'ready',
	lastActivityAt: '2026-03-13T12:00:00.000Z',
	sessionCwd: '/fixture',
	mode: 'normal',
	viewOnlyReason: null,
};
const agent: ConnectedAgent = {
	root: '/fixture',
	protocolVersion: 1,
	name: 'nanocoder',
	version: '9.9.9',
	capabilities: {
		loadSession: true,
		sessions: {close: false, delete: false, list: true, resume: true},
		prompt: {image: false, audio: false, embeddedContext: false},
		mcp: {http: false, sse: false},
	},
};
const projectProps = {
	projects: [],
	activeProjectId: null,
	pending: false,
	onAdd() {},
	onOpen() {},
	onLocate() {},
};
const runtimeProps = {
	runtime: {ok: true as const, value: runtime},
	processState: null,
	projectRoot: '/fixture',
	gates,
	diagnosticsBusy: false,
	diagnosticsMessage: '',
	onCheckAgain() {},
	onCapabilities() {},
	onDiagnostics() {},
};

function dialogs(kind: WorkspaceDialog) {
	return {
		kind,
		onClose() {},
		projects: projectProps,
		runtime: runtimeProps,
		capabilities: {gates, modelGate: null, agent: null, thread: null},
		archives: {
			threads: [thread],
			projectName: 'fixture',
			now: new Date('2026-03-20T12:00:00.000Z'),
			pending: false,
			onUnarchive() {},
		},
		diagnostics: null,
	};
}

test('capability rows list only real gates in mockup order', t => {
	const rows = capabilityRows(gates, null);
	t.deepEqual(
		rows.map(row => row.label),
		[
			'session resume',
			'model + mode offers',
			'exact agent changes',
			'child run tree',
			'session close',
			'session delete',
			'session list',
			'session rename',
			'tool timeline',
		],
	);
	t.false(rows.some(row => row.label.includes('browser')));
	t.deepEqual(rows[1]?.gate, {
		enabled: false,
		reason: 'not reported for this project yet',
	});
});

test('the model and mode row uses the reported model gate', t => {
	const modelGate = {
		enabled: false,
		reason: 'restart Nanocoder first',
	} as const;
	const rows = capabilityRows(gates, modelGate);
	t.deepEqual(rows[1]?.gate, modelGate);
});

test('capabilities show each reason and say when nothing has been reported', t => {
	const html = renderToStaticMarkup(
		createElement(CapabilitiesDialogBody, {
			gates,
			modelGate: null,
			agent: null,
			thread: null,
		}),
	);
	t.true(html.includes('the agent does not report close'));
	t.false(html.includes('milestone 3'));
	t.true(html.includes('aria-label="Nanocoder capabilities"'));
	const empty = renderToStaticMarkup(
		createElement(CapabilitiesDialogBody, {
			gates: null,
			modelGate: null,
			agent: null,
			thread: null,
		}),
	);
	t.true(empty.includes('has not reported capabilities for this project yet'));
});

test('capabilities name the connected agent, ACP version and session mode', t => {
	const html = renderToStaticMarkup(
		createElement(CapabilitiesDialogBody, {
			gates,
			modelGate: null,
			agent,
			thread: {...thread, nanocoderSessionId: 'session-1', mode: 'normal'},
		}),
	).replace(/<!-- -->/g, '');
	t.true(
		html.includes('connected to nanocoder 9.9.9 over ACP protocol version 1'),
	);
	t.true(html.includes('session session-1 in normal mode'));
	t.true(html.includes('aria-label="connected agent"'));
	const noSession = renderToStaticMarkup(
		createElement(CapabilitiesDialogBody, {
			gates,
			modelGate: null,
			agent,
			thread: null,
		}),
	);
	t.true(noSession.includes('ACP protocol version'));
	t.false(noSession.includes('in normal mode'));
});

test('archive ages are compact and never invented', t => {
	const now = new Date('2026-03-20T12:00:00.000Z');
	t.is(archivedAge('2026-03-20T08:00:00.000Z', now), 'today');
	t.is(archivedAge('2026-03-19T11:00:00.000Z', now), '1 day ago');
	t.is(archivedAge('2026-03-16T12:00:00.000Z', now), '4 days ago');
	t.is(archivedAge('2026-03-13T12:00:00.000Z', now), '1 week ago');
	t.is(archivedAge('2026-02-20T12:00:00.000Z', now), '4 weeks ago');
	t.is(archivedAge('not a date', now), 'time unknown');
});

test('archived rows escape titles and offer unarchive without selection wording', t => {
	const html = renderToStaticMarkup(
		createElement(ArchivesDialogBody, {
			threads: [thread],
			projectName: 'fixture',
			now: new Date('2026-03-20T12:00:00.000Z'),
			pending: false,
			onUnarchive() {},
		}),
	);
	t.notRegex(html, /<script\b/i);
	t.true(html.includes('&lt;script&gt;thread&lt;/script&gt;'));
	t.true(html.includes('fixture · 1 week ago'));
	t.true(html.includes('restoring a row does not select, resume or send'));
	t.true(html.includes('aria-label="unarchive &lt;script&gt;thread'));
	const empty = renderToStaticMarkup(
		createElement(ArchivesDialogBody, {
			threads: [],
			projectName: 'fixture',
			now: new Date(),
			pending: false,
			onUnarchive() {},
		}),
	);
	t.true(empty.includes('no archived threads'));
});

test('runtime details name the runtime source and report a failure', t => {
	const html = renderToStaticMarkup(
		createElement(RuntimeDialogBody, runtimeProps),
	);
	t.true(html.includes('set by NANOCODER_DESKTOP_CLI'));
	t.true(html.includes('v22.1.0'));
	t.true(html.includes('/opt/nanocoder/dist/cli.js'));
	t.false(html.includes('role="alert"'));
	t.false(html.includes('connected agent'));
	t.false(html.includes('ACP protocol version'));
	const failed = renderToStaticMarkup(
		createElement(RuntimeDialogBody, {
			...runtimeProps,
			runtime: {
				ok: false as const,
				error: {code: 'UNAVAILABLE', message: 'Nanocoder was not found'},
			},
		}),
	);
	t.true(failed.includes('role="alert"'));
	t.true(failed.includes('Nanocoder was not found'));
	t.true(failed.includes('check again'));
});

test('diagnostics review shows the captured lines escaped and says nothing is sent', t => {
	const snapshot: DiagnosticsSnapshot = {
		id: '44444444-4444-4444-8444-444444444444',
		projectId: gates.projectId,
		lines: ['<script>line</script>'],
		truncated: true,
	};
	const html = renderToStaticMarkup(
		createElement(DiagnosticsDialogBody, {snapshot, message: ''}),
	);
	t.notRegex(html, /<script\b/i);
	t.true(html.includes('&lt;script&gt;line&lt;/script&gt;'));
	t.true(html.includes('older or oversized diagnostics were omitted'));
	t.true(html.includes('nothing is sent to a server'));
	t.true(html.includes('aria-label="captured diagnostics"'));
});

test('each workspace dialog titles itself in the shared shell', t => {
	const snapshot: DiagnosticsSnapshot = {
		id: '44444444-4444-4444-8444-444444444444',
		projectId: gates.projectId,
		lines: ['line'],
		truncated: false,
	};
	const titles: Array<[WorkspaceDialog, string]> = [
		['projects', 'your projects'],
		['runtime', 'runtime details'],
		['capabilities', 'capabilities, with reasons'],
		['archives', 'archived threads'],
		['diagnostics', 'review captured diagnostics'],
	];
	for (const [kind, title] of titles) {
		const html = renderToStaticMarkup(
			createElement(WorkspaceDialogs, {
				...dialogs(kind),
				diagnostics: {snapshot, busy: false, message: '', onExport() {}},
			}),
		);
		t.true(html.includes('class="dialog-shell"'), kind);
		t.false(html.includes('dialog-frame'), kind);
		t.true(html.includes(`>${title}</h2>`), kind);
		t.true(html.includes('aria-label="dismiss dialog"'), kind);
	}
	const runtimeHtml = renderToStaticMarkup(
		createElement(WorkspaceDialogs, dialogs('runtime')),
	);
	t.true(runtimeHtml.includes('review diagnostics'));
	t.is(
		renderToStaticMarkup(
			createElement(WorkspaceDialogs, dialogs('diagnostics')),
		),
		'',
	);
});
