/**
 * Draws a replay's ship paths behind the plan (see `state/overlay.ts`).
 *
 * Positions are minimap pixels, scaled to map metres exactly as `ReplayLayer`
 * does: the planner's map image is the game's minimap, so it is a plain ratio.
 */

import { memo, useMemo } from 'react';
import { Shape } from 'react-konva';
import type Konva from 'konva';
import type { GameMap } from '@/types/model';
import { lastIndexAt, type ReplayPaths } from '@/replay/paths';
import { cssColor } from '@/replay/timeline';

/** Fallback ally green, as in `ReplayLayer`; the recording player's ship has no tint of its own. */
const ALLY_COLOR = 0x4ce8aa;
const LINE_PX = 1.6;
const DOT_PX = 3.6;

interface Props {
  data: ReplayPaths;
  map: GameMap | null;
  until: number;
  allies: boolean;
  enemies: boolean;
  opacity: number;
  /** Inverse camera scale, so lines keep a constant on-screen width. */
  inv: number;
}

export const OverlayLayer = memo(function OverlayLayer({ data, map, until, allies, enemies, opacity, inv }: Props) {
  const k = useMemo(() => {
    const w = map?.widthMeters || data.spaceSize * 30;
    return w / data.minimapSize;
  }, [map?.widthMeters, data]);

  const sceneFunc = useMemo(
    () => (ctx: Konva.Context) => {
      const allyColor = data.paths.find((p) => p.ally && p.color !== null)?.color ?? ALLY_COLOR;
      // A gap longer than this means the ship went unseen; the line breaks there.
      const maxGap = data.stepSeconds * 1.5;
      const dot = DOT_PX * inv;

      ctx.save();
      ctx.setAttr('lineCap', 'round');
      ctx.setAttr('lineJoin', 'round');
      ctx.setAttr('lineWidth', LINE_PX * inv);

      for (const path of data.paths) {
        if (path.ally ? !allies : !enemies) continue;
        const last = lastIndexAt(path.points, until);
        if (last < 0) continue;
        const color = cssColor(path.color ?? allyColor);
        ctx.setAttr('strokeStyle', color);
        ctx.setAttr('fillStyle', color);

        ctx.beginPath();
        for (let i = 0; i <= last; i++) {
          const p = path.points[i]!;
          const joined = i > 0 && p.t - path.points[i - 1]!.t <= maxGap;
          if (joined) ctx.lineTo(p.pos.x * k, p.pos.y * k);
          else ctx.moveTo(p.pos.x * k, p.pos.y * k);
        }
        ctx.stroke();

        // Where the ship is at `until`: a cross if sunk, a dot if seen then,
        // a ring at its last known position if not.
        const end = path.points[last]!;
        const ex = end.pos.x * k;
        const ey = end.pos.y * k;
        ctx.beginPath();
        if (path.diedAt !== null && path.diedAt <= until) {
          ctx.moveTo(ex - dot, ey - dot);
          ctx.lineTo(ex + dot, ey + dot);
          ctx.moveTo(ex + dot, ey - dot);
          ctx.lineTo(ex - dot, ey + dot);
          ctx.stroke();
        } else if (until - end.t <= maxGap) {
          ctx.arc(ex, ey, dot, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.arc(ex, ey, dot, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    },
    [data, until, allies, enemies, inv, k],
  );

  return <Shape listening={false} opacity={opacity} perfectDrawEnabled={false} sceneFunc={sceneFunc} />;
});
