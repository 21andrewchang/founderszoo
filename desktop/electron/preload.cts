import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
	isDesktop: true,
	getShortcut: () => ipcRenderer.invoke('desktop-shortcut:get'),
	setShortcut: (shortcut: string) => ipcRenderer.invoke('desktop-shortcut:set', shortcut)
});
