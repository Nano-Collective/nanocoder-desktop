import {contextBridge, ipcRenderer} from 'electron';
import type {DesktopApi} from '@/shared/desktop-api';
import {CHANNELS, type ProjectEvent} from '@/shared/ipc';

const api: DesktopApi = {
	getSettings: request => ipcRenderer.invoke(CHANNELS.getSettings, request),
	updateSettings: request =>
		ipcRenderer.invoke(CHANNELS.updateSettings, request),
	getUiState: request => ipcRenderer.invoke(CHANNELS.getUiState, request),
	updateUiState: request => ipcRenderer.invoke(CHANNELS.updateUiState, request),
	listProjects: request => ipcRenderer.invoke(CHANNELS.listProjects, request),
	addProject: request => ipcRenderer.invoke(CHANNELS.addProject, request),
	openProject: request => ipcRenderer.invoke(CHANNELS.openProject, request),
	locateProject: request => ipcRenderer.invoke(CHANNELS.locateProject, request),
	removeProject: request => ipcRenderer.invoke(CHANNELS.removeProject, request),
	setProjectDefaultMode: request =>
		ipcRenderer.invoke(CHANNELS.setProjectDefaultMode, request),
	getProjectControls: request =>
		ipcRenderer.invoke(CHANNELS.getProjectControls, request),
	setProjectConfigOption: request =>
		ipcRenderer.invoke(CHANNELS.setProjectConfigOption, request),
	getSupervisorState: request =>
		ipcRenderer.invoke(CHANNELS.getSupervisorState, request),
	startProject: request => ipcRenderer.invoke(CHANNELS.startProject, request),
	stopProject: request => ipcRenderer.invoke(CHANNELS.stopProject, request),
	restartProject: request =>
		ipcRenderer.invoke(CHANNELS.restartProject, request),
	getCapabilityGates: request =>
		ipcRenderer.invoke(CHANNELS.getCapabilityGates, request),
	getDiagnostics: request =>
		ipcRenderer.invoke(CHANNELS.getDiagnostics, request),
	exportDiagnostics: request =>
		ipcRenderer.invoke(CHANNELS.exportDiagnostics, request),
	listThreads: request => ipcRenderer.invoke(CHANNELS.listThreads, request),
	createThread: request => ipcRenderer.invoke(CHANNELS.createThread, request),
	openThread: request => ipcRenderer.invoke(CHANNELS.openThread, request),
	getThreadSnapshot: request =>
		ipcRenderer.invoke(CHANNELS.getThreadSnapshot, request),
	renameThread: request => ipcRenderer.invoke(CHANNELS.renameThread, request),
	archiveThread: request => ipcRenderer.invoke(CHANNELS.archiveThread, request),
	removeThread: request => ipcRenderer.invoke(CHANNELS.removeThread, request),
	deleteThreadHistory: request =>
		ipcRenderer.invoke(CHANNELS.deleteThreadHistory, request),
	promptThread: request => ipcRenderer.invoke(CHANNELS.promptThread, request),
	cancelThread: request => ipcRenderer.invoke(CHANNELS.cancelThread, request),
	setThreadMode: request => ipcRenderer.invoke(CHANNELS.setThreadMode, request),
	answerThreadPermission: request =>
		ipcRenderer.invoke(CHANNELS.answerThreadPermission, request),
	discoverSessions: request =>
		ipcRenderer.invoke(CHANNELS.discoverSessions, request),
	importSession: request => ipcRenderer.invoke(CHANNELS.importSession, request),
	getAppInfo: () => ipcRenderer.invoke(CHANNELS.getAppInfo, {}),
	getNanocoderRuntime: () =>
		ipcRenderer.invoke(CHANNELS.getNanocoderRuntime, {}),
	connectNanocoder: () => ipcRenderer.invoke(CHANNELS.connectNanocoder, {}),
	onProjectEvent: listener => {
		const handler = (_event: unknown, event: ProjectEvent) => listener(event);
		ipcRenderer.on(CHANNELS.projectEvent, handler);
		return () => ipcRenderer.removeListener(CHANNELS.projectEvent, handler);
	},
};

contextBridge.exposeInMainWorld('desktop', api);
