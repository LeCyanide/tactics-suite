/**
 * Adds maps to the planner's map library from unpacked game space files.
 *
 *   node scripts/import-maps.mjs --collection <dir> [--spaces <dir>] [--data <dir>] [--dry]
 *
 * Every map the planner knows is a minimap image plus the size of the water
 * it covers, and both of those sit in the game's own `spaces/<n>_<name>`
 * folder. What the folder does not hold is the name a player would recognise
 * — it is `35_NE_north_winter` on disk and "Northern Lights" in port — so the
 * names come from a replay collection whose folders are named `Map Name -
 * space_file_name`. One folder per map is all this reads; the replays inside
 * are what `import-cap-layouts.mjs` wants, not this.
 *
 * Three things can be true of a map in the collection, and each is handled:
 *
 *   - the planner already has its space          nothing to do
 *   - the planner has its name, but another space   the map was reworked
 *                                                onto new terrain, so the
 *                                                entry is repointed and its
 *                                                image and size refreshed,
 *                                                keeping the id that plans
 *                                                already reference
 *   - the planner has neither                    a new map is added
 *
 * Nothing is ever removed and no map is renamed, so a collection that is
 * missing a map the planner has leaves that map alone.
 *
 * As with the other import scripts this writes into the application-data
 * directory; run `refresh-seed.mjs` afterwards to carry the result into the
 * build.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
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
const dataDir = opt('--data')
  ? path.resolve(opt('--data'))
  : process.env.WOWSPLAN_DATA_DIR && path.resolve(process.env.WOWSPLAN_DATA_DIR);

// The unpacked `spaces` directory sits beside the repository more often than
// inside it, so that is the default rather than something under `root`.
const spacesDir = path.resolve(opt('--spaces') ?? path.join(root, '..', 'res', 'spaces'));
const collectionDir = opt('--collection') && path.resolve(opt('--collection'));

if (!dataDir || !collectionDir) {
  console.error(
    'usage: node scripts/import-maps.mjs --collection <dir> [--spaces <dir>] [--data <dir>] [--dry]',
  );
  console.error('       (--data may be omitted when WOWSPLAN_DATA_DIR is set)');
  process.exit(1);
}
for (const [what, dir] of [
  ['space', spacesDir],
  ['collection', collectionDir],
]) {
  if (!fs.existsSync(dir)) {
    console.error(`No ${what} directory at ${dir}`);
    process.exit(1);
  }
}

const mapsFile = path.join(dataDir, 'maps', 'maps.json');
const assetsDir = path.join(dataDir, 'maps', 'assets');
if (!fs.existsSync(mapsFile)) {
  console.error(`No map database at ${mapsFile}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* PNG                                                                 */
/* ------------------------------------------------------------------ */

/*
 * A space holds its minimap in two layers: `minimap_water.png` is the sea and
 * the grid, `minimap.png` is the land drawn over it on a transparent ground.
 * The planner stores one flattened image, so the two are composited here.
 *
 * The land layer is always 8-bit RGBA; the water layer is RGBA on most maps
 * and, where the sea is drawn with nothing to see through, plain RGB. Neither
 * is ever interlaced and the flattened image is opaque, so the reader and
 * writer below handle those cases rather than PNG at large.
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reads an 8-bit RGB or RGBA PNG as RGBA, in `{ width, height, pixels }`. */
function readRgba(file) {
  const buf = fs.readFileSync(file);
  let off = 8;
  let header = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const length = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colour: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + length;
  }
  if (!header) throw new Error(`${file}: no IHDR`);
  if (header.depth !== 8 || (header.colour !== 2 && header.colour !== 6) || header.interlace !== 0) {
    throw new Error(
      `${file}: expected an 8-bit RGB or RGBA PNG, got depth ${header.depth} colour ${header.colour}`,
    );
  }

  const { width, height } = header;
  const bpp = header.colour === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const flat = Buffer.alloc(stride * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = y * stride;
    const above = row - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[p + i];
      const a = i >= bpp ? flat[row + i - bpp] : 0;
      const b = y > 0 ? flat[above + i] : 0;
      const c = i >= bpp && y > 0 ? flat[above + i - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`${file}: unknown row filter ${filter}`);
      }
      flat[row + i] = v & 0xff;
    }
    p += stride;
  }
  if (bpp === 4) return { width, height, pixels: flat };

  // Widen RGB to RGBA so the compositing below has one shape to work with.
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0, o = 0; i < flat.length; i += 3, o += 4) {
    flat.copy(pixels, o, i, i + 3);
    pixels[o + 3] = 0xff;
  }
  return { width, height, pixels };
}

