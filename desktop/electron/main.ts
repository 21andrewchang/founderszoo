import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { UiohookKey, uIOhook } from 'uiohook-napi';
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

	const hidePanel = () => {
		if (panelWin && !panelWin.isDestroyed()) {
			panelWin.hide();
		}
	};

	ipcMain.on('desktop:hide-panel', () => {
		hidePanel();
	});

	const togglePanel = async () => {
		const win = await ensurePanelWindow();
		if (win.isVisible()) {
			win.hide();
			return;
		}
		win.center();
		win.show();
		win.focus();
	};

	let pendingCmdK = false;
	uIOhook.on('keydown', (event) => {
		if (event.keycode === UiohookKey.K && event.metaKey && !pendingCmdK) {
			pendingCmdK = true;
		}
	});
	uIOhook.on('keyup', (event) => {
		if (event.keycode !== UiohookKey.K || !pendingCmdK) return;
		pendingCmdK = false;

		if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) {
			hidePanel();
			return;
		}

		void togglePanel();
	});
	uIOhook.start();

	// Pre-warm panel window so toggle feels instant.
	void ensurePanelWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			void createWindow();
		}
	});

	app.on('will-quit', () => {
		uIOhook.stop();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});
