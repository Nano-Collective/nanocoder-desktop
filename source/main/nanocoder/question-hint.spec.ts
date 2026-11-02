import type {
	RequestPermissionRequest,
	SessionNotification,
} from '@agentclientprotocol/sdk';
import test from 'ava';
import {QuestionHints} from '@/main/nanocoder/question-hint';

const sessionId = 'session-1';
const question = 'which rows should the export include?';
const choices = ['current filtered rows', 'all rows'];

function announce(
	hints: QuestionHints,
	update: Record<string, unknown> = {},
	notificationSession = sessionId,
): void {
	hints.observe({
		sessionId: notificationSession,
		update: {
			sessionUpdate: 'tool_call',
			toolCallId: 'call-1',
			title: question,
			kind: 'other',
			status: 'pending',
			rawInput: {question, options: choices},
			...update,
		},
	} as unknown as SessionNotification);
}

function permission(
	overrides: Partial<RequestPermissionRequest> = {},
): RequestPermissionRequest {
	return {
		sessionId,
		toolCall: {toolCallId: 'call-1', title: question, status: 'pending'},
		options: choices.map((name, index) => ({
			optionId: `answer-${index}`,
			name,
			kind: 'allow_once',
		})),
		...overrides,
	};
}

// Announces rawInput and asks with the given title and labels, so the only
// thing under test is the shape check, not a mismatch with the permission.
function probe(
	rawInput: unknown,
	labels: string[],
	title = question,
	update: Record<string, unknown> = {},
): boolean {
	const hints = new QuestionHints(sessionId);
	announce(hints, {rawInput, ...update});
	return hints.matches(
		permission({
			toolCall: {toolCallId: 'call-1', title, status: 'pending'},
			options: labels.map((name, index) => ({
				optionId: `answer-${index}`,
				name,
				kind: 'allow_once',
			})),
		}),
	);
}

test('matches the shape Nanocoder sends for ask_user', t => {
	t.true(probe({question, options: choices}, choices));
});

test('refuses a tool call whose kind, input or count is not ask_user', t => {
	const hints = (update: Record<string, unknown>) => {
		const h = new QuestionHints(sessionId);
		announce(h, update);
		return h.matches(permission());
	};
	t.false(hints({kind: 'read'}), 'kind is not other');
	t.false(hints({kind: undefined}), 'kind is missing');
	t.false(hints({rawInput: 'question'}), 'rawInput is not an object');
	t.false(hints({rawInput: [question, choices]}), 'rawInput is an array');
	t.false(
		probe({question: 1, options: choices}, choices),
		'question is not a string',
	);
	t.false(probe({question: ' ', options: choices}, choices), 'question blank');
	t.false(
		probe({question, options: [choices[0]]}, [choices[0]]),
		'fewer than two options',
	);
	const seven = [...choices, 'a', 'b', 'c', 'd', 'e'];
	t.false(probe({question, options: seven}, seven), 'more than six options');
	t.true(
		probe({question, options: seven.slice(0, 6)}, seven.slice(0, 6)),
		'six options is the limit',
	);
});

test('refuses options that Nanocoder would normalise or drop', t => {
	t.false(
		probe(
			{question, options: [{label: choices[0]}, {label: choices[1]}]},
			choices,
		),
		'object options',
	);
	t.false(
		probe({question, options: [choices[0], '', choices[1]]}, [
			choices[0],
			'',
			choices[1],
		]),
		'an empty option',
	);
	t.false(
		probe({question, options: [choices[0], ' ']}, [choices[0], ' ']),
		'a blank option',
	);
});

