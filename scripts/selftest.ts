/**
 * Headless checks for the two paths that are pure logic and would otherwise
 * only be exercised by hand: messy ship-data import, and the .wowsplan
 * pack/read/import round-trip.
 *
 *   npm run selftest
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { parseShipData, serializeShips } from '../src/lib/shipImport';
import * as db from '../electron/storage/db';

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

async function main(): Promise<void> {
  await testShipImport();
  await testPackage();
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
