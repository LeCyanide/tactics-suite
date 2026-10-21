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
import { distinctStyles } from '@/replay/colors';

/** Fallback ally green, as in `ReplayLayer`; the recording player's ship has no tint of its own. */
const ALLY_COLOR = 0x4ce8aa;
const LINE_PX = 1.6;
/** A little smaller than the replay viewer's ships, so the plan stays on top visually. */
const SHIP_PX = 22;
const NAME_PX = 9;
const SUNK_FILL = 0x000000;
const SUNK_OUTLINE = '#9aa6b2';
/** A ship sunk or unseen at `until` is drawn fainter, at its last known spot. */
const STALE_ALPHA = 0.6;

interface Props {
  data: ReplayPaths;
  map: GameMap | null;
  until: number;
  allies: boolean;
  enemies: boolean;
  /** Give each ship its own colour instead of its team's. */
  unique: boolean;
  /** Entity id of the one ship to show, or null for all. */
  only: number | null;
  opacity: number;
  /** Inverse camera scale, so lines and icons keep a constant on-screen size. */
  inv: number;
}

export const OverlayLayer = memo(function OverlayLayer({ data, map, until, allies, enemies, unique, only, opacity, inv }: Props) {
  const k = useMemo(() => {
    const w = map?.widthMeters || data.spaceSize * 30;
    return w / data.minimapSize;
  }, [map?.widthMeters, data]);

  const styles = useMemo(() => (unique ? distinctStyles(data.paths, data.minimapSize) : null), [data, unique]);

  const sceneFunc = useMemo(
    () => (ctx: Konva.Context) => {
      const allyColor = data.paths.find((p) => p.ally && p.color !== null)?.color ?? ALLY_COLOR;
      // A gap longer than this means the ship went unseen; the line breaks there.
      const maxGap = data.stepSeconds * 1.5;
      const shown: { path: ShipPath; last: number; color: number; dashed: boolean }[] = [];
      data.paths.forEach((path, i) => {
        if (only !== null ? path.entityId !== only : path.ally ? !allies : !enemies) return;
        const last = lastIndexAt(path.points, until);
        if (last < 0) return;
        const style = styles?.[i];
        shown.push({ path, last, color: style?.color ?? path.color ?? allyColor, dashed: style?.dashed ?? false });
      });

      ctx.save();
      ctx.setAttr('lineCap', 'round');
      ctx.setAttr('lineJoin', 'round');

      // Trails first, then every ship on top, so no trail runs over an icon.
      ctx.setAttr('lineWidth', LINE_PX * inv);
      for (const { path, last, color, dashed } of shown) {
        ctx.setAttr('strokeStyle', cssColor(color));
        ctx.setLineDash(dashed ? [6 * inv, 4 * inv] : []);
        ctx.beginPath();
        for (let i = 0; i <= last; i++) {
          const p = path.points[i]!;
          const joined = i > 0 && p.t - path.points[i - 1]!.t <= maxGap;
          if (joined) ctx.lineTo(p.pos.x * k, p.pos.y * k);
          else ctx.moveTo(p.pos.x * k, p.pos.y * k);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);

      const nameSize = NAME_PX * inv;
      for (const { path, last, color } of shown) {
        const end = path.points[last]!;
        const ex = end.pos.x * k;
        const ey = end.pos.y * k;
        const sunk = path.diedAt !== null && path.diedAt <= until;
        const alpha = sunk || until - end.t > maxGap ? STALE_ALPHA : 1;

        // Every trail ends in its ship's icon, so each line can be told apart. Sunk
        // ships go black, as the game's minimap shows them, with a light edge so
        // they still read on dark water.
        drawShip(ctx, {
          px: ex,
          py: ey,
          yaw: end.yaw,
          species: path.species,
          color: sunk ? SUNK_FILL : color,
          alpha,
          size: SHIP_PX * inv,
          inv,
          outline: sunk ? SUNK_OUTLINE : null,
        });

        if (path.shipName) {
          // Names sit a step behind the icons: readable, but quieter than the plan's own labels.
          ctx.setAttr('globalAlpha', alpha * 0.75);
          ctx.setAttr('fillStyle', styles ? cssColor(color) : '#c9d3de');
          text(ctx, path.shipName, ex, ey + SHIP_PX * inv * 0.6, nameSize, 'center', 'top');
        }
      }
      ctx.restore();
    },
    [data, until, allies, enemies, only, styles, inv, k],
  );

  return <Shape listening={false} opacity={opacity} perfectDrawEnabled={false} sceneFunc={sceneFunc} />;
});

