/**
 * Updates, fetched from the release server on the VPS.
 *
 * This is the one place the application talks to the network. It only ever
 * reaches the update server baked in at build time (UPDATE_URL in
 * .env.release) and presents the build's update token, so users never sign in
 * to anything. Nothing is downloaded without the user saying so.
 *
 * Two install kinds update differently:
 *  - the NSIS install goes through electron-updater, reading latest.yml and
 *    running the new installer silently on restart;
 *  - the portable exe cannot run an installer over itself, so it reads
 *    portable.json, downloads the new exe beside the running one, swaps the
 *    files and relaunches.
 */

import { app, BrowserWindow, net } from 'electron';
import { CancellationToken } from 'builder-util-runtime';
import { autoUpdater } from 'electron-updater';
import semver from 'semver';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

declare const __UPDATE_URL__: string;
declare const __UPDATE_TOKEN__: string;

export type UpdateState =
  | { status: 'disabled'; reason: string }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current'; version: string }
  | { status: 'available'; version: string; size?: number }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };

/** What the release script writes next to the portable exe on the server. */
interface PortableManifest {
  version: string;
  file: string;
  sha512: string;
  size: number;
}

/**
 * A check that gets no answer in this long counts as offline. Downloads have
 * no overall limit (the installer is large and connections vary) but give up
 * once no data has arrived for STALL_TIMEOUT_MS.
 */
const CHECK_TIMEOUT_MS = 15_000;
const STALL_TIMEOUT_MS = 30_000;
const TIMEOUT_MESSAGE = 'The update server could not be reached.';

const feedUrl = __UPDATE_URL__.replace(/\/+$/, '');
const authHeader = `Bearer ${__UPDATE_TOKEN__}`;
const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;

let getWindow: () => BrowserWindow | null = () => null;
let state: UpdateState = { status: 'idle' };
let portableManifest: PortableManifest | null = null;
// Bumped by every check, so a request that answers after its timeout cannot
// overwrite the state a newer check has set.
let checkGeneration = 0;
/** Restarted by each chunk received; fires the abort for the running download. */
let stallWatch: { kick(): void; stop(): void } | null = null;

function setState(next: UpdateState): void {
  state = next;
  getWindow()?.webContents.send('update:state', state);
}

export function updateState(): UpdateState {
  return state;
}

export function initUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter;
  if (!app.isPackaged) return setState({ status: 'disabled', reason: 'Updates are off in development builds.' });
  if (!feedUrl || !__UPDATE_TOKEN__) return setState({ status: 'disabled', reason: 'This build has no update server.' });

  if (portableExe) {
    // Left behind by the previous swap, or by a download that never finished.
    void fsp.rm(`${portableExe}.old`, { force: true }).catch(() => undefined);
    void fsp.rm(`${portableExe}.update`, { force: true }).catch(() => undefined);
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
  autoUpdater.requestHeaders = { Authorization: authHeader };
  autoUpdater.on('download-progress', (p) => {
    stallWatch?.kick();
    if (state.status === 'downloading') setState({ ...state, percent: p.percent });
  });
  // Failures are reported through the promises below; this keeps the emitter
  // from throwing on an unhandled 'error'.
  autoUpdater.on('error', () => undefined);
}

/**
 * Asks the server for the newest version. A quiet check (the one at startup)
 * falls back to idle on failure: being offline is not worth an error.
 */
export async function checkForUpdates(quiet = false): Promise<UpdateState> {
  if (state.status === 'disabled' || state.status === 'downloading' || state.status === 'ready') return state;
  const generation = ++checkGeneration;
  setState({ status: 'checking' });
  try {
    if (portableExe) {
      const manifest = await fetchPortableManifest();
      if (generation !== checkGeneration) return state;
      portableManifest = manifest;
      if (semver.gt(manifest.version, app.getVersion())) {
        setState({ status: 'available', version: manifest.version, size: manifest.size });
      } else {
        setState({ status: 'current', version: app.getVersion() });
      }
    } else {
      const result = await withTimeout(autoUpdater.checkForUpdates(), CHECK_TIMEOUT_MS);
      if (generation !== checkGeneration) return state;
      const info = result?.updateInfo;
      if (info && semver.gt(info.version, app.getVersion())) {
        setState({ status: 'available', version: info.version, size: info.files[0]?.size });
      } else {
        setState({ status: 'current', version: app.getVersion() });
      }
    }
  } catch (err) {
    if (generation !== checkGeneration) return state;
    setState(quiet ? { status: 'idle' } : { status: 'error', message: describe(err) });
  }
  return state;
}

