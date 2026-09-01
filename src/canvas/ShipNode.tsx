import { memo } from 'react';
import { Arc, Circle, Group, Image as KonvaImage, Line, Path, Rect, Text } from 'react-konva';
import type { CharacteristicFlags, RangeStyle, Ship, ShipObject, Team } from '@/types/model';
import { RANGE_KEYS, DEFAULT_RANGE_STYLES } from '@/types/model';
import { CLASS_GLYPHS, GLYPH_CONTRAST_WIDTH } from './shipGlyphs';
import { shipRangeKm } from '@/state/store';
import type { CanvasTheme } from '@/state/theme';
import { withAlpha } from '@/lib/util';

/**
 * Drag is handled by delegation on the content Layer (see MapCanvas), which
 * keeps one code path for single and multi-object drags. react-konva warns
 * when a draggable node has no local handler, so nodes carry this no-op; the
 * real work still happens when the event bubbles up.
 */
const bubbleDrag = () => {};

const RANGE_LABEL: Record<string, string> = {
  detection: 'Detection',
  radar: 'Radar',
  hydro: 'Hydro',
  mainBattery: 'Main Battery',
  secondary: 'Secondary',
  torpedo: 'Torpedo',
};

/** Width of the name plate, in screen px, used to centre it under the hull. */
const NAME_FONT = 10.5;

/** Fixed plate width keeps a multi-line name centred without measuring text. */
const NAME_PLATE_W = 160;

interface ShipNodeProps {
  obj: ShipObject;
  ship?: Ship;
  team?: Team;
  flags: CharacteristicFlags;
  icon: HTMLImageElement | null;
  /** 1 / camera.scale — converts screen pixels into world metres. */
  inv: number;
  baseSize: number;
  selected: boolean;
  draggable: boolean;
  /** Canvas palette; a prop so a theme switch invalidates the memo. */
  theme: CanvasTheme;
}

/**
 * A ship on the map.
 *
 * The icon and its labels are drawn inside a group scaled by 1/zoom, so they
 * keep a constant on-screen size and stay legible at every zoom level, while
 * the ship's position itself lives in world metres.
 */
export const ShipNode = memo(function ShipNode({
  obj,
  ship,
  team,
  flags,
  icon,
  inv,
  baseSize,
  selected,
  draggable,
  theme,
}: ShipNodeProps) {
  const glyph = CLASS_GLYPHS[obj.shipClass] ?? CLASS_GLYPHS.CA;
  const size = baseSize * obj.iconScale * (icon ? 1 : glyph.scale);
  const half = size / 2;
  // Team membership is the only thing that colours a ship. A ship with no
  // team falls back to neutral grey rather than to a class colour.
  const teamColor = team?.color ?? theme.neutral;

  const lines: string[] = [];
  if (flags.name) lines.push(obj.label || obj.shipName);
  if (flags.consumables && ship) {
    // Consumables as text, so they are available without forcing a ring onto
    // the map. The ranged ones still have their own independent toggles.
    for (const c of ship.consumables ?? []) {
      lines.push(c.range_km ? `${c.name} ${c.range_km.toFixed(1)} km` : c.name);
    }
    if (ship.fighter) lines.push('Fighter');
    if (ship.spottingAircraft) lines.push('Spotting Aircraft');
  }
  const text = lines.join('\n');

  return (
    <Group
      id={obj.id}
      name="object ship"
      x={obj.x}
      y={obj.y}
      opacity={obj.opacity}
      visible={obj.visible}
      draggable={draggable}
      onDragMove={bubbleDrag}
      listening={!obj.locked}
    >
      <Group scaleX={inv} scaleY={inv}>
        {/* Selection is a corner bracket, not a ring: nothing circular is
            allowed to surround a ship marker. */}
        {selected && <SelectionBrackets half={half + 4} color={theme.selection} />}

        {/* Rotating part: hull icon and heading pointer */}
        <Group rotation={obj.rotation}>
          {flags.heading && (
            <Line
              points={[0, -half - 4, -4, -half + 3, 0, -half + 1, 4, -half + 3]}
              closed
              fill={teamColor}
              listening={false}
            />
          )}

          {flags.icon !== false &&
            (icon ? (
              <KonvaImage image={icon} width={size} height={size} offsetX={half} offsetY={half} listening={false} />
            ) : (
              <Group scaleX={size / 24} scaleY={size / 24} offsetX={12} offsetY={12} listening={false}>
                <Path
                  data={glyph.solid}
                  fill={withAlpha(teamColor, 0.94)}
                  stroke={theme.contrast}
                  strokeWidth={GLYPH_CONTRAST_WIDTH}
                  lineJoin="round"
                />
              </Group>
            ))}
        </Group>

        {/* Hit area — generous enough to grab comfortably at any zoom */}
        <Rect x={-half - 3} y={-half - 3} width={size + 6} height={size + 6} fill="transparent" />

        {/* The name sits outside the rotating group, so it stays horizontal
            whatever the ship's heading, and is centred on the hull by giving
            the Text its own width and centring within it. */}
        {text && (
          <Text
            text={text}
            x={-NAME_PLATE_W / 2}
            y={half + 5}
            width={NAME_PLATE_W}
            align="center"
            fontSize={NAME_FONT}
            lineHeight={1.25}
            fontFamily="Inter, Segoe UI, sans-serif"
            fontStyle="600"
            fill={theme.plateText}
            stroke={theme.contrast}
            strokeWidth={2.6}
            fillAfterStrokeEnabled
            listening={false}
          />
        )}
      </Group>
    </Group>
  );
});

