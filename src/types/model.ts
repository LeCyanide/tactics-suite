/**
 * Core data model for the WoWS Tactical Planner.
 *
 * Coordinate system
 * -----------------
 * All tactical geometry is stored in WORLD METRES with the origin at the
 * top-left corner of the map. A map declares its own extent (e.g. 30000 x
 * 30000 m), the background image is stretched across that extent, and every
 * object position, radius and length is expressed in metres. Ship ranges come
 * out of the ship database in kilometres and are multiplied by 1000 on render.
 *
 * This keeps range circles physically correct at any zoom level and makes the
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
  CV: 'Aircraft Carrier',
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
  /** Half-angle of the torpedo firing sector drawn on the map, in degrees. */
  torpedoArc_deg?: number;
  torpedoes?: string;

  aaRange_km?: number;
  aa?: string;

  radar_km?: number;
  radarDuration_s?: number;
  hydro_km?: number;
  hydroDuration_s?: number;
  smokeDuration_s?: number;
  smokeRadius_km?: number;
  fighter?: boolean;
  spottingAircraft?: boolean;
  consumables?: Consumable[];

  /** Id of a locally imported icon asset. Null -> procedural class glyph. */
  iconId?: ID | null;

  notes?: string;
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
  | 'consumables';

export const CHARACTERISTICS: { key: CharacteristicKey; label: string; group: 'range' | 'other' }[] = [
  { key: 'detection', label: 'Detection Range', group: 'range' },
  { key: 'radar', label: 'Radar', group: 'range' },
  { key: 'hydro', label: 'Hydro', group: 'range' },
  { key: 'mainBattery', label: 'Main Battery Range', group: 'range' },
  { key: 'secondary', label: 'Secondary Battery Range', group: 'range' },
  { key: 'torpedo', label: 'Torpedo Range', group: 'range' },
  { key: 'consumables', label: 'Other Consumables', group: 'other' },
];

/** Characteristics that render as a circle / sector on the map. */
export const RANGE_KEYS: CharacteristicKey[] = [
  'detection',
  'radar',
  'hydro',
  'mainBattery',
  'secondary',
  'torpedo',
];

/** Characteristics a page can set a default for: everything but the ranges. */
export const PAGE_CHARACTERISTIC_KEYS: CharacteristicKey[] = CHARACTERISTICS.filter(
  (c) => c.group !== 'range',
).map((c) => c.key);

export type CharacteristicFlags = Partial<Record<CharacteristicKey, boolean>>;

/**
 * Default page-level state: nothing extra. Placing a ship shows the ship and
 * its name, and not one thing more until it is asked for.
 */
export const DEFAULT_CHARACTERISTICS: CharacteristicFlags = {
  consumables: false,
};

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
  ranges: 'layer-ranges',
  annotations: 'layer-annotations',
  ships: 'layer-ships',
} as const;

/**
 * Four layers, and no more. Shapes, arrows, text and markers all live on
 * "Annotations" — they are drawn the same way and are almost always shown or
 * hidden together — while ranges keep their own layer so every circle on the
 * page can be switched off in one click.
 */
export function createDefaultLayers(): Layer[] {
  // Rendered back-to-front in array order.
  return [
    { id: LAYER_IDS.grid, name: 'Grid', visible: true, locked: true, opacity: 1, system: true },
    { id: LAYER_IDS.ranges, name: 'Ship Ranges', visible: true, locked: false, opacity: 1, system: true },
    { id: LAYER_IDS.annotations, name: 'Annotations', visible: true, locked: false, opacity: 1, system: true },
    { id: LAYER_IDS.ships, name: 'Ships', visible: true, locked: false, opacity: 1, system: true },
  ];
}

/** Layer ids removed in schema 2, mapped onto their replacement. */
export const LEGACY_LAYER_REMAP: Record<string, string> = {
  'layer-zones': LAYER_IDS.annotations,
  'layer-routes': LAYER_IDS.annotations,
  'layer-shapes': LAYER_IDS.annotations,
  'layer-text': LAYER_IDS.annotations,
  'layer-pings': LAYER_IDS.annotations,
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

/** Object types dropped in schema 2; they are stripped when a project loads. */
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
  /** Number badges only. */
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
  label?: string;
}

export type TacticalObject = ShipObject | PathObject | ShapeObject | TextObject | MarkerObject;

/* ------------------------------------------------------------------ */
/* Pages & projects                                                    */
/* ------------------------------------------------------------------ */

export interface Page {
  id: ID;
  name: string;
  mapId: ID | null;
  mapView: MapViewConfig;
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
  pages: Page[];
  activePageId: ID | null;
  teams: Team[];
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
};
