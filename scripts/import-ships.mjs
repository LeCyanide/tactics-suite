/**
 * Imports a ship data file into the ship database from the command line.
 *
 *   node scripts/import-ships.mjs <file.csv|json|yaml> [--data <dir>] [--replace] [--dry]
 *
 * This is the same parser the application uses (`src/lib/shipImport.ts`),
 * bundled through esbuild so the file on disk is the only definition of how
 * ship data is read. The in-app importer stays the normal route; this exists
 * for seeding or refreshing the whole database in one pass.
 *
 * The default is a merge, not an overwrite. A ship already in the database is
 * matched by name — ignoring case, punctuation and accents, so "Hakuryu" finds
 * "Hakuryū" — and keeps its id, its icon and every field the incoming file has
 * nothing to say about. Projects reference ships by id, so a re-import must
 * never hand an existing ship a new one. Ships missing from the file are left
 * alone unless --replace is given.
 *
 * New ships get a readable slug id (`ship-des-moines`) to match the ids the
 * database already uses, falling back to a numeric suffix on a collision.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const source = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--data');
const dry = flag('--dry');
const replace = flag('--replace');
const dataDir = opt('--data')
  ? path.resolve(opt('--data'))
  : process.env.WOWSPLAN_DATA_DIR && path.resolve(process.env.WOWSPLAN_DATA_DIR);

if (!source || !dataDir) {
  console.error('usage: node scripts/import-ships.mjs <file> --data <dir> [--replace] [--dry]');
  console.error('       (--data may be omitted when WOWSPLAN_DATA_DIR is set)');
  process.exit(1);
}
if (!fs.existsSync(source)) {
  console.error(`No such file: ${source}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* The application's own parser                                        */
/* ------------------------------------------------------------------ */

const bundle = path.join(root, 'node_modules', '.import-ships.mjs');
await build({
  entryPoints: [path.join(root, 'src', 'lib', 'shipImport.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: bundle,
  alias: { '@': path.join(root, 'src') },
  logLevel: 'warning',
});
const { parseShipData } = await import(`file://${bundle.replace(/\\/g, '/')}`);

/* ------------------------------------------------------------------ */
/* Merge                                                               */
/* ------------------------------------------------------------------ */

/** NFKD splits an accented letter into a plain letter plus a combining mark;
 *  dropping every non-ASCII code point then leaves the plain letter behind. */
function fold(name) {
  return [...String(name).normalize('NFKD')].filter((c) => c.charCodeAt(0) < 128).join('');
}

/** Comparison form of a ship name: no case, accents or punctuation. */
function nameKey(name) {
  return fold(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function slugId(name, taken) {
  const base = 'ship-' + fold(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** Notes from both sides, deduplicated line by line, incoming first. */
function mergeNotes(incoming, existing) {
  const lines = [];
  for (const text of [incoming, existing]) {
    for (const line of String(text ?? '').split('\n')) {
      if (line.trim() && !lines.includes(line)) lines.push(line);
    }
  }
  return lines.length ? lines.join('\n') : undefined;
}

const shipsFile = path.join(dataDir, 'ships', 'ships.json');
const existing = fs.existsSync(shipsFile) ? JSON.parse(fs.readFileSync(shipsFile, 'utf8')) : [];
const byName = new Map(existing.map((s) => [nameKey(s.name), s]));

const text = fs.readFileSync(source, 'utf8');
const { ships: parsed, format, warnings } = parseShipData(text, path.extname(source));
for (const w of warnings) console.warn(`warning: ${w}`);
if (!parsed.length) {
  console.error('Nothing to import.');
  process.exit(1);
}

const taken = new Set(existing.map((s) => s.id));
const matched = new Set();
let updated = 0;
let added = 0;

const merged = parsed.map((ship) => {
  const prior = byName.get(nameKey(ship.name));
  if (!prior) {
    added++;
    return { ...ship, id: slugId(ship.name, taken) };
  }
  matched.add(prior.id);
  updated++;
  // Incoming values win; everything the file is silent about survives.
  const out = { ...prior, ...ship, id: prior.id };
  if (ship.iconId == null) out.iconId = prior.iconId ?? null;
  const notes = mergeNotes(ship.notes, prior.notes);
  if (notes) out.notes = notes;
  else delete out.notes;
  return out;
});

const untouched = existing.filter((s) => !matched.has(s.id));
const kept = replace ? [] : untouched;
const all = [...merged, ...kept].sort(
  (a, b) => b.tier - a.tier || a.class.localeCompare(b.class) || a.name.localeCompare(b.name),
);

/* ------------------------------------------------------------------ */
/* Report and write                                                    */
/* ------------------------------------------------------------------ */

const withField = (field) => all.filter((s) => s[field] !== undefined && s[field] !== null).length;

console.log(`source     ${path.basename(source)} (${format}, ${parsed.length} rows)`);
console.log(`database   ${shipsFile}`);
console.log(`updated    ${updated}   added ${added}   ${replace ? 'dropped' : 'kept'} ${untouched.length}`);
console.log(`total      ${all.length} ships`);
const REPORTED = [
  'concealment_km', 'concealmentAir_km', 'mainBatteryRange_km', 'torpedoRange_km',
  'radar_km', 'hydro_km', 'airstrikeMaxRange_km',
];
for (const field of REPORTED) {
  console.log(`  ${field.padEnd(20)} ${withField(field)}`);
}

if (dry) {
  console.log('\n--dry: nothing written.');
  process.exit(0);
}

if (fs.existsSync(shipsFile)) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  await fsp.copyFile(shipsFile, `${shipsFile}.bak-${stamp}`);
  console.log(`\nbacked up  ${path.basename(shipsFile)}.bak-${stamp}`);
}

// Written the way the application writes it: a sibling temp file renamed over
// the target, so an interrupted run cannot truncate the database.
const tmp = `${shipsFile}.${process.pid}.tmp`;
await fsp.mkdir(path.dirname(shipsFile), { recursive: true });
await fsp.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
await fsp.rename(tmp, shipsFile);
console.log(`wrote      ${all.length} ships`);
