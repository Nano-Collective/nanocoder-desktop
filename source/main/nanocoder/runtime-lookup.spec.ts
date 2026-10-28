import test from 'ava';
import {createLookup} from '@/main/nanocoder/runtime-lookup';

type Result = {ok: true; value: string} | {ok: false; message: string};

function lookupOf(results: Array<Result | Error>) {
	let calls = 0;
	const lookup = createLookup(async () => {
		const next = results[Math.min(calls++, results.length - 1)];
		if (next instanceof Error) throw next;
		return next;
	});
	return {lookup, calls: () => calls};
}

test('looks a successful result up once and remembers it', async t => {
	const {lookup, calls} = lookupOf([{ok: true, value: 'first'}]);
	t.deepEqual(await lookup(), {ok: true, value: 'first'});
	t.deepEqual(await lookup(), {ok: true, value: 'first'});
	t.is(calls(), 1);
});

test('does not remember a failure, so Nanocoder installed later is found', async t => {
	const {lookup, calls} = lookupOf([
		{ok: false, message: 'not installed'},
		{ok: true, value: 'installed'},
	]);
	t.deepEqual(await lookup(), {ok: false, message: 'not installed'});
	t.deepEqual(await lookup(), {ok: true, value: 'installed'});
	t.is(calls(), 2);
	t.deepEqual(await lookup(), {ok: true, value: 'installed'});
	t.is(calls(), 2);
});

test('does not remember a lookup that threw', async t => {
	const {lookup, calls} = lookupOf([
		new Error('disk error'),
		{ok: true, value: 'fine'},
	]);
	await t.throwsAsync(lookup(), {message: 'disk error'});
	t.deepEqual(await lookup(), {ok: true, value: 'fine'});
	t.is(calls(), 2);
});

test('callers that ask while a lookup is running share it', async t => {
	const {lookup, calls} = lookupOf([{ok: true, value: 'shared'}]);
	const [a, b, c] = await Promise.all([lookup(), lookup(), lookup()]);
	t.deepEqual([a, b, c], Array(3).fill({ok: true, value: 'shared'}));
	t.is(calls(), 1);
});

test('keeps asking after each failure until one succeeds', async t => {
	const {lookup, calls} = lookupOf([
		{ok: false, message: 'a'},
		{ok: false, message: 'b'},
		{ok: true, value: 'c'},
	]);
	t.false((await lookup()).ok);
	t.false((await lookup()).ok);
	t.true((await lookup()).ok);
	t.is(calls(), 3);
});
