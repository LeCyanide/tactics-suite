/**
 * The replay library.
 *
 * Replays live as plain files in a folder the user picks, with one level of
 * sub-folders as collections. It is their folder: they can open it in
 * Explorer, drop replays in, sort them into folders or copy the lot to a new
 * machine, and the planner picks up whatever it finds there.
 *
 *   <root>/
 *     <battle>.wowsreplay               unsorted
 *     <Collection>/<battle>.wowsreplay  filed
 *     .wowstactics/                     the planner's own bookkeeping
 *       library.json                    metadata and content hashes
 *       baked/<sha256>.wtreply          timelines, one per battle
 *
 * The baked timelines are what keep a replay watchable across patches. A bake
 * needs the game data of the exact build the battle was recorded on, and the
 * game keeps only the current one: after a patch every older replay is just
 * bytes. So each replay is baked as soon as its build is installed, and the
 * timeline is kept for good. They sit inside the library folder rather than in
 * app storage because they are as irreplaceable as the replays themselves, and
 * copying the folder has to carry them along.
 *
 * Replays are identified by content hash, not by path, so moving one between
 * collections — here or in Explorer — keeps its metadata and its bake.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { readJson, storageRoot, writeJson } from '../storage/db';
import {
  DEFAULT_FPS,
  bakeToFile,
  checkGameDir,
  emitLibrary,
  emitToRenderer,
  probeReplay,
  sidecarStatus,
  type ReplayProbe,
  type SidecarEvent,
} from './sidecar';

const EXT = '.wowsreplay';
const META_DIR = '.wowstactics';

/**
 * Replays run from a few hundred KB to tens of MB. The bounds are loose on
 * purpose — they exist to reject a file picked by mistake, not to police the
 * format, which the sidecar does properly when it probes.
 */
const MIN_BYTES = 1024;
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_NAME = 80;

/**
 * How long a bake outlives its replay. A replay deleted from inside the app
 * takes its bake with it; one that vanished from the folder keeps it this
 * long, because it may only have been moved out for a while, and the bake of
 * a past patch cannot be made again.
 */
const ORPHAN_BAKE_MS = 30 * 24 * 3600 * 1000;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Whether a replay can be watched.
 *
 *   baked       a timeline is stored; plays on any patch, instantly
 *   bakeable    its build is installed; it will be baked
 *   unplayable  neither: recorded on a patch the game no longer has
 */
export type ReplayState = 'baked' | 'bakeable' | 'unplayable';

export interface LibraryReplay {
  /** Content hash. Stable across moves and renames. */
  id: string;
  /** Path inside the library folder, with forward slashes. */
  path: string;
  /** The file name, for display when there is no metadata. */
  name: string;
  /** The collection folder it sits in, or null when unsorted. */
  collection: string | null;
  size: number;
  addedAt: number;
  /** Metadata from the sidecar, or null when probing did not succeed. */
  probe: ReplayProbe | null;
  probeError?: string;
  /** Game build the battle was recorded on, when known. */
  build: number | null;
  state: ReplayState;
  /** Why the last bake failed, when it did. */
  bakeError?: string;
}

export interface ReplayCollection {
  /** The folder name. Collections are folders, so the name is the id. */
  name: string;
}

export interface LibraryListing {
  root: string;
  replays: LibraryReplay[];
  collections: ReplayCollection[];
  /** Extra copies of a battle already listed, by path. Shown once, not twice. */
  duplicates: string[];
}

export interface ImportOutcome {
  added: LibraryReplay[];
  /** Files already in the library, by the name they were offered under. */
  duplicates: string[];
  /** Files that could not be taken, and why. */
  failed: { name: string; reason: string }[];
}

export interface ConfigureResult {
  ok: boolean;
  reason?: string;
  /** Replays moved in from the legacy app-data store. */
  migrated?: number;
}

/** Bookkeeping in `.wowstactics/library.json`. */
interface LibraryFile {
  version: 1;
  /** Per battle, by content hash. */
  replays: Record<string, ReplayMeta>;
  /** Per file, so an unchanged file is not hashed again on every listing. */
  files: Record<string, { size: number; mtimeMs: number; sha: string }>;
}

