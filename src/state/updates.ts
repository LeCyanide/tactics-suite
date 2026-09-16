import { useEffect, useState } from 'react';
import type { UpdateState } from '../../electron/preload';
import { useStore } from './store';

export type { UpdateState };

/** The main process's update state, kept current as it changes. */
export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  useEffect(() => {
    void window.api.updates.state().then(setState);
    return window.api.updates.onStateChange(setState);
  }, []);
  return state;
}

/** Saves the open project, then restarts into the downloaded version. */
export async function restartToUpdate(): Promise<void> {
  const s = useStore.getState();
  if (s.dirty && s.project) await s.saveProject({ silent: true });
  try {
    await window.api.updates.install();
  } catch (err) {
    s.toast(`Update failed: ${(err as Error).message}`, 'error');
  }
}
