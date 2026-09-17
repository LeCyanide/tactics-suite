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
import path from 'node:path';

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
/** Set once Restart has been handled, so a second click cannot start a second swap. */
let installing = false;

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
    // Left behind by a download that never finished or a swap that timed out.
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
  if (state.status !== 'ready' || installing) return;
  installing = true;
  try {
    if (portableExe) await swapPortable(portableExe, state.version);
  } catch (err) {
    installing = false;
    throw err;
  }
  // Silent install into the existing location, then launch the new version.
  if (!portableExe) autoUpdater.quitAndInstall(true, true);
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
 * The portable launcher (this process's parent) holds its own exe open until
 * it exits, so the file cannot be renamed or replaced from in here. A hidden
 * helper waits for both processes to go, swaps in the new exe, retrying while
 * the launcher releases its lock, and starts whichever version is then in
 * place: the new one, or the old one if the swap never went through.
 *
 * A file named after its version (WoWS-Tactics-Toolkit-1.3.2.exe) is renamed
 * to the new one; a name without the running version is kept as it is. The
 * new version starts as soon as it is in place, and only then is the old file
 * removed, so a file that is slow or unable to go never holds up the restart.
 */
async function swapPortable(exe: string, newVersion: string): Promise<void> {
  const staged = `${exe}.update`;
  await fsp.access(staged);
  // Fail here, where the user can still be told, rather than after quitting.
  const probe = `${exe}.write-test`;
  await fsp.writeFile(probe, '');
  await fsp.rm(probe, { force: true });

  const name = path.basename(exe);
  const at = name.lastIndexOf(app.getVersion());
  const target =
    at >= 0
      ? path.join(path.dirname(exe), name.slice(0, at) + newVersion + name.slice(at + app.getVersion().length))
      : exe;

  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
  // Retries `action` until it stops throwing or a minute has passed.
  const retry = (action: string, done: string) =>
    `while ($true) { try { ${action}; Log ${quote(done)}; break } catch { if ((Get-Date) -gt $deadline) { Log ('gave up: ' + $_.Exception.Message); break }; Start-Sleep -Milliseconds 500 } }`;
  // [NullString]::Value, not $null: PowerShell would pass "" as the backup path.
  const place =
    target === exe
      ? [retry(`[System.IO.File]::Replace(${quote(staged)}, ${quote(exe)}, [NullString]::Value)`, 'replaced the exe'), `$start = ${quote(exe)}`]
      : [
          `$start = ${quote(exe)}`,
          `try { if ([System.IO.File]::Exists(${quote(target)})) { [System.IO.File]::Replace(${quote(staged)}, ${quote(target)}, [NullString]::Value) } else { [System.IO.File]::Move(${quote(staged)}, ${quote(target)}) }; $start = ${quote(target)}; Log ${quote(`saved the new exe as ${path.basename(target)}`)} } catch { Log ('could not save the new exe: ' + $_.Exception.Message) }`,
        ];
  // Runs after the new version has started; its minute of retries is its own.
  const cleanUp =
    target === exe
      ? []
      : [`if ($start -ne ${quote(exe)}) { $deadline = (Get-Date).AddSeconds(60); ${retry(`[System.IO.File]::Delete(${quote(exe)})`, 'removed the old exe')} }`];
  // What happened is only visible after this process is gone, so the helper
  // leaves a short trail in the temp folder.
  const log = path.join(app.getPath('temp'), 'wows-tactics-update.log');
  const script = [
    // Logging is best effort: a log another process holds open must not stop the swap.
    `function Log($m) { try { Add-Content -LiteralPath ${quote(log)} -Value ("{0:u} {1}" -f (Get-Date), $m) -ErrorAction Stop } catch {} }`,
    `Log 'waiting for the app to exit'`,
    `Wait-Process -Id ${process.pid},${process.ppid} -Timeout 60 -ErrorAction SilentlyContinue`,
    `$deadline = (Get-Date).AddSeconds(60)`,
    ...place,
    `Start-Process -FilePath $start`,
    `Log ('started ' + [System.IO.Path]::GetFileName($start))`,
    ...cleanUp,
  ].join('; ');
  launchHidden(script);
  app.quit();
}

/**
 * Runs a PowerShell script detached from this process and without a window.
 *
 * PowerShell spawned directly from here dies as soon as this process exits,
 * before running a line, so it needs a launcher that outlives us. `cmd /c
 * start` survives but opens a console that Windows Terminal, when it is the
 * default terminal, takes over and shows. wscript starting PowerShell with a
 * hidden window avoids both. VBScript is being retired from Windows, so
 * without wscript.exe the cmd route is still better than no update.
 */
function launchHidden(script: string): void {
  const command = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
  const wscript = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe');
  if (fs.existsSync(wscript)) {
    const vbs = path.join(app.getPath('temp'), 'wows-tactics-update.vbs');
    // Window style 0: hidden from the start, so no terminal ever claims it.
    fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run "${command}", 0, False\r\n`);
    spawn(wscript, ['//B', '//Nologo', vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }
  spawn('cmd.exe', ['/d', '/c', 'start', '""', '/b', ...command.split(' ')], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
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
