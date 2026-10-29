import test from 'ava';
import {
	composite,
	contrast,
	isKnownGap,
	knownGaps,
	rgb,
	themedColor,
	usedPairs,
} from '../ui-contrast';

test('contrast maths matches WCAG reference black and white', t => {
	t.is(contrast(rgb('#000000'), rgb('#ffffff')), 21);
	t.is(contrast(rgb('#ffffff'), rgb('#ffffff')), 1);
});

for (const theme of ['dark', 'light']) {
	test(`${theme} text pairings pass AA or are a documented DESIGN.md gap`, t => {
		for (const [foreground, background] of usedPairs) {
			const fg = themedColor(foreground, theme);
			const bg = themedColor(background, theme);
			const ratio = contrast(fg, bg);
			t.true(
				ratio >= 4.5 || isKnownGap(fg, bg, theme),
				`${theme}: ${foreground} on ${background}: ${ratio.toFixed(3)}:1`,
			);
		}
	});
}

test('known-gap exceptions come from the design and stay within its ratios', t => {
	t.is(knownGaps.length, 12);
	for (const gap of knownGaps) {
		const ratio = contrast(
			themedColor(gap.foreground, gap.theme),
			themedColor(gap.background, gap.theme),
		);
		t.true(Math.abs(ratio - gap.ratio) < 0.02);
	}
	t.false(
		isKnownGap(
			themedColor('skill', 'light'),
			themedColor('surface-elevated', 'light'),
			'light',
		),
	);
});

test('55% key hints need a design decision before they can be used', t => {
	const background = themedColor('surface-panel', 'light');
	const hint = composite(themedColor('on-surface', 'light'), background, 0.55);
	t.true(contrast(hint, background) < 4.5);
	t.false(isKnownGap(hint, background, 'light'));
});
