/**
 * Whole-battle ship paths, for drawing a replay behind a plan page.
 *
 * The sidecar bakes with its own trails switched off, so the paths are rebuilt
 * here from the ship records: one frame per `stepSeconds`, which for a
 * 20-minute battle is ~1,200 small frame decodes, done once per load.
 */

import { Visibility, type Px, type ReplayTimeline, type Rgb } from './timeline';

export interface PathPoint {
  /** Battle clock, seconds. */
  t: number;
  pos: Px;
  /** Heading, radians, as the ship record gives it. */
  yaw: number;
}

export interface ShipPath {
  entityId: number;
  ally: boolean;
  /** The renderer's tint for this ship; null when it never gave one. */
  color: Rgb | null;
  shipName?: string;
  playerName?: string;
  /** Ship class as the renderer names it, for the glyph. */
  species?: string;
  /** Only positions where the ship was actually seen; gaps mean undetected. */
  points: PathPoint[];
  /** Battle clock of the first frame it shows as sunk, or null. */
  diedAt: number | null;
}

export interface ReplayPaths {
  paths: ShipPath[];
  /** Battle clock of the last baked frame. */
  duration: number;
  stepSeconds: number;
  /** `spaces/...`, matched against `GameMap.spaceName`. */
  spaceName: string | null;
  /** Point positions are minimap pixels, `0..minimapSize`. */
  minimapSize: number;
  /** Map extent in BigWorld units (30 m), for when the map record has none. */
  spaceSize: number;
}

export function extractPaths(timeline: ReplayTimeline, stepSeconds = 1): ReplayPaths {
  const relationByPlayer = new Map((timeline.header.vehicles ?? []).map((v) => [v.name, v.relation]));
  const byId = new Map<number, ShipPath>();
  const step = Math.max(1, Math.round(stepSeconds * timeline.fps));

  const pathFor = (entityId: number): ShipPath => {
    let p = byId.get(entityId);
    if (!p) {
      p = { entityId, ally: false, color: null, points: [], diedAt: null };
      byId.set(entityId, p);
    }
    return p;
  };

  for (let i = 0; i < timeline.frameCount; i += step) {
    const t = timeline.clockAt(i);
    for (const rec of timeline.frame(i)) {
      if (rec.kind === 'ship') {
        const p = pathFor(rec.entityId);
        p.shipName ??= rec.shipName;
        p.playerName ??= rec.playerName;
        p.species ??= rec.species;
        const relation = rec.playerName ? relationByPlayer.get(rec.playerName) : undefined;
        // shortcut: without a roster relation, only self and spotted-teammate flags mark an ally; a nameless bake may class a hidden ally as enemy.
        if (rec.isSelf || rec.isDetectedTeammate || relation === 0 || relation === 1) p.ally = true;
        if (!rec.isSelf && rec.color !== null) p.color ??= rec.color;
        // Undetected records are last-known ghosts, not where the ship was.
        if (rec.visibility !== Visibility.Undetected) p.points.push({ t, pos: rec.pos, yaw: rec.yaw });
      } else if (rec.kind === 'deadShip') {
        const p = pathFor(rec.entityId);
        p.shipName ??= rec.shipName;
        p.playerName ??= rec.playerName;
        p.species ??= rec.species;
        if (p.diedAt === null) {
          p.diedAt = t;
          p.points.push({ t, pos: rec.pos, yaw: rec.yaw });
        }
      }
    }
  }

  return {
    paths: [...byId.values()].filter((p) => p.points.length > 0),
    duration: timeline.frameCount ? timeline.clockAt(timeline.frameCount - 1) : 0,
    stepSeconds: step / timeline.fps,
    spaceName: timeline.header.map?.name ?? null,
    minimapSize: timeline.minimapSize,
    spaceSize: timeline.spaceSize,
  };
}

/** Index of the last point at or before `t`, or -1. Points are in time order. */
export function lastIndexAt(points: PathPoint[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
