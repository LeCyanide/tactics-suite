/**
 * Rebuilds the capture point layout library from the WoWs Toolkit database.
 *
 *   node scripts/import-cap-layouts.mjs [--toolkit <dir|db>] [--data <dir>] [--dry]
 *
 * The toolkit records one layout per map and scenario the moment it parses a
 * replay of that battle type, so playing a mode once is what puts its caps
 * within reach. This reads that table straight out of its SQLite file and
 * rewrites maps/cap-layouts.json in the planner's data directory.
 *
 * Rebuilding is safe to repeat: a layout's id is derived from the space and
 * the game's own scenario config id, so a page already pointing at one keeps
 * pointing at it. Layouts for a space with no map — or with only an archived
 * stand-in — are skipped, as are the two-cap brawl layouts.
 *
 * Several scenarios of one battle type share both a name and the caps they
 * draw — a PvE room, or a revision that replaced what it revised. A map keeps
 * one layout per name, so the picker never offers the same mode twice; see
 * "Collapse aliases" below.
 *
 * The toolkit may be running, so the database is copied before it is read.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

const defaultToolkit = path.join(
  process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
  'WoWs Toolkit',
  'data',
);
const toolkitArg = opt('--toolkit') ? path.resolve(opt('--toolkit')) : defaultToolkit;
const toolkitDb = toolkitArg.endsWith('.db') ? toolkitArg : path.join(toolkitArg, 'wows_toolkit.db');

if (!dataDir) {
  console.error(
    'usage: node scripts/import-cap-layouts.mjs --data <dir> [--toolkit <dir|db>] [--dry]',
  );
  console.error('       (--data may be omitted when WOWSPLAN_DATA_DIR is set)');
  process.exit(1);
}
if (!fs.existsSync(toolkitDb)) {
  console.error(`No toolkit database at ${toolkitDb}`);
  process.exit(1);
}

const mapsFile = path.join(dataDir, 'maps', 'maps.json');
const layoutsFile = path.join(dataDir, 'maps', 'cap-layouts.json');
if (!fs.existsSync(mapsFile)) {
  console.error(`No map database at ${mapsFile}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* The archived layout format                                          */
/* ------------------------------------------------------------------ */

/*
 * The toolkit stores each layout as an rkyv archive, which is the struct as
 * it sits in memory rather than a self-describing format — so the offsets
 * below are the schema. The root is at the end of the buffer:
 *
 *   u32 mapId, u32 scenarioConfigId, String space, String scenario,
 *   u32 gameMode, RelPtr points, u32 pointCount
 *
 * and each point is 40 bytes:
 *
 *   u32 index, f32 x, f32 y, f32 radius, i64 cpType, i64 teamId, i64 enabled
 *
 * Positions are BigWorld units with the origin at the centre of the map and
 * +y pointing north, which is why y is mirrored when it is normalised below.
 */
const ROOT_SIZE = 36;
const POINT_SIZE = 40;

/** An 8-byte archived string: the text inline, or a length and a pointer. */
function readString(view, bytes, at) {
  const tag = bytes[at];
  if (!(tag & 0x80)) {
    let end = at;
    while (end < at + 8 && bytes[end] !== 0) end++;
    return Buffer.from(bytes.subarray(at, end)).toString('utf8');
  }
  // A relative pointer counts from the start of the field holding it.
  const start = at + view.getInt32(at + 4, true);
  return Buffer.from(bytes.subarray(start, start + (tag & 0x7f))).toString('utf8');
}

function decodeLayout(blob) {
  const bytes = new Uint8Array(blob);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const root = bytes.length - ROOT_SIZE;

  const count = view.getUint32(root + 32, true);
  const first = root + 28 + view.getInt32(root + 28, true);
  const points = [];
  for (let i = 0; i < count; i++) {
    const o = first + i * POINT_SIZE;
    points.push({
      index: view.getUint32(o, true),
      x: view.getFloat32(o + 4, true),
      y: view.getFloat32(o + 8, true),
      radius: view.getFloat32(o + 12, true),
      cpType: Number(view.getBigInt64(o + 16, true)),
      teamId: Number(view.getBigInt64(o + 24, true)),
      initiallyEnabled: view.getBigInt64(o + 32, true) !== 0n,
    });
  }
  return {
    scenarioId: view.getUint32(root + 4, true),
    spaceName: readString(view, bytes, root + 8),
    scenario: readString(view, bytes, root + 16),
    gameMode: view.getUint32(root + 24, true),
    points,
  };
}

