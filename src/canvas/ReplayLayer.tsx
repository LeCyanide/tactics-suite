/**
 * Replay playback over the tactical map.
 *
 * One frame is 80-280 draw records, and playback redraws it up to sixty times
 * a second. That rules out a Konva node per record: the reconciler would be
 * doing thousands of diffs a second for nodes that are all replaced on the next
 * tick anyway. Instead the whole frame is painted by a single `Shape` scene
 * function straight onto the canvas, which is one Konva node and one pass.
 *
 * The layer is inert (`listening={false}`) and sits above the map and its
 * capture zones but below every tactical object, so the drawing tools keep
 * working over a running replay — an arrow drawn on a push stays on top of it,
 * and stays in map metres.
 */

import { memo, useMemo } from 'react';
import type Konva from 'konva';
import { Shape } from 'react-konva';
import type { GameMap } from '@/types/model';
import {
  cssColor,
  type Px,
  type Record_,
  type ReplayTimeline,
  Visibility,
} from '@/replay/timeline';
import { GLYPH_BOX, REPLAY_GLYPHS, classForSpecies, yawToDegrees } from './replayGlyphs';

/** What the viewer draws. Each maps to a toggle in the replay sidebar. */
export interface ReplayViewOptions {
  playerNames: boolean;
  shipNames: boolean;
  healthBars: boolean;
  tracers: boolean;
  torpedoes: boolean;
  smoke: boolean;
  capturePoints: boolean;
  planes: boolean;
  buildings: boolean;
  cameraDirection: boolean;
  trails: boolean;
  /** Detection and range circles, when the bake included them. */
  rangeCircles: boolean;
}

export const DEFAULT_REPLAY_VIEW: ReplayViewOptions = {
  // Off by default for the same reason the renderer hides them: 24 names over
  // a 42 km map is unreadable, and the roster in the sidebar says who is who.
  playerNames: false,
  shipNames: true,
  healthBars: true,
  tracers: true,
  torpedoes: true,
  smoke: true,
  capturePoints: true,
  planes: true,
  buildings: true,
  cameraDirection: false,
  trails: true,
  rangeCircles: true,
};

interface Props {
  timeline: ReplayTimeline;
  /** Frame to paint. Clamped by the caller; out of range throws. */
  frame: number;
  map: GameMap | null;
  options: ReplayViewOptions;
  /** Inverse camera scale, for anything that should stay a constant size. */
  inv: number;
  opacity: number;
}

/** Screen-constant sizes, in pixels before the inverse-scale conversion. */
const SHIP_PX = 26;
const NAME_PX = 9.5;
const TRACER_PX = 1.1;
const TORPEDO_PX = 2.2;
const PLANE_PX = 5;
const HEALTH_W_PX = 22;
const HEALTH_H_PX = 2.6;

const MONO = 'JetBrains Mono, Consolas, monospace';

/**
 * Outlines that mark a ship out without shouting.
 *
 * These sit on top of a glyph only a couple of dozen pixels across, so a bright
 * stroke at full width swamps the silhouette underneath and the ship reads as a
 * blob of colour rather than as a ship. Both are muted, and drawn barely wider
 * than the ordinary contrast edge.
 */
const SPOTTED_OUTLINE = '#b39a5e';
/** Edge width for a marked ship, against 0.9 for every other one. */
const MARKED_OUTLINE_WIDTH = 1.15;

/**
 * Ally green, mirroring `TEAM0_COLOR` in the renderer's `renderer.rs`.
 *
 * Only a fallback: the colour is normally taken from an ally in the frame
 * being drawn, so it cannot drift if the renderer ever changes its palette.
 */
const ALLY_COLOR = 0x4ce8aa;

/** Fill for a ship the renderer gave no tint: a last-known-position ghost. */
const NEUTRAL_FILL = '#5f6d7c';

export const ReplayLayer = memo(function ReplayLayer({
  timeline,
  frame,
  map,
  options,
  inv,
  opacity,
}: Props) {
  const records = useMemo(() => {
    try {
      return timeline.frame(frame);
    } catch (err) {
      // Drawing nothing for one tick beats losing the whole canvas, but the
      // reason must not vanish: a decode failure here means the timeline is
      // damaged and every later frame will fail the same way.
      console.error('[ReplayLayer] could not decode frame', frame, err);
      return [];
    }
  }, [timeline, frame]);

  /**
   * Minimap pixels to map metres.
   *
   * Both cover the same ground: the planner's map image is the game's own
   * minimap, and `widthMeters` is derived from the same `spaceSize` the
   * renderer scaled its positions by. So this is a plain ratio with no offset
   * and no flip — minimap pixels and planner metres both run from the top-left
   * corner. When the map record has no extent, the timeline's own `spaceSize`
   * gives it: the game states map size in BigWorld units of 30 m.
   */
  const { kx, ky } = useMemo(() => {
    const fallback = timeline.spaceSize * 30;
    const w = map?.widthMeters || fallback;
    const h = map?.heightMeters || fallback;
    return { kx: w / timeline.minimapSize, ky: h / timeline.minimapSize };
  }, [map?.widthMeters, map?.heightMeters, timeline.spaceSize, timeline.minimapSize]);

  const sceneFunc = useMemo(
    () => (ctx: Konva.Context) => paintFrame(ctx, { records, kx, ky, inv, options }),
    [records, kx, ky, inv, options],
  );

  return <Shape listening={false} opacity={opacity} perfectDrawEnabled={false} sceneFunc={sceneFunc} />;
});