interface ReplayMeta {
  addedAt: number;
  lastSeen: number;
  probe: ReplayProbe | null;
  probeError?: string;
  bakeError?: string;
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

let root: string | null = null;
let gameDir = '';

function metaDir(): string {
  return path.join(requireRoot(), META_DIR);
}
function libraryFile(): string {
  return path.join(metaDir(), 'library.json');
}
function bakedDir(): string {
  return path.join(metaDir(), 'baked');
}
function bakedPath(sha: string): string {
  return path.join(bakedDir(), `${sha}.wtreply`);
}

function requireRoot(): string {
  if (!root) throw new Error('Choose a folder for your replays first.');
  return root;
}

/**
 * Points the library at a folder and a game install.
 *
 * Called on start-up with the saved settings and again whenever either
 * changes. Creates the folder if needed, moves in replays from the legacy
 * app-data store, and starts baking whatever the game can bake.
 */
export async function configure(opts: { root: string; gameDir?: string }): Promise<ConfigureResult> {
  const dir = path.resolve(String(opts.root ?? ''));
  if (!opts.root) return { ok: false, reason: 'No replay folder was given.' };
  try {
    await fsp.mkdir(path.join(dir, META_DIR, 'baked'), { recursive: true });
    const probe = path.join(dir, META_DIR, `.write-test-${process.pid}`);
    await fsp.writeFile(probe, '');
    await fsp.rm(probe, { force: true });
  } catch (err) {
    return { ok: false, reason: `Cannot use ${dir}: ${message(err)}` };
  }
  hide(path.join(dir, META_DIR));

  const changed = root !== dir;
  root = dir;
  gameDir = opts.gameDir ?? '';
  let migrated = 0;
  if (changed) {
    stopQueue();
    migrated = await migrateOldStore();
  }
  void scheduleBakes();
  return { ok: true, migrated };
}

export function currentRoot(): string | null {
  return root;
}

/** Hides the bookkeeping folder in Explorer. Cosmetic, so failure is ignored. */
function hide(dir: string): void {
  if (process.platform !== 'win32') return;
  try {
    spawn('attrib', ['+h', dir], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined);
  } catch {
    /* cosmetic */
  }
}

/* ------------------------------------------------------------------ */
/* Bookkeeping                                                         */
/* ------------------------------------------------------------------ */

/** Serializes library writes and folder changes, so two cannot interleave. */
let writeChain: Promise<unknown> = Promise.resolve();
function queued<T>(task: () => Promise<T>): Promise<T> {
  const next = writeChain.then(task, task);
  writeChain = next.catch(() => undefined);
  return next;
}

async function readLibrary(): Promise<LibraryFile> {
  const lib = await readJson<Partial<LibraryFile>>(libraryFile(), {});
  return {
    version: 1,
    replays: lib.replays && typeof lib.replays === 'object' ? lib.replays : {},
    files: lib.files && typeof lib.files === 'object' ? lib.files : {},
  };
}

function rel(abs: string): string {
  return path.relative(requireRoot(), abs).split(path.sep).join('/');
}
function abs(relPath: string): string {
  return path.join(requireRoot(), ...relPath.split('/'));
}

async function hashFile(file: string): Promise<string> {
  return crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
}

/** The build number from a probe's client version, e.g. `0,15,8,0,13187581`. */
function buildOf(probe: ReplayProbe | null): number | null {
  const m = /(\d+)\D*$/.exec(probe?.clientVersion ?? '');
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 1000 ? n : null;
}

function installedBuilds(): Set<number> {
  if (!gameDir) return new Set();
  const check = checkGameDir(gameDir);
  return new Set(check.ok ? check.builds : []);
}

interface ScannedFile {
  abs: string;
  collection: string | null;
  size: number;
  mtimeMs: number;
  birthtimeMs: number;
}

/** Every replay file in the library folder, one level of collections deep. */
async function scanFiles(): Promise<{ files: ScannedFile[]; collections: string[] }> {
  const base = requireRoot();
  const files: ScannedFile[] = [];
  const collections: string[] = [];

  const collect = async (dir: string, collection: string | null) => {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        // Only the top level holds collections; the bookkeeping folder and
        // anything else hidden is not one.
        if (collection === null && !e.name.startsWith('.')) {
          collections.push(e.name);
          await collect(path.join(dir, e.name), e.name);
        }
        continue;
      }
      if (!e.isFile() || path.extname(e.name).toLowerCase() !== EXT) continue;
      const file = path.join(dir, e.name);
      try {
        const st = await fsp.stat(file);
        files.push({ abs: file, collection, size: st.size, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs });
      } catch {
        /* vanished between readdir and stat */
      }
    }
  };
  await collect(base, null);
  return { files, collections };
}

