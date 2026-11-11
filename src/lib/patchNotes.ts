/**
 * Patch notes shown inside the app.
 *
 * The notes are PATCHNOTES.md, parsed at build time by the same code that
 * publishes them for Discord (scripts/patch-notes.mjs) and baked in as
 * `__PATCH_NOTES__`. Baking them in means a build always carries the notes for
 * its own version, offline, and there is nothing to fetch.
 */

export interface PatchNoteSection {
  title: string;
  notes: string[];
}

export interface VersionNotes {
  version: string;
  sections: PatchNoteSection[];
}

declare const __PATCH_NOTES__: VersionNotes[] | undefined;

/** Every released version's notes, newest first. Empty where the build did not bake them in (tests). */
export const BUNDLED_PATCH_NOTES: VersionNotes[] = typeof __PATCH_NOTES__ !== 'undefined' ? __PATCH_NOTES__ : [];

/** `2.6.0` → [2, 6, 0]; null for anything else, such as the browser preview's "preview". */
function parse(version: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative, zero or positive as `a` is older than, the same as or newer than `b`. Null when either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/**
 * The notes to show on launch, newest first: every version after `seen` up to
 * and including `current`, so someone who skipped an update still reads what
 * it brought. With no `seen`, only the current version's.
 */
export function notesSince(all: VersionNotes[], seen: string, current: string): VersionNotes[] {
  return all.filter((v) => {
    const upToCurrent = compareVersions(v.version, current);
    if (upToCurrent === null || upToCurrent > 0) return false;
    if (!seen) return upToCurrent === 0;
    const afterSeen = compareVersions(v.version, seen);
    return afterSeen !== null && afterSeen > 0;
  });
}

export type LaunchDecision =
  /** Show these notes, and remember `current` as seen. */
  | { show: VersionNotes[]; markSeen: string }
  /** Show nothing; remember `current` as seen when given. */
  | { show: null; markSeen: string | null };

/**
 * What to do about patch notes when the app starts.
 *
 * - A fresh install shows nothing: there is no update to describe.
 * - A user coming from a version before this feature has settings but no
 *   `seen` version; they get the current version's notes.
 * - With the pop-up turned off, the version is still marked seen, so turning
 *   it back on later shows the next update and not a backlog.
 * - A downgrade, or a build that is not a version (the browser preview), shows nothing.
 */
export function onLaunch(opts: {
  all: VersionNotes[];
  current: string;
  seen: string;
  enabled: boolean;
  freshInstall: boolean;
}): LaunchDecision {
  const { all, current, seen, enabled, freshInstall } = opts;
  if (compareVersions(current, current) === null) return { show: null, markSeen: null };
  if (seen && compareVersions(seen, current) === 0) return { show: null, markSeen: null };
  if (freshInstall && !seen) return { show: null, markSeen: current };
  if (seen && (compareVersions(seen, current) ?? 1) > 0) return { show: null, markSeen: current };
  if (!enabled) return { show: null, markSeen: current };
  const notes = notesSince(all, seen, current);
  return notes.length > 0 ? { show: notes, markSeen: current } : { show: null, markSeen: current };
}

/** What the patch notes modal is opened with. */
export interface PatchNotesArg {
  versions: VersionNotes[];
  /** Opened by itself after an update, rather than from Settings. Offers "Don't show again". */
  afterUpdate: boolean;
  /** The modal to go back to on close: the project picker on launch, Settings when opened from there. */
  returnTo?: string;
}
