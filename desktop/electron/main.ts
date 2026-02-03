import { app, BrowserWindow, globalShortcut, ipcMain, shell } from 'electron';
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

	return win;
};

app.whenReady().then(async () => {
	const mainWin = await createWindow();
	let panelWin: BrowserWindow | null = null;

	const ensurePanelWindow = async () => {
		if (panelWin && !panelWin.isDestroyed()) {
			return panelWin;
		}

		panelWin = new BrowserWindow({
			width: 720,
			height: 520,
			resizable: false,
			show: false,
			frame: false,
			transparent: true,
			alwaysOnTop: true,
			skipTaskbar: true,
			focusable: true,
			title: 'Quick Panel',
			vibrancy: 'popover',
			webPreferences: {
				preload: path.join(__dirname, 'preload.cjs'),
				contextIsolation: true,
				nodeIntegration: false
			}
		});

		if (process.platform === 'darwin') {
			panelWin.setWindowButtonVisibility(false);
		}

		panelWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
		panelWin.setFullScreenable(false);

		panelWin.on('blur', () => {
			if (panelWin && panelWin.isVisible()) {
				panelWin.hide();
			}
		});

		if (devServerUrl) {
			await panelWin.loadURL(`${devServerUrl}?view=panel`);
		} else {
			await panelWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
				query: { view: 'panel' }
			});
		}

		panelWin.webContents.setWindowOpenHandler(({ url }) => {
			shell.openExternal(url);
			return { action: 'deny' };
		});

		return panelWin;
	};

	ipcMain.on('desktop:hide-panel', () => {
		if (panelWin && !panelWin.isDestroyed()) {
			panelWin.hide();
		}
	});

	let lastToggleAt = 0;
	let toggleInFlight = false;
	const togglePanel = async () => {
		const now = Date.now();
		if (toggleInFlight || now - lastToggleAt < 50) {
			return;
		}
		lastToggleAt = now;
		toggleInFlight = true;
		setTimeout(() => {
			toggleInFlight = false;
		}, 40);

		const win = await ensurePanelWindow();
		if (win.isVisible()) {
			win.hide();
			return;
		}
		win.center();
		win.show();
		win.focus();
	};

	const registered = globalShortcut.register('CommandOrControl+K', () => {
		void togglePanel();
	});
	if (!registered) {
		console.warn('Global shortcut registration failed.');
	}

	// Pre-warm panel window so toggle feels instant.
	void ensurePanelWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			void createWindow();
		}
	});

	app.on('will-quit', () => {
		globalShortcut.unregisterAll();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});
