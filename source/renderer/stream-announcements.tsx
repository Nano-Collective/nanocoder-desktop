import * as React from 'react';
import type {Clock} from '@/renderer/overlay-model';
import {currentTurnStart, type Transcript} from '@/renderer/transcript';

interface Snapshot {
	transcript: Transcript;
	running: boolean;
	outcome?: 'completed' | 'failed' | 'cancelled' | 'interrupted';
}

export function createAnnouncementHost(ports: {
	place(): boolean;
	write(text: string): void;
	frame(callback: () => void): () => void;
	delivered(): void;
}) {
	let pending: string | undefined;
	let cancel: (() => void) | undefined;
	let disposed = false;
	const settle = () => {
		cancel?.();
		ports.place();
		cancel = ports.frame(() => {
			if (disposed) return;
			cancel = ports.frame(() => {
				if (disposed || pending === undefined) return;
				if (ports.place()) {
					settle();
					return;
				}
				const text = pending;
				pending = undefined;
				ports.write(text);
				ports.delivered();
			});
		});
	};
	return {
		move() {
			if (!disposed && ports.place() && pending !== undefined) settle();
		},
		publish(text: string) {
			if (disposed) return;
			if (!text) {
				cancel?.();
				pending = undefined;
				ports.write('');
				ports.delivered();
				return;
			}
			pending = text;
			settle();
		},
		dispose() {
			disposed = true;
			cancel?.();
			pending = undefined;
		},
	};
}