interface PaintArgs {
  records: Record_[];
  kx: number;
  ky: number;
  inv: number;
  options: ReplayViewOptions;
}

/**
 * Paints one frame.
 *
 * Records are drawn in the order the renderer emitted them, which is its own
 * painter order — tracers under ships, ships under their labels. Re-sorting
 * here would mean re-deriving a z-order that already exists and is correct.
 */
function paintFrame(ctx: Konva.Context, args: PaintArgs): void {
  const { records, kx, ky, inv, options } = args;
  const x = (p: Px) => p.x * kx;
  const y = (p: Px) => p.y * ky;
  /** Radii arrive in minimap pixels; the map is square, so one axis is enough. */
  const r = (px: number) => px * kx;

  const shipSize = SHIP_PX * inv;
  const nameSize = NAME_PX * inv;

  /**
   * The colour to paint the player's own ship.
   *
   * The renderer tints self pure white, which on a dark sea makes it the
   * loudest mark on the map — louder than the ships shooting at it. It belongs
   * to a team like everything else, so it is painted in that team's colour.
   *
   * Taken from a detected teammate rather than hardcoded, because the renderer
   * owns the palette; the constant is only used when no ally is on screen.
   */
  let selfColor = ALLY_COLOR;
  for (const rec of records) {
    if (rec.kind === 'ship' && rec.isDetectedTeammate && !rec.isSelf && rec.color !== null) {
      selfColor = rec.color;
      break;
    }
  }

  ctx.save();
  ctx.setAttr('lineCap', 'round');
  ctx.setAttr('lineJoin', 'round');

  for (const rec of records) {
    switch (rec.kind) {
      case 'weatherZone': {
        ctx.setAttr('globalAlpha', 0.12);
        ctx.setAttr('fillStyle', '#ffffff');
        circle(ctx, x(rec.pos), y(rec.pos), r(rec.radius));
        ctx.fill();
        break;
      }
      case 'buffZone': {
        ctx.setAttr('globalAlpha', rec.alpha);
        ctx.setAttr('fillStyle', cssColor(rec.color));
        circle(ctx, x(rec.pos), y(rec.pos), r(rec.radius));
        ctx.fill();
        break;
      }
      case 'capturePoint': {
        if (!options.capturePoints) break;
        const cx = x(rec.pos);
        const cy = y(rec.pos);
        const radius = r(rec.radius);
        // Fill and ring are painted separately for the same reason CapZones
        // splits them: one translucent wash plus one solid edge reads far
        // better than a uniformly washed-out circle.
        ctx.setAttr('globalAlpha', rec.alpha * 0.28);
        ctx.setAttr('fillStyle', cssColor(rec.color));
        circle(ctx, cx, cy, radius);
        ctx.fill();

        ctx.setAttr('globalAlpha', 1);
        ctx.setAttr('strokeStyle', cssColor(rec.color));
        ctx.setAttr('lineWidth', 1.4 * inv);
        circle(ctx, cx, cy, radius);
        ctx.stroke();

        // Capture progress as an arc from the top, so a cap being taken is
        // legible without reading a number.
        if (rec.progress > 0.001 && rec.invaderColor !== null) {
          ctx.setAttr('strokeStyle', cssColor(rec.invaderColor));
          ctx.setAttr('lineWidth', 3 * inv);
          ctx.beginPath();
          ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + rec.progress * Math.PI * 2, false);
          ctx.stroke();
        }
        if (rec.label) {
          ctx.setAttr('fillStyle', cssColor(rec.color));
          text(ctx, rec.label, cx, cy, nameSize * 1.6, 'center', 'middle');
        }
        break;
      }
      case 'building': {
        if (!options.buildings) break;
        ctx.setAttr('globalAlpha', rec.isAlive ? 0.9 : 0.35);
        ctx.setAttr('fillStyle', cssColor(rec.color));
        const s = 5 * inv;
        ctx.beginPath();
        ctx.rect(x(rec.pos) - s / 2, y(rec.pos) - s / 2, s, s);
        ctx.fill();
        break;
      }
      case 'positionTrail': {
        if (!options.trails || rec.points.length < 2) break;
        ctx.setAttr('globalAlpha', 0.5);
        ctx.setAttr('lineWidth', 1.2 * inv);
        // Each segment carries its own colour, so this cannot be one stroked
        // polyline.
        for (let i = 1; i < rec.points.length; i++) {
          const a = rec.points[i - 1]!;
          const b = rec.points[i]!;
          ctx.setAttr('strokeStyle', cssColor(b.color));
          ctx.beginPath();
          ctx.moveTo(x(a.pos), y(a.pos));
          ctx.lineTo(x(b.pos), y(b.pos));
          ctx.stroke();
        }
        break;
      }
      case 'smoke': {
        if (!options.smoke) break;
        ctx.setAttr('globalAlpha', rec.alpha);
        ctx.setAttr('fillStyle', cssColor(rec.color));
        circle(ctx, x(rec.pos), y(rec.pos), r(rec.radius));
        ctx.fill();
        break;
      }
      case 'consumableRadius':
      case 'patrolRadius': {
        if (!options.rangeCircles) break;
        ctx.setAttr('globalAlpha', rec.alpha);
        ctx.setAttr('strokeStyle', cssColor(rec.color));
        ctx.setAttr('lineWidth', 1 * inv);
        circle(ctx, x(rec.pos), y(rec.pos), r(rec.radius));
        ctx.stroke();
        break;
      }
      case 'shipConfigCircle': {
        if (!options.rangeCircles) break;
        ctx.setAttr('globalAlpha', rec.alpha);
        ctx.setAttr('strokeStyle', cssColor(rec.color));
        ctx.setAttr('lineWidth', (rec.isSelf ? 1.6 : 1) * inv);
        ctx.setLineDash(rec.dashed ? [6 * inv, 5 * inv] : []);
        circle(ctx, x(rec.pos), y(rec.pos), r(rec.radius));
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case 'tracer': {
        if (!options.tracers) break;
        // Secondaries are dimmed rather than hidden: a battleship in a
        // secondary brawl would otherwise look idle.
        ctx.setAttr('globalAlpha', rec.secondary ? 0.35 : 0.85);
        ctx.setAttr('strokeStyle', cssColor(rec.color));
        ctx.setAttr('lineWidth', (rec.secondary ? TRACER_PX * 0.7 : TRACER_PX) * inv);
        ctx.beginPath();
        ctx.moveTo(x(rec.from), y(rec.from));
        ctx.lineTo(x(rec.to), y(rec.to));
        ctx.stroke();
        break;
      }
      case 'tracerTip': {
        if (!options.tracers) break;
        ctx.setAttr('globalAlpha', rec.secondary ? 0.5 : 1);
        ctx.setAttr('fillStyle', cssColor(rec.color));
        circle(ctx, x(rec.at), y(rec.at), (rec.secondary ? 1 : 1.5) * inv);
        ctx.fill();
        break;
      }
      case 'torpedo': {
        if (!options.torpedoes) break;
        ctx.setAttr('globalAlpha', 1);
        ctx.setAttr('fillStyle', cssColor(rec.color));
        circle(ctx, x(rec.pos), y(rec.pos), (TORPEDO_PX / 2) * inv);
        ctx.fill();
        break;
      }
      case 'plane': {
        if (!options.planes) break;
        ctx.setAttr('globalAlpha', 0.9);
        ctx.setAttr('fillStyle', '#ffd479');
        // A small diamond: distinct from a torpedo dot at a glance, and it
        // needs no icon from the game's packed data.
        const s = (PLANE_PX / 2) * inv;
        const px = x(rec.pos);
        const py = y(rec.pos);
        ctx.beginPath();
        ctx.moveTo(px, py - s);
        ctx.lineTo(px + s, py);
        ctx.lineTo(px, py + s);
        ctx.lineTo(px - s, py);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'cameraDirection': {
        if (!options.cameraDirection) break;
        ctx.setAttr('globalAlpha', 0.7);
        ctx.setAttr('strokeStyle', cssColor(rec.color));
        ctx.setAttr('lineWidth', 1 * inv);
        const cx = x(rec.pos);
        const cy = y(rec.pos);
        const angle = (yawToDegrees(rec.yaw) * Math.PI) / 180 - Math.PI / 2;
        const len = r(rec.length);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
        ctx.stroke();
        break;
      }
      case 'healthBar': {
        if (!options.healthBars) break;
        const w = HEALTH_W_PX * inv;
        const h = HEALTH_H_PX * inv;
        const bx = x(rec.pos) - w / 2;
        const by = y(rec.pos) - shipSize * 0.75;
        ctx.setAttr('globalAlpha', rec.backgroundAlpha);
        ctx.setAttr('fillStyle', cssColor(rec.background));
        ctx.beginPath();
        ctx.rect(bx, by, w, h);
        ctx.fill();
        ctx.setAttr('globalAlpha', 1);
        ctx.setAttr('fillStyle', cssColor(rec.fill));
        ctx.beginPath();
        ctx.rect(bx, by, w * rec.fraction, h);
        ctx.fill();
        break;
      }
      case 'deadShip': {
        // Wrecks stay on the map, faded, because where a ship died is most of
        // what a post-battle read is about.
        drawShip(ctx, {
          px: x(rec.pos),
          py: y(rec.pos),
          yaw: rec.yaw,
          species: rec.species,
          color: rec.isSelf ? selfColor : rec.color,
          alpha: 0.32,
          size: shipSize * 0.85,
          inv,
        });
        break;
      }
      case 'ship': {
        // Undetected ships are the renderer's last-known-position ghosts; it
        // has already decided how faint they should be.
        const alpha = rec.visibility === Visibility.Undetected ? rec.opacity * 0.55 : rec.opacity;
        drawShip(ctx, {
          px: x(rec.pos),
          py: y(rec.pos),
          yaw: rec.yaw,
          species: rec.species,
          color: rec.isSelf ? selfColor : rec.color,
          alpha,
          // Your own ship now looks like any other ally, so a slight size bump
          // is what is left to find it by.
          size: shipSize * (rec.isSelf ? 1.08 : 1),
          inv,
          // Self is flagged as a detected teammate too, but a rim saying "an
          // ally can see this" is noise on the ship you are looking out of.
          outline: !rec.isSelf && rec.isDetectedTeammate ? SPOTTED_OUTLINE : null,
        });

        const label = [
          options.playerNames ? rec.playerName : null,
          options.shipNames ? rec.shipName : null,
        ].filter(Boolean) as string[];
        if (label.length) {
          ctx.setAttr('globalAlpha', Math.min(1, alpha + 0.25));
          ctx.setAttr('fillStyle', rec.nameColor !== null ? cssColor(rec.nameColor) : '#e8eef6');
          let ty = y(rec.pos) + shipSize * 0.72;
          for (const line of label) {
            text(ctx, line, x(rec.pos), ty, nameSize, 'center', 'top');
            ty += nameSize * 1.15;
          }
        }
        break;
      }
    }
  }

  ctx.setAttr('globalAlpha', 1);
  ctx.restore();
}

function circle(ctx: Konva.Context, cx: number, cy: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(radius, 0), 0, Math.PI * 2, false);
}

