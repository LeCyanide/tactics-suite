/**
 * Core data model for the WoWs Tactics Suite.
 *
 * Coordinate system
 * -----------------
 * All tactical geometry is stored in WORLD METRES with the origin at the
 * top-left corner of the map. A map declares its own extent (e.g. 30000 x
 * 30000 m), the background image is stretched across that extent, and every
 * object position, radius and length is expressed in metres. Ship ranges come
 * out of the ship database in kilometres and are multiplied by 1000 on render.
 *
 * This keeps range circles physically correct at any canvas size and makes the
 * model independent of the pixel dimensions of whatever image the user
 * imported.
 */

export type ID = string;

export const SCHEMA_VERSION = 2;

/* ------------------------------------------------------------------ */
/* Ships                                                               */
/* ------------------------------------------------------------------ */

export type ShipClass = 'DD' | 'CA' | 'BB' | 'CV' | 'SS';

export const SHIP_CLASSES: ShipClass[] = ['DD', 'CA', 'BB', 'CV', 'SS'];

export const SHIP_CLASS_LABEL: Record<ShipClass, string> = {
  DD: 'Destroyer',
  CA: 'Cruiser',
  BB: 'Battleship',
  CV: 'Aircraft carrier',
  SS: 'Submarine',
};

/**
 * The code shown for a ship's class. Light cruisers read "CL" but are a CA in
 * every other respect — same marker, same colour, same handling.
 */
export function shipClassCode(ship: { class: ShipClass; cruiserType?: 'CA' | 'CL' }): string {
  return ship.class === 'CA' ? (ship.cruiserType ?? 'CA') : ship.class;
}

/** A consumable that is not one of the first-class ones (radar/hydro/smoke/...). */
export interface Consumable {
  name: string;
  /** Effective radius in km, when the consumable projects a range. */
  range_km?: number;
  duration_s?: number;
  charges?: number;
  cooldown_s?: number;
  notes?: string;
}

export interface Ship {
  id: ID;
  name: string;
  nation: string;
  class: ShipClass;
  /**
   * Cruisers may be flagged as light cruisers. This is a naming distinction
   * only: a CL uses the CA marker and is treated identically everywhere else.
   */
  cruiserType?: 'CA' | 'CL';
  tier: number;

  hp?: number;
  speed_kn?: number;
  rudderShift_s?: number;
  turningCircle_m?: number;

  /** Surface detectability in km. */
  concealment_km?: number;
  concealmentAir_km?: number;

  mainBatteryRange_km?: number;
  mainBattery?: string;
  secondaryRange_km?: number;
  secondaryBattery?: string;

  torpedoRange_km?: number;
  torpedoSpeed_kn?: number;
  /** Half-angle of the torpedo firing sector, in degrees. Stored only; the torpedo ring is a full circle. */
  torpedoArc_deg?: number;
  torpedoes?: string;

  /**
   * The airstrike ring is drawn from the maximum alone, as a full circle like
   * every other range. The minimum is kept because the source data carries it
   * and it survives an export round-trip, but nothing draws it: a hole in the
   * ring buys less clarity than it costs.
   */
  airstrikeMinRange_km?: number;
  airstrikeMaxRange_km?: number;

  aaRange_km?: number;
  aa?: string;

  radar_km?: number;
  radarDuration_s?: number;
  hydro_km?: number;
  hydroDuration_s?: number;
  smokeDuration_s?: number;
  smokeRadius_km?: number;
  /**
   * Whether the ship carries a smoke generator at all. Most sources say that
   * much and nothing about radius or duration, so it is its own field; left
   * unset, the smoke figures and the consumable list decide.
   */
  smoke?: boolean;
  fighter?: boolean;
  spottingAircraft?: boolean;
  consumables?: Consumable[];

  /** Id of a locally imported icon asset. Null -> procedural class glyph. */
  iconId?: ID | null;

  notes?: string;
}

