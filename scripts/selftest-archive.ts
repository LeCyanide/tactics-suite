/**
 * Checks for the replay archive.
 *
 * Everything here runs against a throwaway store under WOWSPLAN_DATA_DIR. The
 * import path is exercised with synthetic files: the archive's own job is
 * copying, de-duplicating and indexing, and it must do that whether or not the
 * add-on is installed to fill in metadata. Set WOWSPLAN_REPLAY to additionally
 * import a real replay and check the cached probe, and WOWSPLAN_GAME_DIR to
 * exercise the scan of the game's own replays folder.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  archiveUsage,
  importReplays,
  listReplays,
  refreshProbe,
  removeReplay,
  replayPath,
  scanGameReplays,
} from '../electron/replay/archive';
import { sidecarStatus } from '../electron/replay/sidecar';

type Check = (label: string, condition: boolean, detail?: unknown) => void;

/** A file that looks enough like a replay to get past the import guards. */
async function fakeReplay(dir: string, name: string, filler: string): Promise<string> {
  const file = path.join(dir, name);
  await fs.writeFile(file, Buffer.alloc(4096, filler));
  return file;
}

export async function testReplayArchive(check: Check): Promise<void> {
  console.log('\nreplay archive');

  const saved = process.env.WOWSPLAN_DATA_DIR;
  const store = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-archive-store-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-archive-src-'));
  process.env.WOWSPLAN_DATA_DIR = store;

  try {
    check('empty: starts with nothing', (await listReplays()).length === 0);
    const empty = await archiveUsage();
    check('empty: usage reports zero', empty.count === 0 && empty.bytes === 0, empty);

    const a = await fakeReplay(source, 'battle-a.wowsreplay', 'a');
    const b = await fakeReplay(source, 'battle-b.wowsreplay', 'b');

    const first = await importReplays([a, b]);
    check('import: both taken', first.added.length === 2, first);
    check('import: nothing failed', first.failed.length === 0, first.failed);
    check('import: original names kept', first.added.some((e) => e.originalName === 'battle-a.wowsreplay'), first.added);

    // The stored file is named from the id, so a hostile or merely awkward
    // source name can never decide where bytes land.
    check(
      'import: stored under an id, not the source name',
      first.added.every((e) => e.file.startsWith('rp-') && e.file.endsWith('.wowsreplay')),
      first.added.map((e) => e.file),
    );

    const stored = await replayPath(first.added[0]!.id);
    check('import: the stored file exists', await exists(stored), stored);
    check('import: stored inside the archive', stored.startsWith(path.join(store, 'replays', 'files')), stored);

    // Re-importing the same bytes under a different name must not duplicate:
    // the game writes the same battle into a version folder and users copy
    // them around, so the same replay arrives twice as a matter of course.
    const renamed = path.join(source, 'copied-elsewhere.wowsreplay');
    await fs.copyFile(a, renamed);
    const second = await importReplays([renamed]);
    check('dedupe: identical content refused', second.added.length === 0, second.added);
    check('dedupe: reported as a duplicate', second.duplicates.includes('copied-elsewhere.wowsreplay'), second);
    check('dedupe: archive did not grow', (await listReplays()).length === 2);

    // Duplicates within one batch, which a folder-wide selection produces.
    const c1 = await fakeReplay(source, 'same-1.wowsreplay', 'c');
    const c2 = await fakeReplay(source, 'same-2.wowsreplay', 'c');
    const batch = await importReplays([c1, c2]);
    check('dedupe: caught within a single batch', batch.added.length === 1 && batch.duplicates.length === 1, batch);

    // One bad file must not lose the good ones beside it.
    const wrongExt = path.join(source, 'notes.txt');
    await fs.writeFile(wrongExt, 'hello');
    const tiny = await fakeReplay(source, 'tiny.wowsreplay', 'z');
    await fs.writeFile(tiny, 'too small');
    const good = await fakeReplay(source, 'battle-d.wowsreplay', 'd');
    const mixed = await importReplays([wrongExt, tiny, good, path.join(source, 'ghost.wowsreplay')]);
    check('partial: the good file was taken', mixed.added.length === 1, mixed.added.length);
    check('partial: the other three failed', mixed.failed.length === 3, mixed.failed);
    check('partial: wrong extension explained', /\.wowsreplay/.test(reasonFor(mixed, 'notes.txt')), mixed.failed);
    check('partial: undersized file explained', /too small/i.test(reasonFor(mixed, 'tiny.wowsreplay')), mixed.failed);
    check('partial: missing file explained', reasonFor(mixed, 'ghost.wowsreplay').length > 0, mixed.failed);

    const all = await listReplays();
    check('list: holds every import', all.length === 4, all.length);
    // Newest first is what the sidebar renders without re-sorting.
    check(
      'list: newest first',
      all.every((e, i) => i === 0 || all[i - 1]!.addedAt >= e.addedAt),
      all.map((e) => e.addedAt),
    );

    const usage = await archiveUsage();
    check('usage: counts every replay', usage.count === 4, usage);
    check('usage: sums their sizes', usage.bytes === all.reduce((n, e) => n + e.size, 0), usage.bytes);

    // Removal has to take the file too, or the archive grows forever.
    const victim = all[0]!;
    const victimFile = await replayPath(victim.id);
    const remaining = await removeReplay(victim.id);
    check('remove: dropped from the index', remaining.length === 3, remaining.length);
    check('remove: file deleted', !(await exists(victimFile)), victimFile);
    check('remove: an unknown id is harmless', (await removeReplay('rp-nope')).length === 3);
    let pathRejected = false;
    try {
      await replayPath(victim.id);
    } catch {
      pathRejected = true;
    }
    check('remove: its path no longer resolves', pathRejected);

    // Removing one replay must leave the other files alone.
    const survivors = await listReplays();
    const stillThere = await Promise.all(survivors.map((e) => replayPath(e.id).then(exists)));
    check('remove: survivors untouched', stillThere.every(Boolean), stillThere);

    // Index writes are serialized, so overlapping imports must not lose entries.
    const p1 = fakeReplay(source, 'race-1.wowsreplay', '1').then((f) => importReplays([f]));
    const p2 = fakeReplay(source, 'race-2.wowsreplay', '2').then((f) => importReplays([f]));
    await Promise.all([p1, p2]);
    check('concurrency: both concurrent imports survive', (await listReplays()).length === 5, (await listReplays()).length);

    await testRealReplay(check);
    await testScan(check);
  } finally {
    if (saved === undefined) delete process.env.WOWSPLAN_DATA_DIR;
    else process.env.WOWSPLAN_DATA_DIR = saved;
    await fs.rm(store, { recursive: true, force: true });
    await fs.rm(source, { recursive: true, force: true });
  }
}