function preview(text: string): string {
	const plain = text
		.slice(0, 4000)
		.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, ' code omitted ')
		.replace(/`[^`]*`/g, ' code omitted ')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<[^>]*>/g, ' ')
		.replace(/[*_#>~]/g, '')
		.replace(/[\p{Cc}\p{Cf}]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const characters = Array.from(plain);
	return characters.length > 160
		? `${characters.slice(0, 159).join('').trimEnd()}…`
		: plain || 'response available in the conversation';
}

export function createStreamAnnouncer(
	clock: Clock,
	changed: (text: string) => void,
) {
	type Message = {kind: 'state' | 'waiting' | 'response'; text: string};
	let pending: Message[] = [];
	let current: Message | undefined;
	let implicitEnd: Message | undefined;
	let cancel: (() => void) | undefined;
	let disposed = false;
	let delivering = false;
	let initialized = false;
	let wasRunning = false;
	let wasWaiting = false;
	let active = false;
	let turnStart = -1;
	let summarised = -1;
	let previousOutcome: Snapshot['outcome'];
	const emit = (message: Message) => {
		if (disposed) return;
		current = message;
		delivering = true;
		changed(message.text);
	};
	const enqueue = (message: Message) => {
		if (!cancel && !delivering) emit(message);
		else {
			if (pending.length === 8) pending.shift();
			pending.push(message);
		}
	};
	return {
		delivered() {
			if (disposed || !delivering) return;
			delivering = false;
			cancel = clock.schedule(() => {
				cancel = undefined;
				const next = pending.shift();
				if (next && !disposed) emit(next);
			}, 1000);
		},
		update({transcript, running, outcome}: Snapshot, modal = false) {
			if (disposed) return;
			const start = currentTurnStart(transcript.items);
			if (start !== turnStart) {
				turnStart = start;
				summarised = start;
				implicitEnd = undefined;
			}
			const waiting = transcript.permissions.length > 0;
			if (!initialized) {
				initialized = true;
				if (!running) {
					summarised = transcript.items.length - 1;
					wasWaiting = waiting;
					previousOutcome = outcome;
					return;
				}
			}
			if (!waiting || modal)
				pending = pending.filter(message => message.kind !== 'waiting');
			if (modal && current?.kind === 'waiting') {
				current = undefined;
				changed('');
			}
			if (running && !wasRunning) {
				active = true;
				wasWaiting = false;
				implicitEnd = undefined;
				enqueue({kind: 'state', text: 'turn started'});
			}
			if (active && waiting && !wasWaiting && !modal)
				enqueue({kind: 'waiting', text: 'turn waiting for approval'});
			const ending =
				active &&
				(!running || (outcome !== undefined && outcome !== previousOutcome));
			const correcting =
				implicitEnd !== undefined &&
				outcome !== undefined &&
				outcome !== previousOutcome;
			const result = outcome ?? 'interrupted';
			let summary = '';
			if (
				(active || correcting) &&
				(!(ending || correcting) || result === 'completed')
			) {
				for (let index = transcript.items.length - 1; index > start; index--) {
					const item = transcript.items[index];
					if (
						item.kind !== 'agent' ||
						index <= summarised ||
						(!(ending || correcting) &&
							(index === transcript.items.length - 1 ||
								transcript.items.at(-1)?.kind === 'failure'))
					)
						continue;
					summary = `response finished: ${preview(item.text)}`;
					summarised = index;
					break;
				}
			}
			if (ending || correcting) {
				active = false;
				const message: Message = {
					kind: 'state',
					text: `turn ${result}${summary ? `. ${summary}` : ''}`,
				};
				if (correcting)
					pending = pending.filter(queued => queued !== implicitEnd);
				if (correcting && current === implicitEnd && delivering) emit(message);
				else enqueue(message);
				implicitEnd = outcome === undefined ? message : undefined;
			} else if (summary) enqueue({kind: 'response', text: summary});
			wasRunning = running;
			wasWaiting = waiting;
			previousOutcome = outcome;
		},
		dispose() {
			disposed = true;
			delivering = false;
			cancel?.();
			pending = [];
			current = undefined;
			implicitEnd = undefined;
		},
	};
}

const browserClock: Clock = {
	schedule(callback, delay) {
		const timer = window.setTimeout(callback, delay);
		return () => window.clearTimeout(timer);
	},
};

const browserFrame = (callback: () => void) => {
	const frame = requestAnimationFrame(callback);
	return () => cancelAnimationFrame(frame);
};

export function StreamAnnouncements({
	transcript,
	running,
	outcome,
	clock = browserClock,
	frame = browserFrame,
}: Snapshot & {
	clock?: Clock;
	frame?: (callback: () => void) => () => void;
}) {
	const host = React.useRef<HTMLDivElement>(null);
	const latest = React.useRef<Snapshot>({transcript, running, outcome});
	const driver = React.useRef<{update(snapshot: Snapshot): void} | null>(null);
	React.useLayoutEffect(() => {
		const node = document.createElement('div');
		node.setAttribute('role', 'status');
		node.setAttribute('aria-label', 'stream announcements');
		node.setAttribute('aria-live', 'polite');
		node.setAttribute('aria-atomic', 'true');
		node.setAttribute('aria-relevant', 'additions text');
		Object.assign(node.style, {
			position: 'absolute',
			top: '0',
			left: '0',
			width: '1px',
			height: '1px',
			margin: '0',
			overflow: 'hidden',
			clipPath: 'inset(50%)',
			whiteSpace: 'nowrap',
		});
		const modalHost = () =>
			document.querySelector<HTMLElement>(
				'dialog[open] [data-stream-announcement-host="modal"]',
			);
		const destination = () => modalHost() ?? host.current;
		const announcer = createStreamAnnouncer(clock, message =>
			delivery.publish(message),
		);
		const delivery = createAnnouncementHost({
			place() {
				const target = destination();
				if (!target || node.parentElement === target) return false;
				target.append(node);
				return true;
			},
			write(message) {
				node.textContent = message;
			},
			frame,
			delivered: () => announcer.delivered(),
		});
		const update = (snapshot: Snapshot) => {
			latest.current = snapshot;
			announcer.update(snapshot, modalHost() !== null);
			delivery.move();
		};
		driver.current = {update};
		delivery.move();
		const observer = new MutationObserver(() => update(latest.current));
		observer.observe(document.body, {
			subtree: true,
			attributes: true,
			attributeFilter: ['open'],
		});
		update(latest.current);
		return () => {
			driver.current = null;
			observer.disconnect();
			delivery.dispose();
			announcer.dispose();
			node.remove();
		};
	}, [clock, frame]);
	React.useLayoutEffect(() => {
		driver.current?.update({transcript, running, outcome});
	}, [transcript, running, outcome]);
	return <div ref={host} data-stream-announcement-host="normal" />;
}
