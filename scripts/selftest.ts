/**
 * Headless checks for the paths that are pure logic and would otherwise only
 * be exercised by hand: messy ship-data import, the .wowsplan
 * pack/read/import round-trip, the destinations an export can be written to,
 * the accent folding every name lookup goes through, the startup sweep of
 * orphaned temp files, the store migration after the rename, and seeding
 * across releases.
 *
 *   npm run selftest
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseShipData, serializeShips } from '../src/lib/shipImport';
import { foldForSearch } from '../src/lib/util';
import { matchShip } from '../src/lib/shipMatch';
import type { Ship } from '../src/types/model';
import { allowedBy, filterShips, hasRadar, hasSmoke, inScope, limitUse, type ShipFilter } from '../src/lib/shipFilters';
import { mergeKey, shipRangeKm } from '../src/state/store';
import * as db from '../electron/storage/db';
import { LEGACY_APP_FOLDERS, adoptLegacyStore } from '../electron/storage/migrate';
import { testReplayArchive } from './selftest-archive';
import { testSidecar } from './selftest-sidecar';
import { testReplayTimeline } from './selftest-timeline';

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`);
  }
}

async function testShipImport(): Promise<void> {
  console.log('\nship data import');

  // A deliberately awkward CSV: alias column names, unit suffixes, a Roman
  // tier, a thousands separator, a range given in metres, and an "N/A".
  const csv = [
    'Ship,Country,Type,Level,Health,Detectability,Surveillance Radar,Hydroacoustic Search,Firing Range,Torpedo Range,Max Speed',
    'Des Moines,USA,Heavy Cruiser,X,"60,000",9.6 km,10.0 km,5.0 km,15.8 km,N/A,33 kn',
    'Shimakaze,Japan,Destroyer,10,21500,5.6,-,-,11.5,20000,39',
  ].join('\n');

  const fromCsv = parseShipData(csv, '.csv');
  check('csv: two ships parsed', fromCsv.ships.length === 2, fromCsv.ships.length);
  const dm = fromCsv.ships.find((s) => s.name === 'Des Moines')!;
  check('csv: "Heavy Cruiser" -> CA', dm.class === 'CA', dm.class);
  check('csv: Roman tier X -> 10', dm.tier === 10, dm.tier);
  check('csv: "60,000" -> 60000 hp', dm.hp === 60000, dm.hp);
  check('csv: "9.6 km" -> 9.6', dm.concealment_km === 9.6, dm.concealment_km);
  check('csv: radar alias mapped', dm.radar_km === 10, dm.radar_km);
  check('csv: "N/A" torpedoes dropped', dm.torpedoRange_km === undefined, dm.torpedoRange_km);
  check('csv: "33 kn" -> 33', dm.speed_kn === 33, dm.speed_kn);
  const shima = fromCsv.ships.find((s) => s.name === 'Shimakaze')!;
  check('csv: "Destroyer" -> DD', shima.class === 'DD', shima.class);
  check('csv: 20000 m -> 20 km', shima.torpedoRange_km === 20, shima.torpedoRange_km);
  check('csv: "-" radar dropped', shima.radar_km === undefined, shima.radar_km);

  // The in-game export shape: every unit in the header, and 0 standing in for
  // "this ship has none".
  const wows = [
    'Ship,Class,Tier,Nation,Detection by Sea (km),Detection by Air (km),Main Battery Range (km),Torpedo Range (km),Airstrike Min Range (km),Airstrike Max Range (km),Radar Range (km),Hydro Range (km)',
    'Petropavlovsk,Cruiser,10,U.S.S.R.,11.90,7.75,19.70,0,0,0,12.00,5.00',
    'Gouden Leeuw,Cruiser,10,Netherlands,11.34,7.61,17.90,0,1.50,13.00,0,0',
  ].join('\n');

  const fromWows = parseShipData(wows, '.csv');
  const petro = fromWows.ships.find((s) => s.name === 'Petropavlovsk')!;
  check('wows: "(km)" header suffix ignored', petro.concealment_km === 11.9, petro.concealment_km);
  check('wows: air detection mapped', petro.concealmentAir_km === 7.75, petro.concealmentAir_km);
  check('wows: main battery range mapped', petro.mainBatteryRange_km === 19.7, petro.mainBatteryRange_km);
  check('wows: radar range mapped', petro.radar_km === 12, petro.radar_km);
  check('wows: hydro range mapped', petro.hydro_km === 5, petro.hydro_km);
  check('wows: 0 torpedo range -> absent', petro.torpedoRange_km === undefined, petro.torpedoRange_km);
  check('wows: "U.S.S.R." -> USSR', petro.nation === 'USSR', petro.nation);
  check('wows: 0 airstrike -> absent', petro.airstrikeMaxRange_km === undefined, petro.airstrikeMaxRange_km);
  check('wows: nothing left over to note', petro.notes === undefined, petro.notes);
  const leeuw = fromWows.ships.find((s) => s.name === 'Gouden Leeuw')!;
  check('wows: airstrike min mapped', leeuw.airstrikeMinRange_km === 1.5, leeuw.airstrikeMinRange_km);
  check('wows: airstrike max mapped', leeuw.airstrikeMaxRange_km === 13, leeuw.airstrikeMaxRange_km);
  check('wows: 0 radar -> absent', leeuw.radar_km === undefined, leeuw.radar_km);

  // The ring is drawn from the maximum alone; the minimum is data only.
  check('range: airstrike ring uses the maximum', shipRangeKm(leeuw, 'airstrike') === 13, shipRangeKm(leeuw, 'airstrike'));
  check('range: no airstrike -> no ring', shipRangeKm(petro, 'airstrike') === undefined, shipRangeKm(petro, 'airstrike'));

  // JSON with a wrapper object and nested consumables.
  const json = JSON.stringify({
    ships: [
      {
        name: 'Minotaur', nation: 'UK', class: 'CL', tier: 10,
        concealment: 9.1, radar: { }, radar_km: 8.5,
        consumables: ['Smoke Generator', { name: 'Surveillance Radar', range: 8.5, duration: 40 }],
        someUnknownField: 'keep me',
      },
    ],
  });
  const fromJson = parseShipData(json, '.json');
  check('json: wrapper unwrapped', fromJson.ships.length === 1, fromJson.ships.length);
  const mino = fromJson.ships[0];
  check('json: "CL" -> CA', mino.class === 'CA', mino.class);
  check('json: consumables parsed', (mino.consumables?.length ?? 0) === 2, mino.consumables);
  check('json: consumable range mapped', mino.consumables?.[1].range_km === 8.5, mino.consumables?.[1]);
  check('json: unknown field kept in notes', !!mino.notes?.includes('keep me'), mino.notes);

  // Name-keyed object form.
  const keyed = parseShipData(JSON.stringify({ Yamato: { nation: 'Japan', class: 'BB', tier: 10 } }), '.json');
  check('json: name-keyed object form', keyed.ships[0]?.name === 'Yamato', keyed.ships[0]?.name);

  // YAML round-trip through our own serializer.
  const yamlText = serializeShips(fromCsv.ships, 'yaml');
  const fromYaml = parseShipData(yamlText, '.yaml');
  check('yaml: round-trip preserves count', fromYaml.ships.length === 2, fromYaml.ships.length);
  check(
    'yaml: round-trip preserves radar',
    fromYaml.ships.find((s) => s.name === 'Des Moines')?.radar_km === 10,
  );

  // CSV round-trip.
  const csvText = serializeShips(fromCsv.ships, 'csv');
  const back = parseShipData(csvText, '.csv');
  check('csv: round-trip preserves ids', back.ships[0]?.id === fromCsv.ships[0]?.id, back.ships[0]?.id);
}

async function testShipFilters(): Promise<void> {
  console.log('\nship filters');

  // "Smoke" is one column that sources fill with either a yes/no or a radius.
  const csv = [
    'Ship,Class,Tier,Radar,Smoke,Smoke Radius (km)',
    'Minotaur,Cruiser,10,10,yes,0.45',
    'Des Moines,Cruiser,10,10,no,',
    'Shimakaze,Destroyer,10,0,0.45,',
    'Yamato,Battleship,10,,,',
    'Kagero,Destroyer,8,,x,',
  ].join('\n');
  const { ships } = parseShipData(csv, '.csv');
  const named = (name: string) => ships.find((s) => s.name === name)!;

  check('smoke: "yes" sets the flag', named('Minotaur').smoke === true, named('Minotaur'));
  check('smoke: a yes/no does not swallow the radius column', named('Minotaur').smokeRadius_km === 0.45);
  check('smoke: "no" is kept, not dropped', named('Des Moines').smoke === false && !hasSmoke(named('Des Moines')));
  check('smoke: a number in the column is a radius', named('Shimakaze').smokeRadius_km === 0.45 && named('Shimakaze').smoke === undefined);
  check('smoke: a radius alone counts as smoke', hasSmoke(named('Shimakaze')));
  check('smoke: nothing said means none', !hasSmoke(named('Yamato')));
  check('smoke: listed consumable counts', hasSmoke({ ...named('Yamato'), consumables: [{ name: 'Smoke Generator' }] }));
  check('smoke: the flag overrides a stray radius', !hasSmoke({ ...named('Shimakaze'), smoke: false }));
  check('radar: a range counts, a zero does not', hasRadar(named('Minotaur')) && !hasRadar(named('Shimakaze')));

  const back = parseShipData(serializeShips(ships, 'csv'), '.csv').ships;
  check(
    'smoke: flag and radius survive a CSV round trip',
    back.every((s) => s.smoke === named(s.name).smoke && s.smokeRadius_km === named(s.name).smokeRadius_km),
    back.map((s) => [s.name, s.smoke, s.smokeRadius_km]),
  );

  const base: ShipFilter = { query: '', nation: '', cls: '', tier: '', radar: '', smoke: '', ruleset: null };
  const names = (f: Partial<ShipFilter>) => filterShips(ships, { ...base, ...f }).map((s) => s.name).sort().join(',');
  check('filter: has radar', names({ radar: 'yes' }) === 'Des Moines,Minotaur', names({ radar: 'yes' }));
  check('filter: no smoke', names({ smoke: 'no' }) === 'Des Moines,Yamato', names({ smoke: 'no' }));
  check('filter: radar and smoke together', names({ radar: 'yes', smoke: 'yes' }) === 'Minotaur');

  const open = { id: 'r', name: 'Open', tiers: [], classes: [], banned: [], limits: [], maxShips: 0 };
  check('ruleset: an empty one allows everything', ships.every((s) => allowedBy(open, s)));
  const season = { ...open, tiers: [10], classes: ['CA' as const, 'DD' as const], banned: [named('Minotaur').id] };
  check('ruleset: tier, class and ban all apply', names({ ruleset: season }) === 'Des Moines,Shimakaze', names({ ruleset: season }));
  check('ruleset: a banned ship is still in scope', inScope(season, named('Minotaur')) && !inScope(season, named('Kagero')));

  const [mino, dm, shima] = ['Minotaur', 'Des Moines', 'Shimakaze'].map((n) => named(n).id);
  const capped = {
    ...open,
    limits: [
      { id: 'a', max: 2, ships: [mino, dm, shima] },
      { id: 'b', max: 1, ships: [dm] },
    ],
  };
  check('limit: a ship no limit names has none', limitUse(capped, named('Yamato').id, [mino, dm]) === null);
  const twoPlaced = limitUse(capped, shima, [mino, mino, null, named('Yamato').id]);
  check('limit: the same ship twice counts twice', twoPlaced?.used === 2 && twoPlaced.max === 2, twoPlaced);
  const tight = limitUse(capped, dm, []);
  check('limit: the tightest of several limits is reported', tight?.used === 0 && tight.max === 1, tight);
}

/**
 * A store under a legacy folder name moves to the current one with everything
 * in it. Each case is a temp tree standing in for %APPDATA%.
 */
