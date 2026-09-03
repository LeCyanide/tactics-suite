import { app, BrowserWindow, shell, Menu } from 'electron';
import path from 'node:path';
import { ensureDirs, storageRoot, sweepTempFiles } from './storage/db';
import { registerIpc } from './ipc';

// This application is entirely local. Disabling remote content behaviours
// keeps it honest: nothing here ever wants the network.
app.commandLine.appendSwitch('disable-http-cache');

const isDev = !!process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#0d1117',
    title: 'WoWS Tactics Toolkit',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  // The renderer draws its own title bar; there is no native menu.
  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  const send = (channel: string, payload?: unknown) => mainWindow?.webContents.send(channel, payload);
  mainWindow.on('maximize', () => send('window:state', { maximized: true }));
  mainWindow.on('unmaximize', () => send('window:state', { maximized: false }));

  // Never navigate away, never open a browser window from page content.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(process.env.VITE_DEV_SERVER_URL ?? 'file://')) event.preventDefault();
  });

  if (isDev) {
    // Surface renderer problems in the terminal during development.
    mainWindow.webContents.on('console-message', (event) => {
      // eslint-disable-next-line no-console
      console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    });
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      // eslint-disable-next-line no-console
      console.error('[did-fail-load]', code, desc, url);
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      // eslint-disable-next-line no-console
      console.error('[render-process-gone]', details.reason);
    });
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  ensureDirs();
  // Housekeeping only: clears temp files orphaned by a crash mid-write.
  // It runs alongside startup and can never hold it up or fail it.
  void sweepTempFiles().catch(() => undefined);
  registerIpc(() => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  if (isDev) {
    // eslint-disable-next-line no-console
    console.log('[storage]', storageRoot());
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
