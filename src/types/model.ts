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

export const SCHEMA_VERSION = 1;

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

export type CharacteristicKey =
  | 'icon'
  | 'name'
  | 'class'
  | 'tier'
  | 'hp'
  | 'heading'
  | 'detection'
  | 'radar'
  | 'hydro'
  | 'smoke'
  | 'mainBattery'
  | 'secondary'
  | 'torpedo'
  | 'aa'
  | 'consumables'
  | 'route';

export const CHARACTERISTICS: { key: CharacteristicKey; label: string; group: 'label' | 'range' | 'other' }[] = [
  { key: 'icon', label: 'Ship Icon', group: 'label' },
  { key: 'name', label: 'Ship Name', group: 'label' },
  { key: 'class', label: 'Class', group: 'label' },
  { key: 'tier', label: 'Tier', group: 'label' },
  { key: 'hp', label: 'HP', group: 'label' },
  { key: 'heading', label: 'Direction Indicator', group: 'other' },
  { key: 'detection', label: 'Detection Range', group: 'range' },
  { key: 'radar', label: 'Radar', group: 'range' },
  { key: 'hydro', label: 'Hydro', group: 'range' },
  { key: 'smoke', label: 'Smoke', group: 'range' },
  { key: 'mainBattery', label: 'Main Battery Range', group: 'range' },
  { key: 'secondary', label: 'Secondary Battery Range', group: 'range' },
  { key: 'torpedo', label: 'Torpedo Range', group: 'range' },
  { key: 'aa', label: 'AA Range', group: 'range' },
  { key: 'consumables', label: 'Other Consumables', group: 'other' },
  { key: 'route', label: 'Planned Route', group: 'other' },
];

/** Characteristics that render as a circle / sector on the map. */
export const RANGE_KEYS: CharacteristicKey[] = [
  'detection',
  'radar',
  'hydro',
  'smoke',
  'mainBattery',
  'secondary',
  'torpedo',
  'aa',
];

export type CharacteristicFlags = Partial<Record<CharacteristicKey, boolean>>;

/**
 * Default page-level state. Nothing but the icon and the name is on, which is
 * the "clean map" requirement: placing a ship must not spray its statistics
 * across the canvas.
 */
export const DEFAULT_CHARACTERISTICS: CharacteristicFlags = {
  icon: true,
  name: true,
  class: false,
  tier: false,
  hp: false,
  heading: true,
  detection: false,
  radar: false,
  hydro: false,
  smoke: false,
  mainBattery: false,
  secondary: false,
  torpedo: false,
  aa: false,
  consumables: false,
  route: true,
};

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
  smoke: { color: '#b9c2cc', opacity: 0.85, lineWidth: 1.5, fill: true, fillOpacity: 0.1, dashed: false, showLabel: true },
  mainBattery: { color: '#ff8f5e', opacity: 0.85, lineWidth: 1.5, fill: false, fillOpacity: 0.05, dashed: false, showLabel: true },
  secondary: { color: '#ffb38a', opacity: 0.8, lineWidth: 1.2, fill: false, fillOpacity: 0.05, dashed: true, showLabel: true },
  torpedo: { color: '#8f7bff', opacity: 0.9, lineWidth: 1.5, fill: true, fillOpacity: 0.1, dashed: false, showLabel: true },
  aa: { color: '#ff6b8a', opacity: 0.85, lineWidth: 1.5, fill: false, fillOpacity: 0.06, dashed: true, showLabel: true },
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
  zones: 'layer-zones',
  ranges: 'layer-ranges',
  routes: 'layer-routes',
  ships: 'layer-ships',
  shapes: 'layer-shapes',
  text: 'layer-text',
  pings: 'layer-pings',
} as const;