async function testStoreMigration(): Promise<void> {
  console.log('\nstore migration on rename');

  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'wowsplan-migrate-'));
  const exists = (p: string) => fs.access(p).then(() => true, () => false);
  let n = 0;
  const appData = async (withOld: boolean, withNew: boolean) => {
    const dir = path.join(base, String(n++));
    const oldData = path.join(dir, LEGACY_APP_FOLDERS[0], 'data');
    const newData = path.join(dir, 'WoWs Tactics Suite', 'data');
    if (withOld) {
      await fs.mkdir(path.join(oldData, 'projects'), { recursive: true });
      await fs.writeFile(path.join(oldData, 'projects', 'p1.json'), '{"name":"old plan"}');
      await fs.writeFile(path.join(oldData, 'settings.json'), '{"theme":"light"}');
    }
    if (withNew) {
      await fs.mkdir(newData, { recursive: true });
      await fs.writeFile(path.join(newData, 'settings.json'), '{"theme":"dark"}');
    }
    return { oldData, newData };
  };

  {
    const { oldData, newData } = await appData(false, false);
    const adopted = adoptLegacyStore(newData, [oldData]);
    check('a first install starts a fresh store', adopted.outcome === 'fresh' && adopted.root === newData, adopted);
    check('and creates nothing while deciding', !(await exists(newData)));
  }

  {
    const { oldData, newData } = await appData(true, false);
    const adopted = adoptLegacyStore(newData, [oldData]);
    check('a store under the old name is moved to the new one', adopted.outcome === 'moved' && adopted.root === newData, adopted);
    const plan = await fs.readFile(path.join(newData, 'projects', 'p1.json'), 'utf8').catch(() => '');
    check('with its projects and settings intact', plan === '{"name":"old plan"}' && (await exists(path.join(newData, 'settings.json'))));
    check('leaving no second copy behind', !(await exists(oldData)));
    const again = adoptLegacyStore(newData, [oldData]);
    check('and the next start simply uses it', again.outcome === 'current' && again.from === undefined, again);
  }

  {
    const { oldData, newData } = await appData(true, true);
    const adopted = adoptLegacyStore(newData, [oldData]);
    check('a store already under the new name wins', adopted.outcome === 'current' && adopted.root === newData, adopted);
    const settings = await fs.readFile(path.join(newData, 'settings.json'), 'utf8');
    check('and neither folder is touched', settings === '{"theme":"dark"}' && (await exists(path.join(oldData, 'projects', 'p1.json'))));
  }

  {
    // The new place cannot be created: its parent path is taken by a file.
    // Both the move and the copy must fail, and the old store must survive.
    const { oldData } = await appData(true, false);
    const blocker = path.join(base, 'blocker');
    await fs.writeFile(blocker, '');
    const adopted = adoptLegacyStore(path.join(blocker, 'data'), [oldData]);
    check('when the store cannot be brought over it is used where it is', adopted.outcome === 'left-in-place' && adopted.root === oldData, adopted);
    check('and it is still whole', await exists(path.join(oldData, 'projects', 'p1.json')));
  }

  await fs.rm(base, { recursive: true, force: true });
}

