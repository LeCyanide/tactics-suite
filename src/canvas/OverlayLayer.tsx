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
import { lastIndexAt, type ReplayPaths, type ShipPath } from '@/replay/paths';
import { cssColor } from '@/replay/timeline';
import { drawShip, text } from './ReplayLayer';

/** Fallback ally green, as in `ReplayLayer`; the recording player's ship has no tint of its own. */
const ALLY_COLOR = 0x4ce8aa;
const LINE_PX = 1.6;
/** A little smaller than the replay viewer's ships, so the plan stays on top visually. */
const SHIP_PX = 22;
const NAME_PX = 9;
const CROSS_PX = 4;
/** A ship not seen at `until` is drawn at its last known spot, fainter still. */
const STALE_ALPHA = 0.45;

interface Props {
  data: ReplayPaths;
  map: GameMap | null;
  until: number;
  allies: boolean;
  enemies: boolean;
  opacity: number;
  /** Inverse camera scale, so lines and icons keep a constant on-screen size. */
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
      const shown: { path: ShipPath; last: number; color: number }[] = [];
      for (const path of data.paths) {
        if (path.ally ? !allies : !enemies) continue;
        const last = lastIndexAt(path.points, until);
        if (last >= 0) shown.push({ path, last, color: path.color ?? allyColor });
      }

      ctx.save();
      ctx.setAttr('lineCap', 'round');
      ctx.setAttr('lineJoin', 'round');

      // Trails first, then every ship on top, so no trail runs over an icon.
      ctx.setAttr('lineWidth', LINE_PX * inv);
      for (const { path, last, color } of shown) {
        ctx.setAttr('strokeStyle', cssColor(color));
        ctx.beginPath();
        for (let i = 0; i <= last; i++) {
          const p = path.points[i]!;
          const joined = i > 0 && p.t - path.points[i - 1]!.t <= maxGap;
          if (joined) ctx.lineTo(p.pos.x * k, p.pos.y * k);
          else ctx.moveTo(p.pos.x * k, p.pos.y * k);
        }
        ctx.stroke();
      }

      const cross = CROSS_PX * inv;
      const nameSize = NAME_PX * inv;
      for (const { path, last, color } of shown) {
        const end = path.points[last]!;
        const ex = end.pos.x * k;
        const ey = end.pos.y * k;
        const sunk = path.diedAt !== null && path.diedAt <= until;
        const alpha = sunk || until - end.t > maxGap ? STALE_ALPHA : 1;

        if (sunk) {
          ctx.setAttr('globalAlpha', alpha);
          ctx.setAttr('strokeStyle', cssColor(color));
          ctx.setAttr('lineWidth', LINE_PX * 1.4 * inv);
          ctx.beginPath();
          ctx.moveTo(ex - cross, ey - cross);
          ctx.lineTo(ex + cross, ey + cross);
          ctx.moveTo(ex + cross, ey - cross);
          ctx.lineTo(ex - cross, ey + cross);
          ctx.stroke();
        } else {
          drawShip(ctx, { px: ex, py: ey, yaw: end.yaw, species: path.species, color, alpha, size: SHIP_PX * inv, inv, outline: null });
        }

        if (path.shipName) {
          // Names sit a step behind the icons: readable, but quieter than the plan's own labels.
          ctx.setAttr('globalAlpha', alpha * 0.75);
          ctx.setAttr('fillStyle', '#c9d3de');
          text(ctx, path.shipName, ex, ey + SHIP_PX * inv * 0.6, nameSize, 'center', 'top');
        }
      }
      ctx.restore();
    },
    [data, until, allies, enemies, inv, k],
  );

  return <Shape listening={false} opacity={opacity} perfectDrawEnabled={false} sceneFunc={sceneFunc} />;
});
