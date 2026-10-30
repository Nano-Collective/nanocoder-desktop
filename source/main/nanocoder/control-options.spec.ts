import test from 'ava';
import {projectConfigOptions} from '@/main/nanocoder/control-options';

const offered = (id = 'model', values = ['fixture-model']) => ({
	id,
	type: 'select',
	category: 'model',
	name: id,
	currentValue: values[0],
	options: values.map(value => ({name: value, value})),
});

test('projects only Nanocoder confirmed select state and offered values (CHAT-10 ACP-14)', t => {
	const provider = offered('provider', ['fixture-provider']);
	const model = offered();
	t.deepEqual(
		projectConfigOptions([
			{...provider, privateSetting: 'discarded'},
			{...model, _meta: {privateSetting: 'discarded'}},
		]),
		[provider, model].map(({id, name, currentValue, options}) => ({
			id,
			name,
			currentValue,
			options,
		})),
	);
});

for (const [name, raw] of [
	['non-array', {}],
	['null entry', [null]],
	['excess outer entries', Array.from({length: 33}, () => offered())],
	['duplicate config IDs', [offered(), offered()]],
	['wrong category', [{...offered(), category: 'other'}]],
	['boolean select', [{...offered(), type: 'boolean'}]],
	[
		'grouped options',
		[{...offered(), options: [{group: 'nested', options: []}]}],
	],
	['duplicate values', [offered('model', ['same', 'same'])]],
	['unoffered current value', [{...offered(), currentValue: 'not-offered'}]],
	['empty values', [offered('model', [''])]],
	['boolean values', [{...offered(), options: [{name: 'flag', value: true}]}]],
	['control characters', [offered('model', ['unsafe\nmodel'])]],
	['oversized value', [offered('model', ['x'.repeat(513)])]],
	['oversized name', [{...offered(), name: 'x'.repeat(257)}]],
	[
		'oversized option name',
		[
			{
				...offered(),
				options: [{name: 'x'.repeat(257), value: 'fixture-model'}],
			},
		],
	],
	[
		'too many providers',
		[
			offered(
				'provider',
				Array.from({length: 65}, (_, i) => `p${i}`),
			),
		],
	],
	[
		'too many models',
		[
			offered(
				'model',
				Array.from({length: 257}, (_, i) => `m${i}`),
			),
		],
	],
	['inherited fields', [Object.create(offered())]],
	[
		'oversized UTF-8 envelope',
		[
			{
				...offered(),
				currentValue: `${'界'.repeat(500)}0`,
				options: Array.from({length: 256}, (_, i) => ({
					name: '界'.repeat(256),
					value: `${'界'.repeat(500)}${i}`,
				})),
			},
		],
	],
] as const) {
	test(`refuses ${name} without projecting control authority (CHAT-10 ACP-14)`, t => {
		t.is(projectConfigOptions(raw), undefined);
	});
}

test('unknown config IDs are ignored, never passed to the renderer (CHAT-10 ACP-14)', t => {
	t.deepEqual(projectConfigOptions([offered('credential')]), []);
});

test('control projection never executes getters on offers (CHAT-10 ACP-14)', t => {
	let reads = 0;
	const value = {...offered()};
	Object.defineProperty(value, 'options', {
		get() {
			reads++;
			return [{name: 'fixture-model', value: 'fixture-model'}];
		},
	});
	const projected = projectConfigOptions([value]);
	t.is(reads, 0);
	t.is(projected, undefined);
});
