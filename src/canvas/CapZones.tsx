import { memo } from 'react';
import { Circle, Group, Path, Text } from 'react-konva';
import type { CapLayout, GameMap } from '@/types/model';
import { CAP_FILL_OPACITY, CP_TYPE_BASE_WITH_POINTS, capColor } from '@/types/model';
import { BASE_FLAG_HEIGHT, BASE_FLAG_PATH, BASE_FLAG_WIDTH } from './baseIcons';

interface Props {
  /** The page's selected layout, or null when none is chosen or it is hidden. */
  layout: CapLayout | null;
  map: GameMap | null;
  opacity: number;
}

/**
 * Capture zones for the page's selected layout.
 *
 * Lives on the background layer, painted after the grid so the zones read on
 * top of it, and before every tactical object so a ship is never hidden behind
 * a cap. Inert (`listening={false}`): these are match-start facts rather than
 * something the planner edits, so they must never swallow a click meant for a
 * ship underneath.
 *
 * Geometry arrives as fractions of the map extent, so the only thing this
 * component needs from the map is how big it is in metres.
 */
export const CapZones = memo(function CapZones({ layout, map, opacity }: Props) {
  if (!layout || !map) return null;

  const w = map.widthMeters;
  const h = map.heightMeters;
  // Sized off the map rather than the zone: every letter stays the same size,
  // so a small cap does not get a smaller label than the one beside it.
  const fontSize = w * 0.016;
  const flagH = w * 0.04;
  const flagScale = flagH / BASE_FLAG_HEIGHT;
  const flagW = BASE_FLAG_WIDTH * flagScale;

  return (
    // Clipped to the map: a tournament layout can centre a zone on the very
    // edge of the water, and the half beyond it is not anywhere a ship can be.
    <Group listening={false} opacity={opacity} clipX={0} clipY={0} clipWidth={w} clipHeight={h}>
      {layout.points.map((p) => {
        const color = capColor(p.teamId);
        // A base is owned from the first second and carries the game's flag;
        // only a contested cap gets a letter.
        const isBase = p.cpType === CP_TYPE_BASE_WITH_POINTS;
        const x = p.nx * w;
        const y = p.ny * h;
        const r = p.nr * w;
        return (
          <Group key={p.index}>
            {/* Fill and outline are separate nodes because Konva's opacity
                applies to the whole node — one translucent wash plus one
                solid ring, rather than a washed-out ring. */}
            <Circle x={x} y={y} radius={r} fill={color} opacity={CAP_FILL_OPACITY} />
            <Circle x={x} y={y} radius={r} stroke={color} strokeWidth={w * 0.0007} />
            {isBase ? (
              <Path
                data={BASE_FLAG_PATH}
                fill={color}
                x={x - flagW / 2}
                y={y - flagH / 2}
                scaleX={flagScale}
                scaleY={flagScale}
              />
            ) : (
              <Text
                x={x - r}
                y={y - r}
                width={r * 2}
                height={r * 2}
                align="center"
                verticalAlign="middle"
                text={p.label}
                fontSize={fontSize}
                fontStyle="600"
                fontFamily="JetBrains Mono, Consolas, monospace"
                fill={color}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
});
