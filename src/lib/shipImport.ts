/**
 * Ship database import/export.
 *
 * The user supplies the data, and real-world exports are messy, so the parser
 * is deliberately forgiving: it accepts JSON, CSV and YAML, matches column
 * names case- and separator-insensitively across a table of aliases, strips
 * unit suffixes ("10.0 km", "97,200 HP") and understands Roman-numeral tiers.
 * Anything it cannot map is preserved under the ship's notes so nothing the
 * user imported is silently thrown away.
 */

import Papa from 'papaparse';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import type { Consumable, Ship, ShipClass } from '@/types/model';
import { uid } from './util';

type Raw = Record<string, unknown>;

const CLASS_ALIASES: Record<string, ShipClass> = {
  dd: 'DD', destroyer: 'DD', destroyers: 'DD',
  ca: 'CA', cl: 'CA', cruiser: 'CA', cruisers: 'CA', heavycruiser: 'CA', lightcruiser: 'CA',
  bb: 'BB', battleship: 'BB', battleships: 'BB', battlecruiser: 'BB',
  cv: 'CV', carrier: 'CV', aircraftcarrier: 'CV', carriers: 'CV',
  ss: 'SS', submarine: 'SS', sub: 'SS', submarines: 'SS',
};

/**
 * Nation names differ between every source that publishes them ("U.S.A.",
 * "United States", "USA"). They are folded to one spelling so the database
 * does not end up with the same navy under three labels in the filters.
 * Anything unrecognised is kept exactly as written.
 */
const NATION_ALIASES: Record<string, string> = {
  usa: 'USA', us: 'USA', america: 'USA', unitedstates: 'USA', unitedstatesofamerica: 'USA',
  uk: 'UK', britain: 'UK', greatbritain: 'UK', unitedkingdom: 'UK', royalnavy: 'UK',
  ussr: 'USSR', soviet: 'USSR', sovietunion: 'USSR', russia: 'USSR',
  japan: 'Japan', germany: 'Germany', france: 'France', italy: 'Italy', spain: 'Spain',
  netherlands: 'Netherlands', holland: 'Netherlands', dutch: 'Netherlands',
  panasia: 'Pan-Asia', panamerica: 'Pan-America', panamerican: 'Pan-America',
  europe: 'Europe', paneurope: 'Europe', european: 'Europe',
  commonwealth: 'Commonwealth', panafrica: 'Pan-Africa',
};

const ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12,
};

