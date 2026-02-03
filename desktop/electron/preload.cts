import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
	hidePanel: () => ipcRenderer.send('desktop:hide-panel')
});
