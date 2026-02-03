import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

const createWindow = async () => {
	const win = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 1100,
		minHeight: 720,
		show: false,
		title: 'Founders Zoo',
		frame: false,
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	win.maximize();

	win.once('ready-to-show', () => win.show());

	if (devServerUrl) {
		await win.loadURL(devServerUrl);
		win.webContents.openDevTools({ mode: 'detach' });
	} else {
		await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
	}

	win.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: 'deny' };
	});
};

app.whenReady().then(async () => {
	await createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			void createWindow();
		}
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});
