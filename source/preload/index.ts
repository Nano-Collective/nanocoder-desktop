import {contextBridge, ipcRenderer} from 'electron';
import type {DesktopApi} from '@/shared/desktop-api';
import {CHANNELS, type TurnEvent} from '@/shared/ipc';

const api: DesktopApi = {
	getAppInfo: () => ipcRenderer.invoke(CHANNELS.getAppInfo, {}),
	getNanocoderRuntime: () =>
		ipcRenderer.invoke(CHANNELS.getNanocoderRuntime, {}),
	connectNanocoder: () => ipcRenderer.invoke(CHANNELS.connectNanocoder, {}),
	sendPrompt: text => ipcRenderer.invoke(CHANNELS.sendPrompt, {text}),
	answerPermission: (id, optionId) =>
		ipcRenderer.invoke(CHANNELS.answerPermission, {id, optionId}),
	onNanocoderEvent: listener => {
		const handler = (_event: unknown, turnEvent: TurnEvent) => {
			listener(turnEvent);
		};
		ipcRenderer.on(CHANNELS.nanocoderEvent, handler);
		return () => {
			ipcRenderer.removeListener(CHANNELS.nanocoderEvent, handler);
		};
	},
};

contextBridge.exposeInMainWorld('desktop', api);
