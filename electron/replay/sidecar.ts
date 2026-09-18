/**
 * Drives the replay viewer sidecar.
 *
 * The sidecar is a separate executable rather than a library because all of
 * the replay parsing lives in landaire's Rust crates. This module owns its
 * whole lifetime: finding it, deciding whether the replay viewer is available
 * at all, and running its two commands.
 *
 *   probe  metadata for one replay. Milliseconds, no game install needed.
 *   bake   the full draw-command timeline. Seconds, and needs the install.
 *
 * The sidecar writes the timeline to stdout as binary and its progress to
 * stderr as newline-delimited JSON, so the two never interleave. A bake is
 * 7-41 MB; that is collected here and handed to the renderer in one piece,
 * because the reader wants random access to every frame and the alternative —
 * a temp file the renderer fetches back — buys nothing at this size.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
// BrowserWindow is a type here only: importing it as a value would drag the
// whole electron module into the headless self-test.
import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/** Frames per second of game time. Matches the sidecar's own default. */
export const DEFAULT_FPS = 10;

/**
 * A bake that produces no output at all for this long is treated as hung.
 * Generous on purpose: loading GameParams takes ~3.4 s and emits nothing while
 * it works, and a slow disk on a cold cache can be several times that.
 */
const SILENCE_TIMEOUT_MS = 90_000;

const EXE = process.platform === 'win32' ? 'wows-replay-sidecar.exe' : 'wows-replay-sidecar';

export interface SidecarStatus {
  /** Whether a replay can be baked right now. */
  available: boolean;
  /** Why not, for the UI to show verbatim. */
  reason?: string;
  /** Resolved executable, when there is one. */
  exe?: string;
}

/** What `probe` reports. Mirrors the sidecar's JSON, which is its contract. */
export interface ReplayProbe {
  file?: string;
  clientVersion?: string;
  dateTime?: string;
  map?: { name?: string; displayName?: string; id?: number };
  mode?: { gameMode?: number; gameType?: string | null; scenario?: string; matchGroup?: string | null };
  player?: { name?: string; vehicle?: string };
  durationSeconds?: number;
  playersPerTeam?: number;
  teamsCount?: number;
  vehicles?: { name: string; relation: number }[];
}

/** A line the sidecar wrote to stderr. */
export type SidecarEvent =
  | { t: 'stage'; stage: string }
  | { t: 'progress'; frame: number; total: number }
  | { t: 'warning'; msg: string }
  | { t: 'error'; msg: string }
  | { t: 'done'; [key: string]: unknown };

/* ------------------------------------------------------------------ */
/* Locating the executable                                            */
/* ------------------------------------------------------------------ */

/**
 * Where the sidecar lives.
 *
 * Packaged, electron-builder puts it under `resources/sidecar`. In development
 * it is either staged there by `npm run build:sidecar` or sitting in the
 * crate's own target directory, so a plain `cargo build` is enough to pick up
 * a change without re-staging.
 */
function locate(): string | null {
  const candidates: string[] = [];
  if (process.env.WOWSPLAN_SIDECAR) candidates.push(path.resolve(process.env.WOWSPLAN_SIDECAR));
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'sidecar', EXE));
  try {
    const root = app.getAppPath();
    candidates.push(path.join(root, 'resources', 'sidecar', EXE));
    candidates.push(path.join(root, 'sidecar', 'target', 'release', EXE));
  } catch {
    /* app unavailable; the tests stub it out */
  }
  for (const file of candidates) {
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

export function sidecarStatus(): SidecarStatus {
  // Add-ons ship with the installer only. The portable exe is a single file
  // the user drops anywhere, with no resources directory to carry a 17 MB
  // binary in, so the replay viewer is simply not part of it.
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    return { available: false, reason: 'The replay viewer is only available in the installed version.' };
  }
  const exe = locate();
  if (!exe) {
    return {
      available: false,
      reason: app.isPackaged
        ? 'The replay viewer add-on is not installed. Reinstall and enable it during setup.'
        : 'The sidecar is not built. Run "npm run build:sidecar".',
    };
  }
  return { available: true, exe };
}

/* ------------------------------------------------------------------ */
/* Game install                                                       */
/* ------------------------------------------------------------------ */

export interface GameDirCheck {
  ok: boolean
  reason?: string;
  /** Build numbers found under bin/, newest first. */
  builds?: number[];
}

/**
 * Whether a directory is a usable World of Warships install.
 *
 * Checked here rather than left to the sidecar because the wrong folder is the
 * most likely setup mistake, and a bake that fails after loading game data
 * reports it far less clearly than a dialog can.
 */
