import { app, BrowserWindow, globalShortcut, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const DEFAULT_SHORTCUT = 'Command+Control+Alt+Shift+K';

type DesktopSettings = {
	shortcut?: string;
};

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

const readSettings = async (): Promise<DesktopSettings> => {
	try {
		const raw = await fs.readFile(settingsPath(), 'utf8');
		return JSON.parse(raw) as DesktopSettings;
	} catch {
		return {};
	}
};

const writeSettings = async (next: DesktopSettings) => {
	try {
		await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
	} catch (error) {
		console.error('settings write error', error);
	}
};

const hasModifier = (accelerator: string) =>
	/(Command|Control|CommandOrControl|Alt|Option|Shift|Super)/.test(accelerator);

const isAscii = (value: string) => /^[\x20-\x7E]+$/.test(value);

const isValidAccelerator = (accelerator: string) =>
	Boolean(
		accelerator && accelerator.trim().length > 0 && hasModifier(accelerator) && isAscii(accelerator)
	);

let currentShortcut: string | null = null;

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

	win.once('ready-to-show', () => {
		win.show();
		win.maximize();
	});

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
	if (process.platform === 'darwin') {
		app.dock?.show();
	}
	app.setLoginItemSettings({
		openAtLogin: true
	});
	const mainWin = await createWindow();

	const focusMainWindow = () => {
		if (mainWin.isMinimized()) {
			mainWin.restore();
		}
		if (!mainWin.isVisible()) {
			mainWin.show();
		}
		app.focus({ steal: true });
		mainWin.moveTop();
		mainWin.setAlwaysOnTop(true);
		mainWin.focus();
		mainWin.setAlwaysOnTop(false);
	};

	const handleCtrlK = () => {
		if (mainWin.isVisible() && !mainWin.isMinimized() && mainWin.isFocused()) {
			mainWin.hide();
			return;
		}
		focusMainWindow();
	};

	const applyShortcut = (nextShortcut: string) => {
		if (!isValidAccelerator(nextShortcut)) return false;
		const previous = currentShortcut;
		if (previous) {
			globalShortcut.unregister(previous);
		}
		const ok = globalShortcut.register(nextShortcut, handleCtrlK);
		if (!ok) {
			if (previous) {
				globalShortcut.register(previous, handleCtrlK);
			}
			return false;
		}
		currentShortcut = nextShortcut;
		return true;
	};

	const settings = await readSettings();
	const initialShortcut =
		settings.shortcut && isValidAccelerator(settings.shortcut)
			? settings.shortcut
			: DEFAULT_SHORTCUT;
	applyShortcut(initialShortcut);

	ipcMain.handle('desktop-shortcut:get', () => currentShortcut ?? DEFAULT_SHORTCUT);
	ipcMain.handle('desktop-shortcut:set', async (_event, shortcut: string) => {
		const nextShortcut = String(shortcut ?? '').trim();
		if (!isValidAccelerator(nextShortcut)) {
			return {
				ok: false,
				shortcut: currentShortcut ?? DEFAULT_SHORTCUT,
				message: 'Shortcut must include a modifier key.'
			};
		}
		const ok = applyShortcut(nextShortcut);
		if (!ok) {
			return {
				ok: false,
				shortcut: currentShortcut ?? DEFAULT_SHORTCUT,
				message: 'That shortcut is unavailable.'
			};
		}
		await writeSettings({ shortcut: currentShortcut ?? DEFAULT_SHORTCUT });
		return { ok: true, shortcut: currentShortcut ?? DEFAULT_SHORTCUT };
	});

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