async function bakedSet(): Promise<Set<string>> {
  try {
    const names = await fsp.readdir(bakedDir());
    return new Set(names.filter((n) => n.endsWith('.wtreply')).map((n) => n.slice(0, -'.wtreply'.length)));
  } catch {
    return new Set();
  }
}

/**
 * Reads the folder into a listing. Runs inside the lock: it may hash new
 * files, probe them and prune stale bookkeeping, all of which write.
 */
async function buildListing(): Promise<LibraryListing> {
  const lib = await readLibrary();
  const { files, collections } = await scanFiles();
  const baked = await bakedSet();
  const builds = installedBuilds();
  const canProbe = sidecarStatus().available;
  const now = Date.now();
  let dirty = false;

  const seenPaths = new Set<string>();
  const seenShas = new Set<string>();
  const replays: LibraryReplay[] = [];
  const duplicates: string[] = [];

  for (const f of files) {
    const relPath = rel(f.abs);
    seenPaths.add(relPath);
    if (f.size < MIN_BYTES || f.size > MAX_BYTES) continue;

    let cached = lib.files[relPath];
    if (!cached || cached.size !== f.size || cached.mtimeMs !== f.mtimeMs) {
      try {
        cached = { size: f.size, mtimeMs: f.mtimeMs, sha: await hashFile(f.abs) };
      } catch {
        continue;
      }
      lib.files[relPath] = cached;
      dirty = true;
    }
    const sha = cached.sha;
    if (seenShas.has(sha)) {
      duplicates.push(relPath);
      continue;
    }
    seenShas.add(sha);

    let meta = lib.replays[sha];
    if (!meta) {
      // A file that arrived without going through the app, dropped in from
      // Explorer. Its creation time is the best guess at when it was added.
      meta = { addedAt: Math.round(f.birthtimeMs || f.mtimeMs || now), lastSeen: now, probe: null };
      await fillProbe(meta, f.abs, canProbe);
      lib.replays[sha] = meta;
      dirty = true;
    } else if (!meta.probe && canProbe && meta.probeError?.startsWith(NO_ADDON)) {
      // Probe failed for lack of the add-on, which is now available.
      await fillProbe(meta, f.abs, canProbe);
      dirty = true;
    }
    if (now - meta.lastSeen > 3600_000) {
      meta.lastSeen = now;
      dirty = true;
    }

    const build = buildOf(meta.probe);
    replays.push({
      id: sha,
      path: relPath,
      name: path.basename(f.abs),
      collection: f.collection,
      size: f.size,
      addedAt: meta.addedAt,
      probe: meta.probe,
      ...(meta.probeError ? { probeError: meta.probeError } : {}),
      build,
      state: baked.has(sha) ? 'baked' : build !== null && builds.has(build) ? 'bakeable' : 'unplayable',
      ...(meta.bakeError ? { bakeError: meta.bakeError } : {}),
    });
  }

  for (const p of Object.keys(lib.files)) {
    if (!seenPaths.has(p)) {
      delete lib.files[p];
      dirty = true;
    }
  }
  // Bakes of replays gone from the folder for long enough are let go.
  for (const [sha, meta] of Object.entries(lib.replays)) {
    if (seenShas.has(sha) || now - meta.lastSeen < ORPHAN_BAKE_MS) continue;
    await fsp.rm(bakedPath(sha), { force: true });
    delete lib.replays[sha];
    dirty = true;
  }

  if (dirty) await writeJson(libraryFile(), lib);

  replays.sort((a, b) => b.addedAt - a.addedAt);
  collections.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return { root: requireRoot(), replays, collections: collections.map((name) => ({ name })), duplicates };
}

const NO_ADDON = 'The replay viewer add-on is not available';

async function fillProbe(meta: ReplayMeta, file: string, canProbe: boolean): Promise<void> {
  if (!canProbe) {
    meta.probe = null;
    meta.probeError = `${NO_ADDON}, so this replay has no details yet.`;
    return;
  }
  try {
    meta.probe = await probeReplay(file);
    delete meta.probeError;
  } catch (err) {
    meta.probe = null;
    meta.probeError = message(err);
  }
}

