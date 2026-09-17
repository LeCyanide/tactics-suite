/**
 * Electron main process for the IPC check.
 *
 * Registers the real IPC surface against a throwaway store, opens a hidden
 * window with the real preload, and relays what the renderer reports back to
 * stdout. Nothing here is a stand-in: the point of the exercise is the actual
 * ipcMain/contextBridge path, which neither dev preview can reach.
 */

import { BrowserWindow, app, ipcMain } from 'electron';
import path from 'node:path';
import { registerIpc } from '../electron/ipc';
import { initSidecar, shutdownSidecar } from '../electron/replay/sidecar';
import { ensureDirs } from '../electron/storage/db';

// Bundled as CommonJS, so `__dirname` is the emitted file's folder.
declare const __dirname: string;
const here = __dirname;

// Rendering is irrelevant here and a GPU process only adds ways to fail on a
// machine without a display.
app.disableHardwareAcceleration();

let failures = 0;

ipcMain.on('check:result', (_e, r: { label: string; ok: boolean; detail?: unknown }) => {
  if (!r.ok) failures++;
  const detail = r.detail === undefined ? '' : ` -> ${JSON.stringify(r.detail)}`;
  console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.label}${detail}`);
});
ipcMain.on('check:info', (_e, text: string) => console.log(`  info  ${text}`));
ipcMain.on('check:done', () => {
  console.log(failures === 0 ? '\nIPC checks passed\n' : `\n${failures} IPC check(s) failed\n`);
  shutdownSidecar();
  app.exit(failures === 0 ? 0 : 1);
});
ipcMain.on('check:fatal', (_e, text: string) => {
  console.log(`  FAIL  ${text}`);
  shutdownSidecar();
  app.exit(1);
});

void app.whenReady().then(() => {
  ensureDirs();

  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(here, 'ipc-check-preload.js'), contextIsolation: true, sandbox: false },
  });

  registerIpc(() => win);
  initSidecar(() => win);

  win.webContents.on('console-message', (_e, _level, message) => {
    if (message.startsWith('[check]')) console.log(`  ${message.slice(7).trim()}`);
  });

  void win.loadFile(path.join(here, 'ipc-check.html'));
});

// A renderer that throws before reporting would otherwise hang forever.
setTimeout(() => {
  console.log('  FAIL  the renderer never finished');
  shutdownSidecar();
  app.exit(1);
}, 180_000);
