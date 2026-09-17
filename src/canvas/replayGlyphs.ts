/**
 * Ship marks for replay playback.
 *
 * The game's own minimap icons live inside the client's packed data, which the
 * planner has no business unpacking just to draw a replay. It already has
 * class glyphs traced from the same source in `shipGlyphs.ts`, so a replay ship
 * is drawn as its class — and looks like every other ship in the application
 * rather than like a foreign import.
 *
 * The glyphs are authored as SVG path data, but the replay layer paints a whole
 * frame through one canvas scene function rather than one Konva node per ship,
 * so they are parsed once into plain polygons here. That keeps the hot path to
 * `moveTo`/`lineTo` with no `Path2D` and no per-frame parsing.
 */

import type { ShipClass } from '@/types/model';
import { CLASS_GLYPHS } from './shipGlyphs';

/** One closed subpath, as flat [x0, y0, x1, y1, ...] in the 24x24 glyph box. */
export type Polygon = number[];

/**
 * Parses the M/L/Z subset the class glyphs are written in.
 *
 * Deliberately not a general SVG path parser: `shipGlyphs.ts` documents its
 * data as straight-line subpaths, and anything else appearing there should
 * fail loudly here rather than be silently half-drawn.
 */
function parsePath(d: string): Polygon[] {
  const polys: Polygon[] = [];
  let current: Polygon = [];
  // Commands are written against their first number (`M12 1.1`), so splitting
  // on whitespace would yield "M12". Match letters and numbers separately.
  const tokens = d.match(/[MLZz]|-?\d*\.?\d+/g) ?? [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === 'M' || token === 'L') {
      const x = Number(tokens[++i]);
      const y = Number(tokens[++i]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`glyph path has a malformed ${token} command: ${d}`);
      }
      if (token === 'M' && current.length) {
        polys.push(current);
        current = [];
      }
      current.push(x, y);
    } else if (token === 'Z' || token === 'z') {
      if (current.length) polys.push(current);
      current = [];
    } else if (token) {
      throw new Error(`glyph path has an unsupported command ${JSON.stringify(token)}: ${d}`);
    }
  }
  if (current.length) polys.push(current);
  return polys;
}

export interface ReplayGlyph {
  polygons: Polygon[];
  /** Relative size, so a battleship reads bigger than a destroyer. */
  scale: number;
}

/** Parsed once at module load; the draw loop only ever reads these. */
export const REPLAY_GLYPHS: Record<ShipClass, ReplayGlyph> = Object.fromEntries(
  Object.entries(CLASS_GLYPHS).map(([cls, glyph]) => [cls, { polygons: parsePath(glyph.solid), scale: glyph.scale }]),
) as Record<ShipClass, ReplayGlyph>;

/** The box the glyphs are authored in. */
export const GLYPH_BOX = 24;

/**
 * The species names the renderer puts in a `Ship` record, mapped to the
 * planner's classes. These are the game's own `typeinfo.species` values.
 *
 * Anything unrecognized falls back to the cruiser silhouette: it is the
 * middle-of-the-road shape, so an unfamiliar species reads as a ship rather
 * than as a destroyer that is inexplicably enormous.
 */
const SPECIES_TO_CLASS: Record<string, ShipClass> = {
  Destroyer: 'DD',
  Cruiser: 'CA',
  Battleship: 'BB',
  AirCarrier: 'CV',
  Carrier: 'CV',
  Submarine: 'SS',
};

export function classForSpecies(species: string | undefined): ShipClass {
  return (species && SPECIES_TO_CLASS[species]) || 'CA';
}

/**
 * Konva rotation, in degrees, for a replay yaw.
 *
 * The minimap renderer documents the convention in `drawing.rs`: its icons
 * point up (north is -Y) while game yaw is 0 at east and increases
 * counter-clockwise, so screen rotation is `PI/2 - yaw`. Our glyphs are
 * authored bow-up too, so the same conversion applies unchanged.
 */
export function yawToDegrees(yaw: number): number {
  return ((Math.PI / 2 - yaw) * 180) / Math.PI;
}