/** The library as it is on disk now. Also picks up changes made in Explorer. */
export async function listLibrary(): Promise<LibraryListing> {
  const listing = await queued(buildListing);
  void scheduleBakes();
  return listing;
}

async function findReplay(id: string): Promise<LibraryReplay> {
  const replay = (await buildListing()).replays.find((r) => r.id === id);
  if (!replay) throw new Error('That replay is not in the library.');
  return replay;
}

/** Absolute path of a replay, for handing to the sidecar. */
export async function replayPath(id: string): Promise<string> {
  return abs((await queued(() => findReplay(id))).path);
}

/* ------------------------------------------------------------------ */
/* Files and folders                                                   */
/* ------------------------------------------------------------------ */

/** A free name in `dir` for `name`, adding " (2)" and up if it is taken. */
async function freeName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? name : `${stem} (${i})${ext}`;
    try {
      await fsp.access(path.join(dir, candidate));
    } catch {
      return candidate;
    }
  }
}

function collectionDir(collection: string | null): string {
  return collection === null ? requireRoot() : path.join(requireRoot(), cleanName(collection));
}

async function requireCollection(collection: string | null): Promise<string> {
  const dir = collectionDir(collection);
  if (collection !== null) {
    const st = await fsp.stat(dir).catch(() => null);
    if (!st?.isDirectory()) throw new Error(`There is no collection called "${collection}".`);
  }
  return dir;
}

/**
 * Moves a file, across drives if need be. Rename first, since it is atomic and
 * keeps the modified time the hash cache keys on.
 */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    await fsp.rm(from, { force: true });
  }
}

/**
 * Copies replays into the library, into a collection or unsorted.
 *
 * Partial success is the normal outcome when a user selects a whole folder:
 * one unreadable file should not lose the other fifty, so every source is
 * reported separately rather than the batch failing as a unit.
 */
