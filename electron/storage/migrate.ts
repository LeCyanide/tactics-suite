/**
 * Moves the data store from a legacy folder name (LEGACY_APP_FOLDERS) to the
 * current one. Runs once, before the first read, and decides which folder is
 * the store. No outcome loses or hides data:
 *
 *  - A store already in the current folder wins; nothing else is touched.
 *  - Otherwise the legacy folder is renamed into place (same parent, so atomic).
 *  - If the rename is refused, it is copied beside the target, then renamed in.
 *  - If that fails too, the legacy folder is used as is. Starting empty would
 *    create the current folder and hide the legacy one for good.
 *
 * No electron import, so the selftest can run it against a temp tree.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Legacy data folder names, newest first. */
export const LEGACY_APP_FOLDERS = ['WoWS Tactics Toolkit'];

export interface AdoptedStore {
  /** The folder to use as the store. */
  root: string;
  outcome: 'current' | 'fresh' | 'moved' | 'copied' | 'left-in-place';
  /** Where the store came from, when it was not already in place. */
  from?: string;
  /** Why a gentler step was needed. */
  reason?: string;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function adoptLegacyStore(target: string, candidates: string[]): AdoptedStore {
  if (fs.existsSync(target)) return { root: target, outcome: 'current' };

  const from = candidates.find((dir) => path.resolve(dir) !== path.resolve(target) && fs.existsSync(dir));
  if (from === undefined) return { root: target, outcome: 'fresh' };

  let reason: string;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(from, target);
    return { root: target, outcome: 'moved', from };
  } catch (error) {
    reason = message(error);
  }

  // Copied under another name first: a copy cut short must never be mistaken
  // for the store.
  const staging = `${target}.migrating`;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.cpSync(from, staging, { recursive: true, errorOnExist: false });
    fs.renameSync(staging, target);
    return { root: target, outcome: 'copied', from, reason };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    return { root: from, outcome: 'left-in-place', from, reason: `${reason}; then ${message(error)}` };
  }
}