test('refuses control, format and oversized text', t => {
	t.false(
		probe(
			{question: `${question}\n`, options: choices},
			choices,
			`${question}\n`,
		),
		'control character in the question',
	);
	t.false(
		probe({question, options: [choices[0], 'all\u0007rows']}, [
			choices[0],
			'all\u0007rows',
		]),
		'control character in an option',
	);
	t.false(
		probe({question, options: [choices[0], 'all\u202Erows']}, [
			choices[0],
			'all\u202Erows',
		]),
		'format character in an option',
	);
	const longLabel = 'a'.repeat(513);
	t.false(
		probe({question, options: [choices[0], longLabel]}, [
			choices[0],
			longLabel,
		]),
		'oversized option',
	);
	const longQuestion = 'q'.repeat(2049);
	t.false(
		probe({question: longQuestion, options: choices}, choices, longQuestion),
		'oversized question',
	);
	const edgeLabel = 'a'.repeat(512);
	t.true(
		probe({question, options: [choices[0], edgeLabel]}, [
			choices[0],
			edgeLabel,
		]),
		'an option of exactly 512 bytes is allowed',
	);
});

test('a permission must match the announced question, labels and ids', t => {
	const hints = new QuestionHints(sessionId);
	announce(hints);
	const refusals: Array<[string, RequestPermissionRequest]> = [
		[
			'title differs from the question',
			permission({
				toolCall: {toolCallId: 'call-1', title: 'other?', status: 'pending'},
			}),
		],
		[
			'ids are not answer-N in order',
			permission({
				options: [
					{optionId: 'answer-1', name: choices[0], kind: 'allow_once'},
					{optionId: 'answer-0', name: choices[1], kind: 'allow_once'},
				],
			}),
		],
		[
			'ids are the approval ids',
			permission({
				options: [
					{optionId: 'allow', name: choices[0], kind: 'allow_once'},
					{optionId: 'deny', name: choices[1], kind: 'allow_once'},
				],
			}),
		],
		[
			'an option is allow_always',
			permission({
				options: [
					{optionId: 'answer-0', name: choices[0], kind: 'allow_always'},
					{optionId: 'answer-1', name: choices[1], kind: 'allow_once'},
				],
			}),
		],
		[
			'an option is reject_once',
			permission({
				options: [
					{optionId: 'answer-0', name: choices[0], kind: 'allow_once'},
					{optionId: 'answer-1', name: choices[1], kind: 'reject_once'},
				],
			}),
		],
		[
			'labels are reordered',
			permission({
				options: [
					{optionId: 'answer-0', name: choices[1], kind: 'allow_once'},
					{optionId: 'answer-1', name: choices[0], kind: 'allow_once'},
				],
			}),
		],
		[
			'a label differs',
			permission({
				options: [
					{optionId: 'answer-0', name: choices[0], kind: 'allow_once'},
					{optionId: 'answer-1', name: 'every row', kind: 'allow_once'},
				],
			}),
		],
		[
			'fewer options than announced',
			permission({
				options: [{optionId: 'answer-0', name: choices[0], kind: 'allow_once'}],
			}),
		],
		[
			'more options than announced',
			permission({
				options: [
					...permission().options,
					{optionId: 'answer-2', name: 'third', kind: 'allow_once'},
				],
			}),
		],
	];
	for (const [name, request] of refusals) {
		t.false(hints.matches(request), name);
	}
	t.true(hints.matches(permission()), 'the announced request still matches');
});

// Announces the labels, then asks with the given ids and kinds. Only the ids and
// kinds of the permission differ from the announced shape.
function asked(
	labels: readonly string[],
	ids: readonly unknown[],
	kinds: readonly unknown[] = labels.map(() => 'allow_once'),
): boolean {
	const hints = new QuestionHints(sessionId);
	announce(hints, {rawInput: {question, options: [...labels]}});
	const options = ids.map((optionId, index) => ({
		optionId,
		name: labels[index],
		kind: kinds[index],
	}));
	return hints.matches(
		permission({options} as unknown as Partial<RequestPermissionRequest>),
	);
}