/** Writes 8-bit RGB pixels as a PNG. */
function writeRgb(file, width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // Filter 0: the rows are small and the saving is not worth the guesswork.
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour, no alpha
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** The land layer over the water layer, flattened to opaque RGB. */
function flattenMinimap(spaceDir) {
  const water = readRgba(path.join(spaceDir, 'minimap_water.png'));
  const land = readRgba(path.join(spaceDir, 'minimap.png'));
  if (water.width !== land.width || water.height !== land.height) {
    throw new Error(`${spaceDir}: the two minimap layers are different sizes`);
  }
  const { width, height } = water;
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, o = 0; i < water.pixels.length; i += 4, o += 3) {
    const alpha = land.pixels[i + 3];
    for (let c = 0; c < 3; c++) {
      rgb[o + c] = Math.round((land.pixels[i + c] * alpha + water.pixels[i + c] * (255 - alpha)) / 255);
    }
  }
  return { width, height, rgb };
}

/* ------------------------------------------------------------------ */
/* How big the water is                                                */
/* ------------------------------------------------------------------ */

/*
 * `space.settings` gives the terrain as a range of 100-unit chunks. The
 * terrain runs two chunks past the playable square on every side, so the
 * extent a position is measured against is four chunks narrower than the
 * bounds — a rule that reproduces the stored size of all 25 maps that were
 * measured by hand before this script existed.
 *
 * One unit of that extent is thirty metres, which is where the map's size in
 * the grid comes from.
 */
const CHUNK = 100;
const BORDER_CHUNKS = 4;
const METRES_PER_UNIT = 30;

function spaceSize(spaceDir) {
  const text = fs.readFileSync(path.join(spaceDir, 'space.settings'), 'utf8');
  // The bounds are written as attributes on some maps and as elements on
  // others; both spellings mean the same thing.
  const bound = (name) => {
    const m =
      text.match(new RegExp(`${name}\\s*=\\s*"(-?\\d+)"`)) ??
      text.match(new RegExp(`<${name}>\\s*(-?\\d+)\\s*</${name}>`));
    if (!m) throw new Error(`${spaceDir}: space.settings has no ${name}`);
    return Number(m[1]);
  };
  const width = bound('maxX') - bound('minX') + 1;
  const height = bound('maxY') - bound('minY') + 1;
  if (width !== height) throw new Error(`${spaceDir}: ${width}x${height} chunks is not square`);
  return (width - BORDER_CHUNKS) * CHUNK;
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

/** The collection's folders, each `Display Name - space_file_name`. */
function readCollection(dir) {
  const wanted = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const at = entry.name.lastIndexOf(' - ');
    if (at < 0) {
      console.log(`ignored    ${entry.name}: not named "Map Name - space_file_name"`);
      continue;
    }
    wanted.push({ name: entry.name.slice(0, at), file: entry.name.slice(at + 3) });
  }
  return wanted.sort((a, b) => a.name.localeCompare(b.name));
}

// A space is `<number>_<file name>` on disk, and only the file name is what
// the collection knows it by.
const spaceDirs = new Map(
  fs
    .readdirSync(spacesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => [e.name.replace(/^\d+_/, '').toLowerCase(), e.name]),
);