async function testPackage(): Promise<void> {
  console.log('\n.wowsplan round-trip');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wowsplan-selftest-'));
  process.env.WOWSPLAN_DATA_DIR = root;
  db.ensureDirs();

  // A map with a real (tiny) asset, a ship, an icon, and a project using them.
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const mapFile = await db.writeMapAsset('map-test', '.png', pngBytes);
  await db.saveMapRecord({ id: 'map-test', name: 'Test Map', file: mapFile, mime: 'image/png', widthMeters: 30000, heightMeters: 30000 });

  const iconFile = await db.writeIconAsset('icon-test', '.png', pngBytes);
  await db.saveIconRecord({ id: 'icon-test', name: 'des_moines', file: iconFile, mime: 'image/png' });
  await db.saveShips([{ id: 'ship-test', name: 'Des Moines', class: 'CA', tier: 10, iconId: 'icon-test', radar_km: 10 }]);

  const project = {
    id: 'prj-test',
    name: 'Round Trip',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pages: [
      {
        id: 'page-1',
        name: '01 - Opening',
        mapId: 'map-test',
        objects: [{ id: 'obj-1', type: 'ship', shipId: 'ship-test', x: 1000, y: 2000, display: { radar: true } }],
      },
    ],
  };
  await db.saveProject(project);

  const packed = await db.packProject(project);
  check('pack: produced gzip bytes', packed[0] === 0x1f && packed[1] === 0x8b, [packed[0], packed[1]]);

  const outFile = path.join(root, 'roundtrip.wowsplan');
  await db.writeFileAbsolute(outFile, packed);
  const pkg = await db.readPackage(outFile);
  check('read: format tag', pkg.format === 'wowsplan');
  check('read: map record embedded', pkg.maps.length === 1, pkg.maps.length);
  check('read: referenced ship embedded', pkg.ships.length === 1, pkg.ships.length);
  check('read: icon embedded', pkg.icons.length === 1, pkg.icons.length);
  check('read: map asset bytes embedded', !!pkg.assets[`maps/${mapFile}`]);
  check('read: icon asset bytes embedded', !!pkg.assets[`icons/${iconFile}`]);

  // Import into a *different*, empty data directory, as a second machine would.
  const root2 = await fs.mkdtemp(path.join(os.tmpdir(), 'wowsplan-selftest2-'));
  process.env.WOWSPLAN_DATA_DIR = root2;
  db.ensureDirs();

  const imported = await db.importPackage(pkg, { newId: true });
  check('import: fresh project id', imported.id !== 'prj-test', imported.id);
  check('import: name marked as imported', String(imported.name).includes('imported'), imported.name);
  check('import: map restored', (await db.listMaps()).length === 1);
  check('import: ship restored', (await db.listShips()).length === 1);
  check('import: icon restored', (await db.listIcons()).length === 1);
  const assetBack = await db.readMapAsset(mapFile);
  check('import: map image bytes identical', !!assetBack && assetBack.equals(pngBytes));
  check('import: project listed on the new machine', (await db.listProjects()).length === 1);

  // Backups: rolling window keeps only the newest N.
  process.env.WOWSPLAN_DATA_DIR = root;
  for (let i = 0; i < 4; i++) {
    await db.createBackup('prj-test', 2);
    await new Promise((r) => setTimeout(r, 12));
  }
  const backups = await db.listBackups('prj-test');
  check('backup: rolling window capped at 2', backups.length === 2, backups.length);
  check('backup: newest first', backups[0].mtime >= backups[1].mtime);

  // An id containing traversal segments is sanitised, never resolved outside
  // the storage root.
  const traversed = await db.loadProject('../../evil');
  check('safety: traversing id resolves to nothing', traversed === null, traversed);

  await fs.rm(root2, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
}

async function testExportDestinations(): Promise<void> {
  console.log('\nexport destinations');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wowsplan-selftest4-'));
  process.env.WOWSPLAN_DATA_DIR = root;

  // A drive root: Windows answers `mkdir 'Z:\'` with EPERM, not EEXIST, and
  // recursive mkdir only forgives EEXIST.
  const driveRoot = path.parse(root).root;
  let mkdirRejected = false;
  try {
    await fs.mkdir(driveRoot, { recursive: true });
  } catch {
    mkdirRejected = true;
  }
  if (mkdirRejected) {
    check('destination: bare mkdir on a drive root does reject', true);
  } else {
    console.log(`  skip  destination: mkdir on ${driveRoot} succeeds on this platform`);
  }

  let rootErr: unknown = null;
  try {
    await db.ensureParentDir(path.join(driveRoot, 'plan.wowsplan'));
  } catch (err) {
    rootErr = err;
  }
  check('destination: saving into a drive root is allowed', rootErr === null, rootErr);

  // A destination whose parent is missing is still created on demand.
  const nested = path.join(root, 'a', 'b', 'plan.wowsplan');
  await db.writeFileAbsolute(nested, Buffer.from('bytes'));
  check('destination: missing parent directories created', (await db.readFileAbsolute(nested)).toString() === 'bytes');

  // Overwriting an existing export must succeed rather than trip on the file.
  await db.writeFileAbsolute(nested, Buffer.from('newer'));
  check('destination: existing file overwritten', (await db.readFileAbsolute(nested)).toString() === 'newer');

  await fs.rm(root, { recursive: true, force: true });
}

async function testTempSweep(): Promise<void> {
  console.log('\ntemp-file sweep');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wowsplan-selftest3-'));
  process.env.WOWSPLAN_DATA_DIR = root;
  db.ensureDirs();

  await db.saveProject({ id: 'prj-sweep', name: 'Sweeper', createdAt: Date.now(), updatedAt: Date.now(), pages: [] });
  await db.createBackup('prj-sweep');

  const write = async (...parts: string[]): Promise<string> => {
    const full = path.join(root, ...parts);
    await fs.writeFile(full, 'half-written', 'utf8');
    return full;
  };

  // A pid this high never exists, so each of these stands for a process that
  // died between writing its temp file and renaming it over the target.
  const dead = 999999999;
  const orphans = [
    await write(`settings.json.${dead}.tmp`),
    await write('projects', `prj-sweep.json.${dead}.tmp`),
    await write('maps', `maps.json.${dead}.tmp`),
    await write('maps', 'assets', `map-x.png.${dead}.tmp`),
    await write('ships', `ships.json.${dead}.tmp`),
    await write('ships', 'icons', `icon-x.png.${dead}.tmp`),
    await write('backups', 'prj-sweep', `2020-01-01.wowsplan.${dead}.tmp`),
  ];

  // A temp file owned by a running process and written moments ago: a second
  // instance could be mid-write, so it has to survive.
  const live = await write('projects', `prj-live.json.${process.pid}.tmp`);
  // The same pid on an hours-old file can only mean the number was recycled.
  const stale = await write('projects', `prj-stale.json.${process.pid}.tmp`);
  const longAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
  await fs.utimes(stale, longAgo, longAgo);
  // No pid suffix, so not ours to delete.
  const notTmp = await write('projects', 'prj-notes.tmp');

  const removed = await db.sweepTempFiles();
  const gone = async (f: string) => !(await fs.stat(f).catch(() => null));

  for (const f of orphans) check(`sweep: removed ${path.basename(f)}`, await gone(f));
  check('sweep: hours-old file from a recycled pid removed', await gone(stale));
  check('sweep: fresh file from a live pid kept', !(await gone(live)));
  check('sweep: file without a pid suffix kept', !(await gone(notTmp)));
  check('sweep: reported every deletion', removed.length === orphans.length + 1, removed.length);
  check('sweep: real project untouched', (await db.loadProject('prj-sweep'))?.name === 'Sweeper');
  check('sweep: backup untouched', (await db.listBackups('prj-sweep')).length === 1);
  check('sweep: second pass finds nothing left', (await db.sweepTempFiles()).length === 0);

  // A data directory that is not there yet must not throw: housekeeping can
  // never be the reason the application fails to start.
  process.env.WOWSPLAN_DATA_DIR = path.join(root, 'does-not-exist');
  check('sweep: absent data directory tolerated', (await db.sweepTempFiles()).length === 0);

  process.env.WOWSPLAN_DATA_DIR = root;
  await fs.rm(root, { recursive: true, force: true });
}

async function testShipMatch(): Promise<void> {
  console.log('\nreplay ship names');
  const db = [
    'Vittorio Veneto', 'Vittorio Cuniberti', 'Almirante Irízar', 'Almirante Oquendo', 'Alberico da Barbiano',
    'Ruggiero di Lauria', 'Prins van Oranje', 'Prins van Oranje Golden', 'San Martín', 'Napoli', 'Napoli B',
    'Bismarck', 'AL Bismarck', 'Thrasher', 'Thrasher',
  ].map((name, i) => ({ id: `s${i}`, name, nation: 'x', class: i === 14 ? 'BB' : 'CA', tier: 10 }) as Ship);
  const found = (replay: string, cls?: 'CA' | 'BB') => matchShip(replay, db, cls)?.name ?? null;
  check('match: "V. Veneto" is Vittorio Veneto, not Cuniberti', found('V. Veneto') === 'Vittorio Veneto');
  check('match: "Almte. Irízar" is Almirante Irízar', found('Almte. Irízar') === 'Almirante Irízar');
  check('match: "A. da Barbiano" is Alberico da Barbiano', found('A. da Barbiano') === 'Alberico da Barbiano');
  check('match: "R. Lauria" is Ruggiero di Lauria', found('R. Lauria') === 'Ruggiero di Lauria');
  check('match: "Pr. van Oranje" is not the Golden one', found('Pr. van Oranje') === 'Prins van Oranje');
  check('match: a non-breaking space still matches', found('San Martín') === 'San Martín');
  check('match: "Napoli" is not "Napoli B"', found('Napoli') === 'Napoli');
  check('match: "Bismarck" is not "AL Bismarck"', found('Bismarck') === 'Bismarck');
  check('match: a name twice in the DB is settled by class', matchShip('Thrasher', db, 'BB')?.id === 's14');
  check('match: an unknown ship is null', found('Yamato') === null);
  check('match: a bracketed variant tag is ignored', found('Napoli (Scope)') === 'Napoli');
}

async function testNameFolding(): Promise<void> {
  console.log('\nname folding');

  // Typing plain ASCII has to reach the ships nobody can spell on a keyboard.
  const reaches = (query: string, name: string) => foldForSearch(name).includes(foldForSearch(query));
  check('fold: "myoko" finds Myōkō', reaches('myoko', 'Myōkō'));
  check('fold: "irizar" finds Almirante Irízar', reaches('irizar', 'Almirante Irízar'));
  check('fold: "kurfurst" finds Grosser Kurfürst', reaches('kurfurst', 'Grosser Kurfürst'));
  check('fold: "ostergotland" finds Östergötland', reaches('ostergotland', 'Östergötland'));
  check('fold: "republique" finds République', reaches('republique', 'République'));

  // These carry no combining mark, so NFD alone leaves them unmatched.
  check('fold: "blyskawica" finds Błyskawica', reaches('blyskawica', "Błyskawica '44"));
  check('fold: "gdansk" finds Gdańsk', reaches('gdansk', 'Gdańsk'));

  // Leniency runs both ways: a pasted accented name finds an ASCII spelling.
  check('fold: pasted "Zaō" finds Zao', reaches('Zaō', 'Zao'));
  check('fold: case is folded too', reaches('MYŌKŌ', 'myōkō'));
  check('fold: distinct ships stay distinct', !reaches('kongō', 'Yamato'));

  // Icon files are matched by a stripped form of the same fold, so an icon
  // named for the ship attaches without the artist typing macrons.
  const iconKey = (name: string) => foldForSearch(name).replace(/[^a-z0-9]/g, '');
  check('fold: Myoko.png matches Myōkō', iconKey('Myōkō') === iconKey('Myoko'));
  check('fold: Grosser Kurfurst.png matches Grosser Kurfürst',
    iconKey('Grosser Kurfürst') === iconKey('Grosser Kurfurst'));

  // Import merges on the folded name+tier, so a re-exported sheet updates a
  // ship in place instead of adding a near-duplicate beside it.
  check('merge: "Zao" tier 10 is the same row as "Zaō"', mergeKey('Zao', 10) === mergeKey('Zaō', 10));
  check('merge: tier still separates', mergeKey('Zaō', 10) !== mergeKey('Zaō', 9));
  check('merge: different ships keep different keys', mergeKey('Kongō', 8) !== mergeKey('Fusō', 8));

  // Folding an identity key can only be safe while no two real ships collapse
  // onto one key, so the shipped roster is the guard.
  const rosterPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'seed', 'ships', 'ships.json');
  const roster = JSON.parse(await fs.readFile(rosterPath, 'utf8')) as { name: string; tier: number }[];
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const ship of roster) {
    const key = mergeKey(ship.name, ship.tier);
    const prev = seen.get(key);
    if (prev && prev !== ship.name) collisions.push(`${prev} == ${ship.name}`);
    seen.set(key, ship.name);
  }
  check(`merge: no collisions across ${roster.length} shipped ships`, collisions.length === 0, collisions);
}