/** field -> accepted source keys (normalised: lowercase, alphanumeric only) */
const FIELD_ALIASES: Record<string, string[]> = {
  name: ['name', 'ship', 'shipname', 'title'],
  nation: ['nation', 'country', 'flag', 'faction'],
  class: ['class', 'type', 'shiptype', 'shipclass', 'hull'],
  cruiserType: ['cruisertype', 'cruisersubclass', 'subclass'],
  tier: ['tier', 'level', 'lvl'],
  hp: ['hp', 'health', 'hitpoints', 'survivability'],
  speed_kn: ['speed', 'maxspeed', 'speedkn', 'knots'],
  rudderShift_s: ['ruddershift', 'rudder', 'ruddershifttime'],
  turningCircle_m: ['turningcircle', 'turningradius', 'turncircle'],
  concealment_km: ['concealment', 'detectability', 'detection', 'detectionrange', 'seadetection', 'concealmentsea', 'detectabilitybysea', 'detectionbysea', 'detectionsea', 'surfacedetection'],
  concealmentAir_km: ['concealmentair', 'airdetection', 'detectabilitybyair', 'airdetectability', 'detectionbyair', 'detectionair'],
  mainBatteryRange_km: ['mainbatteryrange', 'range', 'artilleryrange', 'gunrange', 'firingrange', 'mainrange'],
  mainBattery: ['mainbattery', 'guns', 'artillery', 'mainguns'],
  secondaryRange_km: ['secondaryrange', 'secondarybatteryrange', 'atbarange'],
  secondaryBattery: ['secondary', 'secondarybattery', 'atba'],
  torpedoRange_km: ['torpedorange', 'torprange', 'torpedoesrange'],
  torpedoSpeed_kn: ['torpedospeed', 'torpspeed'],
  torpedoArc_deg: ['torpedoarc', 'torpedoangle', 'torparc'],
  torpedoes: ['torpedoes', 'torps', 'torpedotubes'],
  airstrikeMinRange_km: ['airstrikeminrange', 'airstrikemin', 'minairstrikerange', 'airstrikerangemin'],
  airstrikeMaxRange_km: ['airstrikemaxrange', 'airstrikemax', 'maxairstrikerange', 'airstrikerangemax', 'airstrikerange', 'airstrike'],
  aaRange_km: ['aarange', 'antiairrange', 'aadistance'],
  aa: ['aa', 'antiair', 'aadps', 'aadefense'],
  radar_km: ['radar', 'radarrange', 'surveillanceradar', 'radarkm'],
  radarDuration_s: ['radarduration', 'radartime'],
  hydro_km: ['hydro', 'hydrorange', 'hydroacoustic', 'hydroacousticsearch', 'sonar'],
  hydroDuration_s: ['hydroduration', 'hydrotime'],
  smokeDuration_s: ['smokeduration', 'smoketime'],
  smokeRadius_km: ['smokeradius', 'smokerange'],
  // A column headed just "smoke" holds a yes/no as often as a radius, so it is
  // read as both and each side keeps only what it can parse.
  smoke: ['smoke', 'hassmoke', 'smokegenerator', 'smokescreen'],
  fighter: ['fighter', 'catapultfighter'],
  spottingAircraft: ['spottingaircraft', 'spotter', 'spotteraircraft', 'spottingplane'],
  notes: ['notes', 'comment', 'comments', 'description'],
  iconId: ['iconid', 'icon'],
};

function norm(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Unit words that trail a column name rather than belong to it. */
const UNIT_WORDS = new Set([
  'km', 'm', 'nm', 'kn', 'kt', 'kts', 'knot', 'knots', 's', 'sec', 'secs', 'second', 'seconds',
  'deg', 'degree', 'degrees', 'mm', 'hp', 'pct', 'percent', '%',
]);

/**
 * Column names carry their units — "Detection by Sea (km)", "Speed, kn" — and
 * the unit is never part of what the column means. A parenthesised group and a
 * trailing unit word are dropped so those headers land on the same key as the
 * bare ones. The unit only goes if something is left to match on, so a column
 * headed just "km" or "HP" still keeps its name.
 */
function normHeader(key: string): string {
  const stripped = key
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .trim()
    .replace(/[\s,;:_/-]+(?:in\s+)?([a-z%]+)\.?$/i, (all, unit) =>
      UNIT_WORDS.has(String(unit).toLowerCase()) ? '' : all,
    );
  return norm(stripped) || norm(key);
}

/** Pulls "12.4" out of "12.4 km", "12,4km", "97 200 HP" or a plain number. */
function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const text = String(value).trim();
  if (!text || /^(n\/?a|none|-|—)$/i.test(text)) return undefined;
  const cleaned = text.replace(/\s|'/g, '').replace(/,(?=\d{3}\b)/g, '');
  const match = cleaned.replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (!match) return undefined;
  const n = parseFloat(match[0]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A stat column reading 0 means the ship has none of it: exports write 0 where
 * a blank cell was meant, and a ship with "radar 0" has no radar. Treating it
 * as absent keeps zero-radius rings and "0.0 km" labels out of the planner.
 */
function pos(value: unknown): number | undefined {
  const n = num(value);
  return n !== undefined && n > 0 ? n : undefined;
}

/** Whether a cell is a written-out zero, for columns we do not recognise. */
function isZero(value: unknown): boolean {
  return /^0+([.,]0+)?$/.test(String(value).trim());
}

function bool(value: unknown): boolean | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const t = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'x'].includes(t)) return true;
  if (['false', 'no', 'n', '0', '', '-', 'n/a'].includes(t)) return false;
  return undefined;
}