function reasonFor(outcome: { failed: { name: string; reason: string }[] }, name: string): string {
  return outcome.failed.find((f) => f.name === name)?.reason ?? '';
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

async function testRealReplay(check: Check): Promise<void> {
  const replay = process.env.WOWSPLAN_REPLAY;
  if (!replay) {
    console.log('  skip  importing a real replay (set WOWSPLAN_REPLAY)');
    return;
  }
  const outcome = await importReplays([replay]);
  check('real: imported', outcome.added.length === 1, outcome);
  const entry = outcome.added[0]!;

  if (sidecarStatus().available) {
    check('real: probed at import time', entry.probe !== null, entry.probeError);
    check('real: map captured', !!entry.probe?.map?.name, entry.probe?.map);
    check('real: no probe error', entry.probeError === undefined, entry.probeError);
    // Listing must not re-probe: the metadata is cached because archived
    // files never change.
    const listed = (await listReplays()).find((e) => e.id === entry.id);
    check('real: metadata survives a listing', listed?.probe?.map?.name === entry.probe?.map?.name, listed?.probe?.map);
    const refreshed = await refreshProbe(entry.id);
    check('real: re-probing agrees', refreshed.probe?.map?.name === entry.probe?.map?.name, refreshed.probe?.map);
  } else {
    check('real: kept despite no add-on', entry.probe === null && !!entry.probeError, entry);
  }

  // The copy in the archive must be byte-identical, or a bake would read
  // something the original never said.
  const original = await fs.readFile(replay);
  const copied = await fs.readFile(await replayPath(entry.id));
  check('real: archived copy is identical', original.equals(copied), {
    original: original.length,
    copied: copied.length,
  });
}

async function testScan(check: Check): Promise<void> {
  const gameDir = process.env.WOWSPLAN_GAME_DIR;
  if (!gameDir) {
    console.log('  skip  scanning the game replays folder (set WOWSPLAN_GAME_DIR)');
    return;
  }
  const found = await scanGameReplays(gameDir, 25);
  check('scan: found replays', found.length > 0, found.length);
  check('scan: capped at the limit', found.length <= 25, found.length);
  check(
    'scan: newest first',
    found.every((f, i) => i === 0 || found[i - 1]!.mtime >= f.mtime),
  );
  check('scan: every hit is a replay file', found.every((f) => f.name.endsWith('.wowsreplay')), found[0]?.name);
  check('scan: version folder recorded', found.every((f) => typeof f.version === 'string'), found[0]?.version);

  // Anything already archived is marked, so the UI never offers to import a
  // battle the user already has.
  const archived = await listReplays();
  const known = new Set(archived.map((e) => e.originalName));
  const flagged = found.filter((f) => f.archived);
  check(
    'scan: archived entries flagged by content',
    flagged.every((f) => known.has(f.name)),
    flagged.map((f) => f.name),
  );

  // A folder with no replays must come back empty rather than throwing.
  const nowhere = await scanGameReplays(path.join(os.tmpdir(), 'wt-no-game-here'));
  check('scan: a folder without replays is empty, not an error', nowhere.length === 0, nowhere.length);

  console.log(`  info  ${found.length} recent replays, ${flagged.length} already archived`);
}
