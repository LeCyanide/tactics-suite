import { useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Circle,
  MoveDiagonal,
  Pentagon,
  RectangleHorizontal,
  Redo2,
  Slash,
  Square,
  Hash,
  MousePointer2,
  Pencil,
  Pin,
  Ruler,
  Scan,
  SquareDashed,
  Type,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  ARROW_TOOL_LABELS,
  ARROW_TOOLS,
  SHAPE_TOOL_LABELS,
  SHAPE_TOOLS,
  useStore,
  type ArrowTool,
  type ShapeTool,
  type ToolId,
} from '@/state/store';
import { Tip } from './common/ui';

interface ToolDef {
  id: ToolId;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

const GROUPS: ToolDef[][] = [
  [
    { id: 'select', icon: MousePointer2, label: 'Select — one object: move, rotate, resize', shortcut: 'V' },
    { id: 'marquee', icon: SquareDashed, label: 'Multi-select — box or click a group, drag to move it', shortcut: 'Shift+V' },
  ],
  [{ id: 'freehand', icon: Pencil, label: 'Freehand', shortcut: 'F' }],
  [
    { id: 'text', icon: Type, label: 'Text', shortcut: 'T' },
    { id: 'number', icon: Hash, label: 'Number' },
    { id: 'marker', icon: Pin, label: 'Marker' },
  ],
  [
    { id: 'ruler', icon: Ruler, label: 'Ruler', shortcut: 'M' },
    { id: 'area', icon: Scan, label: 'Area — click points, double-click to close' },
  ],
];

const VARIANT_ICONS: Record<string, LucideIcon> = {
  circle: Circle,
  rect: Square,
  roundRect: RectangleHorizontal,
  polygon: Pentagon,
  line: Slash,
  arrow: ArrowUpRight,
  doubleArrow: MoveDiagonal,
  curvedArrow: Redo2,
};

const VARIANT_KEYS: Record<string, string | undefined> = {
  circle: 'C',
  rect: 'R',
  polygon: 'G',
  line: 'L',
  arrow: 'A',
};

export function ToolRail() {
  const railRef = useRef<HTMLDivElement>(null);
  const shapeRef = useRef<HTMLButtonElement>(null);
  const arrowRef = useRef<HTMLButtonElement>(null);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const options = useStore((s) => s.toolOptions);
  const hasProject = useStore((s) => !!s.project);

  const button = (t: ToolDef) => {
    const Icon = t.icon;
    return (
      <Tip key={t.id} label={t.label} shortcut={t.shortcut} side="left">
        <button
          className={`tool-btn${tool === t.id ? ' active' : ''}`}
          disabled={!hasProject}
          onClick={() => setTool(t.id)}
        >
          <Icon size={15} />
        </button>
      </Tip>
    );
  };

  /**
   * One button per family, showing and drawing whichever kind was picked
   * last. While a family's tool is in use its kinds stand in a narrow bar
   * beside the rail, so switching kind never needs the sidebar.
   */
  const family = (id: 'shape' | 'arrow', current: ToolId, members: readonly string[], shortcut: string) => {
    const Icon = VARIANT_ICONS[current] ?? Circle;
    const active = members.includes(tool);
    return (
      <Tip
        key={id}
        label={id === 'shape' ? 'Shape' : 'Line & arrow'}
        shortcut={shortcut}
        side="left"
      >
        <button
          ref={id === 'shape' ? shapeRef : arrowRef}
          className={`tool-btn family${active ? ' active' : ''}`}
          disabled={!hasProject}
          onClick={() => setTool(current)}
        >
          <Icon size={15} />
        </button>
      </Tip>
    );
  };

  const openFamily = SHAPE_TOOLS.includes(tool as ShapeTool)
    ? { members: SHAPE_TOOLS, labels: SHAPE_TOOL_LABELS as Record<string, string>, anchor: shapeRef }
    : ARROW_TOOLS.includes(tool as ArrowTool)
      ? { members: ARROW_TOOLS, labels: ARROW_TOOL_LABELS as Record<string, string>, anchor: arrowRef }
      : null;

  // The bar lines up with its button, which can move when the rail scrolls.
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const button = openFamily?.anchor.current;
    const rail = railRef.current;
    if (!button || !rail) return;
    const wrap = rail.parentElement;
    const place = () =>
      setTop(button.getBoundingClientRect().top - (wrap?.getBoundingClientRect().top ?? 0) - 4);
    place();
    rail.addEventListener('scroll', place);
    return () => rail.removeEventListener('scroll', place);
  }, [openFamily?.anchor, tool]);

  return (
    <>
      {openFamily && (
        <div className="tool-subrail" style={{ top }}>
          {openFamily.members.map((v) => {
            const Icon = VARIANT_ICONS[v];
            return (
              <Tip key={v} label={openFamily.labels[v]} shortcut={VARIANT_KEYS[v]} side="left">
                <button className={`tool-btn${tool === v ? ' active' : ''}`} onClick={() => setTool(v as ToolId)}>
                  <Icon size={15} />
                </button>
              </Tip>
            );
          })}
        </div>
      )}
      <div className="toolrail" ref={railRef}>
        {GROUPS[0].map(button)}
        <div className="tool-sep" />
        {GROUPS[1].map(button)}
        {family('shape', options.shapeVariant, SHAPE_TOOLS, 'C')}
        {family('arrow', options.arrowVariant, ARROW_TOOLS, 'A')}
        <div className="tool-sep" />
        {GROUPS[2].map(button)}
        <div className="tool-sep" />
        {GROUPS[3].map(button)}
      </div>
    </>
  );
}
