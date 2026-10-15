import { contextBridge, ipcRenderer } from 'electron';
import type {
  ConfigureResult,
  FoundReplay,
  ImportOutcome,
  LibraryListing,
  LibraryReplay,
  ReplayCollection,
} from './replay/archive';
import type { GameDirCheck, LibraryEvent, ReplayProbe, SidecarEvent, SidecarStatus } from './replay/sidecar';
import type { UpdateState } from './updater';
import type { DiscordBot, DiscordChannel, DiscordGuild, DiscordStatus } from './discord';

export type {
  ConfigureResult,
  DiscordChannel,
  DiscordGuild,
  DiscordStatus,
  DiscordBot,
  FoundReplay,
  GameDirCheck,
  ImportOutcome,
  LibraryEvent,
  LibraryListing,
  LibraryReplay,
  ReplayCollection,
  ReplayProbe,
  SidecarEvent,
  SidecarStatus,
  UpdateState,
};

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
  updates: {
    state: () => call<UpdateState>('update:state'),
    check: () => call<UpdateState>('update:check'),
    download: () => call<void>('update:download'),
    install: () => call<void>('update:install'),
    onStateChange: (cb: (s: UpdateState) => void) => {
      const listener = (_e: unknown, s: UpdateState) => cb(s);
      ipcRenderer.on('update:state', listener);
      return () => {
        ipcRenderer.off('update:state', listener);
      };
    },
  },
  storage: {
    usage: () => call<{ path: string; bytes: number; files: number }[]>('storage:usage'),
    reveal: () => call<boolean>('storage:reveal'),
    /** Opens the third-party notices file. False when it is not shipped. */
    revealLicenses: () => call<boolean>('storage:revealLicenses'),
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
  discord: {
    status: () => call<DiscordStatus>('discord:status'),
    /** Opens the browser to sign in; settles once it comes back, or is given up on. */
    link: () => call<DiscordStatus>('discord:link'),
    cancelLink: () => call<void>('discord:cancelLink'),
    unlink: () => call<DiscordStatus>('discord:unlink'),
    /** Which bot this copy talks to. */
    bot: () => call<DiscordBot>('discord:bot'),
    /** Another bot's address, or null for the built-in one. Switching disconnects. */
    setBot: (url: string | null) => call<DiscordBot>('discord:setBot', url),
    share: (opts: { channelId: string; title: string; note?: string; image: string }) =>
      call<string | null>('discord:share', opts),
  },
  exporter: {
    image: (dataUrl: string, name: string, ext: string) => call<string | null>('export:image', dataUrl, name, ext),
    text: (text: string, name: string, ext: string) => call<string | null>('export:text', text, name, ext),
    toClipboard: (dataUrl: string) => call<boolean>('clipboard:writeImage', dataUrl),
  },
  replay: {
    /** Whether the replay viewer add-on is present, and why not if it is not. */
    status: () => call<SidecarStatus>('replay:status'),
    checkGameDir: (dir: string) => call<GameDirCheck>('replay:checkGameDir', dir),
    pickGameDir: () => call<({ dir: string } & GameDirCheck) | null>('replay:pickGameDir'),

    /* library */
    /** Where the library goes if the user takes the suggestion. */
    defaultRoot: () => call<string>('replay:defaultRoot'),
    pickRoot: () => call<string | null>('replay:pickRoot'),
    /** Points the library at a folder and the game install. Call on start and on every change. */
    configure: (opts: { root: string; gameDir?: string }) => call<ConfigureResult>('replay:configure', opts),
    /** Reads the folder, picking up anything changed outside the app. */
    list: () => call<LibraryListing>('replay:list'),
    /** Opens a file picker and imports whatever is chosen. Null if cancelled. */
    pickReplays: (collection?: string | null) => call<ImportOutcome | null>('replay:pickReplays', collection ?? null),
    importPaths: (paths: string[], collection?: string | null) =>
      call<ImportOutcome>('replay:import', paths, collection ?? null),
    /** Deletes the file and its baked timeline. */
    remove: (id: string) => call<LibraryListing>('replay:remove', id),
    /** Makes a folder named "New collection", or "New collection (2)" if taken. */
    createCollection: () => call<ReplayCollection>('replay:createCollection'),
    renameCollection: (from: string, to: string) => call<ReplayCollection>('replay:renameCollection', from, to),
    /** Deletes the folder only; its replays go back to unsorted. */
    deleteCollection: (name: string) => call<{ kept: boolean }>('replay:deleteCollection', name),
    /** Moves replays into a collection, or back to unsorted with null. */
    move: (ids: string[], collection: string | null) => call<LibraryListing>('replay:move', ids, collection),
    /** Lists the game's own recorded replays. Looks only; importing is separate. */
    scanGame: (gameDir: string, limit?: number) => call<FoundReplay[]>('replay:scanGame', gameDir, limit),
    revealLibrary: () => call<boolean>('replay:revealLibrary'),
    onLibrary: (cb: (e: LibraryEvent) => void) => {
      const listener = (_e: unknown, event: LibraryEvent) => cb(event);
      ipcRenderer.on('replay:library', listener);
      return () => {
        ipcRenderer.off('replay:library', listener);
      };
    },

    /* playback */
    /**
     * The timeline for a replay, baked first if it has not been. Seconds of
     * work in that case, so subscribe with `onProgress` first.
     */
    load: (opts: { id: string; rebake?: boolean }) => call<Uint8Array>('replay:load', opts),
    cancelBake: () => call<boolean>('replay:cancelBake'),
    onProgress: (cb: (e: SidecarEvent) => void) => {
      const listener = (_e: unknown, event: SidecarEvent) => cb(event);
      ipcRenderer.on('replay:progress', listener);
      return () => {
        ipcRenderer.off('replay:progress', listener);
      };
    },
  },
  dialog: {
    confirm: (opts: { title: string; message: string; detail?: string; confirmLabel?: string; danger?: boolean }) =>
      call<boolean>('dialog:confirm', opts),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type PlannerApi = typeof api;
