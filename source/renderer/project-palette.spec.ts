import test from 'ava';
import {runAction} from '@/renderer/overlay-model';
import {projectPalette} from '@/renderer/project-palette';
import type {ProjectInfo} from '@/shared/ipc';

const project: ProjectInfo = {
	id: '11111111-1111-4111-8111-111111111111',
	displayName: 'fixture',
	canonicalRoot: '/fixture/project',
	sessionCwd: '/fixture/project',
	availability: 'available',
	trusted: false,
	defaultMode: 'normal',
	createdAt: '2026-10-29T00:00:00.000Z',
	lastOpenedAt: '2026-10-29T00:00:00.000Z',
};

function fixture(projects = [project], pending = false) {
	const calls: string[] = [];
	const actions = projectPalette({
		projects,
		pending,
		onAdd: () => {
			calls.push('add');
		},
		onOpen: id => {
			calls.push(`open:${id}`);
		},
		onLocate: id => {
			calls.push(`locate:${id}`);
		},
	});
	return {actions, calls};
}

test('project palette exposes only existing add open and locate callbacks with project IDs', t => {
	const {actions, calls} = fixture();
	t.deepEqual(
		actions.map(action => action.label),
		['add project folder', 'open project fixture', 'locate project fixture'],
	);
	actions.forEach(runAction);
	t.deepEqual(calls, ['add', `open:${project.id}`, `locate:${project.id}`]);
	t.true(actions[1]?.keywords?.includes(project.canonicalRoot));
	t.is(fixture([]).actions.length, 1);
});

test('missing and replaced projects remain listed with a refusal reason while locate stays enabled', t => {
	for (const availability of ['missing', 'changed'] as const) {
		const {actions, calls} = fixture([{...project, availability}]);
		t.is(
			actions[1]?.disabledReason,
			`folder ${availability}; locate it before opening`,
		);
		t.false(runAction(actions[1]));
		t.true(runAction(actions[2]));
		t.deepEqual(calls, [`locate:${project.id}`]);
	}
});

test('a pending project request disables every palette project action with its reason', t => {
	const {actions, calls} = fixture([project], true);
	t.is(actions.length, 3);
	for (const action of actions) {
		t.is(
			action.disabledReason,
			'another project request or native dialog is pending',
		);
		t.false(runAction(action));
	}
	t.deepEqual(calls, []);
});
