import test from 'ava';
import {type ComposerKey, composerEnter} from '@/renderer/composer-key';

const enter: ComposerKey = {
	key: 'Enter',
	shiftKey: false,
	isComposing: false,
};

test('plain Enter is the composer send action (CHAT-17 U.5)', t => {
	t.true(composerEnter(enter));
});

test('Shift Enter, IME and modified keys are never treated as plain send (U.5)', t => {
	for (const event of [
		{...enter, shiftKey: true},
		{...enter, isComposing: true},
		{...enter, keyCode: 229},
		{...enter, altKey: true},
		{...enter, ctrlKey: true},
		{...enter, metaKey: true},
		{...enter, key: 'a'},
	]) {
		t.false(composerEnter(event));
	}
});
