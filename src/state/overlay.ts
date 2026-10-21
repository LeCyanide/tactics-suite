/**
 * Replay overlay: one replay's ship paths drawn faintly behind the plan.
 *
 * Session only — never saved with the page, and left out of exports, so a
 * shared plan never depends on a replay file the reader does not have.
 */

import { create } from 'zustand';
import { extractPaths, type ReplayPaths } from '@/replay/paths';
import { loadTimeline } from './replay';

export type OverlayLoad =
  | { phase: 'idle' }
  | { phase: 'loading'; frame: number; total: number }
  | { phase: 'error'; message: string };

interface OverlayState {
  replayId: string | null;
  paths: ReplayPaths | null;
  load: OverlayLoad;
  /** Paths are drawn from the start of the battle up to this clock, in seconds. */
  until: number;
  opacity: number;
  allies: boolean;
  enemies: boolean;
  /** Each ship gets its own colour instead of its team's, to tell trails apart. */
  unique: boolean;

  show(id: string): Promise<void>;
  clear(): void;
  set(patch: Partial<Pick<OverlayState, 'until' | 'opacity' | 'allies' | 'enemies' | 'unique'>>): void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  replayId: null,
  paths: null,
  load: { phase: 'idle' },
  until: 0,
  opacity: 0.6,
  allies: true,
  enemies: true,
  unique: false,

  async show(id) {
    set({ replayId: id, paths: null, load: { phase: 'loading', frame: 0, total: 1 } });
    // A replay that is not baked yet bakes now; show how far along it is.
    const off = window.api.replay.onProgress((e) => {
      if (get().replayId === id && e.t === 'progress') set({ load: { phase: 'loading', frame: e.frame, total: e.total } });
    });
    try {
      const paths = extractPaths(await loadTimeline(id));
      if (get().replayId !== id) return;
      set({ paths, until: paths.duration, load: { phase: 'idle' } });
    } catch (err) {
      if (get().replayId !== id) return;
      set({ load: { phase: 'error', message: err instanceof Error ? err.message : String(err) } });
    } finally {
      off();
    }
  },

  clear() {
    set({ replayId: null, paths: null, load: { phase: 'idle' } });
  },

  set(patch) {
    set(patch);
  },
}));
