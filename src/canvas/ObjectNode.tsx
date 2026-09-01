import { memo } from 'react';
import { Arc, Arrow, Circle, Ellipse, Group, Label, Line, Path, Rect, Tag, Text } from 'react-konva';
import type {
  MarkerObject,
  PathObject,
  PingObject,
  ShapeObject,
  TacticalObject,
  TextObject,
  Vec2,
  ZoneObject,
} from '@/types/model';
import { PING_ICONS } from '@/data/pings';
import { bearing, dashArray, formatArea, formatBearing, formatKm, pathLength, polygonArea, withAlpha } from '@/lib/util';

const MARKER_PATHS: Record<MarkerObject['shape'], string> = {
  pin: PING_ICONS.pin,
  cross: PING_ICONS.cross,
  diamond: PING_ICONS.diamond,
  star: PING_ICONS.star,
  flag: PING_ICONS.flag,
};

/** See ShipNode: drag is delegated to the Layer; this satisfies react-konva. */
const bubbleDrag = () => {};

export function flatten(points: Vec2[]): number[] {
  const out: number[] = [];
  for (const p of points) {
    out.push(p.x, p.y);
  }
  return out;
}

/** Samples a quadratic bow between the first and last point of a path. */
export function curvedPoints(a: Vec2, b: Vec2, curvature: number, samples = 26): number[] {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cx = mx - dy * curvature;
  const cy = my + dx * curvature;
  const out: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const it = 1 - t;
    out.push(it * it * a.x + 2 * it * t * cx + t * t * b.x, it * it * a.y + 2 * it * t * cy + t * t * b.y);
  }
  return out;
}

interface Props {
  obj: TacticalObject;
  inv: number;
  selected: boolean;
  draggable: boolean;
}

export const ObjectNode = memo(function ObjectNode({ obj, inv, selected, draggable }: Props) {
  const common = {
    id: obj.id,
    name: 'object',
    x: obj.x,
    y: obj.y,
    rotation: obj.rotation,
    opacity: obj.opacity,
    visible: obj.visible,
    draggable,
    onDragMove: bubbleDrag,
    listening: !obj.locked,
  };

  switch (obj.type) {
    case 'freehand':
    case 'line':
    case 'arrow':
    case 'doubleArrow':
    case 'curvedArrow':
    case 'polygon':
    case 'ruler':
    case 'bearing':
    case 'area':
      return <PathNode {...common} obj={obj as PathObject} inv={inv} selected={selected} />;
    case 'rect':
    case 'roundRect':
    case 'circle':
    case 'ellipse':
    case 'arc':
      return <ShapeNode {...common} obj={obj as ShapeObject} inv={inv} selected={selected} />;
    case 'text':
    case 'number':
      return <TextNode {...common} obj={obj as TextObject} inv={inv} selected={selected} />;
    case 'marker':
      return <MarkerNode {...common} obj={obj as MarkerObject} inv={inv} selected={selected} />;
    case 'ping':
      return <PingNode {...common} obj={obj as PingObject} inv={inv} selected={selected} />;
    case 'zone':
      return <ZoneNode {...common} obj={obj as ZoneObject} inv={inv} selected={selected} />;
    default:
      return null;
  }
});

/* ------------------------------------------------------------------ */

type NodeCommon = Record<string, unknown>;

