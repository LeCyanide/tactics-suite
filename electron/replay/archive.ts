/**
 * The replay archive.
 *
 * Replays are copied into the store rather than referenced where they sit.
 * The game prunes its own replays folder as it records new battles, and a
 * reinstall or a cleanup takes the lot — a planner that only held paths would
 * quietly rot. Copying costs a few MB per battle and makes the archive the
 * user's own.
 *
 *   <userData>/data/replays/
 *     index.json                 one record per archived replay
 *     files/<id>.wowsreplay      the replay itself
 *
 * Each record carries the metadata the sidecar's `probe` returned at import
 * time. Archived files never change, so that metadata can never go stale and
 * listing the archive never has to spawn anything.
 */

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { newId, readJson, storageRoot, writeJson } from '../storage/db';
import { probeReplay, sidecarStatus, type ReplayProbe } from './sidecar';

const EXT = '.wowsreplay';

/**
 * Replays run from a few hundred KB to tens of MB. The bounds are loose on
 * purpose — they exist to reject a file picked by mistake, not to police the
 * format, which the sidecar does properly when it probes.
 */
const MIN_BYTES = 1024;
const MAX_BYTES = 256 * 1024 * 1024;

function archiveDir(): string {
  return path.join(storageRoot(), 'replays');
}
function indexFile(): string {
  return path.join(archiveDir(), 'index.json');
}
function filesDir(): string {
  return path.join(archiveDir(), 'files');
}

export interface ArchivedReplay {
  id: string;
  /** File name inside `files/`. Derived from the id, never from user input. */
  file: string;
  /** What the file was called where it came from, for display. */
  originalName: string;
  size: number;
  /** Content hash, so the same battle cannot be archived twice. */
  sha256: string;
  addedAt: number;
  /** Metadata from the sidecar, or null when probing did not succeed. */
  probe: ReplayProbe | null;
  /** Why the probe failed, when it did. The file is kept either way. */
  probeError?: string;
}

/** Serializes index writes, so two imports cannot clobber each other. */
let writeChain: Promise<unknown> = Promise.resolve();
function queued<T>(task: () => Promise<T>): Promise<T> {
  const next = writeChain.then(task, task);
  writeChain = next.catch(() => undefined);
  return next;
}

async function readIndex(): Promise<ArchivedReplay[]> {
  const entries = await readJson<ArchivedReplay[]>(indexFile(), []);
  return Array.isArray(entries) ? entries : [];
}

/** Newest first, which is the order the sidebar wants. */
export async function listReplays(): Promise<ArchivedReplay[]> {
  const entries = await readIndex();
  return entries.slice().sort((a, b) => b.addedAt - a.addedAt);
}

/** Absolute path of an archived replay, for handing to the sidecar. */
export async function replayPath(id: string): Promise<string> {
  const entry = (await readIndex()).find((e) => e.id === id);
  if (!entry) throw new Error('That replay is not in the archive.');
  return path.join(filesDir(), entry.file);
}

export interface ImportOutcome {
  /** Replays added to the archive, newest first. */
  added: ArchivedReplay[];
  /** Files already in the archive, by the name they were offered under. */
  duplicates: string[];
  /** Files that could not be taken, and why. */
  failed: { name: string; reason: string }[];
}

/**
 * Copies replays into the archive.
 *
 * Partial success is the normal outcome when a user selects a whole folder:
 * one unreadable file should not lose the other fifty, so every source is
 * reported separately rather than the batch failing as a unit.
 */