/* ------------------------------------------------------------------ */
/* Naming                                                              */
/* ------------------------------------------------------------------ */

/*
 * The game names a layout after the battle type that plays on it — "Clans.
 * Domination", "Tournament. Domination — Four Areas" — and tells two layouts
 * of one battle type apart by how many areas they have. We keep the game's
 * wording with two substitutions: a hyphen for its full stop, and the cap
 * count in brackets for its "— Four Areas". Domination is three caps unless
 * it says otherwise, so only another count is spelled out.
 *
 * Two of the suffixes the game gives a scenario say nothing a player picked
 * in port and are dropped: _coop lays the same battle type over the same
 * water for a PvE room, and _revised is a reworked arrangement that replaced
 * the one it revised rather than joining it. _alt and _romb do join it — the
 * game offers both on the same map — so they are kept and spelled out in the
 * same brackets as the cap count.
 */
const FAMILIES = [
  { match: /^domination_tournament_/, name: 'Tournament - Domination', counted: true },
  // Clan brawl is its own battle type with its own caps, and on seven maps it
  // sits beside the clan battle layout, so it cannot borrow that name.
  { match: /^cvc_domination_brawl/, name: 'Clans - Brawl', counted: true },
  { match: /^cvc_domination/, name: 'Clans - Domination', counted: true },
  { match: /^ranked_domination/, name: 'Ranked Battle - Domination', counted: true },
  { match: /^domination_localweather_/, name: 'Domination - Local Weather', counted: true },
  { match: /^armsrace/, name: 'Arms Race', counted: false },
  // Asymmetric battle borrows both the standard and the domination rules, so
  // here it is the game mode rather than the scenario that says which.
  {
    match: /^asymm_/,
    name: (mode) =>
      mode === 11 ? 'Asymmetric Battle - Standard' : 'Asymmetric Battle - Domination',
    counted: false,
  },
  // Two bases and a score to defend. The game calls this Standard Battle, and
  // two is the only number of caps it ever has.
  { match: /^domination_2point/, name: 'Standard Battle', counted: false },
  { match: /^domination_/, name: 'Domination', counted: true },
];

/** What a domination layout has unless its name says otherwise. */
const STANDARD_CAPS = 3;

/** The suffixes that move the caps, in the wording the brackets use. */
const VARIANTS = [
  { match: /_alt$/, note: 'alt' },
  { match: /_romb$/, note: 'romb' },
];

function layoutName(scenario, gameMode, caps) {
  const family = FAMILIES.find((f) => f.match.test(scenario));
  if (!family) return null;
  const base = typeof family.name === 'function' ? family.name(gameMode) : family.name;
  const notes = [];
  if (family.counted && caps !== STANDARD_CAPS) notes.push(`${caps} caps`);
  const variant = VARIANTS.find((v) => v.match.test(scenario));
  if (variant) notes.push(variant.note);
  return notes.length ? `${base} (${notes.join(', ')})` : base;
}

/**
 * Layouts held back.
 *
 * Brawl plays a two-cap domination on maps that otherwise run three, and it
 * is not a mode anyone plans for; an operation is not two teams meeting at
 * all. Both would only crowd the picker.
 */
