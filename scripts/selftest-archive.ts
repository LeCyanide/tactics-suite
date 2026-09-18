/**
 * Checks for the replay library.
 *
 * Everything here runs against a throwaway library folder and a throwaway
 * store under WOWSPLAN_DATA_DIR. The import path is exercised with synthetic
 * files: the library's own job is copying, de-duplicating and keeping track of
 * files it does not control, and it must do that whether or not the add-on is
 * installed to fill in metadata. Set WOWSPLAN_REPLAY to additionally import a
 * real replay, and WOWSPLAN_GAME_DIR to exercise the scan of the game's own
 * replays folder and a real bake into the library.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  cleanName,
  configure,
  createCollection,
  createUntitledCollection,
  deleteCollection,
  importReplays,
  listLibrary,
  loadTimeline,
  moveReplays,
  removeReplay,
  renameCollection,
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
  console.log('\nreplay library');

  const saved = process.env.WOWSPLAN_DATA_DIR;
  const store = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-library-store-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-library-src-'));
  const lib = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'wt-library-')), 'Replays');
  process.env.WOWSPLAN_DATA_DIR = store;

  try {
    await testMigration(check, store, lib);

    const configured = await configure({ root: lib });
    check('configure: accepted', configured.ok, configured);
    check('configure: bookkeeping folder made', await exists(path.join(lib, '.wowstactics', 'baked')));
    check('configure: the bookkeeping folder is not a collection', !(await listLibrary()).collections.length);

    const a = await fakeReplay(source, 'battle-a.wowsreplay', 'a');
    const b = await fakeReplay(source, 'battle-b.wowsreplay', 'b');
    const first = await importReplays([a, b]);
    check('import: both taken', first.added.length === 2, first);
    check('import: nothing failed', first.failed.length === 0, first.failed);
    // Plain files under their own names: the folder is the user's to browse.
    check('import: stored under its own name', await exists(path.join(lib, 'battle-a.wowsreplay')));
    check('import: unsorted by default', first.added.every((r) => r.collection === null), first.added);

    // Re-importing the same bytes under a different name must not duplicate:
    // the game writes the same battle into a version folder and users copy
    // them around, so the same replay arrives twice as a matter of course.
    const renamed = path.join(source, 'copied-elsewhere.wowsreplay');
    await fs.copyFile(a, renamed);
    const second = await importReplays([renamed]);
    check('dedupe: identical content refused', second.added.length === 0, second.added);
    check('dedupe: reported as a duplicate', second.duplicates.includes('copied-elsewhere.wowsreplay'), second);

    const c1 = await fakeReplay(source, 'same-1.wowsreplay', 'c');
    const c2 = await fakeReplay(source, 'same-2.wowsreplay', 'c');
    const batch = await importReplays([c1, c2]);
    check('dedupe: caught within a single batch', batch.added.length === 1 && batch.duplicates.length === 1, batch);

    // A different battle with a name already taken lands beside it, not over it.
    const clash = path.join(source, 'clash');
    await fs.mkdir(clash);
    const other = await fakeReplay(clash, 'battle-a.wowsreplay', 'x');
    const clashed = await importReplays([other]);
    check('names: a taken name gets a suffix', clashed.added[0]?.name === 'battle-a (2).wowsreplay', clashed.added);

    // One bad file must not lose the good ones beside it.
    const wrongExt = path.join(source, 'notes.txt');
    await fs.writeFile(wrongExt, 'hello');
    const tiny = path.join(source, 'tiny.wowsreplay');
    await fs.writeFile(tiny, 'too small');
    const good = await fakeReplay(source, 'battle-d.wowsreplay', 'd');
    const mixed = await importReplays([wrongExt, tiny, good, path.join(source, 'ghost.wowsreplay')]);
    check('partial: the good file was taken', mixed.added.length === 1, mixed.added.length);
    check('partial: the other three failed', mixed.failed.length === 3, mixed.failed);
    check('partial: wrong extension explained', /\.wowsreplay/.test(reasonFor(mixed, 'notes.txt')), mixed.failed);
    check('partial: undersized file explained', /too small/i.test(reasonFor(mixed, 'tiny.wowsreplay')), mixed.failed);

    let listing = await listLibrary();
    check('list: holds every import', listing.replays.length === 5, listing.replays.length);
    check(
      'list: newest first',
      listing.replays.every((e, i) => i === 0 || listing.replays[i - 1]!.addedAt >= e.addedAt),
    );
    check(
      'list: without a game folder nothing is playable',
      listing.replays.every((r) => r.state === 'unplayable'),
      listing.replays.map((r) => r.state),
    );

    await testCollections(check, lib);
    await testOutsideChanges(check, lib);
    await testTimelines(check, lib);

    // Removal takes the file and its bake, or the folder grows forever.
    listing = await listLibrary();
    const victim = listing.replays[0]!;
    const victimFile = await replayPath(victim.id);
    await fs.writeFile(path.join(lib, '.wowstactics', 'baked', `${victim.id}.wtreply`), 'baked');
    const remaining = await removeReplay(victim.id);
    check('remove: dropped from the list', remaining.replays.length === listing.replays.length - 1);
    check('remove: file deleted', !(await exists(victimFile)), victimFile);
    check('remove: bake deleted', !(await exists(path.join(lib, '.wowstactics', 'baked', `${victim.id}.wtreply`))));
    check('remove: an unknown id is harmless', (await removeReplay('nope')).replays.length === remaining.replays.length);

    // Writes are serialized, so overlapping imports must not lose entries.
    const before = (await listLibrary()).replays.length;
    const p1 = fakeReplay(source, 'race-1.wowsreplay', '1').then((f) => importReplays([f]));
    const p2 = fakeReplay(source, 'race-2.wowsreplay', '2').then((f) => importReplays([f]));
    await Promise.all([p1, p2]);
    const after = (await listLibrary()).replays.length;
    check('concurrency: both concurrent imports survive', after === before + 2, { before, after });

    await testRealReplay(check);
    await testScan(check);
  } finally {
    if (saved === undefined) delete process.env.WOWSPLAN_DATA_DIR;
    else process.env.WOWSPLAN_DATA_DIR = saved;
    await fs.rm(store, { recursive: true, force: true });
    await fs.rm(source, { recursive: true, force: true });
    await fs.rm(path.dirname(lib), { recursive: true, force: true });
  }
}

/**
 * Replays from the store older versions kept in app data must come across
 * into the library, keeping the metadata they were probed with.
 */