const mapsText = await fsp.readFile(mapsFile, 'utf8');
const maps = JSON.parse(mapsText);
// The application writes this file too, so it is rewritten the way it was
// found rather than reformatted into a diff that hides the real change.
// The first entry sits one level in, so its line says how wide a level is.
const indent = mapsText.match(/\n([ \t]*)/)?.[1].length || 2;
// Only live maps hold a space: an archived one is a stand-in kept for the
// season it belonged to, and repointing it would rewrite history.
const live = maps.filter((m) => !m.archived);
const bySpace = new Map(live.filter((m) => m.spaceName).map((m) => [m.spaceName, m]));
const byName = new Map(live.map((m) => [m.name, m]));

/* ------------------------------------------------------------------ */
/* Convert                                                             */
/* ------------------------------------------------------------------ */

const added = [];
const repointed = [];
const writes = [];

for (const wanted of readCollection(collectionDir)) {
  const dir = spaceDirs.get(wanted.file.toLowerCase());
  if (!dir) {
    console.log(`skipped    ${wanted.name}: no ${wanted.file} under ${spacesDir}`);
    continue;
  }
  const spaceName = `spaces/${dir}`;
  if (bySpace.has(spaceName)) continue; // already known, under whatever name

  let image;
  let extent;
  try {
    image = flattenMinimap(path.join(spacesDir, dir));
    extent = spaceSize(path.join(spacesDir, dir));
  } catch (err) {
    console.log(`skipped    ${wanted.name}: ${err.message}`);
    continue;
  }
  const metres = extent * METRES_PER_UNIT;
  const now = Date.now();

  const existing = byName.get(wanted.name);
  if (existing) {
    // Same map, new terrain. Keeping the id keeps every plan drawn on it.
    repointed.push({ map: existing, from: existing.spaceName, to: spaceName, extent, metres });
    writes.push([path.join(assetsDir, existing.file), image]);
    Object.assign(existing, {
      pixelWidth: image.width,
      pixelHeight: image.height,
      widthMeters: metres,
      heightMeters: metres,
      spaceName,
      spaceSize: extent,
      updatedAt: now,
    });
    continue;
  }

  const id = `map-${crypto.randomUUID()}`;
  const entry = {
    id,
    name: wanted.name,
    mime: 'image/png',
    addedAt: now,
    file: `${id}.png`,
    pixelWidth: image.width,
    pixelHeight: image.height,
    widthMeters: metres,
    heightMeters: metres,
    gridCols: 10,
    gridRows: 10,
    updatedAt: now,
    spaceName,
    spaceSize: extent,
  };
  maps.push(entry);
  bySpace.set(spaceName, entry);
  byName.set(entry.name, entry);
  added.push(entry);
  writes.push([path.join(assetsDir, entry.file), image]);
}

/* ------------------------------------------------------------------ */
/* Compare and write                                                   */
/* ------------------------------------------------------------------ */

for (const m of added) {
  console.log(`added      ${m.name}  (${m.spaceName}, ${m.widthMeters / 1000} km)`);
}
for (const r of repointed) {
  console.log(
    `repointed  ${r.map.name}  ${r.from} -> ${r.to}` +
      (r.metres === r.map.widthMeters ? '' : ` and ${r.metres / 1000} km`),
  );
}

console.log(`\n${live.length} maps before, ${live.length + added.length} after`);
if (dry) {
  console.log('dry run — nothing written');
} else {
  await fsp.mkdir(assetsDir, { recursive: true });
  for (const [file, image] of writes) {
    const tmp = `${file}.tmp`;
    writeRgb(tmp, image.width, image.height, image.rgb);
    await fsp.rename(tmp, file);
  }
  // The images land first: a map row pointing at an image that is not there
  // yet is the one order that leaves the library broken.
  maps.sort((a, b) => Number(a.archived ?? false) - Number(b.archived ?? false));
  const tmp = `${mapsFile}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(maps, null, indent), 'utf8');
  await fsp.rename(tmp, mapsFile);
  console.log(`wrote      ${mapsFile}`);
  console.log(`wrote      ${writes.length} image${writes.length === 1 ? '' : 's'} under ${assetsDir}`);
}
