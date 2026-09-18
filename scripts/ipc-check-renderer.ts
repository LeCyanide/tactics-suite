/**
 * Renderer half of the IPC check.
 *
 * Runs inside a real Electron renderer behind the real preload, so every call
 * here crosses contextBridge and ipcRenderer exactly as the application's does.
 * What it is really testing is the timeline hop: tens of megabytes of
 * Uint8Array coming back from `ipcMain.handle` through the structured clone,
 * arriving intact enough for `ReplayTimeline` to read.
 */

import { ReplayTimeline } from '@/replay/timeline';

declare global {
  interface Window {
    __check: {
      result(r: { label: string; ok: boolean; detail?: unknown }): void;
      info(text: string): void;
      done(): void;
      fatal(text: string): void;
    };
    /** Inputs handed over by the preload; the renderer has no `process`. */
    __env: { replay: string; gameDir: string; replayDir: string };
  }
}

const check = (label: string, ok: boolean, detail?: unknown) => window.__check.result({ label, ok, detail });
const info = (text: string) => window.__check.info(text);

async function run(): Promise<void> {
  const { replay, gameDir, replayDir } = window.__env;

  /* ---- the surface exists at all ---- */

  check('window.api.replay is exposed', typeof window.api?.replay?.load === 'function');

  const status = await window.api.replay.status();
  check('status crosses IPC', typeof status.available === 'boolean', status);
  if (!status.available) {
    info(`sidecar unavailable: ${status.reason}`);
    window.__check.done();
    return;
  }

  const configured = await window.api.replay.configure({ root: replayDir, gameDir });
  check('configure crosses IPC', configured.ok, configured);
  const empty = await window.api.replay.list();
  check('library listing crosses IPC', Array.isArray(empty.replays), empty.replays.length);

  /* ---- errors survive the hop as errors ---- */

  let rejected = false;
  try {
    await window.api.replay.load({ id: 'does-not-exist' });
  } catch (err) {
    rejected = true;
    check('a failing handler rejects in the renderer', (err as Error).message.length > 0, (err as Error).message);
  }
  check('an unknown replay id is an error', rejected);

  if (!replay || !gameDir) {
    info('set WOWSPLAN_REPLAY and WOWSPLAN_GAME_DIR to exercise a real bake');
    window.__check.done();
    return;
  }

  /* ---- the real thing ---- */

  const outcome = await window.api.replay.importPaths([replay]);
  check('import crosses IPC', outcome.added.length + outcome.duplicates.length === 1, {
    added: outcome.added.length,
    duplicates: outcome.duplicates.length,
    failed: outcome.failed,
  });
  const id = outcome.added[0]?.id ?? (await window.api.replay.list()).replays[0]?.id;
  check('the archived replay has an id', !!id);
  if (!id) return void window.__check.done();

  const events: string[] = [];
  const off = window.api.replay.onProgress((e) => events.push(e.t));

  const started = performance.now();
  // Rebake: the background queue may have baked it already, and this check
  // is about the bake's bytes crossing, not about reading a stored file.
  const data = await window.api.replay.load({ id, rebake: true });
  const elapsed = Math.round(performance.now() - started);
  off();

  // The whole reason for this test. Structured clone is specified to preserve
  // typed arrays, but "specified to" and "does, for 27 MB, through a preload
  // bridge" are different claims.
  check('bake returns a Uint8Array', data instanceof Uint8Array, Object.prototype.toString.call(data));
  check('the timeline has bytes', data.byteLength > 0, data.byteLength);
  check('progress events crossed IPC', events.length > 0, events.length);

  // Bytes surviving is not the same as bytes arriving in order. Decoding every
  // frame walks the whole blob and fails on the first wrong offset.
  const timeline = new ReplayTimeline(data);
  check('the reader accepts the transferred bytes', timeline.frameCount > 0, timeline.frameCount);
  let records = 0;
  for (let f = 0; f < timeline.frameCount; f++) records += timeline.frame(f).length;
  check('every frame decodes after the hop', records === timeline.header.records, {
    decoded: records,
    header: timeline.header.records,
  });
  info(`${(data.byteLength / 1048576).toFixed(1)} MB across IPC, ${records} records, bake ${elapsed} ms`);

  const again = await window.api.replay.load({ id });
  check('a second load is served from the stored bake', again.byteLength === data.byteLength, again.byteLength);

  const remaining = await window.api.replay.remove(id);
  check('remove crosses IPC', !remaining.replays.some((r) => r.id === id), remaining.replays.length);

  window.__check.done();
}

run().catch((err: Error) => window.__check.fatal(`renderer threw: ${err?.stack ?? err}`));
