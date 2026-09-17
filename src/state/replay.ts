/**
 * Replay viewer state.
 *
 * Kept out of the main store on purpose. A loaded timeline is tens of megabytes
 * and the playback frame changes ten times a second; neither belongs in the
 * store that holds the project and drives undo. Nothing here is ever persisted
 * — a timeline is rebuilt from the archive in a few seconds, so there is no
 * reason to keep one around.
 */

import { create } from 'zustand';
import { DEFAULT_REPLAY_VIEW, type ReplayViewOptions } from '@/canvas/ReplayLayer';
import { ReplayTimeline } from '@/replay/timeline';
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

interface ArchivedReplay {
  id: string;
  originalName: string;
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
}

interface SidecarStatus {
  available: boolean;
  reason?: string;
}

interface ReplayState {
  mode: AppMode;
  /** Null until checked; the add-on may not be installed. */
  status: SidecarStatus | null;
  archive: ArchivedReplay[];
  archiveLoaded: boolean;
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
  refreshArchive(): Promise<void>;
  addReplays(): Promise<void>;
  importFromGame(): Promise<void>;
  removeReplay(id: string): Promise<void>;
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

/** Playback advances on wall-clock time, not on how often React renders. */
let raf = 0;
let lastTick = 0;
let carry = 0;

export const useReplayStore = create<ReplayState>((set, get) => ({
  mode: 'tactics',
  status: null,
  archive: [],
  archiveLoaded: false,
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
    const status = await window.api.replay.status();
    set({ status });
    if (status.available && !get().archiveLoaded) await get().refreshArchive();
  },

  async refreshArchive() {
    try {
      const archive = await window.api.replay.list();
      set({ archive, archiveLoaded: true });
    } catch (err) {
      useStore.getState().toast(`Could not read the replay archive: ${message(err)}`, 'error');
    }
  },

  async addReplays() {
    try {
      const outcome = await window.api.replay.pickReplays();
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
          found.length ? 'Every recent replay is already in the archive.' : 'No replays found in the game folder.',
        );
        return;
      }
      const ok = await window.api.dialog.confirm({
        title: 'Import from the game folder',
        message: `Add ${fresh.length} replay${fresh.length === 1 ? '' : 's'} to the archive?`,
        detail: `${(fresh.reduce((n, f) => n + f.size, 0) / 1048576).toFixed(0)} MB will be copied into the planner's storage. The originals are left alone.`,
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
    const ok = await window.api.dialog.confirm({
      title: 'Remove replay',
      message: 'Remove this replay from the archive?',
      detail: 'The file is deleted from the planner. The original in the game folder is untouched.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const archive = await window.api.replay.remove(id);
    set({ archive });
    if (get().selectedId === id) get().close();
  },

  async chooseGameDir() {
    const picked = await window.api.replay.pickGameDir();
    if (!picked) return;
    if (!picked.ok) {
      useStore.getState().toast(picked.reason ?? 'That folder is not a World of Warships install.', 'error');
      return;
    }
    useStore.getState().patchSettings({ wowsGameDir: picked.dir });
  },

  async open(id) {
    const s = useStore.getState();
    const gameDir = s.settings.wowsGameDir;
    if (!gameDir) {
      await get().chooseGameDir();
      if (!useStore.getState().settings.wowsGameDir) return;
    }

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
      const { data } = await window.api.replay.bake({
        id,
        gameDir: useStore.getState().settings.wowsGameDir,
        fps: BAKE_FPS,
      });
      if (get().selectedId !== id) return;
      const timeline = new ReplayTimeline(data);
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