function excluded(layout) {
  const battle = layout.gameMode === 7 || layout.gameMode === 11 || layout.gameMode === 15;
  if (!battle) return 'not a team battle';
  if (/^domination_special/.test(layout.scenario)) return 'brawl';
  return null;
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

// A running toolkit keeps its write-ahead log open, so read a copy of the set.
const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'wowsplan-caps-'));
const dbCopy = path.join(scratch, 'wows_toolkit.db');
let rows;
try {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(toolkitDb + suffix)) await fsp.copyFile(toolkitDb + suffix, dbCopy + suffix);
  }
  const db = new DatabaseSync(dbCopy, { readOnly: true });
  rows = db.prepare('select layout_data from cap_layouts').all();
  db.close();
} finally {
  await fsp.rm(scratch, { recursive: true, force: true });
}

const maps = JSON.parse(await fsp.readFile(mapsFile, 'utf8'));
// An archived map is a stand-in with its caps painted into the image; the
// live map is the one a layout belongs to.
const bySpace = new Map(
  maps.filter((m) => !m.archived && m.spaceName).map((m) => [m.spaceName, m]),
);
// A space the game reworked keeps its old layouts, and the stand-in is the
// only map they still fit. Saying so is worth the extra line: "no map" reads
// as a database that needs filling, when nothing is missing at all.
const archivedSpace = new Map(
  maps.filter((m) => m.archived && m.spaceName).map((m) => [m.spaceName, m]),
);

/* ------------------------------------------------------------------ */
/* Convert                                                             */
/* ------------------------------------------------------------------ */

/** Six decimals of a map extent is under a metre — far inside a cap. */
const round = (v) => Math.round(v * 1e6) / 1e6;

const layouts = [];
const skipped = [];
for (const row of rows) {
  const decoded = decodeLayout(row.layout_data);
  const map = bySpace.get(decoded.spaceName);
  if (!map) {
    const standIn = archivedSpace.get(decoded.spaceName);
    skipped.push(
      standIn
        ? `${standIn.name} ${decoded.scenario}: archived stand-in, caps already in the image`
        : `${decoded.spaceName} ${decoded.scenario}: no map`,
    );
    continue;
  }
  const why = excluded(decoded);
  if (why) {
    skipped.push(`${map.name} ${decoded.scenario}: ${why}`);
    continue;
  }
  const name = layoutName(decoded.scenario, decoded.gameMode, decoded.points.length);
  if (!name) {
    skipped.push(`${map.name} ${decoded.scenario}: unknown scenario`);
    continue;
  }
  // The game's own extent for the space, in the units its positions use.
  const extent = map.spaceSize;
  if (!extent) {
    skipped.push(`${map.name} ${decoded.scenario}: map has no spaceSize`);
    continue;
  }
  layouts.push({
    id: `cap-${decoded.spaceName.split('/').pop()}-${decoded.scenarioId}`,
    mapId: map.id,
    spaceName: decoded.spaceName,
    name,
    scenario: decoded.scenario,
    gameMode: decoded.gameMode,
    points: decoded.points.map((p) => ({
      index: p.index,
      label: String.fromCharCode(65 + p.index),
      nx: round(0.5 + p.x / extent),
      ny: round(0.5 - p.y / extent),
      nr: round(p.radius / extent),
      teamId: p.teamId,
      initiallyEnabled: p.initiallyEnabled,
      cpType: p.cpType,
    })),
  });
}

const mapName = (l) => bySpace.get(l.spaceName).name;

const previous = fs.existsSync(layoutsFile)
  ? (JSON.parse(await fsp.readFile(layoutsFile, 'utf8')).layouts ?? [])
  : [];

/* ------------------------------------------------------------------ */
/* Collapse aliases                                                    */
/* ------------------------------------------------------------------ */

/*
 * The game records one layout per scenario config, and several scenarios of a
 * battle type share both a name and the very caps they draw: a PvE room and
 * its PvP original, or a revision that replaced what it revised. The picker
 * lists layouts by name alone, so those arrive as two or three entries that
 * read identically and draw the same circles — one is the mode, the rest are
 * aliases of it.
 *
 * So a map keeps one layout per name. The survivor is whichever the library
 * already published, because a page stores the id it was pointed at and must
 * keep resolving; failing that the scenario the game did not qualify, and
 * failing that the lowest config id, so a rebuild is repeatable.
 *
 * Sharing a name while drawing different caps is a different matter — it
 * means the naming rule cannot tell two real arrangements apart, and dropping
 * one would lose caps rather than a duplicate. Those are kept and reported.
 */

