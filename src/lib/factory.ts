import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_CHARACTERISTICS,
  DEFAULT_TEAM_SIDES,
  DEFAULT_MAP_VIEW,
  DEFAULT_PROJECT_SETTINGS,
  DEFAULT_STROKE,
  LAYER_IDS,
  SCHEMA_VERSION,
  createDefaultLayers,
  type Page,
  type PathObject,
  type Project,
  type ShapeObject,
  type Ship,
  type ShipObject,
  type Team,
  type TextObject,
  type MarkerObject,
  type Vec2,
  type ID,
} from '@/types/model';
import { clone, uid } from './util';
import { canvasTheme } from '@/state/theme';

/**
 * Every project starts with the two clan-war sides. The colours are the whole
 * point of team membership: a ship's marker is painted in its team colour, so
 * Alpha reads green and Bravo reads red at a glance. Both are editable, and
 * further teams can be added with any colour.
 */
export function createTeams(): Team[] {
  return DEFAULT_TEAM_SIDES.map((side) => ({
    id: uid('team-'),
    name: side.name,
    color: side.color,
    visible: true,
    locked: false,
  }));
}

export function createPage(name: string, mapId: ID | null = null): Page {
  const now = Date.now();
  return {
    id: uid('page-'),
    name,
    folderId: null,
    mapId,
    mapView: clone(DEFAULT_MAP_VIEW),
    capLayoutId: null,
    layers: createDefaultLayers(),
    objects: [],
    display: clone(DEFAULT_CHARACTERISTICS),
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
    pageFolders: [],
    pageLayout: pages.map((p) => p.id),
    activePageId: pages[0]?.id ?? null,
    openPageIds: pages[0] ? [pages[0].id] : [],
    teams,
    rulesets: [],
    settings: { ...clone(DEFAULT_PROJECT_SETTINGS), defaultTeamId: teams[0].id },
  };
}

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
    showMeasurement: type === 'ruler' || type === 'area',
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
    // Follows the theme, or text placed in light mode is white on white.
    color: canvasTheme().plateText,
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
    iconScale: 1,
  } as ShipObject;
}

export { DEFAULT_APP_SETTINGS };