/**
 * Four corner ticks around the marker. Circles are reserved for range rings,
 * so selection has to read as something else entirely.
 */
function SelectionBrackets({ half, color }: { half: number; color: string }) {
  const arm = Math.max(4, half * 0.45);
  const corner = (sx: number, sy: number) => [
    sx * half, sy * half - sy * arm,
    sx * half, sy * half,
    sx * half - sx * arm, sy * half,
  ];
  return (
    <Group listening={false}>
      {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sy]) => (
        <Line key={`${sx}:${sy}`} points={corner(sx, sy)} stroke={color} strokeWidth={1.5} lineCap="round" />
      ))}
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Range visualisations                                                */
/* ------------------------------------------------------------------ */

interface ShipRangesProps {
  obj: ShipObject;
  ship?: Ship;
  flags: CharacteristicFlags;
  inv: number;
  theme: CanvasTheme;
}

/**
 * Draws only the characteristics that are switched on. Nothing here renders
 * from the mere presence of a ship: every ring is the direct consequence of a
 * page default or a per-ship override being true, which is also why hidden
 * characteristics cannot leak into an exported image.
 */
export const ShipRanges = memo(function ShipRanges({ obj, ship, flags, inv, theme }: ShipRangesProps) {
  if (!obj.visible) return null;

  const rings = RANGE_KEYS.filter((key) => flags[key]).map((key) => {
    const km = shipRangeKm(ship, key);
    if (!km || km <= 0) return null;
    // Ranges are per ship: the only inheritance is from the built-in defaults.
    const style: RangeStyle = {
      ...DEFAULT_RANGE_STYLES[key],
      ...(obj.rangeStyles?.[key] ?? {}),
    };
    return { key, km, radius: km * 1000, style };
  });

  return (
    <Group x={obj.x} y={obj.y} listening={false} opacity={obj.opacity}>
      {rings.map((ring) => {
        if (!ring) return null;
        const { key, km, radius, style } = ring;
        const dash = style.dashed ? [radius * 0.035, radius * 0.025] : undefined;
        const stroke = withAlpha(style.color, style.opacity);
        const fill = style.fill ? withAlpha(style.color, style.fillOpacity) : undefined;
        const strokeWidth = style.lineWidth * inv;

        // Torpedoes are a launch sector, not a bubble.
        const isCone = key === 'torpedo' && (ship?.torpedoArc_deg ?? 0) > 0;

        return (
          <Group key={key}>
            {isCone ? (
              <Arc
                innerRadius={0}
                outerRadius={radius}
                angle={(ship?.torpedoArc_deg ?? 45) * 2}
                rotation={obj.rotation - 90 - (ship?.torpedoArc_deg ?? 45)}
                stroke={stroke}
                strokeWidth={strokeWidth}
                fill={fill}
                dash={dash}
              />
            ) : (
              <Circle radius={radius} stroke={stroke} strokeWidth={strokeWidth} fill={fill} dash={dash} />
            )}
            {style.showLabel && (
              <Group x={0} y={-radius} scaleX={inv} scaleY={inv}>
                <Text
                  text={`${RANGE_LABEL[key] ?? key} ${km.toFixed(1)} km`}
                  x={-70}
                  y={-15}
                  width={140}
                  align="center"
                  fontSize={10}
                  fontFamily="JetBrains Mono, Consolas, monospace"
                  fill={style.color}
                  stroke={theme.contrast}
                  strokeWidth={2.4}
                  fillAfterStrokeEnabled
                />
              </Group>
            )}
          </Group>
        );
      })}
    </Group>
  );
});
