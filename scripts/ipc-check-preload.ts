/**
 * Preload for the IPC check.
 *
 * Imports the application's real preload for its side effect — exposing
 * `window.api` over contextBridge — so the checks run against the same bridge
 * the app uses rather than a copy of it. Everything else here is scaffolding
 * for reporting results back out.
 */

import { contextBridge, ipcRenderer } from 'electron';
import '../electron/preload';

contextBridge.exposeInMainWorld('__check', {
  result: (r: { label: string; ok: boolean; detail?: unknown }) => ipcRenderer.send('check:result', r),
  info: (text: string) => ipcRenderer.send('check:info', text),
  done: () => ipcRenderer.send('check:done'),
  fatal: (text: string) => ipcRenderer.send('check:fatal', text),
});

// The renderer has no `process`, so the inputs have to be handed across.
contextBridge.exposeInMainWorld('__env', {
  replay: process.env.WOWSPLAN_REPLAY ?? '',
  gameDir: process.env.WOWSPLAN_GAME_DIR ?? '',
  replayDir: process.env.WOWSPLAN_REPLAY_DIR ?? '',
});
