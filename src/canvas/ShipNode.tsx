import { memo } from 'react';
import { Arc, Circle, Group, Image as KonvaImage, Label, Line, Path, Rect, Tag, Text } from 'react-konva';
import type { CharacteristicFlags, Page, RangeStyle, Ship, ShipObject, Team } from '@/types/model';
import { RANGE_KEYS, SHIP_CLASS_LABEL, DEFAULT_RANGE_STYLES } from '@/types/model';
import { CLASS_COLORS, CLASS_GLYPHS, GLYPH_CONTRAST, GLYPH_CONTRAST_WIDTH } from './shipGlyphs';
import { shipRangeKm } from '@/state/store';
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
  smoke: 'Smoke',
  mainBattery: 'Main Battery',
  secondary: 'Secondary',
  torpedo: 'Torpedo',
  aa: 'AA',
};

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
}: ShipNodeProps) {
  const glyph = CLASS_GLYPHS[obj.shipClass] ?? CLASS_GLYPHS.CA;
  const size = baseSize * obj.iconScale * (icon ? 1 : glyph.scale);
  const half = size / 2;
  const teamColor = team?.color ?? '#8b98a5';

  const lines: string[] = [];
  if (flags.name) lines.push(obj.label || obj.shipName);
  const sub: string[] = [];
  if (flags.class) sub.push(SHIP_CLASS_LABEL[obj.shipClass] ?? obj.shipClass);
  if (flags.tier) sub.push(`T${obj.tier}`);
  if (sub.length) lines.push(sub.join('  ·  '));
  if (flags.hp) {
    const hp = obj.hpOverride ?? ship?.hp;
    if (hp) lines.push(`${Math.round(hp).toLocaleString()} HP`);
  }
  if (flags.consumables && ship) {
    // Consumables as text, so they are available without forcing a ring onto
    // the map. The ranged ones still have their own independent toggles.
    for (const c of ship.consumables ?? []) {
      lines.push(c.range_km ? `${c.name} ${c.range_km.toFixed(1)} km` : c.name);
    }
    if (ship.fighter) lines.push('Fighter');
    if (ship.spottingAircraft) lines.push('Spotting Aircraft');
  }

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
        {/* Selection halo */}
        {selected && (
          <Circle radius={half + 7} stroke="#4ea3ff" strokeWidth={1.5} dash={[4, 3]} listening={false} />
        )}

        {/* Team ring — colours the ship without touching the icon artwork */}
        {team && (
          <Circle
            radius={half + 2.5}
            stroke={teamColor}
            strokeWidth={2}
            opacity={0.95}
            listening={false}
            shadowColor="#000"
            shadowBlur={4}
            shadowOpacity={0.5}
          />
        )}

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
                  fill={withAlpha(CLASS_COLORS[obj.shipClass] ?? '#8b98a5', 0.94)}
                  stroke={GLYPH_CONTRAST}
                  strokeWidth={GLYPH_CONTRAST_WIDTH}
                  lineJoin="round"
                />
              </Group>
            ))}
        </Group>

        {/* Hit area — generous enough to grab comfortably at any zoom */}
        <Rect x={-half - 3} y={-half - 3} width={size + 6} height={size + 6} fill="transparent" />

        {/* Labels stay upright regardless of heading */}
        {lines.length > 0 && (
          <Label y={half + 4} x={0}>
            <Tag fill="rgba(9,13,18,0.78)" cornerRadius={2.5} stroke={selected ? '#4ea3ff' : teamColor} strokeWidth={selected ? 1 : 0.6} />
            <Text
              text={lines.join('\n')}
              fontSize={10.5}
              lineHeight={1.25}
              fontFamily="Inter, Segoe UI, sans-serif"
              fontStyle="600"
              fill="#e8eef5"
              padding={3.5}
              align="center"
              offsetX={0}
            />
          </Label>
        )}
      </Group>
    </Group>
  );
});

/* ------------------------------------------------------------------ */
/* Range visualisations                                                */
/* ------------------------------------------------------------------ */

interface ShipRangesProps {
  obj: ShipObject;
  ship?: Ship;
  page: Page;
  flags: CharacteristicFlags;
  inv: number;
}

/**
 * Draws only the characteristics that are switched on. Nothing here renders
 * from the mere presence of a ship: every ring is the direct consequence of a
 * page default or a per-ship override being true, which is also why hidden
 * characteristics cannot leak into an exported image.
 */
