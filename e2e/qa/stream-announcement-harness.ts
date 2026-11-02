import {createElement} from 'react';
import {flushSync} from 'react-dom';
import {createRoot, type Root} from 'react-dom/client';
import type {Clock} from '@/renderer/overlay-model';
import {StreamAnnouncements} from '@/renderer/stream-announcements';
import type {Transcript} from '@/renderer/transcript';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let region: Element | undefined;
let observer: MutationObserver | undefined;
let now = 0;
let nextId = 0;
let nextFrameId = 0;
let retiredRegion: Element | undefined;
const timers = new Map<number, {at: number; callback(): void}>();
const frames = new Map<number, () => void>();
const savedCallbacks: Array<() => void> = [];
const retiredCallbacks: Array<() => void> = [];
const writes: Array<{text: string; at: number}> = [];
const clock: Clock = {
	schedule(callback, delay) {
		const id = ++nextId;
		timers.set(id, {at: now + delay, callback});
		savedCallbacks.push(callback);
		return () => {
			timers.delete(id);
		};
	},
};
const frame = (callback: () => void) => {
	const id = ++nextFrameId;
	frames.set(id, callback);
	savedCallbacks.push(callback);
	return () => {
		frames.delete(id);
	};
};

export const announcementHarness = {
	render({
		running,
		text,
		outcome,
		manualFrames = false,
	}: {
		running: boolean;
		text?: string;
		outcome?: 'completed' | 'failed' | 'cancelled' | 'interrupted';
		manualFrames?: boolean;
	}) {
		if (!root) {
			container = document.createElement('div');
			container.id = 'stream-announcement-fixture';
			document.body.append(container);
			root = createRoot(container);
		}
		const transcript: Transcript = {
			items: [
				{kind: 'user', text: 'fixture prompt'},
				...(text ? [{kind: 'agent' as const, text}] : []),
			],
			permissions: [],
		};
		flushSync(() => {
			root?.render(
				createElement(StreamAnnouncements, {
					transcript,
					running,
					outcome,
					clock,
					frame: manualFrames ? frame : undefined,
				}),
			);
		});
	},
	observe() {
		observer?.disconnect();
		region =
			document.querySelector('[aria-label="stream announcements"]') ??
			undefined;
		if (!region) throw new Error('Missing stream announcement fixture');
		writes.length = 0;
		const observedRegion = region;
		observer = new MutationObserver(() => {
			writes.push({text: observedRegion.textContent ?? '', at: now});
		});
		observer.observe(region, {
			subtree: true,
			childList: true,
			characterData: true,
		});
	},
	advance(milliseconds: number) {
		const end = now + milliseconds;
		for (;;) {
			const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
			if (!next || next[1].at > end) break;
			now = next[1].at;
			timers.delete(next[0]);
			next[1].callback();
		}
		now = end;
	},
	frame() {
		const pending = [...frames.values()];
		frames.clear();
		for (const callback of pending) callback();
	},
	resources() {
		return {timers: timers.size, frames: frames.size};
	},
	unmount() {
		retiredRegion =
			document.querySelector('[aria-label="stream announcements"]') ??
			undefined;
		root?.unmount();
		container?.remove();
		root = undefined;
		container = undefined;
		retiredCallbacks.push(...savedCallbacks.splice(0));
		return {
			timers: timers.size,
			frames: frames.size,
			statuses: document.querySelectorAll('[aria-label="stream announcements"]')
				.length,
		};
	},
	runRetired() {
		for (const callback of retiredCallbacks.splice(0)) callback();
		return {
			text: retiredRegion?.textContent ?? '',
			timers: timers.size,
			frames: frames.size,
		};
	},
	state() {
		return {
			writes: [...writes],
			sameNode:
				region ===
				document.querySelector('[aria-label="stream announcements"]'),
			inModal: Boolean(region?.closest('dialog[open]')),
			owners: [...document.querySelectorAll('[data-stream-announcement-host]')]
				.map(host => host.textContent?.trim())
				.filter(Boolean),
		};
	},
	dispose() {
		observer?.disconnect();
		root?.unmount();
		container?.remove();
		root = undefined;
		container = undefined;
		region = undefined;
		observer = undefined;
		retiredRegion = undefined;
		timers.clear();
		frames.clear();
		savedCallbacks.length = 0;
		retiredCallbacks.length = 0;
		writes.length = 0;
		now = 0;
	},
};
