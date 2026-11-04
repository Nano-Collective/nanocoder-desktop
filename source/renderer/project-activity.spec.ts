import test from 'ava';
import {
	announcementsFor,
	backgroundItems,
	emptyActivity,
	reduceActivity,
} from '@/renderer/project-activity';
import type {
	ProjectActivityStatus,
	ProjectEvent,
	ProjectInfo,
} from '@/shared/ipc';

const activity = (
	projectId: string,
	status: ProjectActivityStatus,
	sequence: number,
): ProjectEvent => ({type: 'project-activity', projectId, sequence, status});

const project = (id: string, displayName: string): ProjectInfo =>
	({id, displayName}) as ProjectInfo;

test('CHAT-22 activity events set each project status, and events for other things change nothing', t => {
	let state = reduceActivity(emptyActivity, activity('b', 'running', 1));
	t.is(state.b.status, 'running');
	const same = reduceActivity(state, {
		type: 'project-removed',
		projectId: 'zzz',
		sequence: 2,
	});
	t.is(same, state);
	state = reduceActivity(state, activity('b', 'needs-approval', 3));
	t.is(state.b.status, 'needs-approval');
});

test('CHAT-22 an older or repeated event cannot undo a newer status', t => {
	let state = reduceActivity(emptyActivity, activity('b', 'needs-approval', 5));
	state = reduceActivity(state, activity('b', 'running', 4));
	state = reduceActivity(state, activity('b', 'idle', 5));
	t.is(state.b.status, 'needs-approval');
});

test('CHAT-22 removing a project drops its activity', t => {
	let state = reduceActivity(emptyActivity, activity('b', 'running', 1));
	state = reduceActivity(state, {
		type: 'project-removed',
		projectId: 'b',
		sequence: 2,
	});
	t.deepEqual(state, {});
});

test('CHAT-22 the rail lists background projects that need attention, approval first', t => {
	let state = emptyActivity;
	state = reduceActivity(state, activity('a', 'running', 1));
	state = reduceActivity(state, activity('b', 'finished', 1));
	state = reduceActivity(state, activity('c', 'needs-approval', 1));
	state = reduceActivity(state, activity('d', 'running', 1));
	state = reduceActivity(state, activity('e', 'idle', 1));
	state = reduceActivity(state, activity('f', 'failed', 1));
	const projects = [
		project('a', 'alpha'),
		project('b', 'beta'),
		project('c', 'gamma'),
		project('d', 'delta'),
		project('e', 'epsilon'),
		project('f', 'zeta'),
	];
	t.deepEqual(
		backgroundItems(state, projects, 'a').map(item => [item.name, item.label]),
		[
			['gamma', 'needs approval'],
			['delta', 'running'],
			['zeta', 'failed'],
			['beta', 'finished'],
		],
	);
});

test('CHAT-22 the viewed project, unknown projects and idle ones are not listed', t => {
	let state = reduceActivity(emptyActivity, activity('a', 'running', 1));
	state = reduceActivity(state, activity('ghost', 'running', 1));
	state = reduceActivity(state, activity('b', 'idle', 1));
	t.deepEqual(
		backgroundItems(state, [project('a', 'alpha'), project('b', 'beta')], 'a'),
		[],
	);
	t.deepEqual(
		backgroundItems(state, [project('a', 'alpha')], null).map(
			item => item.name,
		),
		['alpha'],
	);
});

test('CHAT-22 only a new need or ending is announced, and running never is', t => {
	const item = (projectId: string, name: string, status: string) =>
		({projectId, name, status, label: status}) as never;
	t.deepEqual(
		announcementsFor(new Map(), [
			item('b', 'api', 'running'),
			item('c', 'web', 'needs-approval'),
		]),
		['web needs-approval'],
	);
	t.deepEqual(
		announcementsFor(new Map([['c', 'needs-approval']]), [
			item('c', 'web', 'needs-approval'),
		]),
		[],
	);
	t.deepEqual(
		announcementsFor(new Map([['b', 'running']]), [
			item('b', 'api', 'finished'),
		]),
		['api finished'],
	);
});
