/**
 * Checks for the replay viewer sidecar wrapper.
 *
 * The parts that run without the add-on or the game — locating the binary, the
 * portable gate, game-folder validation, and how a failing child is reported —
 * always run. The parts that need real inputs are skipped unless they are
 * there, so this passes on a machine with neither:
 *
 *   the sidecar binary   built, staged, or pointed at by WOWSPLAN_SIDECAR
 *   WOWSPLAN_GAME_DIR    a World of Warships install
 *   WOWSPLAN_REPLAY      a .wowsreplay recorded by that install
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  bakeInFlight,
  bakeReplay,
  cancelBake,
  checkGameDir,
  probeReplay,
  sidecarStatus,
  type SidecarEvent,
} from '../electron/replay/sidecar';

type Check = (label: string, condition: boolean, detail?: unknown) => void;

export async function testSidecar(check: Check): Promise<void> {
  console.log('\nreplay sidecar wrapper');

  await testLocation(check);
  await testGameDir(check);
  await testRun(check);
}

async function testLocation(check: Check): Promise<void> {
  const savedPortable = process.env.PORTABLE_EXECUTABLE_FILE;
  const savedSidecar = process.env.WOWSPLAN_SIDECAR;

  // Add-ons are installer-only, so the portable build must report unavailable
  // even when a binary is sitting right there. This is the gate the whole
  // add-on design rests on, so it is worth asserting rather than assuming.
  const decoy = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'wt-sidecar-')), 'wows-replay-sidecar.exe');
  await fs.writeFile(decoy, 'not really an executable');
  process.env.WOWSPLAN_SIDECAR = decoy;

  process.env.PORTABLE_EXECUTABLE_FILE = 'C:\\somewhere\\portable.exe';
  const portable = sidecarStatus();
  check('portable: reports unavailable', portable.available === false, portable);
  check('portable: says why', /installed version/i.test(portable.reason ?? ''), portable.reason);
  check('portable: hands out no executable', portable.exe === undefined, portable.exe);

  delete process.env.PORTABLE_EXECUTABLE_FILE;
  const pointed = sidecarStatus();
  check('locator: honours WOWSPLAN_SIDECAR', pointed.exe === decoy, pointed);

  process.env.WOWSPLAN_SIDECAR = path.join(path.dirname(decoy), 'does-not-exist.exe');
  const missing = sidecarStatus();
  // Falls through to the packaged and crate locations, which may legitimately
  // hold a real binary on a dev machine; either way it must not return the
  // path that does not exist.
  check('locator: skips a missing override', missing.exe !== process.env.WOWSPLAN_SIDECAR, missing);

  await fs.rm(path.dirname(decoy), { recursive: true, force: true });
  if (savedPortable === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE;
  else process.env.PORTABLE_EXECUTABLE_FILE = savedPortable;
  if (savedSidecar === undefined) delete process.env.WOWSPLAN_SIDECAR;
  else process.env.WOWSPLAN_SIDECAR = savedSidecar;
}

async function testGameDir(check: Check): Promise<void> {
  check('gameDir: empty path rejected', checkGameDir('').ok === false, checkGameDir(''));

  const absent = checkGameDir(path.join(os.tmpdir(), 'wt-definitely-not-here'));
  check('gameDir: missing folder rejected', absent.ok === false, absent.reason);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-game-'));
  const empty = checkGameDir(root);
  check('gameDir: folder without bin/ rejected', empty.ok === false, empty.reason);
  check('gameDir: names bin/ in the reason', /bin folder/i.test(empty.reason ?? ''), empty.reason);

  // A bin/ holding a build directory with no idx/ is the shape a partially
  // installed or mid-update game leaves behind.
  await fs.mkdir(path.join(root, 'bin', '13187581'), { recursive: true });
  const noIdx = checkGameDir(root);
  check('gameDir: build without idx/ rejected', noIdx.ok === false, noIdx.reason);

  await fs.mkdir(path.join(root, 'bin', '13187581', 'idx'), { recursive: true });
  await fs.mkdir(path.join(root, 'bin', '13015811', 'idx'), { recursive: true });
  await fs.mkdir(path.join(root, 'bin', 'notabuild'), { recursive: true });
  const ok = checkGameDir(root);
  check('gameDir: accepted with idx/', ok.ok === true, ok.reason);
  check('gameDir: builds newest first', JSON.stringify(ok.builds) === '[13187581,13015811]', ok.builds);
  check('gameDir: non-numeric entries ignored', ok.builds?.length === 2, ok.builds);

  await fs.rm(root, { recursive: true, force: true });

  const real = process.env.WOWSPLAN_GAME_DIR;
  if (real) {
    const live = checkGameDir(real);
    check('gameDir: real install accepted', live.ok === true, live.reason);
    console.log(`  info  builds found: ${live.builds?.join(', ')}`);
  } else {
    console.log('  skip  real install (set WOWSPLAN_GAME_DIR)');
  }
}

async function testRun(check: Check): Promise<void> {
  const status = sidecarStatus();
  if (!status.available) {
    console.log(`  skip  running the sidecar (${status.reason})`);
    return;
  }
  console.log(`  info  using ${status.exe}`);

  const replay = process.env.WOWSPLAN_REPLAY;
  const gameDir = process.env.WOWSPLAN_GAME_DIR;

  // A bad path must surface as a clean error, not a hang or an empty result:
  // this is the path a corrupt file in the archive takes.
  let rejected = false;
  let message = '';
  try {
    await probeReplay(path.join(os.tmpdir(), 'wt-no-such-replay.wowsreplay'));
  } catch (err) {
    rejected = true;
    message = (err as Error).message;
  }
  check('probe: a missing replay is an error', rejected, message);
  check('probe: the error explains itself', message.length > 10, message);

  if (!replay) {
    console.log('  skip  probe and bake (set WOWSPLAN_REPLAY)');
    return;
  }

  const probe = await probeReplay(replay);
  check('probe: map name present', !!probe.map?.name, probe.map);
  check('probe: map name is a space path', /^spaces\//.test(probe.map?.name ?? ''), probe.map?.name);
  check('probe: recording player present', !!probe.player?.name, probe.player);
  check('probe: roster present', (probe.vehicles?.length ?? 0) > 0, probe.vehicles?.length);
  // Relation 0 is the recording player; exactly one row should carry it.
  const selves = probe.vehicles?.filter((v) => v.relation === 0).length;
  check('probe: exactly one self in the roster', selves === 1, selves);

  if (!gameDir) {
    console.log('  skip  bake (set WOWSPLAN_GAME_DIR)');
    return;
  }

  check('bake: rejects a nonsense frame rate', await rejects(() => bakeReplay({ replay, gameDir, fps: 0 })), 'fps 0');
  check('bake: rejects a bad game folder', await rejects(() => bakeReplay({ replay, gameDir: os.tmpdir() })), 'tmp');

  const events: SidecarEvent[] = [];
  const started = Date.now();
  const { data, summary } = await bakeReplay({ replay, gameDir, fps: 5 }, (e) => events.push(e));
  const elapsed = Date.now() - started;

  check('bake: produced bytes', data.byteLength > 0, data.byteLength);
  check('bake: reported a summary', summary !== null, summary === null ? null : Object.keys(summary));
  check('bake: byte count matches the summary', summary?.bytes === data.byteLength, {
    summary: summary?.bytes,
    actual: data.byteLength,
  });
  check('bake: emitted stage events', events.some((e) => e.t === 'stage'), events.filter((e) => e.t === 'stage').length);
  check(
    'bake: emitted progress events',
    events.some((e) => e.t === 'progress'),
    events.filter((e) => e.t === 'progress').length,
  );
  check('bake: nothing in flight afterwards', bakeInFlight() === null, bakeInFlight());
  console.log(`  info  baked ${(data.byteLength / 1048576).toFixed(1)} MB at 5 fps in ${elapsed} ms`);

  // The blob has to be readable by the thing that consumes it, not merely
  // non-empty: this is the seam between the two halves of the feature.
  const { ReplayTimeline } = await import('../src/replay/timeline');
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const timeline = new ReplayTimeline(buf);
  check('bake: the reader accepts the blob', timeline.frameCount > 0, timeline.frameCount);
  check('bake: cadence round-trips', timeline.fps === 5, timeline.fps);
  check('bake: map agrees with the probe', timeline.header.map?.name === probe.map?.name, timeline.header.map);
  check('bake: last frame decodes', timeline.frame(timeline.frameCount - 1).length >= 0, 'last frame');

  // Cancelling is what happens when the user picks a different replay while
  // one is still baking, so it must reject the abandoned call rather than
  // leaving it pending forever.
  const inFlight = bakeReplay({ replay, gameDir, fps: 5 }).catch((err: Error) => err);
  check('cancel: in-flight bake is visible', bakeInFlight() === replay, bakeInFlight());
  cancelBake();
  const outcome = await inFlight;
  check('cancel: the abandoned bake rejects', outcome instanceof Error, outcome);
  check('cancel: slot is released', bakeInFlight() === null, bakeInFlight());
}

async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}