/**
 * A yes/no column, and nothing else. `bool` reads 1 and 0 as answers, which
 * would turn a smoke radius of 1 km into a flag; a number here is left for
 * the numeric field sharing the column.
 */
function yesNo(value: unknown): boolean | undefined {
  return typeof value === 'number' || num(value) !== undefined ? undefined : bool(value);
}

function toTier(value: unknown): number {
  const direct = num(value);
  if (direct !== undefined && direct >= 1 && direct <= 12) return Math.round(direct);
  const t = String(value ?? '').trim().toLowerCase().replace(/[^ivx]/g, '');
  return ROMAN[t] ?? 10;
}

function toClass(value: unknown): ShipClass {
  const key = norm(String(value ?? ''));
  if (CLASS_ALIASES[key]) return CLASS_ALIASES[key];
  for (const [alias, cls] of Object.entries(CLASS_ALIASES)) {
    if (key.includes(alias)) return cls;
  }
  return 'CA';
}

function toNation(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  return NATION_ALIASES[norm(text)] ?? text;
}

/** Source values that name a light cruiser specifically. */
const CL_ALIASES = ['cl', 'lightcruiser'];

/**
 * Light cruisers import as CA — same class in every mechanical sense — but the
 * distinction is kept so the database can label them CL.
 */
function toCruiserType(value: unknown): 'CA' | 'CL' | undefined {
  const key = norm(String(value ?? ''));
  if (!key) return undefined;
  return CL_ALIASES.some((a) => key === a || key.includes(a)) ? 'CL' : 'CA';
}

/**
 * Metres sneak into range columns often enough to be worth handling: anything
 * above 100 in a "km" field is treated as metres.
 */
function toKm(value: unknown): number | undefined {
  const n = pos(value);
  if (n === undefined) return undefined;
  if (n > 100) return n / 1000;
  return n;
}

function pick(raw: Raw, field: string): unknown {
  const aliases = FIELD_ALIASES[field] ?? [field.toLowerCase()];
  // Exact header names win; only then is the unit-stripped form considered, so
  // a file carrying both "Radar" and "Radar Range (km)" keeps the plain one.
  for (const shape of [norm, normHeader]) {
    for (const key of Object.keys(raw)) {
      if (aliases.includes(shape(key))) {
        const v = raw[key];
        if (v !== '' && v !== null && v !== undefined) return v;
      }
    }
  }
  return undefined;
}

function parseConsumables(raw: Raw): Consumable[] | undefined {
  const direct = raw['consumables'] ?? raw['Consumables'] ?? raw['otherConsumables'] ?? raw['Other Consumables'];
  if (Array.isArray(direct)) {
    return direct.map((c) =>
      typeof c === 'string'
        ? { name: c }
        : {
            name: String((c as Raw)?.name ?? 'Consumable'),
            range_km: toKm((c as Raw)?.range_km ?? (c as Raw)?.range),
            duration_s: num((c as Raw)?.duration_s ?? (c as Raw)?.duration),
            charges: num((c as Raw)?.charges),
            cooldown_s: num((c as Raw)?.cooldown_s ?? (c as Raw)?.cooldown),
            notes: (c as Raw)?.notes ? String((c as Raw).notes) : undefined,
          },
    );
  }
  if (typeof direct === 'string' && direct.trim()) {
    return direct
      .split(/[;|]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({ name: s }));
  }
  return undefined;
}

const KNOWN_KEYS = new Set(Object.values(FIELD_ALIASES).flat().concat(['consumables', 'otherconsumables', 'id']));

/** Whether a column was consumed by a field, under either header shape. */
function isKnownKey(key: string): boolean {
  return KNOWN_KEYS.has(norm(key)) || KNOWN_KEYS.has(normHeader(key));
}