/**
 * Which ships a competition lets you bring — a clan battle season, a
 * tournament. Rulesets belong to the project that was made for that
 * competition: there are no standard ones, and a new project starts with none.
 * A ruleset only narrows the ship lists; it never touches what is on a page.
 */
export interface ShipRuleset {
  id: ID;
  name: string;
  /** Tiers allowed. Empty means every tier. */
  tiers: number[];
  /** Classes allowed. Empty means every class. */
  classes: ShipClass[];
  /** Ships ruled out by name, on top of the tier and class limits. */
  banned: ID[];
  /** Caps on how many ships out of a named group one side may bring. */
  limits: ShipLimit[];
  /** How many ships one side may field in all. Zero means no limit. */
  maxShips: number;
}

/**
 * "At most two of these." The ships stay allowed; what is capped is how many
 * of the group a single team fields, counted from what that team has on the
 * page.
 */
export interface ShipLimit {
  id: ID;
  max: number;
  ships: ID[];
}

export interface ShipIconAsset {
  id: ID;
  name: string;
  /** File name inside the icon asset store. */
  file: string;
  mime: string;
  addedAt: number;
}

/* ------------------------------------------------------------------ */
/* Maps                                                                */
/* ------------------------------------------------------------------ */

export interface GameMap {
  id: ID;
  name: string;
  /** Asset file name inside the map asset store. */
  file: string;
  mime: string;
  /** Natural pixel size of the imported image, for aspect information. */
  pixelWidth: number;
  pixelHeight: number;
  /** Tactical extent of the map in metres. */
  widthMeters: number;
  heightMeters: number;
  /** Grid divisions across / down. */
  gridCols: number;
  gridRows: number;
  /** Game space this map came from, e.g. "spaces/46_Estuary". */
  spaceName?: string;
  /** Map extent in BigWorld units, as the game declares it (1 unit = 30 m). */
  spaceSize?: number;
  /**
   * A stand-in kept only until real data replaces it — a pre-rendered image
   * with a cap layout drawn into the artwork, covering a mode the layout
   * library has nothing for. Flagged rather than hidden so the whole set can
   * be found and dropped in one pass; see scripts/remove-archived-maps.mjs.
   */
  archived?: boolean;
  /** The live map this one stands in for. */
  archiveOf?: ID;
  addedAt: number;
  updatedAt: number;
}

/** Per-page overrides of the map presentation. */
export interface MapViewConfig {
  showGrid: boolean;
  showCoordinates: boolean;
  showBorder: boolean;
  gridOpacity: number;
  /** Overrides map.gridCols/Rows when set. */
  gridCols?: number;
  gridRows?: number;
  mapOpacity: number;
}

export const DEFAULT_MAP_VIEW: MapViewConfig = {
  showGrid: true,
  showCoordinates: true,
  showBorder: true,
  gridOpacity: 0.22,
  mapOpacity: 1,
};

/* ------------------------------------------------------------------ */
/* Capture point layouts                                               */
/* ------------------------------------------------------------------ */

/**
 * One capture zone, as the game lays it out at the start of a match.
 *
 * Stored as fractions of the map extent rather than metres. A layout is then
 * independent of both the game's own units and whatever metre size a map
 * declares, so correcting a map's extent later can never leave its caps
 * pointing at the wrong water. Multiply by the map extent to get world metres.
 */
export interface CapPoint {
  /** 0 = A, 1 = B, 2 = C, … */
  index: number;
  label: string;
  /** Centre, as a fraction of map width and height. */
  nx: number;
  ny: number;
  /** Radius, as a fraction of map width. */
  nr: number;
  /** -1 = neutral, 0 = alpha, 1 = bravo. */
  teamId: number;
  /** Arms race caps start switched off and are enabled during the match. */
  initiallyEnabled: boolean;
  /** ControlPointType index; 0 = Control, 4 = BaseWithPoints. */
  cpType: number;
}

