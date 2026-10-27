import test from 'ava';
import {z} from 'zod';
import {
	handleRequest,
	isTrustedSender,
	type Sender,
} from '@/main/ipc/handle-request';
import {APP_ORIGIN} from '@/main/security';

const appSender: Sender = {url: 'app://renderer/index.html', isMainFrame: true};
const schema = z.strictObject({name: z.string().max(10)});
const greet = ({name}: {name: string}) => `hello ${name}`;

function request(sender: Sender, payload: unknown) {
	return handleRequest({
		sender,
		payload,
		schema,
		handler: greet,
		allowedOrigins: [APP_ORIGIN],
	});
}

test('returns the handler result for a valid request', async t => {
	t.deepEqual(await request(appSender, {name: 'ada'}), {
		ok: true,
		value: 'hello ada',
	});
});

test('rejects a malformed request with VALIDATION', async t => {
	for (const payload of [
		undefined,
		null,
		'ada',
		{},
		{name: 42},
		{name: 'a'.repeat(11)},
		{name: 'ada', extra: true},
	]) {
		const result = await request(appSender, payload);
		t.false(result.ok);
		if (!result.ok) {
			t.is(result.error.code, 'VALIDATION');
		}
	}
});

test('rejects a request from an unexpected sender with DENIED', async t => {
	for (const sender of [
		{url: 'https://example.com/', isMainFrame: true},
		{url: 'app://other/index.html', isMainFrame: true},
		{url: 'app://renderer/index.html', isMainFrame: false},
		{url: undefined, isMainFrame: true},
	]) {
		const result = await request(sender, {name: 'ada'});
		t.false(result.ok);
		if (!result.ok) {
			t.is(result.error.code, 'DENIED');
		}
	}
});

test('checks the sender before parsing the payload', async t => {
	const result = await request(
		{url: 'https://example.com/', isMainFrame: true},
		'not an object',
	);
	t.false(result.ok);
	if (!result.ok) {
		t.is(result.error.code, 'DENIED');
	}
});

test('turns a thrown error into INTERNAL without leaking its message', async t => {
	const original = console.error;
	console.error = () => {};
	const result = await handleRequest({
		sender: appSender,
		payload: {name: 'ada'},
		schema,
		handler: () => {
			throw new Error('secret detail');
		},
		allowedOrigins: [APP_ORIGIN],
	});
	console.error = original;
	t.deepEqual(result, {
		ok: false,
		error: {
			code: 'INTERNAL',
			message: 'Something went wrong',
			retryable: false,
		},
	});
});

test('trusts only the main frame of an allowed origin', t => {
	t.true(isTrustedSender(appSender, [APP_ORIGIN]));
	t.false(isTrustedSender({...appSender, isMainFrame: false}, [APP_ORIGIN]));
});
