import {
  Aperture,
  ArrowLeftRight,
  ArrowUpRight,
  Circle,
  Compass,
  Egg,
  Hand,
  Hash,
  Maximize2,
  MousePointer2,
  Pencil,
  Pentagon,
  Pin,
  Radar,
  RectangleHorizontal,
  Route,
  Ruler,
  Scan,
  Slash,
  Spline,
  Square,
  SquareDashed,
  Type,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useStore, type ToolId } from '@/state/store';
import { Tip } from './common/ui';
import { canvasApi } from '@/canvas/canvasBridge';

interface ToolDef {
  id: ToolId;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

const GROUPS: ToolDef[][] = [
  [
    { id: 'select', icon: MousePointer2, label: 'Select', shortcut: 'V' },
    { id: 'marquee', icon: SquareDashed, label: 'Multi-select', shortcut: 'Shift+V' },
    { id: 'pan', icon: Hand, label: 'Pan', shortcut: 'H' },
  ],
  [
    { id: 'freehand', icon: Pencil, label: 'Freehand', shortcut: 'F' },
    { id: 'line', icon: Slash, label: 'Line', shortcut: 'L' },
    { id: 'arrow', icon: ArrowUpRight, label: 'Arrow', shortcut: 'A' },
    { id: 'doubleArrow', icon: ArrowLeftRight, label: 'Double arrow' },
    { id: 'curvedArrow', icon: Spline, label: 'Curved arrow' },
  ],
  [
    { id: 'rect', icon: Square, label: 'Rectangle', shortcut: 'R' },
    { id: 'roundRect', icon: RectangleHorizontal, label: 'Rounded rectangle' },
    { id: 'circle', icon: Circle, label: 'Circle', shortcut: 'C' },
    { id: 'ellipse', icon: Egg, label: 'Ellipse' },
    { id: 'polygon', icon: Pentagon, label: 'Polygon — click points, double-click to close' },
    { id: 'arc', icon: Aperture, label: 'Arc' },
  ],
  [
    { id: 'text', icon: Type, label: 'Text', shortcut: 'T' },
    { id: 'number', icon: Hash, label: 'Number badge' },
    { id: 'marker', icon: Pin, label: 'Marker' },
  ],
  [
    { id: 'ruler', icon: Ruler, label: 'Ruler / distance', shortcut: 'M' },
    { id: 'bearing', icon: Compass, label: 'Bearing' },
    { id: 'area', icon: Scan, label: 'Area — click points, double-click to close' },
  ],
  [
    { id: 'ping', icon: Zap, label: 'Tactical ping', shortcut: 'P' },
    { id: 'zone', icon: Radar, label: 'Tactical zone', shortcut: 'Z' },
    { id: 'route', icon: Route, label: 'Route / waypoints — select a ship first' },
  ],
];

export function ToolRail() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const hasProject = useStore((s) => !!s.project);

  return (
    <div className="toolrail">
      {GROUPS.map((group, gi) => (
        <div key={gi} style={{ display: 'contents' }}>
          {gi > 0 && <div className="tool-sep" />}
          {group.map((t) => {
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
          })}
        </div>
      ))}

      <div style={{ flex: 1 }} />
      <div className="tool-sep" />

      <Tip label="Zoom in" shortcut="Ctrl++" side="left">
        <button className="tool-btn" onClick={() => canvasApi()?.zoomBy(1.2)}>
          <ZoomIn size={15} />
        </button>
      </Tip>
      <Tip label="Zoom out" shortcut="Ctrl+-" side="left">
        <button className="tool-btn" onClick={() => canvasApi()?.zoomBy(1 / 1.2)}>
          <ZoomOut size={15} />
        </button>
      </Tip>
      <Tip label="Fit map to screen" shortcut="Ctrl+0" side="left">
        <button className="tool-btn" onClick={() => canvasApi()?.fit()}>
          <Maximize2 size={15} />
        </button>
      </Tip>
    </div>
  );
}