async function testMigration(check: Check, store: string, lib: string): Promise<void> {
  const oldDir = path.join(store, 'replays');
  await fs.mkdir(path.join(oldDir, 'files'), { recursive: true });
  const bytes = Buffer.alloc(4096, 'm');
  await fs.writeFile(path.join(oldDir, 'files', 'rp-old.wowsreplay'), bytes);
  await fs.writeFile(
    path.join(oldDir, 'index.json'),
    JSON.stringify([
      {
        id: 'rp-old',
        file: 'rp-old.wowsreplay',
        originalName: 'old-battle.wowsreplay',
        size: bytes.length,
        sha256: '',
        addedAt: 1000,
        probe: { map: { displayName: 'Old map' } },
      },
    ]),
  );

  const res = await configure({ root: lib });
  check('migrate: reported', res.migrated === 1, res);
  check('migrate: moved under its original name', await exists(path.join(lib, 'old-battle.wowsreplay')));
  check('migrate: old store emptied', !(await exists(path.join(oldDir, 'index.json'))));
  const listed = (await listLibrary()).replays.find((r) => r.name === 'old-battle.wowsreplay');
  check('migrate: metadata kept', listed?.probe?.map?.displayName === 'Old map', listed);
  check('migrate: date kept', listed?.addedAt === 1000, listed?.addedAt);
  await removeReplay(listed!.id);
}