/**
 * Seeding across releases.
 *
 * The interesting cases are all about telling a user's intent from a shipped
 * change: a record they deleted must not come back, a record they edited must
 * not be overwritten, and a record they never touched must follow the seed.
 */
async function testSeeding(): Promise<void> {
  console.log('\nseed install and upgrade');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wowsplan-seed-store-'));
  const seed = await fs.mkdtemp(path.join(os.tmpdir(), 'wowsplan-seed-src-'));
  process.env.WOWSPLAN_DATA_DIR = root;
  process.env.WOWSPLAN_SEED_DIR = seed;

  const writeSeed = async (
    maps: unknown[],
    ships: unknown[],
    layouts: unknown[],
  ): Promise<void> => {
    await fs.mkdir(path.join(seed, 'maps'), { recursive: true });
    await fs.mkdir(path.join(seed, 'ships'), { recursive: true });
    await fs.writeFile(path.join(seed, 'maps', 'maps.json'), JSON.stringify(maps));
    await fs.writeFile(
      path.join(seed, 'maps', 'cap-layouts.json'),
      JSON.stringify({ schemaVersion: 1, layouts }),
    );
    await fs.writeFile(path.join(seed, 'ships', 'ships.json'), JSON.stringify(ships));
  };

  const m = (id: string, name: string) => ({ id, name, file: `${id}.png` });

  // --- first run: an empty store takes everything ---
  await writeSeed([m('map-a', 'Alpha'), m('map-b', 'Bravo')], [{ id: 'sh-1', name: 'Ship One' }], [
    { id: 'cap-1', mapId: 'map-a', name: 'Domination' },
  ]);
  db.ensureDirs();
  db.seedStore();
  check('first run: maps installed', (await db.listMaps()).length === 2);
  check('first run: ships installed', (await db.listShips()).length === 1);
  check('first run: cap layouts installed', (await db.listCapLayouts()).length === 1);

  // --- an unchanged seed does nothing at all ---
  const before = JSON.stringify(await db.listMaps());
  check('unchanged seed: reports no work', db.seedStore().length === 0);
  check('unchanged seed: maps untouched', JSON.stringify(await db.listMaps()) === before);

  // --- the user makes the store their own ---
  await db.deleteMap('map-b'); // deleted on purpose
  const maps = await db.listMaps();
  const edited = { ...maps.find((x) => x.id === 'map-a')!, name: 'Alpha (renamed)' };
  await db.saveMapRecord(edited as never);
  await db.saveShips([{ id: 'sh-1', name: 'Ship One' }, { id: 'sh-mine', name: 'My Import' }] as never);

  // --- a later release: new records, and a change to one the user edited ---
  await writeSeed(
    [m('map-a', 'Alpha revised'), m('map-b', 'Bravo'), m('map-c', 'Charlie')],
    [
      { id: 'sh-1', name: 'Ship One revised' },
      { id: 'sh-2', name: 'Ship Two' },
    ],
    [
      { id: 'cap-1', mapId: 'map-a', name: 'Domination' },
      { id: 'cap-2', mapId: 'map-a', name: 'Clans - Brawl' },
    ],
  );
  db.seedStore();

  const after = await db.listMaps();
  const ids = after.map((x) => x.id).sort();
  check('upgrade: new map added', ids.includes('map-c'), ids);
  check('upgrade: deleted map stays deleted', !ids.includes('map-b'), ids);
  check(
    'upgrade: edited map keeps the user text',
    after.find((x) => x.id === 'map-a')?.name === 'Alpha (renamed)',
    after.find((x) => x.id === 'map-a')?.name,
  );

  const ships = await db.listShips();
  check(
    'upgrade: untouched ship follows the seed',
    ships.find((s) => s.id === 'sh-1')?.name === 'Ship One revised',
    ships.find((s) => s.id === 'sh-1')?.name,
  );
  check('upgrade: new ship added', ships.some((s) => s.id === 'sh-2'));
  check("upgrade: the user's own ship survives", ships.some((s) => s.id === 'sh-mine'));

  // Reference data the editor never writes is replaced outright.
  check('upgrade: cap layouts replaced wholesale', (await db.listCapLayouts()).length === 2);

  // --- a store without a receipt: add-only, nothing overwritten ---
  const legacy = await fs.mkdtemp(path.join(os.tmpdir(), 'wowsplan-seed-legacy-'));
  process.env.WOWSPLAN_DATA_DIR = legacy;
  db.ensureDirs();
  await fs.mkdir(path.join(legacy, 'maps'), { recursive: true });
  await fs.writeFile(
    path.join(legacy, 'maps', 'maps.json'),
    JSON.stringify([{ id: 'map-a', name: 'Old Alpha', file: 'map-a.png' }]),
  );
  db.seedStore();
  const migrated = await db.listMaps();
  check(
    'legacy store: existing record left alone',
    migrated.find((x) => x.id === 'map-a')?.name === 'Old Alpha',
    migrated.find((x) => x.id === 'map-a')?.name,
  );
  check('legacy store: missing records added', migrated.length === 3, migrated.length);

  delete process.env.WOWSPLAN_SEED_DIR;
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(seed, { recursive: true, force: true });
  await fs.rm(legacy, { recursive: true, force: true });
}

async function main(): Promise<void> {
  await testShipImport();
  await testShipFilters();
  await testStoreMigration();
  await testNameFolding();
  await testShipMatch();
  await testPackage();
  await testExportDestinations();
  await testTempSweep();
  await testSeeding();
  await testReplayTimeline(check);
  await testSidecar(check);
  await testReplayArchive(check);
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
