import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
	hidePanel: () => ipcRenderer.send('desktop:hide-panel'),
	setHudSize: (width: number, height: number) =>
		ipcRenderer.send('hud:set-size', { width, height })
});
