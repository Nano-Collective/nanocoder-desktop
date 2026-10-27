import {contextBridge, ipcRenderer} from 'electron';
import type {DesktopApi} from '@/shared/desktop-api';
import {CHANNELS} from '@/shared/ipc';

const api: DesktopApi = {
	getAppInfo: () => ipcRenderer.invoke(CHANNELS.getAppInfo, {}),
};

contextBridge.exposeInMainWorld('desktop', api);