export async function importReplays(sources: string[]): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { added: [], duplicates: [], failed: [] };
  if (!sources.length) return outcome;

  const canProbe = sidecarStatus().available;
  await fsp.mkdir(filesDir(), { recursive: true });

  // Copying and probing happen outside the index lock, because they are slow
  // and the lock is only needed to merge. The index read here is an early
  // rejection for duplicates; the authoritative check happens under the lock,
  // since another import may land between now and then.
  const seen = new Set((await readIndex()).map((e) => e.sha256));
  const staged: ArchivedReplay[] = [];

  for (const source of sources) {
    const name = path.basename(source);
    try {
      if (path.extname(source).toLowerCase() !== EXT) {
        outcome.failed.push({ name, reason: `Not a ${EXT} file.` });
        continue;
      }
      const stat = await fsp.stat(source);
      if (!stat.isFile()) {
        outcome.failed.push({ name, reason: 'Not a file.' });
        continue;
      }
      if (stat.size < MIN_BYTES) {
        outcome.failed.push({ name, reason: 'Too small to be a replay.' });
        continue;
      }
      if (stat.size > MAX_BYTES) {
        outcome.failed.push({ name, reason: 'Too large to be a replay.' });
        continue;
      }

      const data = await fsp.readFile(source);
      const sha256 = crypto.createHash('sha256').update(data).digest('hex');
      if (seen.has(sha256)) {
        outcome.duplicates.push(name);
        continue;
      }

      const id = newId('rp-');
      const file = `${id}${EXT}`;
      const target = path.join(filesDir(), file);
      // Same atomic shape as the rest of the store: write beside, then rename,
      // so a crash cannot leave a half-copied replay that looks complete.
      const tmp = `${target}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, target);

      const entry: ArchivedReplay = {
        id,
        file,
        originalName: name,
        size: stat.size,
        sha256,
        addedAt: Date.now(),
        probe: null,
      };

      // A failed probe is not a failed import. The replay is safely stored;
      // the metadata can be filled in later by `refreshProbe`, which is the
      // right outcome when the add-on is simply not installed yet.
      if (canProbe) {
        try {
          entry.probe = await probeReplay(target);
        } catch (err) {
          entry.probeError = String((err as Error)?.message ?? err);
        }
      } else {
        entry.probeError = 'The replay viewer add-on is not available, so this replay has no details yet.';
      }

      seen.add(sha256);
      staged.push(entry);
    } catch (err) {
      outcome.failed.push({ name, reason: String((err as Error)?.message ?? err) });
    }
  }

  if (staged.length) {
    await queued(async () => {
      // Re-read inside the lock. Reading before it and writing after would let
      // two overlapping imports each save a list that omits the other's work.
      const entries = await readIndex();
      const have = new Set(entries.map((e) => e.sha256));
      for (const entry of staged) {
        if (have.has(entry.sha256)) {
          // Lost the race: an import that finished first already took this
          // battle. Drop the copy rather than leaving it orphaned on disk.
          await fsp.rm(path.join(filesDir(), entry.file), { force: true });
          outcome.duplicates.push(entry.originalName);
          continue;
        }
        entries.push(entry);
        have.add(entry.sha256);
        outcome.added.push(entry);
      }
      await writeJson(indexFile(), entries);
    });
  }

  outcome.added.sort((a, b) => b.addedAt - a.addedAt);
  return outcome;
}

/** Probes an entry again, for one imported before the add-on was available. */
export async function refreshProbe(id: string): Promise<ArchivedReplay> {
  const file = await replayPath(id);
  let probe: ReplayProbe | null = null;
  let probeError: string | undefined;
  try {
    probe = await probeReplay(file);
  } catch (err) {
    probeError = String((err as Error)?.message ?? err);
  }
  return queued(async () => {
    const entries = await readIndex();
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw new Error('That replay is not in the archive.');
    entry.probe = probe;
    if (probeError) entry.probeError = probeError;
    else delete entry.probeError;
    await writeJson(indexFile(), entries);
    return entry;
  });
}

/** Removes a replay and its file. Returns the remaining archive, newest first. */
export async function removeReplay(id: string): Promise<ArchivedReplay[]> {
  return queued(async () => {
    const entries = await readIndex();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return entries.slice().sort((a, b) => b.addedAt - a.addedAt);

    const remaining = entries.filter((e) => e.id !== id);
    // Index first: an orphaned file wastes space, but an index pointing at a
    // file that is gone breaks playback.
    await writeJson(indexFile(), remaining);
    await fsp.rm(path.join(filesDir(), entry.file), { force: true });
    return remaining.sort((a, b) => b.addedAt - a.addedAt);
  });
}

export interface ArchiveUsage {
  count: number;
  bytes: number;
  path: string;
}

export async function archiveUsage(): Promise<ArchiveUsage> {
  const entries = await readIndex();
  return {
    count: entries.length,
    bytes: entries.reduce((sum, e) => sum + (e.size || 0), 0),
    path: archiveDir(),
  };
}

export interface FoundReplay {
  path: string;
  name: string;
  size: number;
  mtime: number;
  /** The version folder it sat in, e.g. `15.8.0.0`. */
  version: string;
  /** Already in the archive, so importing it would be a no-op. */
  archived: boolean;
}

/**
 * Lists the replays the game itself has recorded, newest first.
 *
 * The game keeps them in `replays/`, either loose or in a folder per client
 * version. This only looks; importing is a separate, explicit step, because
 * a corpus of several hundred battles is not something to copy on a whim.
 *
 * Whether each one is already archived is decided by content hash, the same
 * test `importReplays` uses, so the count shown and the count taken agree.
 */
export async function scanGameReplays(gameDir: string, limit = 500): Promise<FoundReplay[]> {
  const root = path.join(gameDir, 'replays');
  let found: { path: string; name: string; version: string }[] = [];

  const collect = async (dir: string, version: string) => {
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (path.extname(name).toLowerCase() === EXT) {
        found.push({ path: path.join(dir, name), name, version });
      }
    }
  };

  await collect(root, '');
  let versions: string[] = [];
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    versions = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    /* no replays folder at all */
  }
  for (const version of versions) await collect(path.join(root, version), version);

  const stated = await Promise.all(
    found.map(async (f) => {
      try {
        const stat = await fsp.stat(f.path);
        return { ...f, size: stat.size, mtime: stat.mtimeMs };
      } catch {
        return null;
      }
    }),
  );

  // Newest first, then capped: hashing every file in a 664-replay corpus to
  // mark duplicates is the expensive part, and the user is not going to page
  // through all of them anyway.
  const recent = stated
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  const known = new Set((await readIndex()).map((e) => e.sha256));
  return Promise.all(
    recent.map(async (f) => {
      let archived = false;
      try {
        const data = await fsp.readFile(f.path);
        archived = known.has(crypto.createHash('sha256').update(data).digest('hex'));
      } catch {
        /* unreadable; treat as not archived and let the import report it */
      }
      return { path: f.path, name: f.name, size: f.size, mtime: f.mtime, version: f.version, archived };
    }),
  );
}