async function testCollections(check: Check, lib: string): Promise<void> {
  const clan = await createCollection('  Clan   battles ');
  check('collections: name tidied', clan.name === 'Clan battles', clan.name);
  check('collections: a real folder', await exists(path.join(lib, 'Clan battles')));
  check('collections: listed', (await listLibrary()).collections.some((c) => c.name === 'Clan battles'));
  check('collections: a duplicate name is refused', await rejects(() => createCollection('Clan battles')));
  check('collections: a blank name is refused', await rejects(() => createCollection('  ')));
  check('collections: a device name is refused', await rejects(() => createCollection('con')));
  check('names: reserved characters replaced', cleanName('a/b:c?') === 'a b c', cleanName('a/b:c?'));
  check('names: no hiding behind a dot', cleanName('..secret') === 'secret', cleanName('..secret'));
  const u1 = await createUntitledCollection();
  const u2 = await createUntitledCollection();
  check('collections: untitled ones get free names', u1.name === 'New collection' && u2.name === 'New collection (2)', [u1, u2]);

  const listing = await listLibrary();
  const [r1, r2] = listing.replays;
  const moved = await moveReplays([r1!.id, r2!.id, 'nope'], 'Clan battles');
  const filed = moved.replays.filter((r) => r.collection === 'Clan battles');
  check('move: filed under the collection', filed.length === 2, moved.replays);
  check('move: the file moved on disk', await exists(path.join(lib, 'Clan battles', r1!.name)));
  check('move: the id survives the move', filed.some((r) => r.id === r1!.id));
  check('move: an unknown collection is refused', await rejects(() => moveReplays([r1!.id], 'Nowhere')));
  const back = await moveReplays([r2!.id], null);
  check('move: null returns it to unsorted', back.replays.find((r) => r.id === r2!.id)?.collection === null);

  await renameCollection('Clan battles', 'Clan wars');
  let after = await listLibrary();
  check('rename: folder renamed', await exists(path.join(lib, 'Clan wars')));
  check('rename: replays follow', after.replays.find((r) => r.id === r1!.id)?.collection === 'Clan wars');
  // Windows treats the old and new name as the same folder.
  await renameCollection('Clan wars', 'CLAN WARS');
  after = await listLibrary();
  check('rename: a change of case alone works', after.collections.some((c) => c.name === 'CLAN WARS'), after.collections);
  check('rename: onto an existing name is refused', await rejects(() => renameCollection('CLAN WARS', 'New collection')));

  const del = await deleteCollection('CLAN WARS');
  after = await listLibrary();
  check('delete: the folder is gone', !del.kept && !(await exists(path.join(lib, 'CLAN WARS'))));
  check('delete: its replays stay, unsorted', after.replays.find((r) => r.id === r1!.id)?.collection === null);

  // A folder holding the user's own files is not theirs to lose.
  await fs.writeFile(path.join(lib, 'New collection', 'notes.txt'), 'mine');
  const kept = await deleteCollection('New collection');
  check('delete: a folder with other files is kept', kept.kept && (await exists(path.join(lib, 'New collection', 'notes.txt'))));
  await fs.rm(path.join(lib, 'New collection'), { recursive: true });
  await deleteCollection('New collection (2)');
}

/** The folder is the user's, so changes made in Explorer must be picked up. */
async function testOutsideChanges(check: Check, lib: string): Promise<void> {
  await fs.mkdir(path.join(lib, 'Dropped in'));
  await fakeReplay(path.join(lib, 'Dropped in'), 'by-hand.wowsreplay', 'h');
  let listing = await listLibrary();
  const byHand = listing.replays.find((r) => r.name === 'by-hand.wowsreplay');
  check('outside: a new folder is a collection', listing.collections.some((c) => c.name === 'Dropped in'));
  check('outside: a file dropped in is listed', byHand?.collection === 'Dropped in', byHand);

  await fs.rename(path.join(lib, 'Dropped in', 'by-hand.wowsreplay'), path.join(lib, 'by-hand.wowsreplay'));
  listing = await listLibrary();
  const movedByHand = listing.replays.find((r) => r.name === 'by-hand.wowsreplay');
  check('outside: a move keeps the id', movedByHand?.id === byHand?.id && movedByHand?.collection === null, movedByHand);

  // A copy of a battle already listed is shown once.
  await fs.copyFile(path.join(lib, 'by-hand.wowsreplay'), path.join(lib, 'Dropped in', 'copy.wowsreplay'));
  listing = await listLibrary();
  check('outside: a copied battle is listed once', listing.replays.filter((r) => r.id === byHand?.id).length === 1);
  check('outside: the copy is reported', listing.duplicates.includes('Dropped in/copy.wowsreplay'), listing.duplicates);

  await fs.rm(path.join(lib, 'Dropped in'), { recursive: true });
  await removeReplay(byHand!.id);
}