/**
 * A full cap layout for one map and mode. A map has several, and they are
 * chosen per page — nothing about a map ties it to one layout.
 */
export interface CapLayout {
  id: ID;
  mapId: ID;
  /** Game space it was read from, e.g. "spaces/46_Estuary". */
  spaceName: string;
  /**
   * The game's own name for the battle type this layout belongs to, with a
   * hyphen for its full stop and the cap count in brackets where it is not
   * the standard three, e.g. "Tournament - Domination (4 caps)".
   */
  name: string;
  scenario: string;
  gameMode: number;
  points: CapPoint[];
}

/**
 * Cap zone colours, taken from the game's own palette: alpha green, bravo red,
 * and white where neither side starts in possession. These are deliberately
 * not the project's team colours — a layout is a fact about the match, not
 * something the planner authors, so it reads the same in every project.
 */
export const CAP_COLORS = {
  neutral: '#FFFFFF',
  alpha: '#4CE8AA',
  bravo: '#FE4D2A',
} as const;

/**
 * Fill alpha for a cap zone. Low enough that the islands inside a zone stay
 * readable, which is usually the whole point of talking about a cap.
 */
export const CAP_FILL_OPACITY = 0.15;

/**
 * ControlPointType index for a scoring base — the two-base Standard battle
 * layout. These are drawn with the game's base flag rather than a letter.
 */
export const CP_TYPE_BASE_WITH_POINTS = 4;

/** The colour a cap is drawn in, from the team that starts owning it. */
export function capColor(teamId: number): string {
  if (teamId === 0) return CAP_COLORS.alpha;
  if (teamId === 1) return CAP_COLORS.bravo;
  return CAP_COLORS.neutral;
}

/* ------------------------------------------------------------------ */
/* Ship characteristics that can be drawn on the map                   */
/* ------------------------------------------------------------------ */

/**
 * Things a ship can be asked to draw beyond itself.
 *
 * The icon and the name are not in here: they are what a ship marker *is*,
 * always drawn, and so have nothing to toggle. Ranges are decided per ship,
 * never page-wide.
 */
export type CharacteristicKey =
  | 'detection'
  | 'radar'
  | 'hydro'
  | 'mainBattery'
  | 'secondary'
  | 'torpedo'
  | 'airstrike';

export const CHARACTERISTICS: { key: CharacteristicKey; label: string; group: 'range' | 'other' }[] = [
  { key: 'detection', label: 'Detection range', group: 'range' },
  { key: 'radar', label: 'Radar', group: 'range' },
  { key: 'hydro', label: 'Hydro', group: 'range' },
  { key: 'mainBattery', label: 'Main battery range', group: 'range' },
  { key: 'secondary', label: 'Secondary battery range', group: 'range' },
  { key: 'torpedo', label: 'Torpedo range', group: 'range' },
  { key: 'airstrike', label: 'Airstrike', group: 'range' },
];

/** Characteristics that render as a circle on the map. */
export const RANGE_KEYS: CharacteristicKey[] = [
  'detection',
  'radar',
  'hydro',
  'mainBattery',
  'secondary',
  'torpedo',
  'airstrike',
];

/** Characteristics a page can set a default for: everything but the ranges. */
export const PAGE_CHARACTERISTIC_KEYS: CharacteristicKey[] = CHARACTERISTICS.filter(
  (c) => c.group !== 'range',
).map((c) => c.key);

export type CharacteristicFlags = Partial<Record<CharacteristicKey, boolean>>;

/**
 * Default page-level state. Every characteristic is a per-ship range, so a
 * page has nothing to default.
 */
export const DEFAULT_CHARACTERISTICS: CharacteristicFlags = {};

/** Every range off. The starting point for a ship's own range flags. */
export const DEFAULT_RANGE_FLAGS: CharacteristicFlags = Object.fromEntries(
  RANGE_KEYS.map((k) => [k, false]),
) as CharacteristicFlags;

