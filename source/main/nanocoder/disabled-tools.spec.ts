import test from 'ava';
import {
	confirmsDisabledTools,
	DISABLED_TOOLS_META,
	disabledToolsMeta,
} from '@/main/nanocoder/disabled-tools';

test('a session that turns tools off sends them under the Nanocoder meta key, and sends nothing otherwise (BRW-18 DEC-48)', t => {
	t.is(DISABLED_TOOLS_META, 'nanocoder/disabledTools');
	t.deepEqual(disabledToolsMeta(['browser']), {
		_meta: {'nanocoder/disabledTools': ['browser']},
	});
	t.deepEqual(disabledToolsMeta([]), {});
});

test('only an echoed list of tool names confirms the request, so anything else fails closed (DEC-48)', t => {
	const echo = (value: unknown) => ({'nanocoder/disabledTools': value});
	t.true(confirmsDisabledTools(['browser'], echo(['browser'])));
	t.true(confirmsDisabledTools(['browser'], echo(['browser', 'web_search'])));
	// Nanocoder leaves out a name it has no tool for, so there is nothing left to turn off.
	t.true(confirmsDisabledTools(['browser'], echo([])));
	for (const meta of [
		undefined,
		null,
		{},
		echo(undefined),
		echo('browser'),
		echo([7]),
		echo({browser: true}),
		'nanocoder/disabledTools',
	])
		t.false(confirmsDisabledTools(['browser'], meta), JSON.stringify(meta));
	t.true(confirmsDisabledTools([], undefined));
});
