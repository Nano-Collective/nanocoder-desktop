type FocusOwner = Pick<
	EventTarget,
	'addEventListener' | 'removeEventListener'
> & {
	readonly activeElement: EventTarget | null;
	readonly body: EventTarget;
};

export function terminalFocusLease(owner: FocusOwner, target: EventTarget) {
	const startedFocused = owner.activeElement === target;
	let moved = false;
	const focus = () => {
		if (owner.activeElement !== target && owner.activeElement !== owner.body)
			moved = true;
	};
	const pointer = () => {
		moved = true;
	};
	owner.addEventListener('focusin', focus);
	owner.addEventListener('pointerdown', pointer);
	return {
		canReturn: () =>
			startedFocused &&
			!moved &&
			(owner.activeElement === target || owner.activeElement === owner.body),
		dispose() {
			owner.removeEventListener('focusin', focus);
			owner.removeEventListener('pointerdown', pointer);
		},
	};
}
