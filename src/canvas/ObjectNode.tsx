import { memo } from 'react';
import { Arrow, Circle, Group, Label, Line, Path, Rect, Tag, Text } from 'react-konva';
import type {
  MarkerObject,
  PathObject,
  ShapeObject,
  TacticalObject,
  TextObject,
  Vec2,
} from '@/types/model';
import { MARKER_ICONS } from '@/data/markerIcons';
import type { CanvasTheme } from '@/state/theme';
import { dashArray, formatArea, formatKm, pathLength, polygonArea, withAlpha } from '@/lib/util';

const MARKER_PATHS: Record<MarkerObject['shape'], string> = MARKER_ICONS;

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
  /** Canvas palette; a prop so a theme switch invalidates the memo. */
  theme: CanvasTheme;
}

export const ObjectNode = memo(function ObjectNode({ obj, inv, selected, draggable, theme }: Props) {
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
    case 'area':
      return <PathNode {...common} obj={obj as PathObject} inv={inv} selected={selected} theme={theme} />;
    case 'rect':
    case 'roundRect':
    case 'circle':
      return <ShapeNode {...common} obj={obj as ShapeObject} inv={inv} selected={selected} theme={theme} />;
    case 'text':
    case 'number':
      return <TextNode {...common} obj={obj as TextObject} inv={inv} selected={selected} theme={theme} />;
    case 'marker':
      return <MarkerNode {...common} obj={obj as MarkerObject} inv={inv} selected={selected} theme={theme} />;
    default:
      return null;
  }
});

/* ------------------------------------------------------------------ */

type NodeCommon = Record<string, unknown>;

type Themed = { theme: CanvasTheme };

function PathNode({ obj, inv, selected, theme, ...rest }: NodeCommon & Themed & { obj: PathObject; inv: number; selected: boolean }) {
  const s = obj.stroke;
  const width = s.width * inv;
  const dash = dashArray(s.dash, width);
  const stroke = selected ? theme.selection : s.color;
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
    shadowColor: selected ? theme.selection : undefined,
    shadowBlur: selected ? 8 * inv : 0,
  };

  let body: React.ReactNode;
  if (obj.type === 'ruler') {
    // A ruler is a measurement, not a direction: it gets tick ends (I——I) so
    // it never reads as an arrow pointing somewhere.
    const ang = Math.atan2(last.y - first.y, last.x - first.x) + Math.PI / 2;
    const cap = arrowSize * 0.42;
    const tick = (p: Vec2) => [
      p.x - Math.cos(ang) * cap, p.y - Math.sin(ang) * cap,
      p.x + Math.cos(ang) * cap, p.y + Math.sin(ang) * cap,
    ];
    body = (
      <>
        <Line points={flatten(pts)} {...shared} />
        <Line points={tick(first)} {...shared} />
        <Line points={tick(last)} {...shared} />
      </>
    );
  } else if (obj.type === 'arrow') {
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
      measurement = (
        <MeasureLabel x={mid.x} y={mid.y} inv={inv} color={s.color} theme={theme} text={formatKm(pathLength(pts))} />
      );
    } else if (obj.type === 'area') {
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      measurement = (
        <MeasureLabel x={cx} y={cy} inv={inv} color={s.color} theme={theme} text={formatArea(polygonArea(pts))} />
      );
    }
  }

  return (
    <Group {...rest}>
      {body}
      {measurement}
    </Group>
  );
}

function MeasureLabel({
  x, y, inv, color, text, theme,
}: { x: number; y: number; inv: number; color: string; text: string; theme: CanvasTheme }) {
  return (
    <Group x={x} y={y} scaleX={inv} scaleY={inv} listening={false}>
      <Label y={-11} x={0}>
        <Tag fill={theme.plate} cornerRadius={2.5} stroke={color} strokeWidth={0.7} />
        <Text text={text} fontSize={11} fontFamily="JetBrains Mono, Consolas, monospace" fill={theme.plateText} padding={4} />
      </Label>
    </Group>
  );
}

function ShapeNode({ obj, inv, selected, theme, ...rest }: NodeCommon & Themed & { obj: ShapeObject; inv: number; selected: boolean }) {
  const s = obj.stroke;
  const width = s.width * inv;
  const dash = dashArray(s.dash, width);
  const stroke = selected ? theme.selection : s.color;
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
    </Group>
  );
}

function TextNode({ obj, inv, selected, theme, ...rest }: NodeCommon & Themed & { obj: TextObject; inv: number; selected: boolean }) {
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

function MarkerNode({ obj, inv, selected, theme, ...rest }: NodeCommon & Themed & { obj: MarkerObject; inv: number; selected: boolean }) {
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