export function checkGameDir(dir: string): GameDirCheck {
  if (!dir) return { ok: false, reason: 'No game folder is set.' };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return { ok: false, reason: `${dir} does not exist.` };
  }
  if (!stat.isDirectory()) return { ok: false, reason: `${dir} is not a folder.` };

  const binDir = path.join(dir, 'bin');
  let entries: string[];
  try {
    entries = fs.readdirSync(binDir);
  } catch {
    return { ok: false, reason: `${dir} has no bin folder, so it is not a World of Warships install.` };
  }
  // Every build keeps its packed game data in bin/<build>/idx. Without one
  // there is nothing for the renderer to read ship and map data from.
  const builds = entries
    .map((name) => Number(name))
    .filter((n) => Number.isInteger(n) && n > 0)
    .filter((n) => {
      try {
        return fs.statSync(path.join(binDir, String(n), 'idx')).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => b - a);

  if (!builds.length) {
    return { ok: false, reason: `No game data found under ${binDir}. Is the game fully installed?` };
  }
  return { ok: true, builds };
}

/* ------------------------------------------------------------------ */
/* Running the sidecar                                                */
/* ------------------------------------------------------------------ */

class SidecarError extends Error {}

/** Splits a stream into complete lines, holding the partial tail. */
function lineReader(onLine: (line: string) => void): (chunk: Buffer) => void {
  let pending = '';
  return (chunk) => {
    pending += chunk.toString('utf8');
    let nl: number;
    while ((nl = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (line) onLine(line);
    }
  };
}

interface RunResult {
  stdout: Buffer;
  events: SidecarEvent[];
}

/**
 * Spawns the sidecar and resolves once it exits cleanly.
 *
 * No shell: the arguments include user-chosen paths, and a shell would
 * concatenate them unescaped.
 */
function run(
  args: string[],
  opts: { onEvent?: (e: SidecarEvent) => void; signal?: { child?: ChildProcessWithoutNullStreams } } = {},
): Promise<RunResult> {
  const status = sidecarStatus();
  if (!status.exe) return Promise.reject(new SidecarError(status.reason ?? 'The replay viewer is unavailable.'));

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(status.exe!, args, { windowsHide: true });
    if (opts.signal) opts.signal.child = child;

    const chunks: Buffer[] = [];
    const events: SidecarEvent[] = [];
    let settled = false;
    let lastError: string | null = null;

    let idle: NodeJS.Timeout;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        lastError = `The replay viewer stopped responding after ${SILENCE_TIMEOUT_MS / 1000}s.`;
        child.kill();
      }, SILENCE_TIMEOUT_MS);
    };
    touch();

    const finish = (err: Error | null, value?: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      if (err) reject(err);
      else resolve(value!);
    };

    child.stdout.on('data', (c: Buffer) => {
      touch();
      chunks.push(c);
    });

    child.stderr.on(
      'data',
      lineReader((line) => {
        touch();
        let event: SidecarEvent;
        try {
          event = JSON.parse(line) as SidecarEvent;
        } catch {
          // The sidecar only writes JSON, so anything else is a panic message
          // or a message from a library underneath it. Keep it: it is usually
          // the only description of what went wrong.
          lastError ??= line;
          return;
        }
        events.push(event);
        if (event.t === 'error') lastError = event.msg;
        opts.onEvent?.(event);
      }),
    );

    child.on('error', (err) =>
      finish(new SidecarError(`The replay viewer could not be started: ${err.message}`)),
    );

    child.on('close', (code, signal) => {
      if (signal && !lastError) {
        return finish(new SidecarError('The replay viewer was cancelled.'));
      }
      if (code !== 0) {
        return finish(new SidecarError(lastError ?? `The replay viewer failed (exit ${code ?? signal}).`));
      }
      finish(null, { stdout: Buffer.concat(chunks), events });
    });
  });
}

export async function probeReplay(replay: string): Promise<ReplayProbe> {
  const { stdout } = await run(['probe', '--replay', replay]);
  const text = stdout.toString('utf8').trim();
  try {
    return JSON.parse(text) as ReplayProbe;
  } catch {
    throw new SidecarError(`Could not read ${path.basename(replay)}: the replay viewer returned no metadata.`);
  }
}

export interface BakeOptions {
  replay: string;
  gameDir: string;
  fps?: number;
}

