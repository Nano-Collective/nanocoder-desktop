import {readFile} from 'node:fs/promises';
import test from 'ava';
import {
	cssUrl,
	designUrl,
	generateTokens,
	parseDesign,
} from './generate-design-tokens.mjs';

const markdown = await readFile(designUrl, 'utf8');
const tokens = parseDesign(markdown);

test('committed CSS matches every DESIGN.md token, including both themes', async t => {
	t.is(
		await readFile(cssUrl, 'utf8'),
		generateTokens(tokens),
		'Run pnpm tokens:generate',
	);
});

test('component references keep theme-aware CSS aliases', t => {
	const css = generateTokens(tokens);
	t.true(
		css.includes('--components-button-text-color: var(--colors-on-surface);'),
	);
	t.true(
		css.includes(
			'--components-button-font-size: var(--typography-meta-font-size);',
		),
	);
	for (const [name, value] of Object.entries(tokens.colors)) {
		t.true(css.includes(`--colors-${name}: ${value};`));
	}
});

test('generation refuses incomplete themes and unknown references', t => {
	t.throws(() => parseDesign('no front matter'), {message: /front matter/});
	t.throws(() => parseDesign('---\ncolors: {}\n---'), {
		message: /Missing token group/,
	});
	t.throws(
		() => parseDesign(markdown.replace('  primary-light: "#0000ee"\n', '')),
		{message: /Missing light colour: primary/},
	);
	const invalid = structuredClone(tokens);
	invalid.components.button.textColor = '{colors.missing}';
	t.throws(() => generateTokens(invalid), {message: /Unknown token/});
});

test('the bundled font notice contains its complete upstream OFL licence', async t => {
	const licence = await readFile(
		new URL('../node_modules/@fontsource/fira-code/LICENSE', import.meta.url),
		'utf8',
	);
	const notices = await readFile(
		new URL('../THIRD-PARTY-NOTICES.txt', import.meta.url),
		'utf8',
	);
	t.true(notices.includes(licence.trim()));
	const build = await readFile(
		new URL('../electron-builder.yml', import.meta.url),
		'utf8',
	);
	t.true(build.includes('  - THIRD-PARTY-NOTICES.txt'));
	t.true(build.includes('  - out/**'));
});