export const ShipRanges = memo(function ShipRanges({ obj, ship, page, flags, inv }: ShipRangesProps) {
  if (!obj.visible) return null;

  const rings = RANGE_KEYS.filter((key) => flags[key]).map((key) => {
    const km = shipRangeKm(ship, key);
    if (!km || km <= 0) return null;
    const style: RangeStyle = {
      ...(page.rangeStyles[key] ?? DEFAULT_RANGE_STYLES[key]),
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
                <Label y={-13}>
                  <Tag fill="rgba(9,13,18,0.8)" cornerRadius={2} />
                  <Text
                    text={`${RANGE_LABEL[key] ?? key} ${km.toFixed(1)} km`}
                    fontSize={10}
                    fontFamily="JetBrains Mono, Consolas, monospace"
                    fill={style.color}
                    padding={3}
                  />
                </Label>
              </Group>
            )}
          </Group>
        );
      })}
    </Group>
  );
});

/* ------------------------------------------------------------------ */
/* Planned route                                                       */
/* ------------------------------------------------------------------ */

interface ShipRouteProps {
  obj: ShipObject;
  team?: Team;
  inv: number;
  editable: boolean;
  showSpeeds: boolean;
}

export const ShipRoute = memo(function ShipRoute({ obj, team, inv, editable, showSpeeds }: ShipRouteProps) {
  if (!obj.route.length || !obj.routeVisible || !obj.visible) return null;
  const color = team?.color ?? '#8b98a5';
  const pts: number[] = [obj.x, obj.y];
  for (const wp of obj.route) pts.push(wp.x, wp.y);

  const last = obj.route[obj.route.length - 1];
  const prev = obj.route.length > 1 ? obj.route[obj.route.length - 2] : { x: obj.x, y: obj.y };
  const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
  const head = 11 * inv;

  return (
    <Group listening={false} opacity={obj.opacity}>
      <Line points={pts} stroke={color} strokeWidth={2 * inv} dash={[10 * inv, 7 * inv]} opacity={0.9} lineJoin="round" />
      {/* Arrowhead on the final leg */}
      <Line
        points={[
          last.x - Math.cos(angle - 0.42) * head * 1.8,
          last.y - Math.sin(angle - 0.42) * head * 1.8,
          last.x,
          last.y,
          last.x - Math.cos(angle + 0.42) * head * 1.8,
          last.y - Math.sin(angle + 0.42) * head * 1.8,
        ]}
        stroke={color}
        strokeWidth={2 * inv}
        lineJoin="round"
      />
      {obj.route.map((wp, i) => (
        <Group key={wp.id} x={wp.x} y={wp.y}>
          <Circle radius={4 * inv} fill="#0d1117" stroke={color} strokeWidth={1.6 * inv} />
          {showSpeeds && wp.speed_kn ? (
            <Group scaleX={inv} scaleY={inv}>
              <Label x={7} y={-8}>
                <Tag fill="rgba(9,13,18,0.8)" cornerRadius={2} />
                <Text text={`${wp.speed_kn} kn`} fontSize={9.5} fontFamily="JetBrains Mono, monospace" fill={color} padding={2.5} />
              </Label>
            </Group>
          ) : null}
          {i === obj.route.length - 1 && wp.label ? (
            <Group scaleX={inv} scaleY={inv}>
              <Label x={7} y={4}>
                <Tag fill="rgba(9,13,18,0.8)" cornerRadius={2} />
                <Text text={wp.label} fontSize={9.5} fill="#c9d4e0" padding={2.5} />
              </Label>
            </Group>
          ) : null}
        </Group>
      ))}
    </Group>
  );
});

/** Draggable waypoint handles, drawn in the overlay for the selected ship. */
export function RouteHandles({ obj, inv }: { obj: ShipObject; inv: number }) {
  return (
    <Group>
      {obj.route.map((wp) => (
        <Circle
          key={wp.id}
          id={`wp:${obj.id}:${wp.id}`}
          name="waypoint"
          x={wp.x}
          y={wp.y}
          radius={6 * inv}
          fill="#4ea3ff"
          stroke="#0d1117"
          strokeWidth={1.5 * inv}
          draggable
          onDragMove={bubbleDrag}
        />
      ))}
    </Group>
  );
}