function PathNode({ obj, inv, selected, ...rest }: NodeCommon & { obj: PathObject; inv: number; selected: boolean }) {
  const s = obj.stroke;
  const width = s.width * inv;
  const dash = dashArray(s.dash, width);
  const stroke = selected ? '#8ecbff' : s.color;
  const fill = s.fill ? withAlpha(s.fill, s.fillOpacity) : undefined;
  const pts = obj.points;
  if (pts.length < 2) return null;

  const arrowSize = (obj.arrowSize ?? 14) * inv;
  const first = pts[0];
  const last = pts[pts.length - 1];

  const shared = {
    stroke,
    strokeWidth: width,
    dash,
    lineCap: 'round' as const,
    lineJoin: 'round' as const,
    hitStrokeWidth: Math.max(width * 3, 12 * inv),
    shadowColor: selected ? '#4ea3ff' : undefined,
    shadowBlur: selected ? 8 * inv : 0,
  };

  let body: React.ReactNode;
  if (obj.type === 'arrow' || obj.type === 'ruler') {
    body = <Arrow points={flatten(pts)} pointerLength={arrowSize} pointerWidth={arrowSize * 0.8} fill={stroke} {...shared} />;
  } else if (obj.type === 'doubleArrow') {
    body = (
      <Arrow
        points={flatten(pts)}
        pointerLength={arrowSize}
        pointerWidth={arrowSize * 0.8}
        pointerAtBeginning
        fill={stroke}
        {...shared}
      />
    );
  } else if (obj.type === 'curvedArrow') {
    body = (
      <Arrow
        points={curvedPoints(first, last, obj.curvature ?? 0.25)}
        pointerLength={arrowSize}
        pointerWidth={arrowSize * 0.8}
        fill={stroke}
        {...shared}
      />
    );
  } else if (obj.type === 'bearing') {
    body = <Arrow points={flatten(pts)} pointerLength={arrowSize * 0.8} pointerWidth={arrowSize * 0.6} fill={stroke} {...shared} />;
  } else {
    body = (
      <Line
        points={flatten(pts)}
        closed={obj.closed}
        fill={obj.closed ? fill : undefined}
        tension={obj.type === 'freehand' ? 0.28 : 0}
        {...shared}
      />
    );
  }

  // Measurement read-outs are drawn upright and at constant size.
  let measurement: React.ReactNode = null;
  if (obj.showMeasurement) {
    if (obj.type === 'ruler') {
      const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
      measurement = <MeasureLabel x={mid.x} y={mid.y} inv={inv} color={s.color} text={formatKm(pathLength(pts))} />;
    } else if (obj.type === 'bearing') {
      const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
      measurement = (
        <MeasureLabel
          x={mid.x}
          y={mid.y}
          inv={inv}
          color={s.color}
          text={`${formatBearing(bearing(first, last))}   ${formatKm(pathLength(pts))}`}
        />
      );
    } else if (obj.type === 'area') {
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      measurement = <MeasureLabel x={cx} y={cy} inv={inv} color={s.color} text={formatArea(polygonArea(pts))} />;
    }
  }

  return (
    <Group {...rest}>
      {body}
      {measurement}
    </Group>
  );
}

function MeasureLabel({ x, y, inv, color, text }: { x: number; y: number; inv: number; color: string; text: string }) {
  return (
    <Group x={x} y={y} scaleX={inv} scaleY={inv} listening={false}>
      <Label y={-11} x={0}>
        <Tag fill="rgba(9,13,18,0.85)" cornerRadius={2.5} stroke={color} strokeWidth={0.7} />
        <Text text={text} fontSize={11} fontFamily="JetBrains Mono, Consolas, monospace" fill="#e8eef5" padding={4} />
      </Label>
    </Group>
  );
}

function ShapeNode({ obj, inv, selected, ...rest }: NodeCommon & { obj: ShapeObject; inv: number; selected: boolean }) {
  const s = obj.stroke;
  const width = s.width * inv;
  const dash = dashArray(s.dash, width);
  const stroke = selected ? '#8ecbff' : s.color;
  const fill = s.fill ? withAlpha(s.fill, s.fillOpacity) : undefined;
  const shared = { stroke, strokeWidth: width, dash, fill, hitStrokeWidth: Math.max(width * 3, 12 * inv) };

  return (
    <Group {...rest}>
      {obj.type === 'rect' && <Rect x={-obj.rx} y={-obj.ry} width={obj.rx * 2} height={obj.ry * 2} {...shared} />}
      {obj.type === 'roundRect' && (
        <Rect
          x={-obj.rx}
          y={-obj.ry}
          width={obj.rx * 2}
          height={obj.ry * 2}
          cornerRadius={obj.cornerRadius ?? Math.min(obj.rx, obj.ry) * 0.25}
          {...shared}
        />
      )}
      {obj.type === 'circle' && <Circle radius={obj.rx} {...shared} />}
      {obj.type === 'ellipse' && <Ellipse radiusX={obj.rx} radiusY={obj.ry} {...shared} />}
      {obj.type === 'arc' && (
        <Arc
          innerRadius={obj.rx * 0.99}
          outerRadius={obj.rx}
          angle={obj.sweepAngle ?? 120}
          rotation={obj.startAngle ?? -60}
          {...shared}
          fill={undefined}
        />
      )}
    </Group>
  );
}

