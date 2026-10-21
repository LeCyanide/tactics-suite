import { useEffect, useMemo, useState } from 'react';
import { Eye, Grid3x3, HardDrive, ListX, Plus, Save, X } from 'lucide-react';
import { getActivePage, useStore } from '@/state/store';
import { loadAsset } from '@/state/assets';
import { folderNameOf } from '@/lib/pageTree';
import { InlineEdit, Tip } from './common/ui';
import { RulesetFlag } from './common/RulesetFlag';
import { renderMarkdown } from '@/lib/markdown';
import { formatRelative } from '@/lib/util';

/* ------------------------------------------------------------------ */
/* Page tabs                                                           */
/* ------------------------------------------------------------------ */

export function PageTabs() {
  const project = useStore((s) => s.project);
  const maps = useStore((s) => s.maps);
  const s = () => useStore.getState();
  // Index the drag is currently hovering, so the gap shows where it will land.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const tabs = useMemo(() => {
    if (!project) return [];
    const byId = new Map(project.pages.map((p) => [p.id, p]));
    return project.openPageIds.flatMap((id) => byId.get(id) ?? []);
  }, [project]);

  // Tabs are for switching quickly, so the boards behind them are decoded
  // before they are asked for. The cache keeps them for the session.
  // Keyed on the files as a string, since the list is rebuilt on every render.
  const mapFiles = tabs.flatMap((p) => maps.find((m) => m.id === p.mapId && m.file) ?? []);
  const mapKey = mapFiles.map((m) => `${m.file}\n${m.mime}`).join('\n');
  useEffect(() => {
    for (const map of mapFiles) void loadAsset('map', map.file, map.mime);
  }, [mapKey]);

  if (!project) return null;

  const endDrag = () => {
    setDragId(null);
    setOverIndex(null);
  };

  return (
    <div className="page-tabs" onDragLeave={() => setOverIndex(null)}>
      {/* Tabs keep their full names until the bar is full; only then do they shrink, ending in "…". */}
      <div className="page-tabs-list">
      {tabs.map((page, i) => {
        const folder = folderNameOf(project, page);
        return (
          <div
            key={page.id}
            className={
              `page-tab${page.id === project.activePageId ? ' active' : ''}` +
              `${dragId === page.id ? ' dragging' : ''}` +
              `${overIndex === i && dragId && dragId !== page.id ? ' drop-target' : ''}`
            }
            title={folder !== null ? `${folder} – ${page.name}` : page.name}
            draggable
            onDragStart={(e) => {
              setDragId(page.id);
              e.dataTransfer.effectAllowed = 'move';
              // Firefox refuses to start a drag without payload.
              e.dataTransfer.setData('text/plain', page.id);
            }}
            onDragEnd={endDrag}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOverIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dragId !== page.id) s().moveTab(dragId, i);
              endDrag();
            }}
            onMouseDown={(e) => e.button === 0 && s().setActivePage(page.id)}
            onAuxClick={(e) => {
              if (e.button === 1) s().closeTab(page.id);
            }}
          >
            {folder !== null && <span className="tab-folder">{folder} –</span>}
            <InlineEdit className="tab-name" value={page.name} onCommit={(v) => s().renamePage(page.id, v)} />
            <RulesetFlag page={page} />
            {tabs.length > 1 && (
              <span
                className="tab-close"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  s().closeTab(page.id);
                }}
                title="Close tab (the page stays in the project)"
              >
                <X size={10} />
              </span>
            )}
          </div>
        );
      })}
      </div>
      <Tip label="New page" side="bottom">
        <button className="page-tab-add" onClick={() => s().addPage()}>
          <Plus size={14} />
        </button>
      </Tip>
      <span className="page-tabs-spacer" />
      {tabs.length > 1 && (
        <Tip label="Multi-close all pages" side="bottom">
          <button className="page-tab-add" onClick={() => s().closeOtherTabs()}>
            <ListX size={14} />
          </button>
        </Tip>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status bar                                                          */
/* ------------------------------------------------------------------ */

const TOOL_NAMES: Record<string, string> = {
  select: 'Select', marquee: 'Multi-select', freehand: 'Freehand', line: 'Line', arrow: 'Arrow',
  doubleArrow: 'Double arrow', curvedArrow: 'Curved arrow', rect: 'Rectangle', roundRect: 'Rounded rectangle',
  circle: 'Circle', polygon: 'Polygon', text: 'Text', number: 'Number',
  marker: 'Marker', ruler: 'Ruler', area: 'Area',
};

export function StatusBar() {
  const tool = useStore((s) => s.tool);
  const page = useStore(getActivePage);
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const dirty = useStore((s) => s.dirty);
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const s = () => useStore.getState();

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
      <button className="save-btn" onClick={() => void s().saveProject()} disabled={!project} title="Save (Ctrl+S)">
        <Save size={14} />
        Save
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
            'Notes for this page. Markdown is supported.'
          }
          onChange={(e) => s().setNotes(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {preview && <div className="notes-preview">{renderMarkdown(page.notes)}</div>}
      </div>
    </div>
  );
}
