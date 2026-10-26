import {contextBridge} from 'electron';
import {APP_NAME} from '@/shared/app-info';
import type {DesktopApi} from '@/shared/desktop-api';

const api: DesktopApi = {appName: APP_NAME};

contextBridge.exposeInMainWorld('desktop', api);
