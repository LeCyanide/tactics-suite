import { useEffect, useMemo, useState } from 'react';
import { Copy, Eye, Grid3x3, HardDrive, Plus, Save, X } from 'lucide-react';
import { getActivePage, useStore } from '@/state/store';
import { canvasApi } from '@/canvas/canvasBridge';
import { useAsset } from '@/state/assets';
import { InlineEdit, Tip } from './common/ui';
import { renderMarkdown } from '@/lib/markdown';
import { formatRelative } from '@/lib/util';
import type { ShipObject } from '@/types/model';

/* ------------------------------------------------------------------ */
/* Page tabs                                                           */
/* ------------------------------------------------------------------ */

export function PageTabs() {
  const project = useStore((s) => s.project);
  const s = () => useStore.getState();
  if (!project) return null;

  return (
    <div className="page-tabs">
      {project.pages.map((page, i) => (
        <div
          key={page.id}
          className={`page-tab${page.id === project.activePageId ? ' active' : ''}`}
          onMouseDown={(e) => e.button === 0 && s().setActivePage(page.id)}
          onAuxClick={(e) => {
            if (e.button === 1 && project.pages.length > 1) s().deletePage(page.id);
          }}
        >
          <span className="mono faint" style={{ fontSize: 10 }}>
            {String(i + 1).padStart(2, '0')}
          </span>
          <InlineEdit value={page.name} onCommit={(v) => s().renamePage(page.id, v)} />
          {project.pages.length > 1 && (
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                s().deletePage(page.id);
              }}
              title="Delete page"
            >
              <X size={10} />
            </span>
          )}
        </div>
      ))}
      <Tip label="Duplicate current page" side="bottom">
        <button
          className="page-tab-add"
          onClick={() => project.activePageId && s().duplicatePage(project.activePageId)}
        >
          <Copy size={12} />
        </button>
      </Tip>
      <Tip label="New page" side="bottom">
        <button className="page-tab-add" onClick={() => s().addPage()}>
          <Plus size={14} />
        </button>
      </Tip>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status bar                                                          */
/* ------------------------------------------------------------------ */

const TOOL_NAMES: Record<string, string> = {
  select: 'Select', marquee: 'Multi-select', pan: 'Pan', freehand: 'Freehand', line: 'Line', arrow: 'Arrow',
  doubleArrow: 'Double arrow', curvedArrow: 'Curved arrow', rect: 'Rectangle', roundRect: 'Rounded rectangle',
  circle: 'Circle', ellipse: 'Ellipse', polygon: 'Polygon', arc: 'Arc', text: 'Text', number: 'Number',
  marker: 'Marker', ruler: 'Ruler', bearing: 'Bearing', area: 'Area', ping: 'Ping', zone: 'Zone', route: 'Route',
};

