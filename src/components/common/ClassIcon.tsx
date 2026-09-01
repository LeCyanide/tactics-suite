import { CLASS_COLORS, CLASS_GLYPHS, GLYPH_CONTRAST, GLYPH_CONTRAST_WIDTH } from '@/canvas/shipGlyphs';
import type { ShipClass } from '@/types/model';

/**
 * The map's fallback class glyph, rendered as SVG for the DOM side of the UI.
 *
 * Same path data as the canvas renderer, so the ship browser, the database
 * table and the map can never drift apart. Bow points up on the map because
 * ship rotation is a heading; in a list there is no heading, so the marker is
 * turned to the side profile the game uses in its own panels.
 */
export function ClassIcon({
  cls,
  size = 20,
  upright = false,
}: {
  cls: ShipClass;
  size?: number;
  /** true keeps the bow pointing up, as on the map. */
  upright?: boolean;
}) {
  const glyph = CLASS_GLYPHS[cls] ?? CLASS_GLYPHS.CA;
  const color = CLASS_COLORS[cls] ?? '#8b98a5';

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label={cls} role="img">
      <path
        d={glyph.solid}
        transform={upright ? undefined : 'rotate(90 12 12)'}
        fill={color}
        stroke={GLYPH_CONTRAST}
        strokeWidth={GLYPH_CONTRAST_WIDTH}
        strokeLinejoin="round"
      />
    </svg>
  );
}
