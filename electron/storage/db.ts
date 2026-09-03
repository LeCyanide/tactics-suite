/**
 * Local persistent store.
 *
 * Everything the application owns lives under the OS application-data
 * directory, on disk, with no network involvement whatsoever:
 *
 *   <userData>/
 *     settings.json                 application settings
 *     ships/ships.json              ship database
 *     ships/icons.json              icon asset index
 *     ships/icons/<id>.<ext>        imported ship icons
 *     maps/maps.json                map database index
 *     maps/cap-layouts.json         capture point layout library
 *     maps/assets/<id>.<ext>        imported map images
 *     projects/<id>.json            one document per project
 *     backups/<id>/<ts>.wowsplan    rolling backups
 *
 * Writes are atomic: content goes to a sibling `.tmp` file which is then
 * renamed over the target, so a crash mid-write can never leave a truncated
 * project behind.
 * A crash between the two steps leaves the temp file behind instead;
 * `sweepTempFiles` clears those orphans out on startup.
 *
 * The rest of the application only talks to this module through the IPC
 * surface in `electron/ipc.ts`, so the backing implementation can be replaced
 * with SQLite (or anything else) without touching the editor.
 */

import { app } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export function newId(prefix = ''): string {
  return prefix + crypto.randomUUID();
}

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

let ROOT = '';

/**
 * Where everything lives. Defaults to the OS application-data directory;
 * `WOWSPLAN_DATA_DIR` overrides it, which makes portable installs (all data on
 * a USB stick next to the executable) and side-by-side test data possible.
 */
export function storageRoot(): string {
  // The override is re-read every call so it always wins and never goes stale;
  // only the derived default is cached.
  const override = process.env.WOWSPLAN_DATA_DIR;
  if (override) return path.resolve(override);
  if (!ROOT) ROOT = path.join(app.getPath('userData'), 'data');
  return ROOT;
}

const P = {
  settings: () => path.join(storageRoot(), 'settings.json'),
  shipsDir: () => path.join(storageRoot(), 'ships'),
  shipsFile: () => path.join(storageRoot(), 'ships', 'ships.json'),
  iconIndex: () => path.join(storageRoot(), 'ships', 'icons.json'),
  iconsDir: () => path.join(storageRoot(), 'ships', 'icons'),
  mapsDir: () => path.join(storageRoot(), 'maps'),
  mapsFile: () => path.join(storageRoot(), 'maps', 'maps.json'),
  capLayoutsFile: () => path.join(storageRoot(), 'maps', 'cap-layouts.json'),
  mapAssetsDir: () => path.join(storageRoot(), 'maps', 'assets'),
  projectsDir: () => path.join(storageRoot(), 'projects'),
  projectFile: (id: string) => path.join(storageRoot(), 'projects', `${safeId(id)}.json`),
  backupsDir: (id: string) => path.join(storageRoot(), 'backups', safeId(id)),
};

/** Guards against an id ever escaping the storage root. */
function safeId(id: string): string {
  const cleaned = String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error(`Invalid id: ${id}`);
  return cleaned;
}

export function ensureDirs(): void {
  for (const dir of [
    storageRoot(),
    P.shipsDir(),
    P.iconsDir(),
    P.mapsDir(),
    P.mapAssetsDir(),
    P.projectsDir(),
    path.join(storageRoot(), 'backups'),
  ]) {
    // Same drive-root caveat as ensureParentDir: a portable install can point
    // WOWSPLAN_DATA_DIR at the root of a stick, which mkdir refuses to create.
    if (fs.existsSync(dir)) continue;
    fs.mkdirSync(dir, { recursive: true });
  }
}

/* ------------------------------------------------------------------ */
/* First-run seeding                                                   */
/* ------------------------------------------------------------------ */

/**
 * Where the shipped databases live.
 *
 * Packaged, electron-builder puts them beside the executable under
 * `resources/seed`; in development they are the `seed/` directory at the
 * repository root. Neither is guaranteed to be there — a checkout without the
 * seed, or a build configured without it, is a normal state — so the caller
 * treats `null` as "nothing to seed".
 */