/** How one range characteristic is painted. */
export interface RangeStyle {
  color: string;
  opacity: number;
  lineWidth: number;
  fill: boolean;
  fillOpacity: number;
  dashed: boolean;
  showLabel: boolean;
}

export type RangeStyleMap = Record<string, RangeStyle>;

export const DEFAULT_RANGE_STYLES: RangeStyleMap = {
  detection: { color: '#f4c95d', opacity: 0.9, lineWidth: 1.5, fill: false, fillOpacity: 0.08, dashed: true, showLabel: true },
  radar: { color: '#5ad2f4', opacity: 0.9, lineWidth: 1.5, fill: true, fillOpacity: 0.07, dashed: false, showLabel: true },
  hydro: { color: '#7ee787', opacity: 0.9, lineWidth: 1.5, fill: true, fillOpacity: 0.06, dashed: false, showLabel: true },
  mainBattery: { color: '#ff8f5e', opacity: 0.85, lineWidth: 1.5, fill: false, fillOpacity: 0.05, dashed: false, showLabel: true },
  secondary: { color: '#ffb38a', opacity: 0.8, lineWidth: 1.2, fill: false, fillOpacity: 0.05, dashed: true, showLabel: true },
  torpedo: { color: '#8f7bff', opacity: 0.9, lineWidth: 1.5, fill: true, fillOpacity: 0.1, dashed: false, showLabel: true },
  airstrike: { color: '#ff7ab6', opacity: 0.9, lineWidth: 1.5, fill: true, fillOpacity: 0.07, dashed: false, showLabel: true },
};

/* ------------------------------------------------------------------ */
/* Teams                                                               */
/* ------------------------------------------------------------------ */