function TextNode({ obj, inv, selected, ...rest }: NodeCommon & { obj: TextObject; inv: number; selected: boolean }) {
  const style = `${obj.bold ? 'bold ' : ''}${obj.italic ? 'italic' : ''}`.trim() || 'normal';

  if (obj.type === 'number') {
    const r = obj.fontSize * 0.85;
    return (
      <Group {...rest}>
        <Circle radius={r} fill={obj.background ?? '#f4c95d'} stroke={selected ? '#8ecbff' : '#0d1117'} strokeWidth={obj.fontSize * 0.08} />
        <Text
          text={obj.text}
          fontSize={obj.fontSize}
          fontStyle="bold"
          fontFamily={`${obj.fontFamily}, Segoe UI, sans-serif`}
          fill={obj.color}
          width={r * 2}
          height={r * 2}
          offsetX={r}
          offsetY={r * 0.98}
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </Group>
    );
  }

  return (
    <Group {...rest}>
      {obj.background && (
        <Rect
          x={-obj.fontSize * 0.25}
          y={-obj.fontSize * 0.2}
          width={obj.text.length * obj.fontSize * 0.56 + obj.fontSize * 0.5}
          height={(obj.text.split('\n').length * obj.fontSize * 1.25) + obj.fontSize * 0.4}
          fill={obj.background}
          cornerRadius={obj.fontSize * 0.12}
          opacity={0.85}
        />
      )}
      <Text
        text={obj.text}
        fontSize={obj.fontSize}
        fontStyle={style}
        fontFamily={`${obj.fontFamily}, Segoe UI, sans-serif`}
        fill={selected ? '#8ecbff' : obj.color}
        align={obj.align}
        lineHeight={1.25}
        shadowColor="#000"
        shadowBlur={obj.fontSize * 0.08}
        shadowOpacity={0.7}
      />
    </Group>
  );
}

function MarkerNode({ obj, inv, selected, ...rest }: NodeCommon & { obj: MarkerObject; inv: number; selected: boolean }) {
  const size = obj.size;
  return (
    <Group {...rest}>
      <Group scaleX={inv} scaleY={inv}>
        <Group scaleX={size / 24} scaleY={size / 24} offsetX={12} offsetY={obj.shape === 'pin' ? 22 : 12}>
          <Path
            data={MARKER_PATHS[obj.shape]}
            fill={obj.shape === 'cross' ? undefined : withAlpha(obj.color, 0.9)}
            stroke={selected ? '#8ecbff' : '#0b0f14'}
            strokeWidth={1.6}
            lineJoin="round"
          />
        </Group>
        <Rect x={-size / 2} y={-size} width={size} height={size * 1.2} fill="transparent" />
        {obj.label && (
          <Label y={obj.shape === 'pin' ? 6 : size / 2 + 3}>
            <Tag fill="rgba(9,13,18,0.8)" cornerRadius={2} />
            <Text text={obj.label} fontSize={10.5} fill="#e8eef5" padding={3} />
          </Label>
        )}
      </Group>
    </Group>
  );
}

