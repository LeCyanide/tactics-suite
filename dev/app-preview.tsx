/**
 * Runs the whole application in a plain browser, against a stubbed `window.api`.
 *
 *   npm run dev:replay -- <file.wtreply>
 *   then open /dev/app-preview.html
 *
 * The real app only runs inside Electron, where every piece of state arrives
 * over IPC. That makes the UI awkward to look at while building it, so this
 * stands in a fake main process: libraries come from `seed/`, the project is
 * synthesised, and the replay archive holds the one timeline the dev server was
 * started with.
 *
 * What this proves is the renderer — the mode switch, the replay sidebar, and
 * the layer drawing over a real page. What it cannot prove is the IPC itself,
 * so a green result here still leaves the Electron hop untested.
 */

import { createProject } from '@/lib/factory';
import type { GameMap, Project } from '@/types/model';

/* ------------------------------------------------------------------ */
/* Fake main process                                                   */
/* ------------------------------------------------------------------ */

const json = <T,>(url: string, fallback: T): Promise<T> =>
  fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<T>) : fallback))
    .catch(() => fallback);

/** Seed libraries, read straight from the repository's `seed/` folder. */
async function seedMaps(): Promise<GameMap[]> {
  const raw = await json<GameMap[] | { maps?: GameMap[] }>('/seed/maps/maps.json', []);
  const list = Array.isArray(raw) ? raw : (raw.maps ?? []);
  return list.filter((m) => !(m as GameMap & { archived?: boolean }).archived);
}

async function dataUrl(path: string, mime: string): Promise<string> {
  const blob = await (await fetch(path)).blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]*;/, `data:${mime};`));
    reader.readAsDataURL(blob);
  });
}

const settings: Record<string, unknown> = {
  theme: 'dark',
  // Preset so the sidebar does not open on the "choose your game folder" path;
  // the stubbed bake never looks at it.
  wowsGameDir: 'Z:\\Wargambling\\World_of_Warships',
};

let project: Project | null = null;

async function makeProject(): Promise<Project> {
  const maps = await seedMaps();
  // The replay the dev server is serving decides which map the page shows, so
  // the layer is drawn over the ground it was actually recorded on.
  const head = await fetch('/__timeline', { headers: { range: 'bytes=0-4095' } });
  let space = 'spaces/40_Okinawa';
  if (head.ok) {
    const bytes = new Uint8Array(await head.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const headerLen = view.getUint32(32, true);
    try {
      const header = JSON.parse(new TextDecoder().decode(bytes.subarray(36, 36 + headerLen)));
      space = header?.map?.name ?? space;
    } catch {
      /* fall back to Okinawa */
    }
  }
  const map = maps.find((m) => m.spaceName === space) ?? maps[0]!;
  const p = createProject('Replay preview');
  p.pages[0]!.mapId = map.id;
  p.pages[0]!.name = map.name;
  return p;
}

const api = {
  window: {
    minimize: () => {},
    maximize: () => {},
    close: () => {},
    isMaximized: async () => false,
    onStateChange: () => () => {},
  },
  app: { info: async () => ({ version: 'preview', name: 'preview', platform: 'browser' }) },
  updates: {
    state: async () => ({ status: 'disabled', reason: 'preview' }),
    check: async () => ({ status: 'disabled' }),
    download: async () => {},
    install: async () => {},
    onStateChange: () => () => {},
  },
  storage: { usage: async () => [], reveal: async () => true },
  settings: {
    get: async () => settings,
    save: async (s: Record<string, unknown>) => void Object.assign(settings, s),
  },
  projects: {
    list: async () => (project ? [{ id: project.id, name: project.name, updatedAt: project.updatedAt }] : []),
    load: async () => project,
    save: async (p: unknown) => void (project = p as Project),
    remove: async () => {},
    backup: async () => null,
    backups: async () => [],
    restoreBackup: async () => null,
    exportFile: async () => null,
    importFile: async () => null,
  },
  maps: {
    list: seedMaps,
    pickImages: async () => [],
    create: async () => null,
    update: async () => [],
    replaceImage: async () => null,
    remove: async () => [],
    dataUrl: async (file: string, mime: string) => ({ dataUrl: await dataUrl(`/seed/maps/assets/${file}`, mime) }),
  },
  capLayouts: {
    list: async () => {
      const doc = await json<{ layouts?: unknown[] } | unknown[]>('/seed/maps/cap-layouts.json', []);
      return Array.isArray(doc) ? doc : (doc.layouts ?? []);
    },
  },
  ships: {
    list: () => json('/seed/ships/ships.json', []),
    saveAll: async () => {},
    pickDataFile: async () => null,
    exportData: async () => null,
  },
  icons: {
    list: () => json('/seed/ships/icons.json', []),
    pickImages: async () => [],
    create: async () => null,
    remove: async () => [],
    dataUrl: async (file: string, mime: string) => ({ dataUrl: await dataUrl(`/seed/ships/icons/${file}`, mime) }),
  },
  exporter: { image: async () => null, text: async () => null, toClipboard: async () => true },
  dialog: { confirm: async (o: { message: string }) => window.confirm(o.message) },

  replay: {
    status: async () => ({ available: true }),
    checkGameDir: async () => ({ ok: true, builds: [13187581] }),
    pickGameDir: async () => null,
    list: async () => [
      {
        id: 'preview',
        file: 'preview.wowsreplay',
        originalName: 'preview.wowsreplay',
        size: 0,
        sha256: '',
        addedAt: Date.now(),
        probe: {
          dateTime: 'dev preview',
          map: { displayName: 'from the served timeline' },
          mode: { scenario: 'preview' },
          player: { name: 'preview' },
        },
      },
    ],
    usage: async () => ({ count: 1, bytes: 0, path: 'preview' }),
    pickReplays: async () => null,
    importPaths: async () => ({ added: [], duplicates: [], failed: [] }),
    remove: async () => [],
    refreshProbe: async () => null,
    scanGame: async () => [],
    revealArchive: async () => true,
    // Serves the timeline the dev server was launched with, after a short
    // pause so the progress state in the sidebar is actually visible.
    bake: async () => {
      await new Promise((r) => setTimeout(r, 600));
      const buf = await (await fetch('/__timeline')).arrayBuffer();
      return { data: new Uint8Array(buf), summary: null };
    },
    cancelBake: async () => true,
    onProgress: (cb: (e: unknown) => void) => {
      const stages = ['loading-game-data', 'preparing', 'baking'];
      const timers = stages.map((stage, i) => setTimeout(() => cb({ t: 'stage', stage }), i * 150));
      const p = setTimeout(() => cb({ t: 'progress', frame: 4000, total: 9215 }), 450);
      return () => [...timers, p].forEach(clearTimeout);
    },
  },
};

(window as unknown as { api: unknown }).api = api;

project = await makeProject();
settings.lastProjectId = project.id;

// Imported only once the stub is in place: the store boots on mount and would
// otherwise reach for an api that is not there yet.
await import('@/main');