function seedRoot(): string | null {
  const candidates: string[] = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'seed'));
  try {
    candidates.push(path.join(app.getAppPath(), 'seed'));
  } catch {
    /* app unavailable; the tests stub it out */
  }
  for (const dir of candidates) {
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Copies a file only where the destination is absent. Never overwrites. */
function copyFileIfAbsent(from: string, to: string): void {
  if (fs.existsSync(to) || !fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

/** Copies the contents of `fromDir` into `toDir`, keeping any file already there. */
function copyTreeInto(fromDir: string, toDir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(fromDir, { withFileTypes: true });
  } catch {
    return;
  }
  fs.mkdirSync(toDir, { recursive: true });
  for (const entry of entries) {
    const from = path.join(fromDir, entry.name);
    const to = path.join(toDir, entry.name);
    if (entry.isDirectory()) copyTreeInto(from, to);
    else copyFileIfAbsent(from, to);
  }
}

/**
 * Installs the ship database, the map library and the capture point layouts
 * on first run.
 *
 * Without this a fresh install opens with no ships, no maps and no layouts,
 * which is not an editor anyone can use: until now the databases were only
 * ever created by the import scripts in `scripts/`, on the machine that ran
 * them.
 *
 * Each database is keyed on its own index file and seeded only when that file
 * is absent, which buys three properties worth having:
 *
 *   - an existing store is never overwritten, so a user's edits survive every
 *     future release;
 *   - a user who deliberately empties a database keeps it empty, because the
 *     index file is still there;
 *   - a later version that adds a database seeds only that one on upgrade and
 *     leaves the rest alone.
 *
 * Individual assets are copied only where absent as well, so a first run
 * interrupted half way through resumes cleanly on the next start.
 *
 * Seeding is best-effort. A missing, partial or unreadable seed leaves the
 * store as empty as it would have been anyway, and must never stop the
 * application from starting. Returns the databases it actually filled, for
 * the startup log.
 */
export function seedStore(): string[] {
  const seed = seedRoot();
  if (!seed) return [];

  const seeded: string[] = [];
  const once = (index: string, label: string, fill: () => void): void => {
    if (fs.existsSync(index)) return;
    try {
      fill();
      seeded.push(label);
    } catch {
      /* leave this database empty; the application still runs */
    }
  };

  once(P.shipsFile(), 'ships', () => {
    copyFileIfAbsent(path.join(seed, 'ships', 'ships.json'), P.shipsFile());
    copyFileIfAbsent(path.join(seed, 'ships', 'icons.json'), P.iconIndex());
    copyTreeInto(path.join(seed, 'ships', 'icons'), P.iconsDir());
  });

  once(P.mapsFile(), 'maps', () => {
    copyFileIfAbsent(path.join(seed, 'maps', 'maps.json'), P.mapsFile());
    copyTreeInto(path.join(seed, 'maps', 'assets'), P.mapAssetsDir());
    copyTreeInto(
      path.join(seed, 'maps', 'archive-clan-battles'),
      path.join(storageRoot(), 'maps', 'archive-clan-battles'),
    );
  });

  once(P.capLayoutsFile(), 'cap layouts', () => {
    copyFileIfAbsent(path.join(seed, 'maps', 'cap-layouts.json'), P.capLayoutsFile());
  });

  return seeded;
}

/* ------------------------------------------------------------------ */
/* Atomic JSON helpers                                                 */
/* ------------------------------------------------------------------ */

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return fallback;
    // A corrupt file must not take the whole app down. Move it aside so the
    // user can recover it manually and carry on with a fresh document.
    try {
      await fsp.rename(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      /* ignore */
    }
    return fallback;
  }
}

/**
 * Creates the directory `file` lives in, if it is not already there.
 *
 * `fsp.mkdir(dir, { recursive: true })` is not the harmless no-op it looks
 * like on Windows: for the root of a drive it fails with EPERM instead of
 * reporting the directory as existing, so exporting straight onto `Z:\` used
 * to abort before a single byte was written. Stat first, and treat a racing
 * creator as success.
 */
export async function ensureParentDir(file: string): Promise<void> {
  const dir = path.dirname(file);
  try {
    if ((await fsp.stat(dir)).isDirectory()) return;
  } catch {
    /* not there yet - fall through to mkdir */
  }
  try {
    await fsp.mkdir(dir, { recursive: true });
  } catch (err: any) {
    if (err?.code !== 'EEXIST') throw err;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureParentDir(file);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

async function writeBinary(file: string, data: Buffer): Promise<void> {
  await ensureParentDir(file);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

/* Serialise writes per file so rapid autosaves cannot interleave. */
const writeQueues = new Map<string, Promise<unknown>>();
function queued<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  writeQueues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/* ------------------------------------------------------------------ */
/* Orphaned temp-file sweep                                            */
/* ------------------------------------------------------------------ */

/** The `<name>.<pid>.tmp` files written by the two helpers above. */
const TMP_PATTERN = /\.(\d+)\.tmp$/;

/**
 * How old a temp file whose pid still resolves to a running process must be
 * before we assume the number was recycled rather than that a write is in
 * flight. Any real write completes in milliseconds, so an hour is generous.
 */
const TMP_MAX_AGE_MS = 60 * 60 * 1000;

function pidIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs the permission/existence check without signalling.
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM means the process exists but belongs to someone else.
    return err?.code === 'EPERM';
  }
}

/** Every directory a `.tmp` file can be written into, backups included. */
async function tmpDirs(): Promise<string[]> {
  const backupsRoot = path.join(storageRoot(), 'backups');
  const dirs = [
    storageRoot(),
    P.shipsDir(),
    P.iconsDir(),
    P.mapsDir(),
    P.mapAssetsDir(),
    P.projectsDir(),
    backupsRoot,
  ];
  // Backups sit one level deeper, one directory per project.
  const entries = await fsp.readdir(backupsRoot, { withFileTypes: true }).catch(() => []);
  for (const e of entries) if (e.isDirectory()) dirs.push(path.join(backupsRoot, e.name));
  return dirs;
}

/**
 * Deletes temp files left behind by a process that died between writing one
 * and renaming it over its target. Nothing else ever removes them, so without
 * this they accumulate in `projects/`, `maps/` and `ships/` forever.
 *
 * A file is only removed once it is certain nobody is still writing it: its
 * pid is gone, or the file is old enough that a live pid must be a recycled
 * number rather than a second instance mid-write.
 *
 * Best-effort throughout — anything that cannot be inspected or deleted is
 * left where it is, exactly as an unreadable document is only moved aside.
 * Startup must never fail because of housekeeping.
 */
export async function sweepTempFiles(maxAgeMs = TMP_MAX_AGE_MS): Promise<string[]> {
  const removed: string[] = [];
  const now = Date.now();
  for (const dir of await tmpDirs()) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = TMP_PATTERN.exec(entry.name);
      if (!match) continue;
      const full = path.join(dir, entry.name);
      try {
        if (pidIsRunning(Number(match[1]))) {
          const st = await fsp.stat(full);
          if (now - st.mtimeMs < maxAgeMs) continue;
        }
        await fsp.rm(full, { force: true });
        removed.push(full);
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export async function getSettings(): Promise<Record<string, unknown>> {
  return readJson<Record<string, unknown>>(P.settings(), {});
}

export async function saveSettings(settings: Record<string, unknown>): Promise<void> {
  return queued('settings', () => writeJson(P.settings(), settings));
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

interface AnyProject {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  pages?: unknown[];
  [k: string]: unknown;
}

export async function listProjects(): Promise<
  {
    id: string;
    name: string;
    description?: string;
    createdAt: number;
    updatedAt: number;
    pageCount: number;
    sizeBytes: number;
  }[]
> {
  ensureDirs();
  const files = await fsp.readdir(P.projectsDir()).catch(() => [] as string[]);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(P.projectsDir(), f);
    const doc = await readJson<AnyProject | null>(full, null);
    if (!doc || !doc.id) continue;
    // Size of the document on disk, so the browser can show what a project
    // actually costs without loading every one of them.
    const sizeBytes = await fsp.stat(full).then((st) => st.size).catch(() => 0);
    out.push({
      id: doc.id,
      name: doc.name ?? 'Untitled',
      description: doc.description,
      createdAt: doc.createdAt ?? 0,
      updatedAt: doc.updatedAt ?? 0,
      pageCount: Array.isArray(doc.pages) ? doc.pages.length : 0,
      sizeBytes,
    });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export async function loadProject(id: string): Promise<AnyProject | null> {
  return readJson<AnyProject | null>(P.projectFile(id), null);
}

export async function saveProject(project: AnyProject): Promise<void> {
  if (!project?.id) throw new Error('Project has no id');
  return queued(`project:${project.id}`, () => writeJson(P.projectFile(project.id), project));
}

export async function deleteProject(id: string): Promise<void> {
  await fsp.rm(P.projectFile(id), { force: true });
  await fsp.rm(P.backupsDir(id), { recursive: true, force: true });
}

export async function createBackup(id: string, maxBackups = 15): Promise<string | null> {
  const doc = await loadProject(id);
  if (!doc) return null;
  const dir = P.backupsDir(id);
  await fsp.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}.wowsplan`);
  const packed = await packProject(doc);
  await writeBinary(file, packed);

  // Rolling window: drop the oldest backups beyond the configured limit.
  const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.wowsplan')).sort();
  while (files.length > maxBackups) {
    const oldest = files.shift();
    if (oldest) await fsp.rm(path.join(dir, oldest), { force: true });
  }
  return file;
}

export async function listBackups(id: string): Promise<{ file: string; name: string; size: number; mtime: number }[]> {
  const dir = P.backupsDir(id);
  const files = await fsp.readdir(dir).catch(() => [] as string[]);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.wowsplan')) continue;
    const full = path.join(dir, f);
    const st = await fsp.stat(full).catch(() => null);
    if (!st) continue;
    out.push({ file: full, name: f, size: st.size, mtime: st.mtimeMs });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/* ------------------------------------------------------------------ */
/* Maps                                                                */
/* ------------------------------------------------------------------ */

interface AnyMap {
  id: string;
  file: string;
  [k: string]: unknown;
}

export async function listMaps(): Promise<AnyMap[]> {
  return readJson<AnyMap[]>(P.mapsFile(), []);
}

/**
 * The capture point layout library.
 *
 * Read-only and shared by every project: these describe how the game itself
 * lays a map out, so nothing in the editor writes them back. A missing or
 * unreadable file simply means no layouts are on offer.
 */
export async function listCapLayouts(): Promise<unknown[]> {
  const doc = await readJson<{ layouts?: unknown[] } | unknown[] | null>(P.capLayoutsFile(), null);
  if (Array.isArray(doc)) return doc;
  return doc?.layouts ?? [];
}

async function writeMaps(maps: AnyMap[]): Promise<void> {
  return queued('maps', () => writeJson(P.mapsFile(), maps));
}

export async function saveMapRecord(map: AnyMap): Promise<AnyMap[]> {
  const maps = await listMaps();
  const idx = maps.findIndex((m) => m.id === map.id);
  if (idx >= 0) maps[idx] = map;
  else maps.push(map);
  await writeMaps(maps);
  return maps;
}

/** Stores raw image bytes for a map and returns the stored file name. */
export async function writeMapAsset(id: string, ext: string, data: Buffer): Promise<string> {
  const file = `${safeId(id)}${ext.startsWith('.') ? ext : `.${ext}`}`;
  await writeBinary(path.join(P.mapAssetsDir(), file), data);
  return file;
}

export async function readMapAsset(file: string): Promise<Buffer | null> {
  const full = path.join(P.mapAssetsDir(), path.basename(file));
  return fsp.readFile(full).catch(() => null);
}

export async function deleteMap(id: string): Promise<AnyMap[]> {
  const maps = await listMaps();
  const target = maps.find((m) => m.id === id);
  if (target?.file) {
    await fsp.rm(path.join(P.mapAssetsDir(), path.basename(String(target.file))), { force: true });
  }
  const next = maps.filter((m) => m.id !== id);
  await writeMaps(next);
  return next;
}

/* ------------------------------------------------------------------ */
/* Ships & icons                                                       */
/* ------------------------------------------------------------------ */

interface AnyShip {
  id: string;
  [k: string]: unknown;
}

export async function listShips(): Promise<AnyShip[]> {
  return readJson<AnyShip[]>(P.shipsFile(), []);
}

export async function saveShips(ships: AnyShip[]): Promise<void> {
  return queued('ships', () => writeJson(P.shipsFile(), ships));
}

interface AnyIcon {
  id: string;
  file: string;
  [k: string]: unknown;
}

export async function listIcons(): Promise<AnyIcon[]> {
  return readJson<AnyIcon[]>(P.iconIndex(), []);
}

async function writeIcons(icons: AnyIcon[]): Promise<void> {
  return queued('icons', () => writeJson(P.iconIndex(), icons));
}

export async function writeIconAsset(id: string, ext: string, data: Buffer): Promise<string> {
  const file = `${safeId(id)}${ext.startsWith('.') ? ext : `.${ext}`}`;
  await writeBinary(path.join(P.iconsDir(), file), data);
  return file;
}

export async function readIconAsset(file: string): Promise<Buffer | null> {
  const full = path.join(P.iconsDir(), path.basename(file));
  return fsp.readFile(full).catch(() => null);
}

export async function saveIconRecord(icon: AnyIcon): Promise<AnyIcon[]> {
  const icons = await listIcons();
  const idx = icons.findIndex((i) => i.id === icon.id);
  if (idx >= 0) icons[idx] = icon;
  else icons.push(icon);
  await writeIcons(icons);
  return icons;
}

export async function deleteIcon(id: string): Promise<AnyIcon[]> {
  const icons = await listIcons();
  const target = icons.find((i) => i.id === id);
  if (target?.file) {
    await fsp.rm(path.join(P.iconsDir(), path.basename(String(target.file))), { force: true });
  }
  const next = icons.filter((i) => i.id !== id);
  await writeIcons(next);
  return next;
}

/* ------------------------------------------------------------------ */
/* .wowsplan project package                                           */
/* ------------------------------------------------------------------ */

/**
 * A `.wowsplan` file is a gzip-compressed JSON envelope. It embeds every asset
 * the project references (map images, ship icons) plus the ship records used
 * by its pages, so the file is genuinely self-contained: copy it to another
 * machine, import it, and the project renders identically.
 */
export interface PlanPackage {
  format: 'wowsplan';
  formatVersion: number;
  exportedAt: number;
  project: AnyProject;
  maps: AnyMap[];
  ships: AnyShip[];
  icons: AnyIcon[];
  /** file name -> base64 payload */
  assets: Record<string, string>;
}

function collectMapIds(project: AnyProject): Set<string> {
  const ids = new Set<string>();
  for (const page of (project.pages ?? []) as any[]) {
    if (page?.mapId) ids.add(String(page.mapId));
  }
  return ids;
}

function collectShipIds(project: AnyProject): Set<string> {
  const ids = new Set<string>();
  for (const page of (project.pages ?? []) as any[]) {
    for (const obj of page?.objects ?? []) {
      if (obj?.type === 'ship' && obj.shipId) ids.add(String(obj.shipId));
    }
  }
  return ids;
}

export async function packProject(project: AnyProject): Promise<Buffer> {
  const mapIds = collectMapIds(project);
  const shipIds = collectShipIds(project);

  const allMaps = await listMaps();
  const allShips = await listShips();
  const allIcons = await listIcons();

  const maps = allMaps.filter((m) => mapIds.has(m.id));
  const ships = allShips.filter((s) => shipIds.has(s.id));
  const iconIds = new Set(ships.map((s) => s.iconId).filter(Boolean) as string[]);
  const icons = allIcons.filter((i) => iconIds.has(i.id));

  const assets: Record<string, string> = {};
  for (const m of maps) {
    const buf = await readMapAsset(String(m.file));
    if (buf) assets[`maps/${path.basename(String(m.file))}`] = buf.toString('base64');
  }
  for (const i of icons) {
    const buf = await readIconAsset(String(i.file));
    if (buf) assets[`icons/${path.basename(String(i.file))}`] = buf.toString('base64');
  }

  const pkg: PlanPackage = {
    format: 'wowsplan',
    formatVersion: 1,
    exportedAt: Date.now(),
    project,
    maps,
    ships,
    icons,
    assets,
  };
  return gzip(Buffer.from(JSON.stringify(pkg), 'utf8'));
}

export async function readPackage(file: string): Promise<PlanPackage> {
  const raw = await fsp.readFile(file);
  let text: string;
  // Tolerate both the compressed format and a plain-JSON file, so a
  // hand-edited export still imports.
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    text = (await gunzip(raw)).toString('utf8');
  } else {
    text = raw.toString('utf8');
  }
  const pkg = JSON.parse(text) as PlanPackage;
  if (pkg?.format !== 'wowsplan') throw new Error('Not a .wowsplan project file');
  return pkg;
}

/**
 * Imports a package. Maps, ships and icons are merged into the local
 * databases; the project is always given a fresh id so importing twice never
 * silently overwrites existing work.
 */
export async function importPackage(pkg: PlanPackage, opts: { newId?: boolean } = {}): Promise<AnyProject> {
  ensureDirs();

  for (const [name, b64] of Object.entries(pkg.assets ?? {})) {
    const buf = Buffer.from(b64, 'base64');
    const base = path.basename(name);
    if (name.startsWith('maps/')) await writeBinary(path.join(P.mapAssetsDir(), base), buf);
    else if (name.startsWith('icons/')) await writeBinary(path.join(P.iconsDir(), base), buf);
  }

  const maps = await listMaps();
  for (const m of pkg.maps ?? []) {
    if (!maps.some((x) => x.id === m.id)) maps.push(m);
  }
  await writeMaps(maps);

  const ships = await listShips();
  for (const s of pkg.ships ?? []) {
    const idx = ships.findIndex((x) => x.id === s.id);
    if (idx >= 0) ships[idx] = s;
    else ships.push(s);
  }
  await saveShips(ships);

  const icons = await listIcons();
  for (const i of pkg.icons ?? []) {
    if (!icons.some((x) => x.id === i.id)) icons.push(i);
  }
  await writeIcons(icons);

  const project = { ...pkg.project } as AnyProject;
  if (opts.newId !== false) {
    project.id = newId('prj-');
    project.name = `${project.name} (imported)`;
  }
  project.updatedAt = Date.now();
  await saveProject(project);
  return project;
}

export async function writeFileAbsolute(file: string, data: Buffer): Promise<void> {
  await writeBinary(file, data);
}

export async function readFileAbsolute(file: string): Promise<Buffer> {
  return fsp.readFile(file);
}

export function storageInfo(): { root: string } {
  return { root: storageRoot() };
}

export async function storageUsage(): Promise<{ path: string; bytes: number; files: number }[]> {
  const dirs = [
    ['Projects', P.projectsDir()],
    ['Maps', P.mapAssetsDir()],
    ['Ship icons', P.iconsDir()],
    ['Backups', path.join(storageRoot(), 'backups')],
  ] as const;
  const out = [];
  for (const [label, dir] of dirs) {
    let bytes = 0;
    let files = 0;
    const walk = async (d: string) => {
      const entries = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) await walk(full);
        else {
          const st = await fsp.stat(full).catch(() => null);
          if (st) {
            bytes += st.size;
            files += 1;
          }
        }
      }
    };
    await walk(dir);
    out.push({ path: label, bytes, files });
  }
  return out;
}