export function normalizeShip(raw: Raw, existing?: Ship): Ship {
  const name = String(pick(raw, 'name') ?? existing?.name ?? 'Unnamed ship').trim();

  // Anything we did not recognise is folded into the notes rather than lost.
  const leftovers = Object.entries(raw)
    .filter(([k, v]) => !isKnownKey(k) && v !== '' && v !== null && v !== undefined && !isZero(v))
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);

  const notesFromField = pick(raw, 'notes');
  const notes = [notesFromField ? String(notesFromField) : '', ...leftovers].filter(Boolean).join('\n') || undefined;

  const ship: Ship = {
    id: (raw.id ? String(raw.id) : undefined) ?? existing?.id ?? uid('ship-'),
    name,
    nation: toNation(pick(raw, 'nation')) ?? existing?.nation ?? 'Unknown',
    class: pick(raw, 'class') !== undefined ? toClass(pick(raw, 'class')) : (existing?.class ?? 'CA'),
    cruiserType: undefined, // resolved below, once the class is known
    tier: pick(raw, 'tier') !== undefined ? toTier(pick(raw, 'tier')) : (existing?.tier ?? 10),
    hp: pos(pick(raw, 'hp')) ?? existing?.hp,
    speed_kn: pos(pick(raw, 'speed_kn')) ?? existing?.speed_kn,
    rudderShift_s: pos(pick(raw, 'rudderShift_s')) ?? existing?.rudderShift_s,
    turningCircle_m: pos(pick(raw, 'turningCircle_m')) ?? existing?.turningCircle_m,
    concealment_km: toKm(pick(raw, 'concealment_km')) ?? existing?.concealment_km,
    concealmentAir_km: toKm(pick(raw, 'concealmentAir_km')) ?? existing?.concealmentAir_km,
    mainBatteryRange_km: toKm(pick(raw, 'mainBatteryRange_km')) ?? existing?.mainBatteryRange_km,
    mainBattery: (pick(raw, 'mainBattery') as string) ?? existing?.mainBattery,
    secondaryRange_km: toKm(pick(raw, 'secondaryRange_km')) ?? existing?.secondaryRange_km,
    secondaryBattery: (pick(raw, 'secondaryBattery') as string) ?? existing?.secondaryBattery,
    torpedoRange_km: toKm(pick(raw, 'torpedoRange_km')) ?? existing?.torpedoRange_km,
    torpedoSpeed_kn: pos(pick(raw, 'torpedoSpeed_kn')) ?? existing?.torpedoSpeed_kn,
    torpedoArc_deg: pos(pick(raw, 'torpedoArc_deg')) ?? existing?.torpedoArc_deg,
    torpedoes: (pick(raw, 'torpedoes') as string) ?? existing?.torpedoes,
    airstrikeMinRange_km: toKm(pick(raw, 'airstrikeMinRange_km')) ?? existing?.airstrikeMinRange_km,
    airstrikeMaxRange_km: toKm(pick(raw, 'airstrikeMaxRange_km')) ?? existing?.airstrikeMaxRange_km,
    aaRange_km: toKm(pick(raw, 'aaRange_km')) ?? existing?.aaRange_km,
    aa: (pick(raw, 'aa') as string) ?? existing?.aa,
    radar_km: toKm(pick(raw, 'radar_km')) ?? existing?.radar_km,
    radarDuration_s: pos(pick(raw, 'radarDuration_s')) ?? existing?.radarDuration_s,
    hydro_km: toKm(pick(raw, 'hydro_km')) ?? existing?.hydro_km,
    hydroDuration_s: pos(pick(raw, 'hydroDuration_s')) ?? existing?.hydroDuration_s,
    smokeDuration_s: pos(pick(raw, 'smokeDuration_s')) ?? existing?.smokeDuration_s,
    smokeRadius_km: toKm(pick(raw, 'smokeRadius_km')) ?? toKm(pick(raw, 'smoke')) ?? existing?.smokeRadius_km,
    smoke: yesNo(pick(raw, 'smoke')) ?? existing?.smoke,
    fighter: bool(pick(raw, 'fighter')) ?? existing?.fighter,
    spottingAircraft: bool(pick(raw, 'spottingAircraft')) ?? existing?.spottingAircraft,
    consumables: parseConsumables(raw) ?? existing?.consumables,
    iconId: (pick(raw, 'iconId') as string) ?? existing?.iconId ?? null,
    notes: notes ?? existing?.notes,
  };

  // The CA/CL split only means anything for cruisers. An explicit column wins;
  // otherwise a source that said "CL" in the class column still carries over.
  if (ship.class === 'CA') {
    const explicit = toCruiserType(pick(raw, 'cruiserType'));
    const fromClass = pick(raw, 'class') !== undefined ? toCruiserType(pick(raw, 'class')) : undefined;
    ship.cruiserType = explicit ?? fromClass ?? existing?.cruiserType;
  }

  // Drop undefined keys so exported files stay tidy.
  for (const key of Object.keys(ship) as (keyof Ship)[]) {
    if (ship[key] === undefined) delete ship[key];
  }
  return ship;
}