test('option ids are exact, canonical and in announced order', t => {
	const three = ['first', 'second', 'third'];
	const canonical = ['answer-0', 'answer-1', 'answer-2'];
	t.true(asked(three, canonical), 'canonical ids in order');
	t.false(asked(three, ['answer-1', 'answer-0', 'answer-2']), 'reordered ids');
	const variants = [
		'answer-01',
		'answer-+1',
		'answer-1.0',
		'answer- 0',
		'answer-0 ',
		'Answer-0',
		'answer-1e0',
	];
	for (const variant of variants)
		for (let index = 0; index < canonical.length; index += 1) {
			const ids = [...canonical];
			ids[index] = variant;
			t.false(asked(three, ids), `${JSON.stringify(variant)} at ${index}`);
		}
	t.false(asked(three, [undefined, 'answer-1', 'answer-2']), 'missing id');
	t.false(asked(three, ['answer-0', 'answer-0', 'answer-2']), 'duplicate id');
	t.false(asked(choices, ['answer-0', 'answer-2']), 'gap in the ids');
	t.false(asked(choices, ['answer-0', undefined]), 'missing second id');
	t.false(asked(choices, ['answer-0', 'answer-1', 'answer-2']), 'extra id');
	t.false(asked(three, [...canonical, 'answer-3']), 'id beyond N-1');
	t.false(asked(choices, ['allow', 'answer-1']), 'approval id without prefix');
	t.false(asked(choices, ['answer-0', 'deny']), 'deny id');
});

test('every option must be allow_once', t => {
	t.true(
		asked(choices, ['answer-0', 'answer-1'], ['allow_once', 'allow_once']),
	);
	t.false(
		asked(choices, ['answer-0', 'answer-1'], ['allow_once', 'allow_always']),
		'one allow_always among allow_once',
	);
	t.false(
		asked(choices, ['answer-0', 'answer-1'], ['allow_once', 'reject_once']),
		'reject_once',
	);
	t.false(
		asked(choices, ['answer-0', 'answer-1'], ['allow_once', undefined]),
		'missing kind',
	);
});

test('a question has two to six options, both limits included', t => {
	const labels = (count: number) =>
		Array.from({length: count}, (_, index) => `choice ${index + 1}`);
	const ids = (count: number) =>
		Array.from({length: count}, (_, index) => `answer-${index}`);
	t.false(asked(labels(1), ids(1)), 'one option');
	t.true(asked(labels(2), ids(2)), 'two options');
	t.true(asked(labels(6), ids(6)), 'six options');
	t.false(asked(labels(7), ids(7)), 'seven options');
});

test('only a tool_call announced in this session and turn counts', t => {
	const otherSession = new QuestionHints(sessionId);
	announce(otherSession, {}, 'other-session');
	t.false(otherSession.matches(permission()), 'announced in another session');

	const current = new QuestionHints(sessionId);
	announce(current);
	t.false(
		current.matches(permission({sessionId: 'other-session'})),
		'requested from another session',
	);
	t.false(
		current.matches(
			permission({
				toolCall: {toolCallId: 'call-2', title: question, status: 'pending'},
			}),
		),
		'unknown toolCallId',
	);

	// The supervisor creates a new record for each prompt, so a later turn starts empty.
	const earlierTurn = new QuestionHints(sessionId);
	announce(earlierTurn);
	t.false(
		new QuestionHints(sessionId).matches(permission()),
		'a later turn starts with no announcements',
	);
	t.true(earlierTurn.matches(permission()));

	current.clear();
	t.false(current.matches(permission()), 'cleared at turn end');
});

test('an update that is not a tool_call announcement does not count', t => {
	const hints = new QuestionHints(sessionId);
	hints.observe({
		sessionId,
		update: {
			sessionUpdate: 'tool_call_update',
			toolCallId: 'call-1',
			title: question,
			kind: 'other',
			rawInput: {question, options: choices},
		},
	} as unknown as SessionNotification);
	t.false(hints.matches(permission()));
});

test('a reused toolCallId is ambiguous and gets no hint', t => {
	const hints = new QuestionHints(sessionId);
	announce(hints);
	announce(hints);
	t.false(hints.matches(permission()));
});

test('the per-turn record is bounded', t => {
	const hints = new QuestionHints(sessionId);
	for (let index = 0; index < 256; index += 1)
		announce(hints, {toolCallId: `filler-${index}`, kind: 'read'});
	announce(hints, {toolCallId: 'late'});
	t.false(
		hints.matches(
			permission({
				toolCall: {toolCallId: 'late', title: question, status: 'pending'},
			}),
		),
		'a call past the limit gets no hint',
	);
});
