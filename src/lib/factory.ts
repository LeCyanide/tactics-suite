import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_CHARACTERISTICS,
  DEFAULT_MAP_VIEW,
  DEFAULT_PROJECT_SETTINGS,
  DEFAULT_RANGE_STYLES,
  DEFAULT_STROKE,
  LAYER_IDS,
  SCHEMA_VERSION,
  createDefaultLayers,
  type Page,
  type PathObject,
  type PingObject,
  type Project,
  type ShapeObject,
  type Ship,
  type ShipObject,
  type Team,
  type TextObject,
  type MarkerObject,
  type ZoneObject,
  type Vec2,
  type ID,
} from '@/types/model';
import { clone, uid } from './util';
import type { PingPreset, ZonePreset } from '@/data/pings';

export function createTeams(): Team[] {
  return [
    { id: uid('team-'), name: 'Team North', color: '#4ea3ff', visible: true, locked: false },
    { id: uid('team-'), name: 'Team South', color: '#ff5f56', visible: true, locked: false },
  ];
}

export function createPage(name: string, mapId: ID | null = null): Page {
  const now = Date.now();
  return {
    id: uid('page-'),
    name,
    mapId,
    mapView: clone(DEFAULT_MAP_VIEW),
    layers: createDefaultLayers(),
    objects: [],
    display: clone(DEFAULT_CHARACTERISTICS),
    rangeStyles: clone(DEFAULT_RANGE_STYLES),
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}

export function createProject(name = 'Untitled Project', pageNames?: string[]): Project {
  const now = Date.now();
  const teams = createTeams();
  const pages = (pageNames?.length ? pageNames : ['01 - Opening']).map((n) => createPage(n));
  return {
    id: uid('prj-'),
    name,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    pages,
    activePageId: pages[0]?.id ?? null,
    teams,
    presets: [],
    settings: { ...clone(DEFAULT_PROJECT_SETTINGS), defaultTeamId: teams[0].id },
  };
}

/** The worked example from the brief, offered as a one-click starting point. */
export const CLAN_WAR_TEMPLATE_PAGES = [
  '01 - Opening',
  '02 - North Push',
  '03 - South Push',
  '04 - Mid Control',
  '05 - Radar Setup',
  '06 - Enemy Counter',
  '07 - Endgame',
];

/* ------------------------------------------------------------------ */
/* Object factories                                                    */
/* ------------------------------------------------------------------ */

function base(type: string, layerId: ID, x: number, y: number) {
  return {
    id: uid('obj-'),
    type,
    layerId,
    x,
    y,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
  };
}

export function createPath(
  type: PathObject['type'],
  layerId: ID,
  origin: Vec2,
  points: Vec2[],
  stroke = DEFAULT_STROKE,
): PathObject {
  return {
    ...base(type, layerId, origin.x, origin.y),
    type,
    points,
    stroke: clone(stroke),
    arrowSize: 14,
    curvature: type === 'curvedArrow' ? 0.25 : 0,
    closed: type === 'polygon' || type === 'area',
    showMeasurement: type === 'ruler' || type === 'bearing' || type === 'area',
  } as PathObject;
}

export function createShape(
  type: ShapeObject['type'],
  layerId: ID,
  origin: Vec2,
  rx: number,
  ry: number,
  stroke = DEFAULT_STROKE,
): ShapeObject {
  return {
    ...base(type, layerId, origin.x, origin.y),
    type,
    rx,
    ry,
    cornerRadius: type === 'roundRect' ? Math.min(rx, ry) * 0.25 : 0,
    startAngle: type === 'arc' ? -60 : undefined,
    sweepAngle: type === 'arc' ? 120 : undefined,
    stroke: clone(stroke),
  } as ShapeObject;
}

export function createText(layerId: ID, origin: Vec2, text = 'Text', fontSize = 340): TextObject {
  return {
    ...base('text', layerId, origin.x, origin.y),
    type: 'text',
    text,
    fontSize,
    fontFamily: 'Inter',
    bold: false,
    italic: false,
    color: '#e6edf3',
    background: null,
    align: 'left',
  } as TextObject;
}

export function createNumber(layerId: ID, origin: Vec2, value: number): TextObject {
  return {
    ...base('number', layerId, origin.x, origin.y),
    type: 'number',
    text: String(value),
    value,
    fontSize: 320,
    fontFamily: 'Inter',
    bold: true,
    italic: false,
    color: '#0d1117',
    background: '#f4c95d',
    align: 'center',
  } as TextObject;
}

export function createMarker(layerId: ID, origin: Vec2, color = '#f4c95d'): MarkerObject {
  return {
    ...base('marker', layerId, origin.x, origin.y),
    type: 'marker',
    color,
    size: 26,
    label: '',
    shape: 'pin',
  } as MarkerObject;
}

export function createPing(preset: PingPreset, layerId: ID, origin: Vec2, size = 30): PingObject {
  return {
    ...base('ping', layerId, origin.x, origin.y),
    type: 'ping',
    presetId: preset.id,
    icon: preset.icon,
    label: preset.label,
    color: preset.color,
    size,
    showLabel: true,
    directional: preset.directional,
  } as PingObject;
}

export function createZone(preset: ZonePreset, layerId: ID, origin: Vec2, radiusM?: number): ZoneObject {
  const km = preset.km ?? 5;
  return {
    ...base('zone', layerId, origin.x, origin.y),
    type: 'zone',
    zoneShape: preset.shape,
    label: preset.label,
    color: preset.color,
    radius: preset.shape === 'circle' || preset.shape === 'cone' ? (radiusM ?? km * 1000) : undefined,
    coneAngle: preset.coneAngle ?? 35,
    rx: preset.shape === 'rect' ? 3000 : undefined,
    ry: preset.shape === 'rect' ? 2000 : undefined,
    points: preset.shape === 'polygon' ? [] : undefined,
    lineWidth: 2,
    fill: preset.fill,
    fillOpacity: 0.12,
    dashed: false,
    showLabel: true,
    valueKm: preset.shape === 'circle' || preset.shape === 'cone' ? km : undefined,
  } as ZoneObject;
}

export function createShipObject(ship: Ship, origin: Vec2, teamId: ID | null, layerId = LAYER_IDS.ships): ShipObject {
  return {
    ...base('ship', layerId, origin.x, origin.y),
    type: 'ship',
    shipId: ship.id,
    shipName: ship.name,
    shipClass: ship.class,
    tier: ship.tier,
    teamId,
    // Empty on purpose: a freshly placed ship inherits the page defaults and
    // shows nothing beyond its icon and name until the planner asks for more.
    display: {},
    route: [],
    routeVisible: true,
    routeFollows: true,
    iconScale: 1,
  } as ShipObject;
}

export function createWaypoint(x: number, y: number, speed?: number) {
  return { id: uid('wp-'), x, y, speed_kn: speed };
}

export { DEFAULT_APP_SETTINGS };
