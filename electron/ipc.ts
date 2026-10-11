/**
 * The complete surface the renderer is allowed to touch.
 *
 * Every handler is local: file dialogs, disk reads/writes and the project
 * database. The update handlers delegate to updater.ts and the Discord ones to
 * discord.ts, the only modules that touch the network; nothing in this file
 * opens a socket itself.
 */

import { BrowserWindow, ClipboardItem, dialog, ipcMain, shell, app, clipboard } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as db from './storage/db';
import * as discord from './discord';
import * as archive from './replay/archive';
import * as replay from './replay/sidecar';
import * as updater from './updater';

type GetWindow = () => BrowserWindow | null;

const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }];
const ICON_FILTERS = [{ name: 'Icons', extensions: ['png', 'svg', 'webp'] }];
const SHIP_DATA_FILTERS = [{ name: 'Ship data', extensions: ['json', 'csv', 'yaml', 'yml'] }];
const PLAN_FILTERS = [{ name: 'WoWS Plan', extensions: ['wowsplan'] }];
const NOTICES = 'THIRD-PARTY-NOTICES.txt';
const REPLAY_FILTERS = [{ name: 'World of Warships replay', extensions: ['wowsreplay'] }];

function mimeFor(ext: string): string {
  const e = ext.toLowerCase().replace('.', '');
  if (e === 'png') return 'image/png';
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'webp') return 'image/webp';
  if (e === 'svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

interface PickedFile {
  name: string;
  ext: string;
  mime: string;
  dataUrl: string;
}

async function readAsPicked(file: string): Promise<PickedFile> {
  const buf = await fsp.readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mime = mimeFor(ext);
  return {
    name: path.basename(file, ext),
    ext,
    mime,
    dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
  };
}

function decodeDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Buffer.from(payload, 'base64');
}

