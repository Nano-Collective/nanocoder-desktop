import test from 'ava';
import {
	clickRisks,
	describeRisks,
	type TargetFacts,
	typeRisks,
} from '@/main/browser-control/sensitive';

const facts = (overrides: Partial<TargetFacts> = {}): TargetFacts => ({
	tag: 'button',
	type: 'button',
	role: 'button',
	name: '',
	id: '',
	autocomplete: '',
	label: 'Show more',
	submits: false,
	download: false,
	editable: false,
	disabled: false,
	...overrides,
});

test('an ordinary button or link click is not sensitive (BRW-13)', t => {
	t.deepEqual(clickRisks(facts()), []);
	t.deepEqual(
		clickRisks(facts({tag: 'a', type: '', role: 'link', label: 'Docs'})),
		[],
	);
});

test('a click that submits a form is sensitive, whatever its label (BRW-13)', t => {
	t.deepEqual(clickRisks(facts({submits: true, label: 'Search'})), ['submit']);
});

test('a click that starts a download or opens the file chooser is sensitive', t => {
	t.deepEqual(clickRisks(facts({tag: 'a', download: true})), ['download']);
	t.deepEqual(clickRisks(facts({tag: 'input', type: 'file'})), ['file']);
});

test('purchase, payment, delete and confirm wording is sensitive in the label, name or id', t => {
	for (const label of [
		'Buy now',
		'Place order',
		'Pay £12',
		'Checkout',
		'Check out',
		'Delete account',
		'Remove item',
		'Confirm',
		'Transfer funds',
		'Unsubscribe',
		'Purchase',
	])
		t.deepEqual(clickRisks(facts({label})), ['wording'], label);
	t.deepEqual(clickRisks(facts({id: 'delete-btn', label: 'X'})), ['wording']);
	t.deepEqual(clickRisks(facts({name: 'confirm', label: ''})), ['wording']);
	for (const label of ['Payload viewer', 'Ordered list demo', 'Confirmed bugs'])
		t.deepEqual(clickRisks(facts({label})), [], label);
});

test('typing into password, payment, one-time-code and file fields is sensitive (BRW-13)', t => {
	const field = (overrides: Partial<TargetFacts>) =>
		facts({
			tag: 'input',
			type: 'text',
			role: 'textbox',
			editable: true,
			label: 'Field',
			...overrides,
		});
	t.deepEqual(typeRisks(field({})), []);
	t.deepEqual(typeRisks(field({type: 'password'})), ['password']);
	t.deepEqual(typeRisks(field({autocomplete: 'current-password'})), [
		'password',
	]);
	t.deepEqual(typeRisks(field({autocomplete: 'cc-number'})), ['payment']);
	t.deepEqual(typeRisks(field({name: 'card_cvc'})), ['payment']);
	t.deepEqual(typeRisks(field({id: 'iban'})), ['payment']);
	t.deepEqual(typeRisks(field({autocomplete: 'one-time-code'})), [
		'one-time-code',
	]);
	t.deepEqual(typeRisks(field({name: 'otp'})), ['one-time-code']);
	t.deepEqual(typeRisks(field({type: 'file'})), ['file']);
	t.deepEqual(typeRisks(field({type: 'email', name: 'email'})), []);
});

test('reasons are described in plain words for the agent', t => {
	t.is(
		describeRisks(['submit', 'wording']),
		'it would submit a form, and its wording suggests a purchase, payment, deletion or confirmation',
	);
});
