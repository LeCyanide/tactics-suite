import { contextBridge, ipcRenderer } from 'electron';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * One stored image, or why the disk would not give it up. The reason is
 * carried rather than flattened to null so a failed read can be told apart
 * from a record that never had an image.
 */
export type AssetResult = { dataUrl: string } | { error: string; code: string };

/** Unwraps the {ok,data} envelope so callers get plain values or a throw. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Result<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

const api = {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => call<boolean>('window:isMaximized'),
    onStateChange: (cb: (s: { maximized: boolean }) => void) => {
      const listener = (_e: unknown, s: { maximized: boolean }) => cb(s);
      ipcRenderer.on('window:state', listener);
      return () => {
        ipcRenderer.off('window:state', listener);
      };
    },
  },
  app: {
    info: () => call<any>('app:info'),
  },
  storage: {
    usage: () => call<{ path: string; bytes: number; files: number }[]>('storage:usage'),
    reveal: () => call<boolean>('storage:reveal'),
  },
  settings: {
    get: () => call<Record<string, unknown>>('settings:get'),
    save: (s: Record<string, unknown>) => call<void>('settings:save', s),
  },
  projects: {
    list: () => call<any[]>('project:list'),
    load: (id: string) => call<any>('project:load', id),
    save: (project: unknown) => call<void>('project:save', project),
    remove: (id: string) => call<void>('project:delete', id),
    backup: (id: string, max: number) => call<string | null>('project:backup', id, max),
    backups: (id: string) => call<{ file: string; name: string; size: number; mtime: number }[]>('project:backups', id),
    restoreBackup: (file: string) => call<any>('project:restoreBackup', file),
    exportFile: (project: unknown) => call<string | null>('project:export', project),
    importFile: () => call<any>('project:import'),
  },
  maps: {
    list: () => call<any[]>('map:list'),
    pickImages: () => call<{ name: string; ext: string; mime: string; dataUrl: string }[]>('map:pickImages'),
    create: (record: unknown, dataUrl: string) => call<any>('map:create', record, dataUrl),
    update: (record: unknown) => call<any[]>('map:update', record),
    replaceImage: (id: string, ext: string, dataUrl: string) => call<any>('map:replaceImage', id, ext, dataUrl),
    remove: (id: string) => call<any[]>('map:delete', id),
    dataUrl: (file: string, mime: string) => call<AssetResult>('map:dataUrl', file, mime),
  },
  capLayouts: {
    list: () => call<any[]>('capLayout:list'),
  },
  ships: {
    list: () => call<any[]>('ship:list'),
    saveAll: (ships: unknown[]) => call<void>('ship:saveAll', ships),
    pickDataFile: () => call<{ name: string; ext: string; text: string } | null>('ship:pickDataFile'),
    exportData: (text: string, ext: string) => call<string | null>('ship:exportData', text, ext),
  },
  icons: {
    list: () => call<any[]>('icon:list'),
    pickImages: () => call<{ name: string; ext: string; mime: string; dataUrl: string }[]>('icon:pickImages'),
    create: (record: unknown, dataUrl: string) => call<any>('icon:create', record, dataUrl),
    remove: (id: string) => call<any[]>('icon:delete', id),
    dataUrl: (file: string, mime: string) => call<AssetResult>('icon:dataUrl', file, mime),
  },
  exporter: {
    image: (dataUrl: string, name: string, ext: string) => call<string | null>('export:image', dataUrl, name, ext),
    text: (text: string, name: string, ext: string) => call<string | null>('export:text', text, name, ext),
    toClipboard: (dataUrl: string) => call<boolean>('clipboard:writeImage', dataUrl),
  },
  dialog: {
    confirm: (opts: { title: string; message: string; detail?: string; confirmLabel?: string; danger?: boolean }) =>
      call<boolean>('dialog:confirm', opts),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type PlannerApi = typeof api;
