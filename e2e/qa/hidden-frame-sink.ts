import type {CDPSession} from '@playwright/test';
import {hiddenTestWindows} from '@/main/window-presentation';

export function hiddenFrameSinkRequired(
	isPackaged: boolean,
	args: readonly string[],
	platform: NodeJS.Platform,
): boolean {
	return (
		hiddenTestWindows(isPackaged, args) &&
		(platform === 'linux' || platform === 'win32')
	);
}

type FrameListener = (frame: {sessionId: number}) => void;

interface FrameSession {
	send: CDPSession['send'];
	on(event: 'Page.screencastFrame', listener: FrameListener): unknown;
	off(event: 'Page.screencastFrame', listener: FrameListener): unknown;
}

export async function startHiddenFrameSink(
	cdp: FrameSession,
): Promise<() => Promise<void>> {
	const discard: FrameListener = ({sessionId}) => {
		void cdp.send('Page.screencastFrameAck', {sessionId}).catch(() => {});
	};
	cdp.on('Page.screencastFrame', discard);
	try {
		await cdp.send('Page.startScreencast', {
			format: 'jpeg',
			quality: 0,
			maxWidth: 1,
			maxHeight: 1,
		});
	} catch (error) {
		cdp.off('Page.screencastFrame', discard);
		throw error;
	}
	let stopped: Promise<void> | undefined;
	return () => {
		stopped ??= (async () => {
			try {
				await cdp.send('Page.stopScreencast');
			} finally {
				cdp.off('Page.screencastFrame', discard);
			}
		})();
		return stopped;
	};
}