/** The drawn shape, as the picker would render it. */
const geometry = (l) =>
  l.points
    .map((p) => `${p.index},${p.nx},${p.ny},${p.nr},${p.teamId},${p.cpType}`)
    .join('|');

/** A scenario the game qualified — a PvE room, or a revision of another. */
const qualified = (scenario) => /_(coop|revised|revised_coop)$/.test(scenario);

const published = new Set(previous.map((l) => l.id));

const groups = new Map();
for (const l of layouts) {
  const key = `${l.mapId}/${l.name}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(l);
}

const kept = [];
for (const [key, group] of groups) {
  if (group.length === 1) {
    kept.push(group[0]);
    continue;
  }
  const shapes = new Set(group.map(geometry));
  if (shapes.size > 1) {
    // Not aliases: the name is hiding a real difference in the caps.
    console.log(
      `clash      ${group.length} layouts named ${key.split('/').pop()} on one map ` +
        `draw ${shapes.size} different arrangements — keeping all`,
    );
    kept.push(...group);
    continue;
  }
  const winner =
    group.find((l) => published.has(l.id)) ??
    group.find((l) => !qualified(l.scenario)) ??
    group.slice().sort((a, b) => a.id.localeCompare(b.id))[0];
  for (const l of group) {
    if (l !== winner) console.log(`alias      ${mapName(l)} — ${l.name}  (${l.scenario})`);
  }
  kept.push(winner);
}

layouts.length = 0;
layouts.push(...kept);
layouts.sort((a, b) => mapName(a).localeCompare(mapName(b)) || a.name.localeCompare(b.name));

/* ------------------------------------------------------------------ */
/* Compare and write                                                   */
/* ------------------------------------------------------------------ */

const before = new Map(previous.map((l) => [l.id, l]));
const after = new Map(layouts.map((l) => [l.id, l]));

for (const l of layouts) {
  const old = before.get(l.id);
  const where = `${mapName(l)} — ${l.name}`;
  if (!old) console.log(`added      ${where}  (${l.scenario}, ${l.points.length} caps)`);
  else if (old.name !== l.name) console.log(`renamed    ${mapName(l)} — ${old.name} -> ${l.name}`);
  else if (JSON.stringify(old) !== JSON.stringify(l)) console.log(`changed    ${where}`);
}
for (const l of previous) {
  if (!after.has(l.id)) console.log(`removed    ${l.spaceName} — ${l.name}`);
}
for (const s of skipped.sort()) console.log(`skipped    ${s}`);

const doc = {
  schemaVersion: 1,
  source: 'wows-toolkit cap_layouts + maps.json spaceSize',
  notes: {
    coords: 'nx/ny/nr are fractions of map extent; x = nx * map.widthMeters',
    teamId: '-1 = neutral, 0 and 1 = the two teams that start owning it',
    cpTypes: {
      0: 'Control',
      1: 'Base',
      2: 'MegaBase',
      3: 'BuildingCP',
      4: 'BaseWithPoints',
      5: 'EpicenterCP',
    },
    naming:
      "The game's own name for the battle type, with a hyphen for its full stop " +
      'and the cap count in brackets where it is not the standard three.',
    excluded:
      'Two-cap layouts that are not Standard Battle are brawl layouts and are not listed.',
    aliases:
      'A map keeps one layout per name. Scenarios that share a name and draw the ' +
      'same caps — a PvE room, or a revision of another — are aliases of the mode ' +
      'already listed, and only one is kept.',
  },
  layouts,
};

console.log(`\n${previous.length} layouts before, ${layouts.length} after`);
if (dry) {
  console.log('dry run — nothing written');
} else {
  const tmp = `${layoutsFile}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(doc, null, 1), 'utf8');
  await fsp.rename(tmp, layoutsFile);
  console.log(`wrote      ${layoutsFile}`);
}
