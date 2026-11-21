import test from 'ava';
import {
	emptyInteraction,
	interactionFor,
	interactionKey,
	storeInteraction,
} from '@/renderer/review-interaction';

test('GIT-07 comment drafts and ranges are isolated by canonical path, side and view', t => {
	const first = {projectId: 'p', path: 'src/a.ts', staged: false, agent: false};
	const second = {
		projectId: 'p',
		path: 'src/b.ts',
		staged: false,
		agent: false,
	};
	const staged = {projectId: 'p', path: 'src/a.ts', staged: true, agent: false};
	const agent = {projectId: 'p', path: 'src/a.ts', staged: false, agent: true};
	const draft = {
		...emptyInteraction,
		comment: 'check this line',
		cursor: {anchor: 4_900, cursor: 4_999},
	};
	let drafts = storeInteraction({}, first, draft);
	drafts = storeInteraction(drafts, second, {
		...emptyInteraction,
		comment: 'a different file',
	});
	t.deepEqual(interactionFor(drafts, first), draft);
	t.is(interactionFor(drafts, second).comment, 'a different file');
	t.deepEqual(interactionFor(drafts, staged), emptyInteraction);
	t.deepEqual(interactionFor(drafts, agent), emptyInteraction);
	t.deepEqual(
		interactionFor(drafts, {...first, projectId: 'another-project'}),
		emptyInteraction,
	);
	t.not(interactionKey(first), interactionKey(staged));
	t.not(interactionKey(first), interactionKey(agent));
});

test('GIT-07 replacing one file interaction leaves every other file untouched', t => {
	const first = {projectId: 'p', path: 'a.ts', staged: false, agent: false};
	const second = {projectId: 'p', path: 'b.ts', staged: false, agent: false};
	const original = storeInteraction({}, second, {
		...emptyInteraction,
		comment: 'keep me',
	});
	const next = storeInteraction(original, first, {
		...emptyInteraction,
		comment: 'new draft',
	});
	t.is(interactionFor(next, second).comment, 'keep me');
	t.deepEqual(interactionFor(original, first), emptyInteraction);
});
