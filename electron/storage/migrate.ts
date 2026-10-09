/**
 * Carries a store over from the folder an earlier name of the application
 * kept it in.
 *
 * The data folder sits under the application's own name, so renaming the
 * application moves where it looks, and everything a user made would be left
 * behind in a folder nothing opens any more. This is run once, before the
 * first read, and decides which folder is the store.
 *
 * The order is chosen so that no outcome loses data or hides it:
 *
 *  - A store already at the new place wins, and nothing else is touched.
 *  - Otherwise the old folder is renamed into place. Both sit in the same
 *    application-data directory, so that is one step that either happened or
 *    did not.
 *  - If the rename is refused, the store is copied beside the new place and
 *    only then renamed in, leaving the original where it was.
 *  - If that fails too, the old folder is used as it stands. Starting an empty
 *    store instead would create the new folder, and from then on the old one
 *    would never be looked at again.
 *
 * No electron import here, so the selftest can run it against a temp tree.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Folder names the application has stored its data under, newest first. */
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
