import test from 'ava';
import {type RetryFocusInput, stepRetryFocus} from './retry-focus';

function step(input: Partial<RetryFocusInput> = {}) {
	return stepRetryFocus({
		intent: true,
		retrying: false,
		sameScope: true,
		dialogOpen: false,
		composer: 'enabled',
		active: 'body',
		...input,
	});
}

test('an open dialog keeps its focus and ends the retry focus', t => {
	t.deepEqual(step({dialogOpen: true, retrying: true, active: 'body'}), {
		intent: false,
		focus: false,
	});
});

test('focus returns to an enabled composer when the retry has finished', t => {
	t.deepEqual(step({retrying: false, active: 'body'}), {
		intent: true,
		focus: true,
	});
});

test('keeps retry focus through a workspace reload that disables the composer', t => {
	let state = step({retrying: true, active: 'other', composer: 'disabled'});
	t.deepEqual(state, {intent: true, focus: false});
	state = step({intent: state.intent, retrying: true, active: 'body'});
	t.deepEqual(state, {intent: true, focus: true});
	state = step({
		intent: state.intent,
		retrying: false,
		active: 'body',
		composer: 'disabled',
	});
	t.deepEqual(state, {intent: true, focus: false});
	state = step({intent: state.intent, retrying: false, active: 'body'});
	t.deepEqual(state, {intent: true, focus: true});
});

test('the composer keeps the intent but takes no focus while it already has it', t => {
	t.deepEqual(step({active: 'composer'}), {intent: true, focus: false});
});

test('does not take focus from another control while the retry is settling', t => {
	t.deepEqual(step({retrying: true, active: 'other'}), {
		intent: true,
		focus: false,
	});
});

test('moving focus to another control or a dialog ends the retry focus', t => {
	t.deepEqual(step({retrying: false, active: 'other'}), {
		intent: false,
		focus: false,
	});
});

test('switching thread or project ends the retry focus', t => {
	t.deepEqual(step({sameScope: false}), {intent: false, focus: false});
});

test('a disabled composer is not focused', t => {
	t.deepEqual(step({composer: 'disabled', active: 'body'}), {
		intent: true,
		focus: false,
	});
});

test('no intent means no focus', t => {
	t.deepEqual(step({intent: false}), {intent: false, focus: false});
});
