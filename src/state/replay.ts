/**
 * Replay viewer state.
 *
 * Kept out of the main store on purpose. A loaded timeline is tens of megabytes
 * and the playback frame changes ten times a second; neither belongs in the
 * store that holds the project and drives undo. Nothing here is ever persisted
 * — a timeline is rebuilt from the library in a few seconds, so there is no
 * reason to keep one around.
 */

import { create } from 'zustand';
import { DEFAULT_REPLAY_VIEW, type ReplayViewOptions } from '@/canvas/ReplayLayer';
import { ReplayTimeline, TimelineFormatError } from '@/replay/timeline';
import { useStore } from './store';

export type AppMode = 'tactics' | 'replay';

/** What the sidebar shows while a replay is being prepared. */
export type BakeState =
  | { phase: 'idle' }
  | { phase: 'baking'; stage: string; frame: number; total: number }
  | { phase: 'error'; message: string };

/**
 * Playback speeds offered in the sidebar.
 *
 * The high end costs nothing: speed only changes which frame is shown next, not
 * how many are decoded, so 20x draws exactly as many frames per second as 1x
 * does. It does skip past transient marks — at 20x roughly two frames in three
 * are never shown, so a single salvo's tracers can pass unseen. That is the
 * right trade for skimming to the part of a battle worth watching.
 */
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 10, 20] as const;

/**
 * Bake cadence, in frames per second of game time.
 *
 * Passed explicitly rather than left to the sidecar's own default, because the
 * progress bar converts frame counts into a battle clock and would be silently
 * wrong if the two ever disagreed.
 */
export const BAKE_FPS = 10;

/** Whether a replay can be watched. See `ReplayState` in the library. */
export type ReplayPlayState = 'baked' | 'bakeable' | 'unplayable';

export interface LibraryReplay {
  id: string;
  path: string;
  name: string;
  collection: string | null;
  size: number;
  addedAt: number;
  probe: {
    dateTime?: string;
    map?: { name?: string; displayName?: string };
    mode?: { scenario?: string; matchGroup?: string | null };
    player?: { name?: string; vehicle?: string };
    durationSeconds?: number;
    vehicles?: { name: string; relation: number }[];
  } | null;
  probeError?: string;
  build: number | null;
  state: ReplayPlayState;
  bakeError?: string;
}

export interface ReplayCollection {
  name: string;
}

interface SidecarStatus {
  available: boolean;
  reason?: string;
}

/** Background baking, for the status line under the library header. */
export interface BakeQueue {
  done: number;
  total: number;
  current: string | null;
}

interface ReplayState {
  mode: AppMode;
  /** Null until checked; the add-on may not be installed. */
  status: SidecarStatus | null;
  /** The library folder, once one is chosen and usable. */
  root: string | null;
  /** Where the library would go if the user takes the suggestion. Set while none is chosen. */
  suggestedRoot: string | null;
  archive: LibraryReplay[];
  collections: ReplayCollection[];
  archiveLoaded: boolean;
  queue: BakeQueue;
  selectedId: string | null;
  timeline: ReplayTimeline | null;
  bake: BakeState;
  frame: number;
  playing: boolean;
  speed: number;
  view: ReplayViewOptions;
  /** Opacity of the replay layer, so a plan drawn over it stays readable. */
  opacity: number;

  setMode(mode: AppMode): void;
  init(): Promise<void>;
  /** Uses `dir` as the library, or asks for a folder when none is given. */
  chooseRoot(dir?: string): Promise<void>;
  refreshArchive(): Promise<void>;
  addReplays(collection?: string | null): Promise<void>;
  importFromGame(): Promise<void>;
  removeReplay(id: string): Promise<void>;
  /** Makes a collection and returns its name, or null if it failed. */
  createCollection(): Promise<string | null>;
  renameCollection(from: string, to: string): Promise<boolean>;
  deleteCollection(name: string): Promise<void>;
  moveReplays(ids: string[], collection: string | null): Promise<void>;
  chooseGameDir(): Promise<void>;
  open(id: string): Promise<void>;
  close(): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  seek(frame: number): void;
  step(delta: number): void;
  setSpeed(speed: number): void;
  setView(patch: Partial<ReplayViewOptions>): void;
  setOpacity(value: number): void;
}

/** Set once the add-on is known to be there and the library events are wired. */
let initialised = false;

/** Playback advances on wall-clock time, not on how often React renders. */
let raf = 0;
let lastTick = 0;
let carry = 0;