export interface Team {
  id: ID;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

export interface Layer {
  id: ID;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  /** System layers are created with every page and cannot be deleted. */
  system?: boolean;
}

/** Well-known layer ids, so new objects land somewhere sensible. */
export const LAYER_IDS = {
  grid: 'layer-grid',
  caps: 'layer-caps',
  ranges: 'layer-ranges',
  annotations: 'layer-annotations',
  ships: 'layer-ships',
  /** Drawn over a replay, and only ever shown there. */
  replay: 'layer-replay',
} as const;

/**
 * Five planning layers plus Replay notes. Shapes, arrows, text and markers all live on
 * "Annotations" — they are drawn the same way and are almost always shown or
 * hidden together — while ranges keep their own layer so every circle on the
 * page can be switched off in one click.
 *
 * Grid and Cap zones are background pseudo-layers: they hold no objects and
 * exist only so the two can be toggled and faded like anything else. Both are
 * locked, which is what keeps them out of every "which layer does this object
 * go on" decision.
 */
export function createDefaultLayers(): Layer[] {
  // Rendered back-to-front in array order.
  return [
    { id: LAYER_IDS.grid, name: 'Grid', visible: true, locked: true, opacity: 1, system: true },
    { id: LAYER_IDS.caps, name: 'Cap zones', visible: true, locked: true, opacity: 1, system: true },
    { id: LAYER_IDS.ranges, name: 'Ship ranges', visible: true, locked: false, opacity: 1, system: true },
    { id: LAYER_IDS.annotations, name: 'Annotations', visible: true, locked: false, opacity: 1, system: true },
    { id: LAYER_IDS.ships, name: 'Ships', visible: true, locked: false, opacity: 1, system: true },
    // Replay notes are a plan for a battle that already happened, on ground the
    // page may not even be planning against, so they are kept apart from the
    // plan and drawn only in replay mode.
    { id: LAYER_IDS.replay, name: 'Replay notes', visible: true, locked: false, opacity: 1, system: true },
  ];
}

/** Legacy layer ids, mapped to the layer that replaces them. */
export const LEGACY_LAYER_REMAP: Record<string, string> = {
  'layer-zones': LAYER_IDS.annotations,
  'layer-routes': LAYER_IDS.annotations,
  'layer-shapes': LAYER_IDS.annotations,
  'layer-text': LAYER_IDS.annotations,
  'layer-pings': LAYER_IDS.annotations,
};

/**
 * The two sides a project starts with. Green and red are the colours the game
 * itself uses for friendly and enemy, so a plan reads the way a battle does.
 */
export const DEFAULT_TEAM_SIDES: { name: string; color: string }[] = [
  { name: 'Alpha', color: '#3fd68a' },
  { name: 'Bravo', color: '#ff5f56' },
];

/** Legacy default team names, mapped to the current sides (name and colour). */
export const LEGACY_TEAM_NAMES: Record<string, { name: string; color: string }> = {
  'Team North': DEFAULT_TEAM_SIDES[0],
  'Team South': DEFAULT_TEAM_SIDES[1],
};

/* ------------------------------------------------------------------ */
/* Tactical objects                                                    */
/* ------------------------------------------------------------------ */

export type ObjectType =
  | 'ship'
  | 'freehand'
  | 'line'
  | 'arrow'
  | 'doubleArrow'
  | 'curvedArrow'
  | 'rect'
  | 'roundRect'
  | 'circle'
  | 'polygon'
  | 'text'
  | 'number'
  | 'marker'
  | 'ruler'
  | 'area';

/** Unsupported object types, stripped when a project loads. */
export const REMOVED_OBJECT_TYPES = ['ping', 'zone', 'ellipse', 'arc', 'bearing'] as const;

export interface Vec2 {
  x: number;
  y: number;
}

export interface BaseObject {
  id: ID;
  type: ObjectType;
  layerId: ID;
  /** Anchor position in world metres. */
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
  name?: string;
}

export interface StrokeStyle {
  color: string;
  width: number;
  dash: 'solid' | 'dashed' | 'dotted';
  fill: string | null;
  fillOpacity: number;
}

export const DEFAULT_STROKE: StrokeStyle = {
  color: '#4ea3ff',
  width: 3,
  dash: 'solid',
  fill: null,
  fillOpacity: 0.15,
};

/** Freehand, line, arrow, double arrow, curved arrow, polygon, ruler, area. */
export interface PathObject extends BaseObject {
  type: 'freehand' | 'line' | 'arrow' | 'doubleArrow' | 'curvedArrow' | 'polygon' | 'ruler' | 'area';
  /** Points relative to (x, y), in metres. */
  points: Vec2[];
  stroke: StrokeStyle;
  closed?: boolean;
  arrowSize?: number;
  /** Curved arrow bow, as a fraction of the chord length. */
  curvature?: number;
  showMeasurement?: boolean;
}

export interface ShapeObject extends BaseObject {
  type: 'rect' | 'roundRect' | 'circle';
  /** Half-extents in metres (circle uses rx). */
  rx: number;
  ry: number;
  cornerRadius?: number;
  stroke: StrokeStyle;
}

export interface TextObject extends BaseObject {
  type: 'text' | 'number';
  text: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  color: string;
  background: string | null;
  align: 'left' | 'center' | 'right';
  /** Number objects only. */
  value?: number;
}

export interface MarkerObject extends BaseObject {
  type: 'marker';
  color: string;
  size: number;
  label: string;
  shape: 'pin' | 'cross' | 'diamond' | 'star' | 'flag';
}

export interface ShipObject extends BaseObject {
  type: 'ship';
  shipId: ID | null;
  /** Snapshot of database values, so a page still renders if the DB changes. */
  shipName: string;
  shipClass: ShipClass;
  tier: number;
  teamId: ID | null;
  /** Per-ship overrides layered on top of the page defaults. */
  display: CharacteristicFlags;
  /** Per-ship range style overrides, layered on DEFAULT_RANGE_STYLES. */
  rangeStyles?: Partial<RangeStyleMap>;
  iconScale: number;
  /**
   * Overrides the team colour for this ship's marker. Undefined follows the
   * team, which is what team membership is for; a colour here is for the one
   * ship that has to stand out from its own side.
   */
  iconColor?: string;
  label?: string;
}

export type TacticalObject = ShipObject | PathObject | ShapeObject | TextObject | MarkerObject;

/* ------------------------------------------------------------------ */
/* Pages & projects                                                    */
/* ------------------------------------------------------------------ */

/**
 * A folder in the page list. It only sorts the list: the pages themselves stay
 * one flat array, which is what the tabs, the shortcuts and export read.
 */
export interface PageFolder {
  id: ID;
  name: string;
}

export interface Page {
  id: ID;
  name: string;
  /** The folder it is sorted into, or null when it sits in the list on its own. */
  folderId: ID | null;
  mapId: ID | null;
  mapView: MapViewConfig;
  /** Selected capture point layout, or null for none. */
  capLayoutId: ID | null;
  layers: Layer[];
  objects: TacticalObject[];
  /**
   * Page-level defaults for ship characteristics. Ranges are deliberately not
   * part of this: they are decided per ship.
   */
  display: CharacteristicFlags;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: ID;
  name: string;
  description?: string;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  /**
   * In list order: a folder's pages are adjacent, and follow `pageLayout`.
   * Kept that way by `settlePages`, so the flat order never disagrees with
   * the sorted one.
   */
  pages: Page[];
  pageFolders: PageFolder[];
  /** The top of the page list: folder ids and the ids of pages in no folder, in order. */
  pageLayout: ID[];
  activePageId: ID | null;
  /**
   * The pages open as tabs above the board, in tab order. A view of `pages`,
   * not a part of it: closing a tab leaves the page where it is. Always holds
   * the active page; kept that way by `settleTabs`.
   */
  openPageIds: ID[];
  teams: Team[];
  /** Ship restrictions for this project, offered as a filter wherever ships are listed. */
  rulesets: ShipRuleset[];
  /** Grid snapping and other editor prefs stored with the project. */
  settings: ProjectSettings;
}

export interface ProjectSettings {
  snapToGrid: boolean;
  /** Snap step in metres. */
  snapStep: number;
  shipIconSize: number;
  defaultTeamId: ID | null;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  snapToGrid: false,
  snapStep: 500,
  shipIconSize: 30,
  defaultTeamId: null,
};

/** Lightweight record used by the project browser. */
export interface ProjectSummary {
  id: ID;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  /** Size of the project file on disk, in bytes. */
  sizeBytes: number;
}

/* ------------------------------------------------------------------ */
/* Application settings                                                */
/* ------------------------------------------------------------------ */

export type ThemeName = 'dark' | 'light';

export interface AppSettings {
  theme: ThemeName;
  lastProjectId: ID | null;
  recentProjectIds: ID[];
  accentColor: string;
  uiScale: number;
  autosave: boolean;
  autosaveIntervalMs: number;
  backupOnSave: boolean;
  maxBackupsPerProject: number;
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  /**
   * World of Warships install, for the replay viewer add-on. Empty until the
   * user points at it; the game can be anywhere, and no amount of guessing
   * beats asking once.
   */
  wowsGameDir: string;
  /**
   * The replay library: a folder of replays, with sub-folders as collections.
   * Empty until the user confirms one the first time they open replay mode.
   */
  replayDir: string;
  /**
   * The channel Share to Discord posts in, by id. Which account is connected
   * is not a setting: the main process keeps that, encrypted, on its own.
   */
  discordChannel: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  lastProjectId: null,
  recentProjectIds: [],
  accentColor: '#4ea3ff',
  uiScale: 1,
  autosave: true,
  autosaveIntervalMs: 4000,
  backupOnSave: true,
  maxBackupsPerProject: 15,
  leftSidebarWidth: 288,
  rightSidebarWidth: 300,
  wowsGameDir: '',
  replayDir: '',
  discordChannel: '',
};
