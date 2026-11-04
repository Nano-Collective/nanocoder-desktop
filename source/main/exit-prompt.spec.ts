import test from 'ava';
import {createExitPrompt, type ShowMessageBox} from '@/main/exit-prompt';

function fixture(response: number) {
	const shown: Parameters<ShowMessageBox>[0][] = [];
	const prompt = createExitPrompt({
		showMessageBox: async options => {
			shown.push(options);
			return {response};
		},
		projectName: id => ({a: 'api', b: 'web', c: 'docs', d: 'infra'})[id],
	});
	return {prompt, shown};
}

test('CHAT-22 the answers map to keep working, wait and cancel, and the cancel answer keeps working', async t => {
	t.is(await fixture(0).prompt(['a']), 'stay');
	t.is(await fixture(1).prompt(['a']), 'wait');
	t.is(await fixture(2).prompt(['a']), 'cancel');
	const {prompt, shown} = fixture(0);
	await prompt(['a']);
	t.is(shown[0].defaultId, 0);
	t.is(shown[0].cancelId, 0);
	t.is(shown[0].buttons[0], 'Keep working');
});

test('CHAT-22 the question names one project, or counts several and shortens the list', async t => {
	const one = fixture(0);
	await one.prompt(['a']);
	t.is(
		one.shown[0].message,
		'api still has a turn that is running or waiting for you.',
	);
	const many = fixture(0);
	await many.prompt(['a', 'b', 'c', 'd']);
	t.is(
		many.shown[0].message,
		'4 projects still have turns that are running or waiting for you: api, web, docs and 1 more.',
	);
});

test('CHAT-22 the question carries only project names, nothing the agent did', async t => {
	const f = fixture(0);
	await f.prompt(['a', 'zzz']);
	t.false(/command|file|\.\//i.test(f.shown[0].message + f.shown[0].detail));
	t.regex(f.shown[0].message, /A project/);
});
