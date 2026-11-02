import type {CaptureState} from './harness';
import {states as conversation} from './state-conversation';
import {states as dialogs} from './state-dialogs';
import {states as firstLaunch} from './state-first-launch';

export const states: CaptureState[] = [
	...firstLaunch,
	...conversation,
	...dialogs,
];
