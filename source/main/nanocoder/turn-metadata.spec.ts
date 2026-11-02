import test from 'ava';
import {
	type MetadataField,
	parsePromptMetadata,
	parseTurnMetadata,
} from '@/main/nanocoder/turn-metadata';

test('malformed metadata and usage are reported by field name and ignored (ACP-12)', t => {
	const fields: MetadataField[] = [];
	const report = (field: MetadataField) => fields.push(field);
	t.is(parseTurnMetadata(['secret'], report), undefined);
	t.is(parseTurnMetadata('secret', report), undefined);
	t.is(parseTurnMetadata(null, report), undefined);
	t.deepEqual(
		parsePromptMetadata(
			{
				stopReason: 'end_turn',
				_meta: {'nanocoder/durationMs': 12},
				usage: {inputTokens: 'secret'},
			} as never,
			report,
		),
		{durationMs: 12},
	);
	t.deepEqual(fields, ['_meta', '_meta', 'usage']);
	const original = console.warn;
	const warned: unknown[][] = [];
	console.warn = (...values: unknown[]) => warned.push(values);
	try {
		t.is(parseTurnMetadata(7), undefined);
	} finally {
		console.warn = original;
	}
	t.deepEqual(warned, [['Ignored malformed ACP metadata:', '_meta']]);
});