export function registerIpc(getWindow: GetWindow): void {
  const handle = (channel: string, fn: (...args: any[]) => any) => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, data: await fn(...args) };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    });
  };

  /* ---------------- discord ---------------- */

  handle('discord:status', () => discord.status());
  handle('discord:link', async () => {
    const linked = await discord.link();
    // The sign-in happened in the browser; come back to where it was asked for.
    const w = getWindow();
    if (w?.isMinimized()) w.restore();
    w?.focus();
    return linked;
  });
  handle('discord:cancelLink', () => discord.cancelLink());
  handle('discord:unlink', () => discord.unlink());
  handle('discord:share', (opts: { channelId: string; title: string; note?: string; image: string }) =>
    discord.share(opts),
  );

  /* ---------------- window ---------------- */

  ipcMain.on('window:minimize', () => getWindow()?.minimize());
  ipcMain.on('window:maximize', () => {
    const w = getWindow();
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.on('window:close', () => getWindow()?.close());
  handle('window:isMaximized', () => !!getWindow()?.isMaximized());

  /* ---------------- app / storage ---------------- */

  handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    storageRoot: db.storageRoot(),
  }));
  handle('storage:usage', () => db.storageUsage());

  /* ---------------- updates ---------------- */
  handle('update:state', () => updater.updateState());
  handle('update:check', () => updater.checkForUpdates());
  handle('update:download', () => updater.downloadUpdate());
  handle('update:install', () => updater.installUpdate());
  handle('storage:reveal', () => {
    shell.openPath(db.storageRoot());
    return true;
  });
  /**
   * The third-party notices, shipped beside the app. MIT asks that the notice
   * travel with every copy, so it is a real file rather than only a string in
   * the About panel.
   */
  handle('storage:revealLicenses', async () => {
    const candidates = [
      process.resourcesPath ? path.join(process.resourcesPath, 'licenses', NOTICES) : '',
      path.join(app.getAppPath(), 'resources', 'licenses', NOTICES),
    ].filter(Boolean);
    for (const file of candidates) {
      if (await fsp.stat(file).then(() => true, () => false)) {
        await shell.openPath(file);
        return true;
      }
    }
    return false;
  });

  /* ---------------- settings ---------------- */

  handle('settings:get', () => db.getSettings());
  handle('settings:save', (settings: Record<string, unknown>) => db.saveSettings(settings));

  /* ---------------- projects ---------------- */

  handle('project:list', () => db.listProjects());
  handle('project:load', (id: string) => db.loadProject(id));
  handle('project:save', (project: any) => db.saveProject(project));
  handle('project:delete', (id: string) => db.deleteProject(id));
  handle('project:backup', (id: string, max: number) => db.createBackup(id, max));
  handle('project:backups', (id: string) => db.listBackups(id));

  handle('project:restoreBackup', async (file: string) => {
    const pkg = await db.readPackage(file);
    return db.importPackage(pkg, { newId: true });
  });

  handle('project:export', async (project: any) => {
    const w = getWindow();
    const safeName = String(project?.name ?? 'project').replace(/[\\/:*?"<>|]/g, '_');
    const res = await dialog.showSaveDialog(w!, {
      title: 'Export project',
      defaultPath: `${safeName}.wowsplan`,
      filters: PLAN_FILTERS,
    });
    if (res.canceled || !res.filePath) return null;
    const packed = await db.packProject(project);
    await db.writeFileAbsolute(res.filePath, packed);
    return res.filePath;
  });

  handle('project:import', async () => {
    const w = getWindow();
    const res = await dialog.showOpenDialog(w!, {
      title: 'Import project',
      filters: PLAN_FILTERS,
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const pkg = await db.readPackage(res.filePaths[0]);
    return db.importPackage(pkg, { newId: true });
  });

  /* ---------------- maps ---------------- */

  handle('map:list', () => db.listMaps());
  handle('capLayout:list', () => db.listCapLayouts());

  handle('map:pickImages', async () => {
    const w = getWindow();
    const res = await dialog.showOpenDialog(w!, {
      title: 'Import map image',
      filters: IMAGE_FILTERS,
      properties: ['openFile', 'multiSelections'],
    });
    if (res.canceled) return [];
    return Promise.all(res.filePaths.map(readAsPicked));
  });

  handle('map:create', async (record: any, dataUrl: string) => {
    const file = await db.writeMapAsset(record.id, record.ext ?? '.png', decodeDataUrl(dataUrl));
    const stored = { ...record, file };
    delete stored.ext;
    await db.saveMapRecord(stored);
    return stored;
  });

  handle('map:update', (record: any) => db.saveMapRecord(record));

  handle('map:replaceImage', async (id: string, ext: string, dataUrl: string) => {
    const maps = await db.listMaps();
    const rec = maps.find((m) => m.id === id);
    if (!rec) throw new Error('Map not found');
    const file = await db.writeMapAsset(id, ext, decodeDataUrl(dataUrl));
    const next = { ...rec, file, updatedAt: Date.now() };
    await db.saveMapRecord(next);
    return next;
  });

  handle('map:delete', (id: string) => db.deleteMap(id));

  handle('map:dataUrl', async (file: string, mime: string) => {
    const res = await db.readMapAssetResult(file);
    if (!('data' in res)) return { error: res.error, code: res.code };
    return { dataUrl: `data:${mime || mimeFor(path.extname(file))};base64,${res.data.toString('base64')}` };
  });

  /* ---------------- ships ---------------- */

  handle('ship:list', () => db.listShips());
  handle('ship:saveAll', (ships: any[]) => db.saveShips(ships));

  handle('ship:pickDataFile', async () => {
    const w = getWindow();
    const res = await dialog.showOpenDialog(w!, {
      title: 'Import ship database',
      filters: SHIP_DATA_FILTERS,
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const file = res.filePaths[0];
    return {
      name: path.basename(file),
      ext: path.extname(file).toLowerCase(),
      text: await fsp.readFile(file, 'utf8'),
    };
  });

  handle('ship:exportData', async (text: string, ext: string) => {
    const w = getWindow();
    const res = await dialog.showSaveDialog(w!, {
      title: 'Export ship database',
      defaultPath: `wows-ships${ext}`,
      filters: SHIP_DATA_FILTERS,
    });
    if (res.canceled || !res.filePath) return null;
    await fsp.writeFile(res.filePath, text, 'utf8');
    return res.filePath;
  });

  /* ---------------- ship icons ---------------- */

  handle('icon:list', () => db.listIcons());

  handle('icon:pickImages', async () => {
    const w = getWindow();
    const res = await dialog.showOpenDialog(w!, {
      title: 'Import ship icons',
      filters: ICON_FILTERS,
      properties: ['openFile', 'multiSelections'],
    });
    if (res.canceled) return [];
    return Promise.all(res.filePaths.map(readAsPicked));
  });

  handle('icon:create', async (record: any, dataUrl: string) => {
    const file = await db.writeIconAsset(record.id, record.ext ?? '.png', decodeDataUrl(dataUrl));
    const stored = { ...record, file };
    delete stored.ext;
    await db.saveIconRecord(stored);
    return stored;
  });

  handle('icon:delete', (id: string) => db.deleteIcon(id));

  handle('icon:dataUrl', async (file: string, mime: string) => {
    const res = await db.readIconAssetResult(file);
    if (!('data' in res)) return { error: res.error, code: res.code };
    return { dataUrl: `data:${mime || mimeFor(path.extname(file))};base64,${res.data.toString('base64')}` };
  });

  /* ---------------- image / vector export ---------------- */

  handle('export:image', async (dataUrl: string, suggestedName: string, ext: string) => {
    const w = getWindow();
    const res = await dialog.showSaveDialog(w!, {
      title: 'Export image',
      defaultPath: `${suggestedName}${ext}`,
      filters: [{ name: ext.replace('.', '').toUpperCase(), extensions: [ext.replace('.', '')] }],
    });
    if (res.canceled || !res.filePath) return null;
    await db.writeFileAbsolute(res.filePath, decodeDataUrl(dataUrl));
    return res.filePath;
  });

  handle('export:text', async (text: string, suggestedName: string, ext: string) => {
    const w = getWindow();
    const res = await dialog.showSaveDialog(w!, {
      title: 'Export file',
      defaultPath: `${suggestedName}${ext}`,
      filters: [{ name: ext.replace('.', '').toUpperCase(), extensions: [ext.replace('.', '')] }],
    });
    if (res.canceled || !res.filePath) return null;
    await fsp.writeFile(res.filePath, text, 'utf8');
    return res.filePath;
  });

  handle('clipboard:writeImage', async (dataUrl: string) => {
    const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/png';
    const blob = new Blob([Uint8Array.from(decodeDataUrl(dataUrl))], { type: mime });
    await clipboard.write([new ClipboardItem({ [mime]: blob })]);
    return true;
  });

  /* ---------------- replay viewer ---------------- */

  handle('replay:status', () => replay.sidecarStatus());
  handle('replay:checkGameDir', (dir: string) => replay.checkGameDir(dir));
  handle('replay:pickGameDir', async () => {
    const res = await dialog.showOpenDialog(getWindow()!, {
      title: 'Select your World of Warships folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const dir = res.filePaths[0];
    return { dir, ...replay.checkGameDir(dir) };
  });
  /* ---- library ---- */

  handle('replay:defaultRoot', () => path.join(app.getPath('documents'), 'WoWs Tactics Suite', 'Replays'));
  handle('replay:pickRoot', async () => {
    const res = await dialog.showOpenDialog(getWindow()!, {
      title: 'Choose a folder for your replays',
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  });
  handle('replay:configure', (opts: { root: string; gameDir?: string }) => archive.configure(opts));
  handle('replay:list', () => archive.listLibrary());
  handle('replay:remove', (id: string) => archive.removeReplay(id));
  handle('replay:scanGame', (gameDir: string, limit?: number) => archive.scanGameReplays(gameDir, limit));
  handle('replay:import', (paths: string[], collection?: string | null) => archive.importReplays(paths, collection ?? null));
  handle('replay:pickReplays', async (collection?: string | null) => {
    const res = await dialog.showOpenDialog(getWindow()!, {
      title: 'Add replays to the library',
      filters: REPLAY_FILTERS,
      properties: ['openFile', 'multiSelections'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return archive.importReplays(res.filePaths, collection ?? null);
  });
  handle('replay:createCollection', () => archive.createUntitledCollection());
  handle('replay:renameCollection', (from: string, to: string) => archive.renameCollection(from, to));
  handle('replay:deleteCollection', (name: string) => archive.deleteCollection(name));
  handle('replay:move', (ids: string[], collection: string | null) => archive.moveReplays(ids, collection));
  handle('replay:revealLibrary', async () => {
    const root = archive.currentRoot();
    if (root) await shell.openPath(root);
    return !!root;
  });

  /* ---- playback ---- */

  /**
   * The timeline comes back as bytes in the reply rather than as a file the
   * renderer reads: it is 7-41 MB, wanted whole, and never needed again once
   * the viewer closes. A replay not yet baked is baked first, with progress on
   * `replay:progress`.
   *
   * The replay is named by library id, not by path: the renderer never gets
   * to hand the sidecar an arbitrary file to open.
   */
  handle('replay:load', (opts: { id: string; rebake?: boolean }) => archive.loadTimeline(opts.id, { rebake: opts.rebake }));
  handle('replay:cancelBake', () => {
    replay.cancelBake();
    return true;
  });

  /* ---------------- generic confirm dialog ---------------- */

  handle('dialog:confirm', async (opts: { title: string; message: string; detail?: string; confirmLabel?: string; danger?: boolean }) => {
    const w = getWindow();
    const res = await dialog.showMessageBox(w!, {
      type: opts.danger ? 'warning' : 'question',
      buttons: [opts.confirmLabel ?? 'OK', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: opts.title,
      message: opts.message,
      detail: opts.detail,
      noLink: true,
    });
    return res.response === 0;
  });
}