export function StatusBar() {
  const tool = useStore((s) => s.tool);
  const page = useStore(getActivePage);
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const camera = useStore((s) => s.camera);
  const dirty = useStore((s) => s.dirty);
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const s = () => useStore.getState();

  const fitScale = canvasApi()?.fitScale() ?? 1;
  const zoomPct = Math.round((camera.scale / (fitScale || 1)) * 100);

  return (
    <div className="statusbar">
      <span className="mono">{TOOL_NAMES[tool] ?? tool}</span>
      <span className="sep" />
      <span>{page ? `${page.objects.length} objects` : '—'}</span>
      {selection.length > 0 && (
        <>
          <span className="sep" />
          <span style={{ color: 'var(--accent)' }}>{selection.length} selected</span>
        </>
      )}
      <span className="sep" />
      <button onClick={() => canvasApi()?.fit()} title="Fit map to screen (Ctrl+0)">
        <span className="mono">{Number.isFinite(zoomPct) ? zoomPct : 100}%</span>
      </button>

      <span className="spacer" />

      {project && (
        <>
          <button
            className={project.settings.snapToGrid ? '' : ''}
            title="Toggle snap to grid"
            onClick={() =>
              useStore.setState({
                project: { ...project, settings: { ...project.settings, snapToGrid: !project.settings.snapToGrid } },
                dirty: true,
              })
            }
          >
            <Grid3x3 size={12} color={project.settings.snapToGrid ? 'var(--accent)' : undefined} />
            Snap {project.settings.snapToGrid ? `${(project.settings.snapStep / 1000).toFixed(1)} km` : 'off'}
          </button>
          <span className="sep" />
        </>
      )}

      <button onClick={() => s().openModal('settings')} title="Storage location">
        <HardDrive size={12} />
        Local storage
      </button>
      <span className="sep" />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span className={`status-dot${dirty ? ' dirty' : ''}`} />
        {dirty ? 'Unsaved changes' : `Saved ${formatRelative(lastSavedAt)}`}
      </span>
      <button onClick={() => void s().saveProject()} disabled={!project} title="Save (Ctrl+S)">
        <Save size={12} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notes panel                                                         */
/* ------------------------------------------------------------------ */

export function NotesPanel() {
  const open = useStore((s) => s.notesOpen);
  const page = useStore(getActivePage);
  const s = () => useStore.getState();
  const [preview, setPreview] = useState(true);
  const [height, setHeight] = useState(190);

  if (!open || !page) return null;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev: MouseEvent) => setHeight(Math.max(90, Math.min(520, startH + (startY - ev.clientY))));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="notes-panel" style={{ height }}>
      <div
        style={{ height: 4, cursor: 'ns-resize', background: 'transparent', marginTop: -4 }}
        onMouseDown={startResize}
      />
      <div className="notes-toolbar">
        <strong style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-dim)' }}>
          Notes — {page.name}
        </strong>
        <span style={{ flex: 1 }} />
        <button className={`btn sm${preview ? ' primary' : ''}`} onClick={() => setPreview((v) => !v)}>
          <Eye size={11} /> Preview
        </button>
        <button className="btn sm ghost" onClick={() => s().toggleNotes()}>
          <X size={12} />
        </button>
      </div>
      <div className="notes-body" style={{ flex: 1 }}>
        <textarea
          value={page.notes}
          placeholder={
            '# Opening\n\n- DD spots enemy deployment\n- BB holds island\n- [ ] Radar cruiser moves into position\n- [x] Do not contest cap before enemy radar is identified'
          }
          onChange={(e) => s().setNotes(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {preview && <div className="notes-preview">{renderMarkdown(page.notes)}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Minimap                                                             */
/* ------------------------------------------------------------------ */

export function Minimap() {
  const project = useStore((s) => s.project);
  const page = useStore(getActivePage);
  const maps = useStore((s) => s.maps);
  const camera = useStore((s) => s.camera);
  const [host, setHost] = useState({ width: 0, height: 0 });

  const map = maps.find((m) => m.id === page?.mapId) ?? null;
  const image = useAsset('map', map?.file, map?.mime ?? '');

  useEffect(() => {
    const el = document.querySelector('.canvas-host') as HTMLElement | null;
    if (!el) return;
    const ro = new ResizeObserver(() => setHost({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setHost({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, [page?.id]);

  const worldW = map?.widthMeters ?? 30000;
  const worldH = map?.heightMeters ?? 30000;

  const ships = useMemo(
    () => (page?.objects.filter((o) => o.type === 'ship') ?? []) as ShipObject[],
    [page?.objects],
  );
  const teamColor = useMemo(() => new Map((project?.teams ?? []).map((t) => [t.id, t.color])), [project?.teams]);

  if (!project?.settings.showMinimap || !page) return null;

  const mmW = 168;
  const mmH = Math.round((mmW * worldH) / worldW);

  // Visible world rectangle, expressed in minimap pixels.
  const view = {
    x: (-camera.x / camera.scale / worldW) * mmW,
    y: (-camera.y / camera.scale / worldH) * mmH,
    w: (host.width / camera.scale / worldW) * mmW,
    h: (host.height / camera.scale / worldH) * mmH,
  };

  const jump = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const wx = ((e.clientX - rect.left) / rect.width) * worldW;
    const wy = ((e.clientY - rect.top) / rect.height) * worldH;
    canvasApi()?.centerOn({ x: wx, y: wy });
  };

  return (
    <div className="minimap" style={{ width: mmW }}>
      <svg viewBox={`0 0 ${mmW} ${mmH}`} height={mmH} onMouseDown={jump}>
        <rect x={0} y={0} width={mmW} height={mmH} fill="#0e1620" />
        {image && <image href={image.src} x={0} y={0} width={mmW} height={mmH} opacity={0.65} />}
        {ships.map((s) => (
          <circle
            key={s.id}
            cx={(s.x / worldW) * mmW}
            cy={(s.y / worldH) * mmH}
            r={2}
            fill={(s.teamId && teamColor.get(s.teamId)) || '#8b98a5'}
          />
        ))}
        <rect
          x={view.x}
          y={view.y}
          width={view.w}
          height={view.h}
          fill="rgba(78,163,255,0.10)"
          stroke="#4ea3ff"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
