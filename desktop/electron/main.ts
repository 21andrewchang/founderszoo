import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from 'electron';
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

	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	win.setFullScreenable(false);

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
	let hudWin: BrowserWindow | null = null;

	const ensureHudWindow = async () => {
		if (hudWin && !hudWin.isDestroyed()) {
			return hudWin;
		}

		hudWin = new BrowserWindow({
			width: 320,
			height: 120,
			resizable: false,
			show: false,
			frame: false,
			transparent: true,
			alwaysOnTop: true,
			skipTaskbar: true,
			focusable: false,
			title: 'Reminder HUD',
			backgroundColor: '#00000000',
			webPreferences: {
				preload: path.join(__dirname, 'preload.cjs'),
				contextIsolation: true,
				nodeIntegration: false
			}
		});

		hudWin.setHasShadow(false);

		if (process.platform === 'darwin') {
			hudWin.setWindowButtonVisibility(false);
		}

		hudWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
		hudWin.setFullScreenable(false);

		if (devServerUrl) {
			await hudWin.loadURL(`${devServerUrl}?view=panel`);
		} else {
			await hudWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
				query: { view: 'panel' }
			});
		}

		hudWin.webContents.setWindowOpenHandler(({ url }) => {
			shell.openExternal(url);
			return { action: 'deny' };
		});

		return hudWin;
	};

	const positionHudTopRight = () => {
		if (!hudWin || hudWin.isDestroyed()) return;
		const display = screen.getPrimaryDisplay();
		const { x, y, width } = display.workArea;
		const { width: winWidth, height: winHeight } = hudWin.getBounds();
		const margin = 20;
		const targetX = x + width - winWidth - margin;
		const targetY = y + margin;
		hudWin.setPosition(targetX, targetY, false);
	};

	ipcMain.on('hud:set-size', (_event, payload: { width: number; height: number }) => {
		if (!hudWin || hudWin.isDestroyed()) return;
		const width = Math.max(200, Math.ceil(payload.width) + 8);
		const height = Math.max(80, Math.ceil(payload.height) + 8);
		hudWin.setContentSize(width, height, false);
		positionHudTopRight();
	});

	const showHud = async (focus = false) => {
		const hud = await ensureHudWindow();
		positionHudTopRight();
		if (focus) {
			hud.setFocusable(true);
			hud.show();
			hud.focus();
		} else {
			hud.setFocusable(false);
			hud.showInactive();
		}
	};

	const hideHud = () => {
		if (hudWin && !hudWin.isDestroyed()) {
			hudWin.hide();
		}
	};

	const focusMainWindow = () => {
		if (mainWin.isMinimized()) {
			mainWin.restore();
		}
		if (!mainWin.isVisible()) {
			mainWin.show();
		}
		app.focus({ steal: true });
		mainWin.moveTop();
		// Toggle always-on-top to ensure focus on macOS.
		mainWin.setAlwaysOnTop(true);
		mainWin.focus();
		mainWin.setAlwaysOnTop(false);
	};

	const handleCtrlK = () => {
		if (mainWin.isVisible() && !mainWin.isMinimized() && mainWin.isFocused()) {
			mainWin.hide();
			void showHud(true);
			return;
		}

		hideHud();
		focusMainWindow();
	};
	globalShortcut.register('Control+K', handleCtrlK);

	// Pre-warm reminder HUD and keep it visible.
	await showHud(false);

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