async function testTimelines(check: Check, lib: string): Promise<void> {
  const listing = await listLibrary();
  const r = listing.replays[0]!;
  // Stored bakes are served as they are, patch or no patch.
  const blob = Buffer.from('WTREPLY1 pretend timeline');
  await fs.writeFile(path.join(lib, '.wowstactics', 'baked', `${r.id}.wtreply`), blob);
  const relisted = (await listLibrary()).replays.find((x) => x.id === r.id);
  check('bake: a stored timeline makes it playable', relisted?.state === 'baked', relisted?.state);
  const loaded = await loadTimeline(r.id);
  check('bake: a stored timeline is served whole', Buffer.from(loaded).equals(blob), loaded.length);
  check('bake: rebaking a gone patch is refused', await rejects(() => loadTimeline(r.id, { rebake: true })));

  const unbaked = listing.replays.find((x) => x.id !== r.id)!;
  let reason = '';
  try {
    await loadTimeline(unbaked.id);
  } catch (err) {
    reason = (err as Error).message;
  }
  check('bake: an unplayable replay says why', reason.length > 0, reason);
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

async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function testRealReplay(check: Check): Promise<void> {
  const replay = process.env.WOWSPLAN_REPLAY;
  if (!replay) {
    console.log('  skip  importing a real replay (set WOWSPLAN_REPLAY)');
    return;
  }
  const outcome = await importReplays([replay]);
  const entry =
    outcome.added[0] ?? (await listLibrary()).replays.find((r) => r.name === path.basename(replay));
  check('real: imported', !!entry, outcome);
  if (!entry) return;

  if (sidecarStatus().available) {
    check('real: probed at import time', entry.probe !== null, entry.probeError);
    check('real: map captured', !!entry.probe?.map?.name, entry.probe?.map);
    check('real: build read from the version', entry.build !== null, entry.probe?.clientVersion);
  } else {
    check('real: kept despite no add-on', entry.probe === null && !!entry.probeError, entry);
  }

  // The copy must be byte-identical, or a bake would read something the
  // original never said.
  const original = await fs.readFile(replay);
  const copied = await fs.readFile(await replayPath(entry.id));
  check('real: library copy is identical', original.equals(copied), {
    original: original.length,
    copied: copied.length,
  });

  const gameDir = process.env.WOWSPLAN_GAME_DIR;
  if (gameDir && sidecarStatus().available) {
    const root = path.dirname(await replayPath(entry.id));
    await configure({ root, gameDir });
    const state = (await listLibrary()).replays.find((r) => r.id === entry.id)?.state;
    if (state === 'unplayable') {
      console.log(`  skip  baking: build ${entry.build} is not installed in ${gameDir}`);
      return;
    }
    const data = await loadTimeline(entry.id);
    check('real: baked into the library', data.length > 0 && (await exists(path.join(root, '.wowstactics', 'baked', `${entry.id}.wtreply`))));
    check('real: now listed as baked', (await listLibrary()).replays.find((r) => r.id === entry.id)?.state === 'baked');
    await configure({ root, gameDir: '' });
  }
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
  check('scan: newest first', found.every((f, i) => i === 0 || found[i - 1]!.mtime >= f.mtime));
  check('scan: every hit is a replay file', found.every((f) => f.name.endsWith('.wowsreplay')), found[0]?.name);

  // A folder with no replays must come back empty rather than throwing.
  const nowhere = await scanGameReplays(path.join(os.tmpdir(), 'wt-no-game-here'));
  check('scan: a folder without replays is empty, not an error', nowhere.length === 0, nowhere.length);

  console.log(`  info  ${found.length} recent replays, ${found.filter((f) => f.archived).length} already in the library`);
}