function PingNode({ obj, inv, selected, ...rest }: NodeCommon & { obj: PingObject; inv: number; selected: boolean }) {
  const size = obj.size;
  const r = size * 0.62;
  return (
    <Group {...rest} rotation={0}>
      <Group scaleX={inv} scaleY={inv}>
        <Circle radius={r} fill="rgba(10,14,20,0.82)" stroke={obj.color} strokeWidth={selected ? 2.4 : 1.8} />
        {selected && <Circle radius={r + 4} stroke="#4ea3ff" strokeWidth={1} dash={[4, 3]} />}

        {obj.directional && (
          <Group rotation={(rest.rotation as number) ?? 0}>
            <Line points={[0, -r - 3, -5, -r - 11, 5, -r - 11]} closed fill={obj.color} />
          </Group>
        )}

        <Group scaleX={size / 34} scaleY={size / 34} offsetX={12} offsetY={12}>
          <Path data={PING_ICONS[obj.icon] ?? PING_ICONS.pin} stroke={obj.color} strokeWidth={2} lineJoin="round" lineCap="round" />
        </Group>

        <Circle radius={r} fill="transparent" />

        {obj.showLabel && obj.label && (
          <Label y={r + 3}>
            <Tag fill="rgba(9,13,18,0.85)" cornerRadius={2} stroke={obj.color} strokeWidth={0.7} />
            <Text
              text={obj.label}
              fontSize={10}
              fontStyle="600"
              fontFamily="Inter, Segoe UI, sans-serif"
              fill="#e8eef5"
              padding={3}
            />
          </Label>
        )}
      </Group>
    </Group>
  );
}

function ZoneNode({ obj, inv, selected, ...rest }: NodeCommon & { obj: ZoneObject; inv: number; selected: boolean }) {
  const stroke = selected ? '#8ecbff' : obj.color;
  const strokeWidth = obj.lineWidth * inv;
  const fill = obj.fill ? withAlpha(obj.color, obj.fillOpacity) : undefined;
  const dash = obj.dashed ? [strokeWidth * 4, strokeWidth * 3] : undefined;
  const shared = { stroke, strokeWidth, fill, dash, hitStrokeWidth: Math.max(strokeWidth * 3, 12 * inv) };

  const labelOffsetY =
    obj.zoneShape === 'circle' ? -(obj.radius ?? 0) : obj.zoneShape === 'rect' ? -(obj.ry ?? 0) : 0;

  return (
    <Group {...rest}>
      {obj.zoneShape === 'circle' && <Circle radius={obj.radius ?? 1000} {...shared} />}
      {obj.zoneShape === 'rect' && (
        <Rect x={-(obj.rx ?? 0)} y={-(obj.ry ?? 0)} width={(obj.rx ?? 0) * 2} height={(obj.ry ?? 0) * 2} {...shared} />
      )}
      {obj.zoneShape === 'cone' && (
        <Arc
          innerRadius={0}
          outerRadius={obj.radius ?? 1000}
          angle={(obj.coneAngle ?? 35) * 2}
          rotation={-90 - (obj.coneAngle ?? 35)}
          {...shared}
        />
      )}
      {obj.zoneShape === 'polygon' && (obj.points?.length ?? 0) >= 2 && (
        <Line points={flatten(obj.points ?? [])} closed {...shared} lineJoin="round" />
      )}

      {obj.showLabel && (
        <Group y={labelOffsetY} scaleX={inv} scaleY={inv} rotation={-((rest.rotation as number) ?? 0)} listening={false}>
          <Label y={-14}>
            <Tag fill="rgba(9,13,18,0.85)" cornerRadius={2.5} stroke={obj.color} strokeWidth={0.7} />
            <Text
              text={obj.valueKm ? `${obj.label}\n${obj.valueKm.toFixed(1)} km` : obj.label}
              fontSize={10.5}
              fontStyle="600"
              align="center"
              fontFamily="Inter, Segoe UI, sans-serif"
              fill="#e8eef5"
              padding={3.5}
            />
          </Label>
        </Group>
      )}
    </Group>
  );
}
