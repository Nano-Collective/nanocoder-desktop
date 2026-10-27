import {PassThrough} from 'node:stream';
import test from 'ava';
import {
	isFrame,
	ProtocolViolation,
	protocolStream,
	readFrames,
} from '@/main/nanocoder/protocol-stream';

async function collect(
	chunks: Array<Uint8Array | string>,
	maxFrameLength?: number,
) {
	const violations: string[] = [];
	const frames: unknown[] = [];
	const source = (async function* () {
		yield* chunks;
	})();
	try {
		for await (const frame of readFrames(
			source,
			line => violations.push(line),
			maxFrameLength,
		)) {
			frames.push(frame);
		}
		return {frames, violations, error: undefined};
	} catch (error) {
		return {frames, violations, error};
	}
}

test('accepts JSON-RPC requests, notifications and responses', t => {
	t.true(isFrame({jsonrpc: '2.0', id: 1, method: 'initialize'}));
	t.true(isFrame({jsonrpc: '2.0', method: 'session/update'}));
	t.true(isFrame({jsonrpc: '2.0', id: 1, result: {}}));
});

test('rejects values that are not JSON-RPC frames', t => {
	for (const value of [
		null,
		'text',
		42,
		[{jsonrpc: '2.0', id: 1}],
		{id: 1, method: 'initialize'},
		{jsonrpc: '1.0', id: 1, method: 'initialize'},
		{jsonrpc: '2.0'},
	]) {
		t.false(isFrame(value), JSON.stringify(value));
	}
});

test('reads frames split across chunks, including multibyte text', async t => {
	const bytes = Buffer.from(
		'{"jsonrpc":"2.0","method":"a","params":{"t":"é"}}\r\n\n{"jsonrpc":"2.0","id":1,"result":{}}',
	);
	const split = bytes.indexOf(0xa9);
	const {frames, error} = await collect([
		bytes.subarray(0, split),
		bytes.subarray(split),
	]);
	t.is(error, undefined);
	t.deepEqual(frames, [
		{jsonrpc: '2.0', method: 'a', params: {t: 'é'}},
		{jsonrpc: '2.0', id: 1, result: {}},
	]);
});

test('a line that is not JSON ends the stream', async t => {
	const {frames, violations, error} = await collect([
		'{"jsonrpc":"2.0","method":"a"}\nStarting Nanocoder...\n{"jsonrpc":"2.0","method":"b"}\n',
	]);
	t.true(error instanceof ProtocolViolation);
	t.deepEqual(violations, ['Starting Nanocoder...']);
	t.deepEqual(frames, [{jsonrpc: '2.0', method: 'a'}]);
});

test('JSON that is not a frame ends the stream', async t => {
	const {violations, error} = await collect(['{"hello":"world"}\n']);
	t.true(error instanceof ProtocolViolation);
	t.deepEqual(violations, ['{"hello":"world"}']);
});

test('a frame past the size limit ends the stream', async t => {
	const {error} = await collect(['{"jsonrpc":"2.0","method":"a"'], 10);
	t.true(error instanceof ProtocolViolation);
});

test('the violation error carries no stdout content', t => {
	const error = new ProtocolViolation();
	t.deepEqual(Object.keys(error), []);
	t.is(
		error.message,
		'Nanocoder wrote something other than ACP to standard output',
	);
});

test('writes newline-delimited JSON and reads frames back', async t => {
	const stdout = new PassThrough();
	const stdin = new PassThrough();
	const stream = protocolStream(stdout, stdin, () => {});

	const writer = stream.writable.getWriter();
	await writer.write({jsonrpc: '2.0', id: 0, method: 'initialize'});
	t.is(
		stdin.read().toString(),
		'{"jsonrpc":"2.0","id":0,"method":"initialize"}\n',
	);

	stdout.end('{"jsonrpc":"2.0","id":0,"result":{}}\n');
	const reader = stream.readable.getReader();
	t.deepEqual(await reader.read(), {
		done: false,
		value: {jsonrpc: '2.0', id: 0, result: {}},
	});
	t.deepEqual(await reader.read(), {done: true, value: undefined});

	await writer.close();
	t.true(stdin.writableEnded);
});

test('the readable errors on a protocol violation', async t => {
	const stdout = new PassThrough();
	const violations: string[] = [];
	const stream = protocolStream(stdout, new PassThrough(), line =>
		violations.push(line),
	);
	stdout.end('oops\n');
	await t.throwsAsync(stream.readable.getReader().read(), {
		instanceOf: ProtocolViolation,
	});
	t.deepEqual(violations, ['oops']);
});

test('cancelling the readable stops reading stdout', async t => {
	const stdout = new PassThrough();
	const stream = protocolStream(stdout, new PassThrough(), () => {});
	await stream.readable.cancel();
	t.true(stdout.destroyed);
});
