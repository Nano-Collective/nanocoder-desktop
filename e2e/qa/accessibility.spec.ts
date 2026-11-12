import test from 'ava';
import {
	type AxNode,
	focusTrap,
	INTERACTIVE_ROLES,
	interactiveCount,
	unnamedInteractive,
} from './accessibility';

const node = (
	role: string,
	name: string | undefined,
	extra: Partial<AxNode> = {},
): AxNode => ({
	role: {value: role},
	...(name === undefined ? {} : {name: {value: name}}),
	...extra,
});

test('A11Y-03 an interactive node with no name, or only spaces, is reported with its role', t => {
	t.deepEqual(
		unnamedInteractive([
			node('button', 'send'),
			node('button', ''),
			node('textbox', '   '),
			node('combobox', undefined),
			node('link', 'docs'),
		]),
		['button', 'textbox', 'combobox'],
	);
});

test('A11Y-03 ignored nodes, and roles that need no name of their own, are not reported', t => {
	t.deepEqual(
		unnamedInteractive([
			node('button', '', {ignored: true}),
			node('generic', ''),
			node('StaticText', ''),
			node('paragraph', ''),
			node('main', ''),
		]),
		[],
	);
});

test('A11Y-03 every control role the app uses is checked, tree items and tabs included', t => {
	for (const role of [
		'button',
		'link',
		'textbox',
		'searchbox',
		'combobox',
		'listbox',
		'option',
		'checkbox',
		'radio',
		'switch',
		'tab',
		'treeitem',
		'menuitem',
		'slider',
		'spinbutton',
		'DisclosureTriangle',
	])
		t.true(INTERACTIVE_ROLES.has(role), role);
});

test('A11Y-01 a focus sequence that stays on one or two elements is a trap, one that moves on is not', t => {
	t.true(focusTrap(['a', 'a', 'a', 'a', 'a', 'a']));
	t.true(focusTrap(['a', 'b', 'a', 'b', 'a', 'b']));
	t.false(focusTrap(['a', 'b', 'c', 'd', 'e', 'f']));
	t.false(focusTrap(['a', 'b', 'c', 'a', 'b', 'c']));
	t.false(focusTrap(['a']));
});

test('A11Y-03 the sweep counts only interactive, visible nodes so an empty area cannot pass it', t => {
	t.is(
		interactiveCount([
			node('button', 'a'),
			node('button', 'b', {ignored: true}),
			node('generic', ''),
			node('tab', 'c'),
		]),
		2,
	);
	t.is(interactiveCount([]), 0);
});