export async function downloadUpdate(): Promise<void> {
  if (state.status !== 'available') return;
  const version = state.version;
  setState({ status: 'downloading', version, percent: 0 });
  const abort = new AbortController();
  const cancellation = new CancellationToken();
  const watch = stallWatchdog(() => {
    abort.abort(new Error(TIMEOUT_MESSAGE));
    cancellation.cancel();
  });
  stallWatch = watch;
  try {
    if (portableExe) await downloadPortable(portableManifest!, portableExe, version, abort.signal);
    else await autoUpdater.downloadUpdate(cancellation);
    if (abort.signal.aborted) throw abort.signal.reason;
    setState({ status: 'ready', version });
  } catch (err) {
    setState({ status: 'error', message: abort.signal.aborted ? TIMEOUT_MESSAGE : describe(err) });
  } finally {
    watch.stop();
    if (stallWatch === watch) stallWatch = null;
  }
}

/** Restarts into the downloaded version. The renderer saves before calling this. */
export async function installUpdate(): Promise<void> {
  if (state.status !== 'ready') return;
  if (portableExe) await swapPortable(portableExe);
  // Silent install into the existing location, then launch the new version.
  else autoUpdater.quitAndInstall(true, true);
}

/* ---------------- portable ---------------- */

async function authorizedFetch(file: string, signal: AbortSignal): Promise<Response> {
  const res = await net.fetch(`${feedUrl}/${encodeURIComponent(file)}`, {
    headers: { Authorization: authHeader },
    cache: 'no-store',
    signal,
  });
  if (res.status === 401 || res.status === 403) throw new Error('The update server refused this build’s token.');
  if (!res.ok) throw new Error(`The update server answered ${res.status} for ${file}.`);
  return res;
}

async function fetchPortableManifest(): Promise<PortableManifest> {
  // The timeout covers the body as well as the headers.
  const signal = AbortSignal.timeout(CHECK_TIMEOUT_MS);
  let manifest: PortableManifest;
  try {
    manifest = (await (await authorizedFetch('portable.json', signal)).json()) as PortableManifest;
  } catch (err) {
    throw signal.aborted ? new Error(TIMEOUT_MESSAGE) : err;
  }
  if (!semver.valid(manifest.version) || !manifest.file || !manifest.sha512) {
    throw new Error('The update server sent an unreadable portable.json.');
  }
  return manifest;
}

/**
 * Streams the new exe next to the running one (same volume, so the swap is a
 * rename) and refuses it unless its hash matches the manifest.
 */
async function downloadPortable(manifest: PortableManifest, exe: string, version: string, signal: AbortSignal): Promise<void> {
  const staged = `${exe}.update`;
  const res = await authorizedFetch(manifest.file, signal);
  if (!res.body) throw new Error('The update server sent an empty download.');
  const total = Number(res.headers.get('content-length')) || manifest.size;
  const hash = crypto.createHash('sha512');
  const out = fs.createWriteStream(staged);
  let received = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      stallWatch?.kick();
      hash.update(value);
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      received += value.byteLength;
      if (total) setState({ status: 'downloading', version, percent: (received / total) * 100 });
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (hash.digest('base64') !== manifest.sha512) throw new Error('The downloaded update is damaged (checksum mismatch).');
  } catch (err) {
    out.destroy();
    await fsp.rm(staged, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * Windows lets a running exe be renamed but not overwritten: the old one steps
 * aside, the new one takes its name, and a hidden helper starts it once this
 * process and the portable launcher around it have exited.
 */
async function swapPortable(exe: string): Promise<void> {
  const staged = `${exe}.update`;
  const old = `${exe}.old`;
  await fsp.rm(old, { force: true });
  await fsp.rename(exe, old);
  try {
    await fsp.rename(staged, exe);
  } catch (err) {
    await fsp.rename(old, exe);
    throw err;
  }

  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const script = [
    `Wait-Process -Id ${process.pid},${process.ppid} -Timeout 60 -ErrorAction SilentlyContinue`,
    `Start-Process -FilePath ${quote(exe)}`,
  ].join('; ');
  spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { detached: true, stdio: 'ignore', windowsHide: true },
  ).unref();
  app.quit();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(TIMEOUT_MESSAGE)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Calls onStall once STALL_TIMEOUT_MS pass without a kick. */
function stallWatchdog(onStall: () => void): { kick(): void; stop(): void } {
  let timer = setTimeout(onStall, STALL_TIMEOUT_MS);
  return {
    kick() {
      clearTimeout(timer);
      timer = setTimeout(onStall, STALL_TIMEOUT_MS);
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(message)) {
    return 'The update server could not be reached.';
  }
  if (/\b40[13]\b/.test(message)) return 'The update server refused this build’s token.';
  if (/EPERM|EACCES/.test(message)) return 'No permission to replace the app in its folder. Move it somewhere writable, or update by hand.';
  return message.split('\n')[0];
}
