import {
  ArrowUpRight,
  Circle,
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
import { ARROW_TOOLS, SHAPE_TOOLS, useStore, type ToolId } from '@/state/store';
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

export function ToolRail() {
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
   * One button per family. It draws whichever variant was chosen last; the
   * choice itself is made in the properties panel, where the options have room
   * to carry their names.
   */
  const family = (
    id: 'shape' | 'arrow',
    icon: LucideIcon,
    current: ToolId,
    members: readonly string[],
    shortcut: string,
  ) => {
    const Icon = icon;
    const active = members.includes(tool);
    return (
      <Tip
        key={id}
        label={`${id === 'shape' ? 'Shape' : 'Line & arrow'} — pick the kind in the panel`}
        shortcut={shortcut}
        side="left"
      >
        <button
          className={`tool-btn${active ? ' active' : ''}`}
          disabled={!hasProject}
          onClick={() => setTool(current)}
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
      {family('shape', Circle, options.shapeVariant, SHAPE_TOOLS, 'R')}
      {family('arrow', ArrowUpRight, options.arrowVariant, ARROW_TOOLS, 'A')}
      <div className="tool-sep" />
      {GROUPS[2].map(button)}
      <div className="tool-sep" />
      {GROUPS[3].map(button)}
    </div>
  );
}