export async function importReplays(sources: string[], collection: string | null = null): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { added: [], duplicates: [], failed: [] };
  if (!sources.length) return outcome;

  await queued(async () => {
    const target = await requireCollection(collection);
    const lib = await readLibrary();
    const known = new Set((await buildListing()).replays.map((r) => r.id));
    const canProbe = sidecarStatus().available;
    const addedIds: string[] = [];

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
        const sha = crypto.createHash('sha256').update(data).digest('hex');
        if (known.has(sha)) {
          outcome.duplicates.push(name);
          continue;
        }

        // Write beside, then rename, so a crash cannot leave a half-copied
        // replay that looks complete.
        const file = path.join(target, await freeName(target, name));
        const tmp = `${file}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, data);
        await fsp.rename(tmp, file);
        const st = await fsp.stat(file);

        const meta: ReplayMeta = lib.replays[sha] ?? { addedAt: Date.now(), lastSeen: Date.now(), probe: null };
        meta.addedAt = Date.now();
        meta.lastSeen = Date.now();
        if (!meta.probe) await fillProbe(meta, file, canProbe);
        lib.replays[sha] = meta;
        lib.files[rel(file)] = { size: st.size, mtimeMs: st.mtimeMs, sha };
        known.add(sha);
        addedIds.push(sha);
      } catch (err) {
        outcome.failed.push({ name, reason: message(err) });
      }
    }

    await writeJson(libraryFile(), lib);
    const listing = await buildListing();
    const wanted = new Set(addedIds);
    outcome.added = listing.replays.filter((r) => wanted.has(r.id));
  });

  void scheduleBakes();
  return outcome;
}

/**
 * Files replays under a collection, or back to unsorted with null. Unknown
 * ids are skipped; an unknown collection is an error.
 */
export async function moveReplays(ids: string[], collection: string | null): Promise<LibraryListing> {
  return queued(async () => {
    const target = await requireCollection(collection);
    const wanted = new Set(ids);
    const listing = await buildListing();
    for (const r of listing.replays) {
      if (!wanted.has(r.id) || r.collection === (collection === null ? null : cleanName(collection))) continue;
      await moveFile(abs(r.path), path.join(target, await freeName(target, r.name)));
    }
    return buildListing();
  });
}

/** Deletes a replay's file and its bake. */
export async function removeReplay(id: string): Promise<LibraryListing> {
  return queued(async () => {
    const listing = await buildListing();
    const replay = listing.replays.find((r) => r.id === id);
    if (!replay) return listing;
    await fsp.rm(abs(replay.path), { force: true });
    // Extra copies of the same battle go too, or it would pop straight back.
    for (const dup of listing.duplicates) {
      const lib = await readLibrary();
      if (lib.files[dup]?.sha === id) await fsp.rm(abs(dup), { force: true });
    }
    await fsp.rm(bakedPath(id), { force: true });
    const lib = await readLibrary();
    delete lib.replays[id];
    await writeJson(libraryFile(), lib);
    return buildListing();
  });
}

/**
 * A collection name that is also a safe folder name on Windows: none of the
 * reserved characters, no trailing dot or space, not a device name, and not
 * hidden, since hidden folders are not listed as collections.
 */
export function cleanName(name: unknown): string {
  const clean = String(name ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, '')
    .trim();
  if (!clean) throw new Error('A collection needs a name.');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(clean)) throw new Error(`"${clean}" is reserved by Windows.`);
  return clean;
}

async function exists(p: string): Promise<boolean> {
  return fsp.access(p).then(
    () => true,
    () => false,
  );
}

export async function createCollection(name: string): Promise<ReplayCollection> {
  const clean = cleanName(name);
  return queued(async () => {
    const dir = path.join(requireRoot(), clean);
    if (await exists(dir)) throw new Error(`There is already a collection called "${clean}".`);
    await fsp.mkdir(dir);
    return { name: clean };
  });
}

/** Makes a collection with a free name, for "New collection" in the sidebar. */
export async function createUntitledCollection(base = 'New collection'): Promise<ReplayCollection> {
  return queued(async () => {
    const name = await freeName(requireRoot(), cleanName(base));
    await fsp.mkdir(path.join(requireRoot(), name));
    return { name };
  });
}

export async function renameCollection(from: string, to: string): Promise<ReplayCollection> {
  const clean = cleanName(to);
  return queued(async () => {
    const src = await requireCollection(from);
    const dst = path.join(requireRoot(), clean);
    if (src === dst) return { name: clean };
    // Windows sees "clan" and "Clan" as the same folder, so a change of case
    // alone would trip the existence check against itself.
    const caseOnly = src.toLowerCase() === dst.toLowerCase();
    if (!caseOnly && (await exists(dst))) throw new Error(`There is already a collection called "${clean}".`);
    if (caseOnly) {
      const via = `${src}.${process.pid}.renaming`;
      await fsp.rename(src, via);
      await fsp.rename(via, dst);
    } else {
      await fsp.rename(src, dst);
    }
    return { name: clean };
  });
}

/**
 * Deletes a collection. Its replays go back to unsorted rather than with it:
 * a folder is a label, and removing a label should never cost a battle.
 * Anything else the user kept in the folder stays, and so does the folder.
 */
export async function deleteCollection(name: string): Promise<{ kept: boolean }> {
  return queued(async () => {
    const dir = await requireCollection(name);
    const base = requireRoot();
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && path.extname(e.name).toLowerCase() === EXT) {
        await moveFile(path.join(dir, e.name), path.join(base, await freeName(base, e.name)));
      }
    }
    try {
      await fsp.rmdir(dir);
      return { kept: false };
    } catch {
      return { kept: true };
    }
  });
}

/* ------------------------------------------------------------------ */
/* Timelines                                                           */
/* ------------------------------------------------------------------ */

/**
 * The background baker. One replay at a time, lowest priority: a replay the
 * user opens jumps the queue, pausing whatever the queue was doing.
 */
let queue: string[] = [];
let queueTotal = 0;
let queueDone = 0;
interface RunningBake {
  id: string;
  slot: { child?: ChildProcessWithoutNullStreams };
  promise: Promise<void>;
  listeners: Set<(e: SidecarEvent) => void>;
}
let running: RunningBake | null = null;
let paused = 0;
let pumping = false;

function stopQueue(): void {
  queue = [];
  queueTotal = queueDone = 0;
  running?.slot.child?.kill();
}

/** Stops background baking when the app is going away. */
export function shutdownLibrary(): void {
  stopQueue();
}

function emitQueue(): void {
  emitLibrary({ t: 'queue', done: queueDone, total: queueTotal, current: running?.id ?? null });
}

/** Queues every replay the installed game can bake and has not yet. */
async function scheduleBakes(): Promise<void> {
  if (!root || !gameDir || !sidecarStatus().available) return;
  let listing: LibraryListing;
  try {
    listing = await queued(buildListing);
  } catch {
    return;
  }
  const want = listing.replays
    .filter((r) => r.state === 'bakeable' && !r.bakeError)
    // Oldest build first: it is the one closest to disappearing.
    .sort((a, b) => (a.build ?? 0) - (b.build ?? 0))
    .map((r) => r.id)
    .filter((id) => id !== running?.id && !queue.includes(id));
  if (!want.length) return;
  if (!queue.length && !running) queueTotal = queueDone = 0;
  queue.push(...want);
  queueTotal += want.length;
  emitQueue();
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length && !paused) {
      const id = queue.shift()!;
      // Opened by the user while it waited, and so baked already.
      if (!(await exists(bakedPath(id)))) await bakeOne(id, false).catch(() => undefined);
      queueDone++;
      emitQueue();
    }
  } finally {
    pumping = false;
    if (!queue.length) {
      queueTotal = queueDone = 0;
      emitQueue();
    }
  }
}

/**
 * Bakes one replay into the library. Shared by the queue and by opening a
 * replay; a second caller for the same replay waits on the first.
 */
function bakeOne(id: string, interactive: boolean, onEvent?: (e: SidecarEvent) => void): Promise<void> {
  if (running?.id === id) {
    if (onEvent) running.listeners.add(onEvent);
    return running.promise;
  }
  const listeners = new Set<(e: SidecarEvent) => void>(onEvent ? [onEvent] : []);
  const slot: { child?: ChildProcessWithoutNullStreams } = {};
  const promise = (async () => {
    const file = await replayPath(id);
    const out = bakedPath(id);
    try {
      await bakeToFile(
        { replay: file, gameDir, out, fps: DEFAULT_FPS },
        (e) => listeners.forEach((l) => l(e)),
        interactive ? undefined : slot,
      );
      await setBakeError(id, undefined);
      emitLibrary({ t: 'baked', id });
    } catch (err) {
      // A cancelled bake is not a broken replay; anything else is remembered
      // so the queue does not retry it on every listing.
      if (!/cancelled/i.test(message(err))) await setBakeError(id, message(err));
      throw err;
    }
  })();
  const entry = { id, slot, promise: promise.then(() => undefined), listeners };
  if (!interactive) {
    running = entry;
    void promise.finally(() => {
      if (running === entry) running = null;
    }).catch(() => undefined);
  }
  return promise;
}

async function setBakeError(id: string, error: string | undefined): Promise<void> {
  await queued(async () => {
    const lib = await readLibrary();
    const meta = lib.replays[id];
    if (!meta) return;
    if (error) meta.bakeError = error;
    else delete meta.bakeError;
    await writeJson(libraryFile(), lib);
  });
}

/**
 * The timeline for a replay, baking it first if it has not been.
 *
 * Progress goes to the renderer on `replay:progress`. With `rebake`, a stored
 * timeline is discarded and baked again (e.g. one in an unsupported format).
 */
export async function loadTimeline(id: string, opts: { rebake?: boolean } = {}): Promise<Uint8Array> {
  const out = bakedPath(id);
  if (opts.rebake) {
    const replay = await queued(() => findReplay(id));
    if (replay.build === null || !installedBuilds().has(replay.build)) {
      throw new Error(unplayableReason(replay));
    }
    await fsp.rm(out, { force: true });
  }
  if (!(await exists(out))) {
    const replay = await queued(() => findReplay(id));
    if (replay.state === 'unplayable') throw new Error(unplayableReason(replay));
    if (running?.id === id) {
      await bakeOne(id, false, emitToRenderer);
    } else {
      // Jump the queue: stop the background bake and put it back in front.
      paused++;
      const queued = queue.indexOf(id);
      if (queued >= 0) {
        queue.splice(queued, 1);
        queueDone++;
      }
      if (running) {
        queue.unshift(running.id);
        queueDone--;
        running.slot.child?.kill();
        await running.promise.catch(() => undefined);
      }
      try {
        await bakeOne(id, true, emitToRenderer);
      } finally {
        paused--;
        void pump();
      }
    }
  }
  return new Uint8Array(await fsp.readFile(out));
}

function unplayableReason(r: LibraryReplay): string {
  if (!gameDir) return 'Choose your World of Warships folder to watch this replay.';
  if (r.build === null) return 'This replay does not say which game version recorded it, so it cannot be played.';
  return `Recorded on game build ${r.build}, which is no longer installed, and never baked while it was. It cannot be played.`;
}

/* ------------------------------------------------------------------ */
/* Legacy store migration                                              */
/* ------------------------------------------------------------------ */

/**
 * Moves replays from the legacy app-data store (`data/replays/files/<id>.wowsreplay`
 * plus an index) into the library as unsorted files under their imported
 * names. Anything that cannot be moved stays in the legacy index and is
 * retried on the next start.
 */
async function migrateOldStore(): Promise<number> {
  const oldDir = path.join(storageRoot(), 'replays');
  const oldIndex = path.join(oldDir, 'index.json');
  const entries = await readJson<{ file: string; originalName: string; sha256: string; addedAt: number; probe: ReplayProbe | null; probeError?: string }[]>(oldIndex, []);
  if (!Array.isArray(entries) || !entries.length) return 0;

  return queued(async () => {
    const lib = await readLibrary();
    const base = requireRoot();
    const left: typeof entries = [];
    let moved = 0;
    for (const e of entries) {
      const from = path.join(oldDir, 'files', path.basename(String(e.file)));
      try {
        const name = path.basename(String(e.originalName || e.file));
        const to = path.join(base, await freeName(base, name.toLowerCase().endsWith(EXT) ? name : `${name}${EXT}`));
        await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL);
        const st = await fsp.stat(to);
        const sha = e.sha256 || (await hashFile(to));
        lib.files[rel(to)] = { size: st.size, mtimeMs: st.mtimeMs, sha };
        lib.replays[sha] ??= {
          addedAt: e.addedAt || Date.now(),
          lastSeen: Date.now(),
          probe: e.probe ?? null,
          ...(e.probeError ? { probeError: e.probeError } : {}),
        };
        await fsp.rm(from, { force: true });
        moved++;
      } catch {
        left.push(e);
      }
    }
    await writeJson(libraryFile(), lib);
    if (left.length) await writeJson(oldIndex, left);
    else {
      await fsp.rm(oldIndex, { force: true });
      await fsp.rm(path.join(oldDir, 'collections.json'), { force: true });
      await fsp.rmdir(path.join(oldDir, 'files')).catch(() => undefined);
      await fsp.rmdir(oldDir).catch(() => undefined);
    }
    return moved;
  });
}

/* ------------------------------------------------------------------ */
/* The game's own replays                                              */
/* ------------------------------------------------------------------ */

export interface FoundReplay {
  path: string;
  name: string;
  size: number;
  mtime: number;
  /** The version folder it sat in, e.g. `15.8.0.0`. */
  version: string;
  /** Already in the library, so importing it would be a no-op. */
  archived: boolean;
}

/**
 * Lists the replays the game itself has recorded, newest first.
 *
 * The game keeps them in `replays/`, either loose or in a folder per client
 * version. This only looks; importing is a separate, explicit step, because
 * a corpus of several hundred battles is not something to copy on a whim.
 *
 * Whether each one is already in the library is decided by content hash, the
 * same test `importReplays` uses, so the count shown and the count taken agree.
 */
export async function scanGameReplays(gameDirToScan: string, limit = 500): Promise<FoundReplay[]> {
  const base = path.join(gameDirToScan, 'replays');
  const found: { path: string; name: string; version: string }[] = [];

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

  await collect(base, '');
  let versions: string[] = [];
  try {
    const entries = await fsp.readdir(base, { withFileTypes: true });
    versions = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    /* no replays folder at all */
  }
  for (const version of versions) await collect(path.join(base, version), version);

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

  const known = root ? new Set((await queued(buildListing)).replays.map((r) => r.id)) : new Set<string>();
  return Promise.all(
    recent.map(async (f) => {
      let archived = false;
      try {
        archived = known.has(await hashFile(f.path));
      } catch {
        /* unreadable; treat as not archived and let the import report it */
      }
      return { path: f.path, name: f.name, size: f.size, mtime: f.mtime, version: f.version, archived };
    }),
  );
}

function message(err: unknown): string {
  return String((err as Error)?.message ?? err);
}
