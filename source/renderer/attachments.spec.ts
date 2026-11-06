import test from 'ava';
import {
	addAttachment,
	attachmentKey,
	chips,
	clearAttachments,
	labelFor,
	MAX_ATTACHMENTS,
	removeAttachment,
} from '@/renderer/attachments';
import type {PromptAttachment} from '@/shared/ipc';

const file = (path: string): PromptAttachment => ({kind: 'file', path});
const comment = (
	path: string,
	startLine = 1,
	endLine = startLine,
): PromptAttachment => ({
	kind: 'review-comment',
	path,
	startLine,
	endLine,
	side: 'unstaged',
	comment: 'why',
	excerpt: '',
});

test('CHAT-16 attachments are kept per thread, never shared between threads or projects', t => {
	const one = attachmentKey('p', 'a');
	const two = attachmentKey('p', 'b');
	const other = attachmentKey('q', 'a');
	t.not(one, two);
	t.not(one, other);
	let store = addAttachment({}, one, file('a.ts'));
	store = addAttachment(store, two, file('b.ts'));
	t.deepEqual(store[one], [file('a.ts')]);
	t.deepEqual(store[two], [file('b.ts')]);
	t.is(store[other], undefined);
});

test('FILE-08 the same file is attached once, but each review comment is its own attachment', t => {
	const key = attachmentKey('p', 't');
	let store = addAttachment({}, key, file('a.ts'));
	const same = addAttachment(store, key, file('a.ts'));
	t.is(same, store);
	store = addAttachment(store, key, comment('a.ts', 4));
	store = addAttachment(store, key, comment('a.ts', 4));
	t.is(store[key].length, 3);
});

test('CHAT-16 at most 20 attachments ride with one message', t => {
	const key = attachmentKey('p', 't');
	let store = {};
	for (let index = 0; index < MAX_ATTACHMENTS + 5; index++)
		store = addAttachment(store, key, file(`f${index}.ts`));
	t.is((store as Record<string, unknown[]>)[key].length, MAX_ATTACHMENTS);
});

test('CHAT-16 chips show a plain label and can each be removed', t => {
	const key = attachmentKey('p', 't');
	let store = addAttachment({}, key, file('src/a.ts'));
	store = addAttachment(store, key, comment('src/a.ts', 3, 5));
	store = addAttachment(store, key, comment('src/b.ts', 9));
	t.deepEqual(
		chips(store[key]).map(chip => chip.label),
		['src/a.ts', 'src/a.ts:3-5 (comment)', 'src/b.ts:9 (comment)'],
	);
	const [first, second] = chips(store[key]);
	store = removeAttachment(store, key, second.id);
	t.deepEqual(
		chips(store[key]).map(chip => chip.label),
		['src/a.ts', 'src/b.ts:9 (comment)'],
	);
	t.is(removeAttachment(store, key, 'missing'), store);
	t.is(removeAttachment(store, 'unknown', first.id), store);
	store = removeAttachment(store, key, chips(store[key])[0].id);
	store = removeAttachment(store, key, chips(store[key])[0].id);
	t.false(key in store);
	t.is(labelFor(comment('x', 2, 2)), 'x:2 (comment)');
});

test('CHAT-16 clearing after a send forgets only that thread', t => {
	const one = attachmentKey('p', 'a');
	const two = attachmentKey('p', 'b');
	let store = addAttachment({}, one, file('a.ts'));
	store = addAttachment(store, two, file('b.ts'));
	const cleared = clearAttachments(store, one);
	t.false(one in cleared);
	t.deepEqual(cleared[two], [file('b.ts')]);
	t.is(clearAttachments(cleared, one), cleared);
});

test('BRW-10 a page chip names the site and a second page replaces the first', t => {
	const page = (url: string): PromptAttachment => ({kind: 'browser-page', url});
	t.is(labelFor(page('http://localhost:5173/app?x=1')), 'page localhost:5173');
	t.is(labelFor(page('https://example.com/a')), 'page example.com');
	const key = attachmentKey('p', 't');
	let store = addAttachment({}, key, file('a.ts'));
	store = addAttachment(store, key, page('http://localhost:3000/'));
	store = addAttachment(store, key, page('http://localhost:5173/'));
	t.deepEqual(store[key], [file('a.ts'), page('http://localhost:5173/')]);
});
