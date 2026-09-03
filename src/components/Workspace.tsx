import { useState } from 'react';
import { Copy, Eye, Grid3x3, HardDrive, Plus, Save, X } from 'lucide-react';
import { getActivePage, useStore } from '@/state/store';
import { InlineEdit, Tip } from './common/ui';
import { renderMarkdown } from '@/lib/markdown';
import { formatRelative } from '@/lib/util';

/* ------------------------------------------------------------------ */
/* Page tabs                                                           */
/* ------------------------------------------------------------------ */

export function PageTabs() {
  const project = useStore((s) => s.project);
  const s = () => useStore.getState();
  // Index the drag is currently hovering, so the gap shows where it will land.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (!project) return null;

  const endDrag = () => {
    setDragId(null);
    setOverIndex(null);
  };

  return (
    <div className="page-tabs" onDragLeave={() => setOverIndex(null)}>
      {project.pages.map((page, i) => (
        <div
          key={page.id}
          className={
            `page-tab${page.id === project.activePageId ? ' active' : ''}` +
            `${dragId === page.id ? ' dragging' : ''}` +
            `${overIndex === i && dragId && dragId !== page.id ? ' drop-target' : ''}`
          }
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
            if (dragId && dragId !== page.id) s().movePageTo(dragId, i);
            endDrag();
          }}
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
            'Placeholder text for notes. You can use Markdown formatting here, and it will be rendered in the preview.'
          }
          onChange={(e) => s().setNotes(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {preview && <div className="notes-preview">{renderMarkdown(page.notes)}</div>}
      </div>
    </div>
  );
}