/** Replays already rebaked once this session for want of players; never twice. */
const rebakedForPlayers = new Set<string>();

export const useReplayStore = create<ReplayState>((set, get) => ({
  mode: 'tactics',
  status: null,
  root: null,
  suggestedRoot: null,
  archive: [],
  collections: [],
  archiveLoaded: false,
  queue: { done: 0, total: 0, current: null },
  selectedId: null,
  timeline: null,
  bake: { phase: 'idle' },
  frame: 0,
  playing: false,
  speed: 1,
  view: DEFAULT_REPLAY_VIEW,
  opacity: 1,

  setMode(mode) {
    if (get().mode === mode) return;
    if (mode === 'tactics') get().pause();
    set({ mode });
    if (mode === 'replay') void get().init();
  },

  async init() {
    if (initialised) {
      // Coming back to replay mode: the folder may have changed meanwhile.
      if (get().root) await get().refreshArchive();
      return;
    }
    const status = await window.api.replay.status();
    set({ status });
    if (!status.available) return;
    initialised = true;
    listenToLibrary();

    const { replayDir, wowsGameDir } = useStore.getState().settings;
    if (!replayDir) {
      set({ suggestedRoot: await window.api.replay.defaultRoot(), archiveLoaded: true });
      return;
    }
    const res = await window.api.replay.configure({ root: replayDir, gameDir: wowsGameDir });
    if (!res.ok) {
      // The folder is gone or unwritable — a removed drive, say. Offer to
      // choose again rather than failing every action after this one.
      useStore.getState().toast(res.reason ?? 'The replay folder cannot be used.', 'error');
      set({ suggestedRoot: replayDir, archiveLoaded: true });
      return;
    }
    set({ root: replayDir });
    await get().refreshArchive();
  },

  async chooseRoot(dir) {
    const picked = dir ?? (await window.api.replay.pickRoot());
    if (!picked) return;
    const res = await window.api.replay.configure({ root: picked, gameDir: useStore.getState().settings.wowsGameDir });
    if (!res.ok) {
      useStore.getState().toast(res.reason ?? 'That folder cannot be used.', 'error');
      return;
    }
    useStore.getState().patchSettings({ replayDir: picked });
    set({ root: picked, suggestedRoot: null });
    if (res.migrated) {
      useStore
        .getState()
        .toast(`Moved ${res.migrated} replay${res.migrated === 1 ? '' : 's'} from the old archive into ${picked}.`);
    }
    await get().refreshArchive();
  },

  async refreshArchive() {
    if (!get().root) return;
    try {
      const listing = await window.api.replay.list();
      set({ archive: listing.replays, collections: listing.collections, archiveLoaded: true });
    } catch (err) {
      useStore.getState().toast(`Could not read the replay folder: ${message(err)}`, 'error');
    }
  },

  async addReplays(collection = null) {
    try {
      const outcome = await window.api.replay.pickReplays(collection);
      if (!outcome) return;
      await get().refreshArchive();
      reportImport(outcome);
    } catch (err) {
      useStore.getState().toast(`Import failed: ${message(err)}`, 'error');
    }
  },

  async importFromGame() {
    const s = useStore.getState();
    const dir = s.settings.wowsGameDir;
    if (!dir) return void (await get().chooseGameDir());
    try {
      const found = await window.api.replay.scanGame(dir);
      const fresh = found.filter((f) => !f.archived);
      if (!fresh.length) {
        s.toast(
          found.length ? 'Every recent replay is already in your library.' : 'No replays found in the game folder.',
        );
        return;
      }
      const ok = await window.api.dialog.confirm({
        title: 'Import from the game folder',
        message: `Add ${fresh.length} replay${fresh.length === 1 ? '' : 's'} to your library?`,
        detail: `${(fresh.reduce((n, f) => n + f.size, 0) / 1048576).toFixed(0)} MB will be copied into ${get().root}. The originals are left alone.`,
        confirmLabel: 'Import',
      });
      if (!ok) return;
      const outcome = await window.api.replay.importPaths(fresh.map((f) => f.path));
      await get().refreshArchive();
      reportImport(outcome);
    } catch (err) {
      s.toast(`Import failed: ${message(err)}`, 'error');
    }
  },

  async removeReplay(id) {
    const replay = get().archive.find((r) => r.id === id);
    const ok = await window.api.dialog.confirm({
      title: 'Delete replay',
      message: 'Delete this replay?',
      detail:
        `${replay?.path ?? 'The file'} is deleted from your replay folder, together with its saved timeline.` +
        (replay?.state === 'baked' && replay.build !== null
          ? ' If its patch is gone from the game, it cannot be baked again.'
          : ''),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const listing = await window.api.replay.remove(id);
      set({ archive: listing.replays, collections: listing.collections });
    } catch (err) {
      useStore.getState().toast(`Could not delete the replay: ${message(err)}`, 'error');
    }
    if (get().selectedId === id) get().close();
  },

  async createCollection() {
    try {
      const collection = await window.api.replay.createCollection();
      await get().refreshArchive();
      return collection.name;
    } catch (err) {
      useStore.getState().toast(`Could not create the collection: ${message(err)}`, 'error');
      return null;
    }
  },

  async renameCollection(from, to) {
    try {
      await window.api.replay.renameCollection(from, to);
      await get().refreshArchive();
      return true;
    } catch (err) {
      useStore.getState().toast(`Could not rename the collection: ${message(err)}`, 'error');
      return false;
    }
  },

  async deleteCollection(name) {
    const held = get().archive.filter((r) => r.collection === name).length;
    // An empty folder costs nothing to lose, so it goes without asking.
    if (held) {
      const ok = await window.api.dialog.confirm({
        title: 'Delete collection',
        message: `Delete "${name}"?`,
        detail: `Its ${held} replay${held === 1 ? '' : 's'} move back to the top of your replay folder, unsorted.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const { kept } = await window.api.replay.deleteCollection(name);
      if (kept) useStore.getState().toast(`The "${name}" folder holds other files, so it was left in place.`);
    } catch (err) {
      useStore.getState().toast(`Could not delete the collection: ${message(err)}`, 'error');
    }
    await get().refreshArchive();
  },

  async moveReplays(ids, collection) {
    try {
      const listing = await window.api.replay.move(ids, collection);
      set({ archive: listing.replays, collections: listing.collections });
    } catch (err) {
      useStore.getState().toast(`Could not move the replay: ${message(err)}`, 'error');
    }
  },

  async chooseGameDir() {
    const picked = await window.api.replay.pickGameDir();
    if (!picked) return;
    if (!picked.ok) {
      useStore.getState().toast(picked.reason ?? 'That folder is not a World of Warships install.', 'error');
      return;
    }
    useStore.getState().patchSettings({ wowsGameDir: picked.dir });
    // The library bakes against the install, so it has to hear about it.
    const root = get().root;
    if (root) {
      await window.api.replay.configure({ root, gameDir: picked.dir });
      await get().refreshArchive();
    }
  },

  async open(id) {
    get().pause();
    set({ selectedId: id, timeline: null, frame: 0, bake: { phase: 'baking', stage: 'starting', frame: 0, total: 1 } });

    const off = window.api.replay.onProgress((e) => {
      // A late event from a bake the user has already moved on from would
      // otherwise reopen the progress bar over the replay they chose instead.
      if (get().selectedId !== id) return;
      if (e.t === 'stage') set((st) => ({ bake: { ...asBaking(st.bake), stage: e.stage } }));
      else if (e.t === 'progress') set((st) => ({ bake: { ...asBaking(st.bake), frame: e.frame, total: e.total } }));
    });

    try {
      let timeline: ReplayTimeline;
      try {
        timeline = new ReplayTimeline(await window.api.replay.load({ id }));
      } catch (err) {
        // A stored timeline this version cannot read, from an older planner.
        // Rebaking works only while the patch is installed; the library says
        // so plainly if it is not.
        if (!(err instanceof TimelineFormatError)) throw err;
        timeline = new ReplayTimeline(await window.api.replay.load({ id, rebake: true }));
      }
      if (timeline.lacksPlayers && !rebakedForPlayers.has(id)) {
        rebakedForPlayers.add(id);
        // Baked before the sidecar could read this patch's roster. Worth one
        // more bake while the build is installed; when it is not, or the bake
        // fails, the nameless timeline is still better than none.
        try {
          timeline = new ReplayTimeline(await window.api.replay.load({ id, rebake: true }));
        } catch {
          /* keep what we have */
        }
      }
      if (get().selectedId !== id) return;
      set({ timeline, frame: firstActiveFrame(timeline), bake: { phase: 'idle' } });
    } catch (err) {
      if (get().selectedId !== id) return;
      set({ bake: { phase: 'error', message: message(err) }, timeline: null });
    } finally {
      off();
    }
  },

  close() {
    get().pause();
    void window.api.replay.cancelBake().catch(() => undefined);
    set({ selectedId: null, timeline: null, frame: 0, bake: { phase: 'idle' } });
  },

  play() {
    const { timeline, playing } = get();
    if (!timeline || playing) return;
    // Restart from the beginning rather than sitting on the last frame.
    if (get().frame >= timeline.frameCount - 1) set({ frame: 0 });
    set({ playing: true });
    lastTick = 0;
    carry = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const st = get();
      if (!st.playing || !st.timeline) return;
      const dt = lastTick ? (now - lastTick) / 1000 : 0;
      lastTick = now;
      carry += dt * st.speed * st.timeline.fps;
      const advance = Math.floor(carry);
      if (advance <= 0) return;
      carry -= advance;
      const next = st.frame + advance;
      if (next >= st.timeline.frameCount - 1) set({ frame: st.timeline.frameCount - 1, playing: false });
      else set({ frame: next });
    };
    raf = requestAnimationFrame(tick);
  },

  pause() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (get().playing) set({ playing: false });
  },

  togglePlay() {
    if (get().playing) get().pause();
    else get().play();
  },

  seek(frame) {
    const t = get().timeline;
    if (!t) return;
    set({ frame: Math.max(0, Math.min(t.frameCount - 1, Math.round(frame))) });
  },

  step(delta) {
    get().pause();
    get().seek(get().frame + delta);
  },

  setSpeed(speed) {
    // Reset the accumulator so a speed change takes effect from now rather
    // than dumping the fraction of a frame banked at the old rate.
    carry = 0;
    set({ speed });
  },

  setView(patch) {
    set((s) => ({ view: { ...s.view, ...patch } }));
  },

  setOpacity(value) {
    set({ opacity: Math.max(0, Math.min(1, value)) });
  },
}));

/**
 * Keeps the list in step with what the library does on its own: background
 * bakes finishing, and changes made to the folder in Explorer, which show up
 * when the window comes back into focus.
 */
function listenToLibrary(): void {
  window.api.replay.onLibrary((e) => {
    const st = useReplayStore.getState();
    if (e.t === 'queue') useReplayStore.setState({ queue: { done: e.done, total: e.total, current: e.current } });
    else if (e.t === 'baked') {
      useReplayStore.setState({
        archive: st.archive.map((r) => (r.id === e.id ? { ...r, state: 'baked', bakeError: undefined } : r)),
      });
    }
  });
  window.addEventListener('focus', () => {
    const st = useReplayStore.getState();
    if (st.mode === 'replay' && st.root) void st.refreshArchive();
  });
}

/**
 * The first frame with a ship on it.
 *
 * A bake starts at replay clock zero, which is before the ships exist: the
 * pre-battle phase is loading screens and a countdown. Opening there shows an
 * empty map and looks broken, so playback starts where the battle does.
 *
 * Scanning costs about thirty frame decodes, which is well under a millisecond.
 */
function firstActiveFrame(t: ReplayTimeline): number {
  const second = Math.max(1, Math.round(t.fps));
  const limit = Math.min(t.frameCount, Math.round(t.fps * 180));
  const hasShip = (f: number) => t.frame(f).some((r) => r.kind === 'ship');
  for (let f = 0; f < limit; f += second) {
    if (!hasShip(f)) continue;
    // Step back through that second so the spawn itself is not skipped past.
    for (let b = Math.max(0, f - second + 1); b < f; b++) if (hasShip(b)) return b;
    return f;
  }
  return 0;
}

function asBaking(b: BakeState): { phase: 'baking'; stage: string; frame: number; total: number } {
  return b.phase === 'baking' ? b : { phase: 'baking', stage: 'working', frame: 0, total: 1 };
}

function message(err: unknown): string {
  return String((err as Error)?.message ?? err);
}

function reportImport(outcome: {
  added: unknown[];
  duplicates: string[];
  failed: { name: string; reason: string }[];
}): void {
  const s = useStore.getState();
  const parts: string[] = [];
  if (outcome.added.length) parts.push(`${outcome.added.length} added`);
  if (outcome.duplicates.length) parts.push(`${outcome.duplicates.length} already in the archive`);
  if (outcome.failed.length) parts.push(`${outcome.failed.length} skipped`);
  s.toast(parts.join(', ') || 'Nothing to import', outcome.failed.length && !outcome.added.length ? 'error' : 'info');
  // The reasons matter more than the count when something was skipped, and a
  // toast is too small to carry them.
  for (const f of outcome.failed.slice(0, 3)) console.warn(`[replay] ${f.name}: ${f.reason}`);
}

/** Formats a battle clock as m:ss. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
