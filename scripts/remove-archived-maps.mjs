/**
 * Drops the archived stand-in maps.
 *
 * These are pre-rendered images with a cap layout baked into the artwork, kept
 * only while the layout library has no data for those modes. Once it does,
 * this removes every one of them — the maps.json entries and their images —
 * in a single pass.
 *
 *   node scripts/remove-archived-maps.mjs [--dry] [--data <dir>]
 *
 * Pages still pointing at a removed map are reported rather than rewritten:
 * which map they should fall back to is a judgement call, not a default.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const dataDir =
  args[args.indexOf('--data') + 1] && args.includes('--data')
    ? path.resolve(args[args.indexOf('--data') + 1])
    : process.env.WOWSPLAN_DATA_DIR && path.resolve(process.env.WOWSPLAN_DATA_DIR);

if (!dataDir) {
  console.error('No data directory. Pass --data <dir> or set WOWSPLAN_DATA_DIR.');
  process.exit(1);
}

const mapsFile = path.join(dataDir, 'maps', 'maps.json');
const maps = JSON.parse(fs.readFileSync(mapsFile, 'utf8'));
const doomed = maps.filter((m) => m.archived);

if (!doomed.length) {
  console.log('No archived maps to remove.');
  process.exit(0);
}

console.log(`${doomed.length} archived map${doomed.length === 1 ? '' : 's'}:`);
for (const m of doomed) console.log(`   ${m.name}  (${m.id})`);

// Warn before the reference breaks, not after.
const projectsDir = path.join(dataDir, 'projects');
const doomedIds = new Set(doomed.map((m) => m.id));
const stillUsed = [];
for (const f of fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : []) {
  if (!f.endsWith('.json')) continue;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(projectsDir, f), 'utf8'));
  } catch {
    continue;
  }
  for (const page of doc.pages ?? []) {
    if (doomedIds.has(page.mapId)) stillUsed.push(`${doc.name} / ${page.name}`);
  }
}
if (stillUsed.length) {
  console.log(`\nStill in use by ${stillUsed.length} page(s) — they will lose their map:`);
  for (const u of stillUsed) console.log(`   ${u}`);
}

if (dry) {
  console.log('\n--dry: nothing written.');
  process.exit(0);
}

for (const m of doomed) {
  const asset = path.join(dataDir, 'maps', 'assets', path.basename(String(m.file)));
  fs.rmSync(asset, { force: true });
}
fs.writeFileSync(mapsFile, JSON.stringify(maps.filter((m) => !m.archived), null, 1), 'utf8');
console.log(`\nRemoved ${doomed.length} maps and their images.`);