function text(
  ctx: Konva.Context,
  value: string,
  cx: number,
  cy: number,
  size: number,
  align: CanvasTextAlign,
  baseline: CanvasTextBaseline,
): void {
  ctx.setAttr('font', `${size}px ${MONO}`);
  ctx.setAttr('textAlign', align);
  ctx.setAttr('textBaseline', baseline);
  ctx.fillText(value, cx, cy);
}

interface ShipArgs {
  px: number;
  py: number;
  yaw: number;
  species?: string;
  color: number | null;
  alpha: number;
  size: number;
  inv: number;
  outline?: string | null;
}

/**
 * One ship mark: the class glyph, rotated to its heading.
 *
 * `color` is null when the renderer wants the icon's own colours, which we do
 * not have — the planner's neutral grey stands in, which is the same fallback
 * a ship with no team gets on a tactics page.
 */
function drawShip(ctx: Konva.Context, a: ShipArgs): void {
  const glyph = REPLAY_GLYPHS[classForSpecies(a.species)];
  const size = a.size * glyph.scale;

  ctx.save();
  ctx.setAttr('globalAlpha', a.alpha);
  ctx.translate(a.px, a.py);
  ctx.rotate((yawToDegrees(a.yaw) * Math.PI) / 180);
  const s = size / GLYPH_BOX;
  ctx.scale(s, s);
  ctx.translate(-GLYPH_BOX / 2, -GLYPH_BOX / 2);

  ctx.beginPath();
  for (const poly of glyph.polygons) {
    ctx.moveTo(poly[0]!, poly[1]!);
    for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i]!, poly[i + 1]!);
    ctx.closePath();
  }
  // A null colour means the renderer sent no tint, which is what a last-known
  // ghost gets. Self is handled by the caller, which substitutes its team
  // colour for the white the renderer sends.
  ctx.setAttr('fillStyle', a.color !== null ? cssColor(a.color) : NEUTRAL_FILL);
  ctx.fill();

  // The contrast edge is what keeps a mark readable over bright land; it is
  // drawn inside the glyph transform, so its width is scaled with everything
  // else rather than set in metres.
  ctx.setAttr('lineWidth', a.outline ? MARKED_OUTLINE_WIDTH : 0.9);
  ctx.setAttr('strokeStyle', a.outline ?? '#080c11');
  ctx.stroke();
  ctx.restore();
}