export interface ParseResult {
  ships: Ship[];
  format: 'json' | 'csv' | 'yaml';
  warnings: string[];
}

export function parseShipData(text: string, ext: string): ParseResult {
  const warnings: string[] = [];
  const e = ext.toLowerCase().replace('.', '');
  let rows: Raw[] = [];
  let format: ParseResult['format'] = 'json';

  if (e === 'csv' || e === 'tsv') {
    format = 'csv';
    const parsed = Papa.parse<Raw>(text, { header: true, skipEmptyLines: true, dynamicTyping: false });
    if (parsed.errors?.length) {
      warnings.push(...parsed.errors.slice(0, 5).map((err) => `Row ${err.row ?? '?'}: ${err.message}`));
    }
    rows = parsed.data ?? [];
  } else if (e === 'yaml' || e === 'yml') {
    format = 'yaml';
    rows = coerceRows(yamlLoad(text));
  } else {
    format = 'json';
    rows = coerceRows(JSON.parse(text));
  }

  const ships = rows
    .filter((r) => r && typeof r === 'object')
    .map((r) => normalizeShip(r))
    .filter((s) => s.name && s.name !== 'Unnamed ship');

  if (!ships.length) warnings.push('No ship rows were recognised in this file.');
  return { ships, format, warnings };
}

/** Accepts an array, a {ships:[...]} wrapper, or a name-keyed object. */
function coerceRows(data: unknown): Raw[] {
  if (Array.isArray(data)) return data as Raw[];
  if (data && typeof data === 'object') {
    const obj = data as Raw;
    for (const key of ['ships', 'data', 'items', 'vehicles']) {
      if (Array.isArray(obj[key])) return obj[key] as Raw[];
    }
    // { "Des Moines": {...}, "Yamato": {...} }
    const values = Object.entries(obj);
    if (values.every(([, v]) => v && typeof v === 'object' && !Array.isArray(v))) {
      return values.map(([k, v]) => ({ name: k, ...(v as Raw) }));
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

const CSV_COLUMNS: (keyof Ship)[] = [
  'id', 'name', 'nation', 'class', 'cruiserType', 'tier', 'hp', 'speed_kn', 'rudderShift_s', 'turningCircle_m',
  'concealment_km', 'concealmentAir_km', 'mainBatteryRange_km', 'mainBattery', 'secondaryRange_km',
  'torpedoRange_km', 'torpedoSpeed_kn', 'torpedoArc_deg', 'torpedoes',
  'airstrikeMinRange_km', 'airstrikeMaxRange_km', 'aaRange_km', 'aa',
  'radar_km', 'radarDuration_s', 'hydro_km', 'hydroDuration_s', 'smoke', 'smokeDuration_s', 'smokeRadius_km',
  'fighter', 'spottingAircraft', 'notes',
];

export function serializeShips(ships: Ship[], format: 'json' | 'csv' | 'yaml'): string {
  if (format === 'json') return JSON.stringify(ships, null, 2);
  if (format === 'yaml') return yamlDump(ships);
  const rows = ships.map((s) => {
    const row: Record<string, unknown> = {};
    for (const col of CSV_COLUMNS) row[col] = s[col] ?? '';
    row.consumables = (s.consumables ?? []).map((c) => c.name).join(' | ');
    return row;
  });
  return Papa.unparse(rows, { columns: [...CSV_COLUMNS.map(String), 'consumables'] });
}
