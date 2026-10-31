import test from 'ava';
import {projectEventForListener} from '@/shared/project-events';

const changed = {
	type: 'projects-changed',
	projectId: '11111111-1111-4111-8111-111111111111',
	sequence: 1,
};

test('project-list invalidations expose exactly an ID and safe positive sequence', t => {
	t.deepEqual(projectEventForListener(changed), changed);
	t.deepEqual(Object.keys(projectEventForListener(changed) ?? {}).sort(), [
		'projectId',
		'sequence',
		'type',
	]);
});

test('malformed project-list invalidations and unknown variants are refused', t => {
	for (const value of [
		null,
		[],
		{},
		{...changed, type: 'unknown'},
		{...changed, type: 'toString'},
		{...changed, projectId: 'not-an-id'},
		{...changed, projectId: undefined},
		{...changed, sequence: 0},
		{...changed, sequence: -1},
		{...changed, sequence: 1.5},
		{...changed, sequence: Number.MAX_SAFE_INTEGER + 1},
		{...changed, sequence: Number.POSITIVE_INFINITY},
		{...changed, sequence: '1'},
		{...changed, canonicalRoot: '/fixture'},
		{...changed, displayName: 'fixture'},
		{...changed, project: {}},
	])
		t.is(projectEventForListener(value), null);
});

test('existing event variants retain their established payload contract', t => {
	const event = {
		type: 'turn' as const,
		projectId: changed.projectId,
		threadId: '22222222-2222-4222-8222-222222222222',
		sequence: 1,
		events: [],
	};
	t.is(projectEventForListener(event), event);
});