export interface BakeResult {
  /** The timeline blob, for `ReplayTimeline` in the renderer. */
  data: Uint8Array;
  /** The sidecar's closing summary: frames, records, bytes, elapsed, skipped. */
  summary: Record<string, unknown> | null;
}

/**
 * The bake in flight, if any.
 *
 * One at a time: a bake is the user opening a replay, and opening a second one
 * means they no longer want the first. Holding both would double the memory
 * and the CPU for a result that is about to be discarded.
 */
let current: { child?: ChildProcessWithoutNullStreams; replay: string } | null = null;

export function bakeInFlight(): string | null {
  return current?.replay ?? null;
}

/** Stops the running bake, if there is one. Safe to call when there is not. */
export function cancelBake(): void {
  current?.child?.kill();
  current = null;
}

export async function bakeReplay(opts: BakeOptions, onEvent?: (e: SidecarEvent) => void): Promise<BakeResult> {
  const game = checkGameDir(opts.gameDir);
  if (!game.ok) throw new SidecarError(game.reason!);

  const fps = opts.fps ?? DEFAULT_FPS;
  if (!(fps > 0 && fps <= 60)) throw new SidecarError(`${fps} is not a usable frame rate.`);

  cancelBake();
  const slot: { child?: ChildProcessWithoutNullStreams; replay: string } = { replay: opts.replay };
  current = slot;
  try {
    const { stdout, events } = await run(
      ['bake', '--game', opts.gameDir, '--replay', opts.replay, '--fps', String(fps)],
      { onEvent, signal: slot },
    );
    if (!stdout.length) throw new SidecarError('The replay viewer produced an empty timeline.');
    const done = events.find((e) => e.t === 'done') as (Record<string, unknown> & { t: 'done' }) | undefined;
    return { data: new Uint8Array(stdout), summary: done ?? null };
  } finally {
    if (current === slot) current = null;
  }
}

/**
 * Bakes a replay into a file, for the library to keep.
 *
 * With no `slot` this is the user's bake: it takes the single interactive slot,
 * so `cancelBake` stops it and opening another replay replaces it. With a
 * slot it is a background bake that the caller stops itself.
 *
 * Written beside and renamed, so an interrupted bake never leaves a truncated
 * timeline where a complete one is expected.
 */
export async function bakeToFile(
  opts: BakeOptions & { out: string },
  onEvent?: (e: SidecarEvent) => void,
  slot?: { child?: ChildProcessWithoutNullStreams },
): Promise<Record<string, unknown> | null> {
  const game = checkGameDir(opts.gameDir);
  if (!game.ok) throw new SidecarError(game.reason!);
  const fps = opts.fps ?? DEFAULT_FPS;
  if (!(fps > 0 && fps <= 60)) throw new SidecarError(`${fps} is not a usable frame rate.`);

  let own: { child?: ChildProcessWithoutNullStreams; replay: string } | null = null;
  if (!slot) {
    cancelBake();
    own = { replay: opts.replay };
    current = own;
  }
  const tmp = `${opts.out}.${process.pid}.tmp`;
  try {
    const { events } = await run(
      ['bake', '--game', opts.gameDir, '--replay', opts.replay, '--fps', String(fps), '--out', tmp],
      { onEvent, signal: slot ?? own! },
    );
    const size = fs.statSync(tmp, { throwIfNoEntry: false })?.size ?? 0;
    if (!size) throw new SidecarError('The replay viewer produced an empty timeline.');
    fs.renameSync(tmp, opts.out);
    const done = events.find((e) => e.t === 'done') as (Record<string, unknown> & { t: 'done' }) | undefined;
    return done ?? null;
  } finally {
    fs.rmSync(tmp, { force: true });
    if (own && current === own) current = null;
  }
}

/* ------------------------------------------------------------------ */
/* Renderer notifications                                             */
/* ------------------------------------------------------------------ */

let getWindow: () => BrowserWindow | null = () => null;

export function initSidecar(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter;
}

/** Forwards one sidecar event to the renderer. */
export function emitToRenderer(event: SidecarEvent): void {
  getWindow()?.webContents.send('replay:progress', event);
}

/** What the library tells the renderer while it bakes in the background. */
export type LibraryEvent =
  | { t: 'queue'; done: number; total: number; current: string | null }
  | { t: 'baked'; id: string };

export function emitLibrary(event: LibraryEvent): void {
  getWindow()?.webContents.send('replay:library', event);
}

/** Kills a running bake when the app is going away. */
export function shutdownSidecar(): void {
  cancelBake();
}
