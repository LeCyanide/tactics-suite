/**
 * Tactics extractor: turns one moment of a replay into a plan page.
 *
 * Every ship goes on the page where it is at that moment — sunk ships too, in
 * black — and its route over the chosen window becomes an ordinary arrow. Sunk
 * and unspotted ships carry a note under their name saying so.
 */

import { createPage, createPath, createShipObject } from '@/lib/factory';
import { matchShip } from '@/lib/shipMatch';
import { pathLength, simplifyPath } from '@/lib/util';
import { classForSpecies, yawToDegrees } from '@/canvas/replayGlyphs';
import {
  DEFAULT_STROKE,
  LAYER_IDS,
  type CapLayout,
  type GameMap,
  type Page,
  type Ship,
  type ShipObject,
  type Team,
  type Vec2,
} from '@/types/model';
import { extractPaths, lastIndexAt, type PathPoint } from './paths';
import type { ReplayTimeline } from './timeline';

export interface ExtractInput {
  timeline: ReplayTimeline;
  frame: number;
  /** How far back each ship's arrow reaches, in seconds; null for the whole battle. */
  windowSeconds: number | null;
  /** The map the replay was played on, if it is in the library. */
  map: GameMap | null;
  ships: Ship[];
  /** The project's teams: the first takes the recording player's side, the second the enemy. */
  teams: Team[];
  capLayouts: CapLayout[];
  replayName: string;
}

export interface ExtractResult {
  page: Page;
  /** Replay ship names with no ship database entry; placed by class only. */
  unmatched: string[];
}

/** Routes shorter than this are a ship holding position, not a move. */
const MIN_ARROW_M = 400;
/** Arrows keep the route's shape, not every wobble of the helm. */
const SIMPLIFY_M = 150;
const SUNK_COLOR = '#000000';
const UNSPOTTED_OPACITY = 0.6;

export function extractPage(input: ExtractInput): ExtractResult {
  const { timeline, map } = input;
  const data = extractPaths(timeline);
  const until = timeline.clockAt(input.frame);
  const maxGap = data.stepSeconds * 1.5;
  const k = (map?.widthMeters || data.spaceSize * 30) / data.minimapSize;
  const toWorld = (p: PathPoint): Vec2 => ({ x: p.pos.x * k, y: p.pos.y * k });

  const player = timeline.header.player?.name;
  const self = data.paths.find((p) => p.playerName === player) ?? null;
  const mapName = map?.name ?? timeline.header.map?.displayName ?? 'Replay';
  const page = createPage(self?.shipName ? `${mapName} – ${self.shipName}` : mapName, map?.id ?? null);
  const scenario = timeline.header.mode?.scenario;
  page.capLayoutId =
    input.capLayouts.find((c) => c.spaceName === data.spaceName && (!scenario || c.scenario === scenario))?.id ?? null;

  const [allyTeam, enemyTeam] = input.teams;
  const unmatched = new Set<string>();

  for (const path of data.paths) {
    const last = lastIndexAt(path.points, until);
    if (last < 0) continue; // not seen yet at this moment
    const end = path.points[last]!;
    const name = path.shipName ?? 'Unknown ship';
    const shipClass = classForSpecies(path.species);
    const team = path.ally ? allyTeam : enemyTeam;
    const sunk = path.diedAt !== null && path.diedAt <= until;
    const unspotted = !sunk && until - end.t > maxGap;

    const db = matchShip(name, input.ships, shipClass);
    if (!db) unmatched.add(name);
    const obj: ShipObject = db
      ? createShipObject(db, toWorld(end), team?.id ?? null)
      : {
          ...createShipObject({ id: '', name, nation: '', class: shipClass, tier: 0 }, toWorld(end), team?.id ?? null),
          shipId: null,
        };
    obj.rotation = yawToDegrees(end.yaw);
    if (sunk) {
      obj.iconColor = SUNK_COLOR;
      obj.label = `${name}\nsunk ${clock(path.diedAt!)}`;
    } else if (unspotted) {
      obj.opacity = UNSPOTTED_OPACITY;
      obj.label = `${name}\nlast seen ${clock(end.t)}`;
    }

    const route = recentRoute(path.points, last, until, input.windowSeconds, maxGap).map(toWorld);
    const simplified = simplifyPath(route, SIMPLIFY_M);
    if (simplified.length >= 2 && pathLength(simplified) >= MIN_ARROW_M) {
      const origin = simplified[0]!;
      const arrow = createPath(
        'arrow',
        LAYER_IDS.annotations,
        origin,
        simplified.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y })),
        { ...DEFAULT_STROKE, color: team?.color ?? DEFAULT_STROKE.color },
      );
      arrow.name = `${name} route`;
      page.objects.push(arrow);
    }
    page.objects.push(obj);
  }

  const lines = [`Extracted from ${input.replayName} at ${clock(until)}.`];
  if (unmatched.size) lines.push('', `Not in the ship database: ${[...unmatched].sort().join(', ')}.`);
  page.notes = lines.join('\n');

  return { page, unmatched: [...unmatched] };
}

/**
 * The ship's route up to its position at `until`: back through the window,
 * stopping at the first gap so an unspotted stretch is not drawn as a
 * straight line it never sailed.
 */
function recentRoute(
  points: PathPoint[],
  last: number,
  until: number,
  windowSeconds: number | null,
  maxGap: number,
): PathPoint[] {
  const from = windowSeconds === null ? -Infinity : until - windowSeconds;
  let first = last;
  while (first > 0 && points[first - 1]!.t >= from && points[first]!.t - points[first - 1]!.t <= maxGap) first--;
  return points.slice(first, last + 1);
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
