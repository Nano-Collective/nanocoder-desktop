import test from 'ava';
import {terminalFocusLease} from '@/renderer/terminal-focus';

function fixture() {
	const target = new EventTarget();
	const owner = Object.assign(new EventTarget(), {
		body: new EventTarget(),
		activeElement: target,
	});
	return {
		owner,
		target,
		move(next: EventTarget) {
			owner.activeElement = next;
			owner.dispatchEvent(new Event('focusin'));
		},
	};
}

test('TERM-11 a disabled initiating control may lose focus to body before being removed', t => {
	const value = fixture();
	const lease = terminalFocusLease(value.owner, value.target);
	value.move(value.owner.body);
	t.true(lease.canReturn());
	lease.dispose();
});

test('TERM-11 asynchronous focus never steals it after the user moved elsewhere or clicked', t => {
	const value = fixture();
	const lease = terminalFocusLease(value.owner, value.target);
	value.move(new EventTarget());
	value.move(value.owner.body);
	t.false(lease.canReturn());
	lease.dispose();
	const next = terminalFocusLease(value.owner, value.owner.body);
	value.owner.dispatchEvent(new Event('pointerdown'));
	t.false(next.canReturn());
	next.dispose();
});

test('TERM-11 inactive initiation cannot take focus and completed leases remove listeners', t => {
	const value = fixture();
	const inactive = terminalFocusLease(value.owner, new EventTarget());
	t.false(inactive.canReturn());
	inactive.dispose();
	const lease = terminalFocusLease(value.owner, value.target);
	lease.dispose();
	value.owner.dispatchEvent(new Event('pointerdown'));
	t.true(lease.canReturn());
});
