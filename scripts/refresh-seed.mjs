/**
 * Refreshes the seed databases from a live store.
 *
 *   node scripts/refresh-seed.mjs [--data <dir>] [--dry]
 *
 * The import scripts in this directory write into the application-data
 * directory, because that is where the running application reads from. The
 * databases that ship with a build live in `seed/` instead, and are copied
 * into an empty store on first run. Without this script the two drift: a
 * re-import updates the store the developer can see and leaves every user of
 * the next release on the old data.
 *
 * So: import as usual, run this, commit the diff.
 *
 * What travels with a build is exactly the shared reference data — ships,
 * maps and their images, capture point layouts. Projects, backups and
 * settings belong to whoever ran the import and are never copied; the check
 * at the end fails loudly if any of them ever turn up under `seed/`.
 *
 * The seed is pruned, not just topped up. An image left behind by a map that
 * has since been deleted would otherwise ship forever, so anything the
 * databases no longer reference is removed.
 *
 * Copying comes first and pruning second, and every file is replaced by a
 * rename rather than a truncate. Between them that means the seed is never
 * missing an image another process might be reading: emptying a directory and
 * refilling it, however briefly, is enough to make a running application
 * believe every map it asked for is gone.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const dry = flag('--dry');

// Defaults to the store the application itself uses. productName is read from
// package.json rather than spelled out here, so renaming the application does
// not quietly leave this script pointing at the old directory.
const { productName } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const defaultData = path.join(
  process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
  productName,
  'data',
);
const dataDir = opt('--data')
  ? path.resolve(opt('--data'))
  : process.env.WOWSPLAN_DATA_DIR
    ? path.resolve(process.env.WOWSPLAN_DATA_DIR)
    : defaultData;

const seedDir = path.join(root, 'seed');

if (flag('--help') || flag('-h')) {
  console.error('usage: node scripts/refresh-seed.mjs [--data <dir>] [--dry]');
  console.error(`       (--data defaults to ${defaultData})`);
  process.exit(1);
}
if (!fs.existsSync(dataDir)) {
  console.error(`No store at ${dataDir}`);
  console.error('Pass --data <dir>, or set WOWSPLAN_DATA_DIR.');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Reading the source databases                                        */
/* ------------------------------------------------------------------ */

function readJson(file, what) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Cannot read the ${what} at ${file}: ${err.message}`);
    process.exit(1);
  }
}

const ships = readJson(path.join(dataDir, 'ships', 'ships.json'), 'ship database');
const maps = readJson(path.join(dataDir, 'maps', 'maps.json'), 'map database');
const caps = readJson(path.join(dataDir, 'maps', 'cap-layouts.json'), 'cap layout library');

if (!Array.isArray(ships)) {
  console.error('The ship database is not an array.');
  process.exit(1);
}
if (!Array.isArray(maps)) {
  console.error('The map database is not an array.');
  process.exit(1);
}

// icons.json is optional: a store with no imported icons never creates it.
const iconsFile = path.join(dataDir, 'ships', 'icons.json');
const icons = fs.existsSync(iconsFile) ? readJson(iconsFile, 'icon index') : [];

/* ------------------------------------------------------------------ */
/* The file list the seed should hold                                  */
/* ------------------------------------------------------------------ */

/** Every path is relative to the store root, and means the same in both trees. */
const wanted = new Set(['ships/ships.json', 'maps/maps.json', 'maps/cap-layouts.json']);

if (fs.existsSync(iconsFile)) wanted.add('ships/icons.json');

// Only assets a database actually references. Anything else is dead weight
// that would ship with every build from here on.
const missing = [];
for (const m of maps) {
  const rel = `maps/assets/${m.file}`;
  if (fs.existsSync(path.join(dataDir, rel))) wanted.add(rel);
  else missing.push(`map "${m.name}" wants ${m.file}`);
}
for (const i of icons) {
  const rel = `ships/icons/${i.file}`;
  if (fs.existsSync(path.join(dataDir, rel))) wanted.add(rel);
  else missing.push(`icon "${i.id}" wants ${i.file}`);
}

// Provenance for the archived clan battles images, if the store carries it.
const archiveDir = path.join(dataDir, 'maps', 'archive-clan-battles');
if (fs.existsSync(archiveDir)) {
  for (const name of fs.readdirSync(archiveDir)) {
    if (fs.statSync(path.join(archiveDir, name)).isFile()) {
      wanted.add(`maps/archive-clan-battles/${name}`);
    }
  }
}

// A seed referencing an image it does not carry would hand every new user a
// broken map, so this is fatal rather than a warning.
if (missing.length) {
  console.error('The store is missing files its databases reference:');
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Sync                                                                */
/* ------------------------------------------------------------------ */

const hash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

/**
 * Replaces one file without it ever being half there.
 *
 * `copyFileSync` truncates the destination and fills it, so anything reading
 * that file in the meantime gets a short one -- and for an image that is a
 * decode failure rather than an error worth reporting. Writing beside the
 * target and renaming over it makes the swap atomic: a reader sees either the
 * old file or the new one.
 *
 * The temporary name carries the process id so two runs at once cannot land
 * on the same scratch file, which is the same rule the application's own
 * writes follow.
 */
function copyAtomic(from, to) {
  const tmp = `${to}.${process.pid}.tmp`;
  fs.copyFileSync(from, tmp);
  fs.renameSync(tmp, to);
}

/** Every file under `dir`, relative to it, with forward slashes. */
function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

const present = new Set(walk(seedDir));
let added = 0;
let updated = 0;
let unchanged = 0;
let removed = 0;

for (const rel of [...wanted].sort()) {
  const from = path.join(dataDir, rel);
  const to = path.join(seedDir, rel);
  const exists = present.has(rel);
  if (exists && hash(from) === hash(to)) {
    unchanged += 1;
    continue;
  }
  console.log(`${exists ? 'updated' : 'added'}    ${rel}`);
  if (exists) updated += 1;
  else added += 1;
  if (!dry) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    copyAtomic(from, to);
  }
}

for (const rel of [...present].sort()) {
  if (wanted.has(rel)) continue;
  console.log(`removed    ${rel}`);
  removed += 1;
  if (!dry) fs.rmSync(path.join(seedDir, rel), { force: true });
}

// Directories emptied by the pruning above would otherwise linger.
if (!dry) {
  const prune = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) prune(path.join(dir, entry.name));
    }
    if (dir !== seedDir && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  };
  prune(seedDir);
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

// Personal data must never reach a build. This catches a stray copy however
// it got there, not only one this run would have made.
const personal = walk(seedDir).filter(
  (rel) => rel.startsWith('projects/') || rel.startsWith('backups/') || rel === 'settings.json',
);
if (personal.length) {
  console.error('\nPersonal data found under seed/ and left in place:');
  for (const p of personal) console.error(`  ${p}`);
  console.error('Remove it before committing.');
  process.exit(1);
}

const capCount = Array.isArray(caps) ? caps.length : (caps?.layouts?.length ?? 0);
const bytes = walk(seedDir).reduce((n, rel) => n + fs.statSync(path.join(seedDir, rel)).size, 0);

console.log(
  `\n${ships.length} ships, ${maps.length} maps, ${capCount} cap layouts` +
    `${icons.length ? `, ${icons.length} icons` : ''}`,
);
console.log(
  `${added} added, ${updated} updated, ${removed} removed, ${unchanged} unchanged` +
    ` — ${(bytes / 1048576).toFixed(1)} MB in seed/`,
);
if (dry) console.log('dry run — nothing written');
