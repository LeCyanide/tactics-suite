import {
  ArrowLeftRight,
  ArrowUpRight,
  Circle,
  Hash,
  Maximize2,
  MousePointer2,
  Pencil,
  Pentagon,
  Pin,
  RectangleHorizontal,
  Ruler,
  Scan,
  Slash,
  Spline,
  Square,
  SquareDashed,
  Type,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  ARROW_TOOLS,
  SHAPE_TOOLS,
  useStore,
  type ArrowTool,
  type ShapeTool,
  type ToolId,
} from '@/state/store';
import { Tip } from './common/ui';
import { canvasApi } from '@/canvas/canvasBridge';

interface ToolDef {
  id: ToolId;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

/** Icons and names for the variants behind the grouped Shape / Arrow buttons. */
const SHAPE_VARIANTS: Record<ShapeTool, { icon: LucideIcon; label: string }> = {
  rect: { icon: Square, label: 'Rectangle' },
  roundRect: { icon: RectangleHorizontal, label: 'Rounded rectangle' },
  circle: { icon: Circle, label: 'Circle' },
  polygon: { icon: Pentagon, label: 'Polygon — click points, double-click to close' },
};

const ARROW_VARIANTS: Record<ArrowTool, { icon: LucideIcon; label: string }> = {
  line: { icon: Slash, label: 'Line' },
  arrow: { icon: ArrowUpRight, label: 'Arrow' },
  doubleArrow: { icon: ArrowLeftRight, label: 'Double arrow' },
  curvedArrow: { icon: Spline, label: 'Curved arrow' },
};

const GROUPS: ToolDef[][] = [
  [
    { id: 'select', icon: MousePointer2, label: 'Select', shortcut: 'V' },
    { id: 'marquee', icon: SquareDashed, label: 'Multi-select', shortcut: 'Shift+V' },
  ],
  [{ id: 'freehand', icon: Pencil, label: 'Freehand', shortcut: 'F' }],
  [
    { id: 'text', icon: Type, label: 'Text', shortcut: 'T' },
    { id: 'number', icon: Hash, label: 'Number badge' },
    { id: 'marker', icon: Pin, label: 'Marker' },
  ],
  [
    { id: 'ruler', icon: Ruler, label: 'Ruler / distance', shortcut: 'M' },
    { id: 'area', icon: Scan, label: 'Area — click points, double-click to close' },
  ],
];

export function ToolRail() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const options = useStore((s) => s.toolOptions);
  const patch = useStore((s) => s.patchToolOptions);
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

  return (
    <div className="toolrail">
      {GROUPS[0].map(button)}
      <div className="tool-sep" />
      {GROUPS[1].map(button)}

      {/* One button per family. The active variant is picked in the flyout and
          becomes what the button draws, so the rail stays short. */}
      <VariantButton
        variants={SHAPE_TOOLS}
        meta={SHAPE_VARIANTS}
        current={options.shapeVariant}
        active={SHAPE_TOOLS.includes(tool as ShapeTool)}
        disabled={!hasProject}
        shortcut="R"
        onPick={(v) => {
          patch({ shapeVariant: v as ShapeTool });
          setTool(v);
        }}
      />
      <VariantButton
        variants={ARROW_TOOLS}
        meta={ARROW_VARIANTS}
        current={options.arrowVariant}
        active={ARROW_TOOLS.includes(tool as ArrowTool)}
        disabled={!hasProject}
        shortcut="A"
        onPick={(v) => {
          patch({ arrowVariant: v as ArrowTool });
          setTool(v);
        }}
      />

      <div className="tool-sep" />
      {GROUPS[2].map(button)}
      <div className="tool-sep" />
      {GROUPS[3].map(button)}

      <div style={{ flex: 1 }} />
      <div className="tool-sep" />

      <Tip label="Recentre map" shortcut="Ctrl+0" side="left">
        <button className="tool-btn" onClick={() => canvasApi()?.fit()}>
          <Maximize2 size={15} />
        </button>
      </Tip>
    </div>
  );
}

/**
 * A rail button that stands for a family of tools. Clicking it selects the
 * remembered variant; the caret opens the list to change which one that is.
 */
function VariantButton<T extends string>({
  variants,
  meta,
  current,
  active,
  disabled,
  shortcut,
  onPick,
}: {
  variants: readonly T[];
  meta: Record<T, { icon: LucideIcon; label: string }>;
  current: T;
  active: boolean;
  disabled: boolean;
  shortcut?: string;
  onPick: (v: T) => void;
}) {
  const Icon = meta[current].icon;
  return (
    <div className="tool-variant">
      <Tip label={meta[current].label} shortcut={shortcut} side="left">
        <button
          className={`tool-btn${active ? ' active' : ''}`}
          disabled={disabled}
          onClick={() => onPick(current)}
        >
          <Icon size={15} />
          <span className="tool-caret" />
        </button>
      </Tip>
      <div className="tool-flyout">
        {variants.map((v) => {
          const VIcon = meta[v].icon;
          return (
            <button
              key={v}
              className={`tool-flyout-item${v === current ? ' active' : ''}`}
              disabled={disabled}
              onClick={() => onPick(v)}
            >
              <VIcon size={14} />
              <span>{meta[v].label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