export function createDefaultLayers(): Layer[] {
  // Rendered back-to-front in array order.
  return [
    { id: LAYER_IDS.grid, name: 'Grid', visible: true, locked: true, opacity: 1, system: true },
    { id: LAYER_IDS.zones, name: 'Tactical Zones', visible: true, locked: false, opacity: 1, system: true },
    { id: LAYER_IDS.ranges, name: 'Ship Ranges', visible: true, locked: false, opacity: 1, system: true },
    { id: LAYER_IDS.routes, name: 'Routes', visible: true, locked: false, opacity: 1, system: true },
    { id: LAYER_IDS.shapes, name: 'Shapes', visible: true, locked: false, opacity: 1, system: true },
    { id: LAYER_IDS.ships, name: 'Ships', visible: true, locked: false, opacity: 1, system: true },
    { id: LAYER_IDS.text, name: 'Text', visible: true, locked: false, opacity: 1, system: true },
    { id: LAYER_IDS.pings, name: 'Pings', visible: true, locked: false, opacity: 1, system: true },
  ];
}

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
  | 'ellipse'
  | 'polygon'
  | 'arc'
  | 'text'
  | 'number'
  | 'marker'
  | 'ruler'
  | 'bearing'
  | 'area'
  | 'ping'
  | 'zone';

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
  type: 'freehand' | 'line' | 'arrow' | 'doubleArrow' | 'curvedArrow' | 'polygon' | 'ruler' | 'bearing' | 'area';
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
  type: 'rect' | 'roundRect' | 'circle' | 'ellipse' | 'arc';
  /** Half-extents in metres (circle uses rx). */
  rx: number;
  ry: number;
  cornerRadius?: number;
  /** Arc sweep, degrees. */
  startAngle?: number;
  sweepAngle?: number;
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

export interface PingObject extends BaseObject {
  type: 'ping';
  presetId: string;
  icon: string;
  label: string;
  color: string;
  size: number;
  showLabel: boolean;
  /** Ping presets that point somewhere (attack, push, retreat) use rotation. */
  directional: boolean;
}

export type ZoneShape = 'circle' | 'rect' | 'polygon' | 'cone';

export interface ZoneObject extends BaseObject {
  type: 'zone';
  zoneShape: ZoneShape;
  label: string;
  color: string;
  /** Circle / cone radius in metres. */
  radius?: number;
  /** Cone half-angle in degrees. */
  coneAngle?: number;
  /** Rect half-extents. */
  rx?: number;
  ry?: number;
  /** Polygon vertices relative to (x, y). */
  points?: Vec2[];
  lineWidth: number;
  fill: boolean;
  fillOpacity: number;
  dashed: boolean;
  showLabel: boolean;
  /** Optional km value displayed under the label. */
  valueKm?: number;
}

export interface Waypoint {
  id: ID;
  x: number;
  y: number;
  /** Planned speed in knots at this leg. */
  speed_kn?: number;
  label?: string;
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
  /** Per-ship range style overrides. */
  rangeStyles?: Partial<RangeStyleMap>;
  route: Waypoint[];
  routeVisible: boolean;
  /** Route follows the ship when the ship is dragged. */
  routeFollows: boolean;
  iconScale: number;
  hpOverride?: number;
  label?: string;
}

export type TacticalObject =
  | ShipObject
  | PathObject
  | ShapeObject
  | TextObject
  | MarkerObject
  | PingObject
  | ZoneObject;

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
  /** Page-level defaults for ship characteristics. */
  display: CharacteristicFlags;
  rangeStyles: RangeStyleMap;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface TacticalPreset {
  id: ID;
  name: string;
  kind: 'zone' | 'ping' | 'shape' | 'path' | 'text';
  /** Partial object used as a template when the preset is stamped. */
  data: Record<string, unknown>;
  createdAt: number;
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
  presets: TacticalPreset[];
  /** Grid snapping and other editor prefs stored with the project. */
  settings: ProjectSettings;
}

export interface ProjectSettings {
  snapToGrid: boolean;
  /** Snap step in metres. */
  snapStep: number;
  shipIconSize: number;
  showMinimap: boolean;
  defaultTeamId: ID | null;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  snapToGrid: false,
  snapStep: 500,
  shipIconSize: 30,
  showMinimap: true,
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
}

/* ------------------------------------------------------------------ */
/* Application settings                                                */
/* ------------------------------------------------------------------ */

export interface AppSettings {
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
