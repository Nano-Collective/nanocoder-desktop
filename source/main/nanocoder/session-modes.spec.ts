import test from 'ava';
import {sessionModeOptions} from '@/main/nanocoder/control-options';

test('session modes intersect the five known IDs with actual offers (ACP-13)', t => {
	t.deepEqual(
		sessionModeOptions([{id: 'normal'}, {id: 'plan'}, {id: 'future'}]),
		['normal', 'plan'],
	);
});

for (const [label, value] of [
	['absent', undefined],
	['not an array', {}],
	['excessive', Array.from({length: 33}, () => ({id: 'normal'}))],
	['duplicate', [{id: 'normal'}, {id: 'normal'}]],
	['invalid ID', [{id: true}]],
	['inherited', [Object.create({id: 'normal'})]],
] as const) {
	test(`session modes fail closed for ${label} offers (ACP-13)`, t => {
		t.deepEqual(sessionModeOptions(value), []);
	});
}

test('session mode projection does not execute getters or accept unknown fallback IDs (ACP-13)', t => {
	let reads = 0;
	t.deepEqual(
		sessionModeOptions([
			{
				get id() {
					reads++;
					return 'normal';
				},
			},
		]),
		[],
	);
	t.is(reads, 0);
	t.deepEqual(sessionModeOptions([{id: 'credential'}, {id: 'auto'}]), []);
});
