import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  Copy,
  Database,
  Eye,
  EyeOff,
  FolderOpen,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Map as MapIcon,
  Plus,
  Save,
  Search,
  Settings,
  StickyNote,
  Trash2,
  Users,
} from 'lucide-react';
import { getActivePage, useStore } from '@/state/store';
import { Check, ColorInput, Field, InlineEdit, Panel, Slider, Tip } from './common/ui';
import { CLASS_COLORS } from '@/canvas/shipGlyphs';
import { LAYER_IDS, SHIP_CLASSES, shipClassCode, type ShipClass, type ID } from '@/types/model';
import { useAsset } from '@/state/assets';
import { canvasApi } from '@/canvas/canvasBridge';
import { formatRelative } from '@/lib/util';
import { renderMarkdown } from '@/lib/markdown';
import { ClassIcon } from './common/ClassIcon';

export function LeftSidebar() {
  const open = useStore((s) => s.leftOpen);
  const width = useStore((s) => s.settings.leftSidebarWidth);
  const patchSettings = useStore((s) => s.patchSettings);
  const resizing = useRef(false);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const move = (ev: MouseEvent) => {
      if (!resizing.current) return;
      patchSettings({ leftSidebarWidth: Math.max(210, Math.min(460, ev.clientX)) });
    };
    const up = () => {
      resizing.current = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!open) return null;

  return (
    <div className="sidebar left" style={{ width }}>
      <div className="sidebar-resizer" onMouseDown={startResize} />
      <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        <ProjectPanel />
        <ShipBrowserPanel />
        <PagesPanel />
        <MapPanel />
        <TeamsPanel />
        <LayersPanel />
        <NotesPreviewPanel />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ProjectPanel() {
  const project = useStore((s) => s.project);
  const dirty = useStore((s) => s.dirty);
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const s = () => useStore.getState();

  return (
    <Panel
      title="Project"
      storageKey="project"
      actions={
        <>
          <Tip label="Open project" side="bottom">
            <button className="icon-btn" onClick={() => s().openModal('projects')}>
              <FolderOpen size={13} />
            </button>
          </Tip>
          <Tip label="New project" side="bottom">
            <button className="icon-btn" onClick={() => s().openModal('newProject')}>
              <Plus size={14} />
            </button>
          </Tip>
          <Tip label="Save project" shortcut="Ctrl+S" side="bottom">
            <button className="icon-btn" disabled={!project} onClick={() => void s().saveProject()}>
              <Save size={13} />
            </button>
          </Tip>
        </>
      }
    >
      {project ? (
        <>
          <div style={{ padding: '2px 2px 6px' }}>
            <InlineEdit
              value={project.name}
              onCommit={(v) => void s().renameProject(project.id, v)}
              className="row-label"
            />
            <div className="faint mono" style={{ fontSize: 10.5, marginTop: 2 }}>
              {project.pages.length} pages · {dirty ? 'unsaved' : `saved ${formatRelative(lastSavedAt)}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn sm" style={{ flex: 1 }} onClick={() => void s().exportProject()}>
              Export
            </button>
            <button className="btn sm" style={{ flex: 1 }} onClick={() => void s().importProject()}>
              Import
            </button>
            <Tip label="Settings" side="bottom">
              <button className="btn sm" onClick={() => s().openModal('settings')}>
                <Settings size={12} />
              </button>
            </Tip>
          </div>
        </>
      ) : (
        <div className="empty-note">No project open.</div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function PagesPanel() {
  const project = useStore((s) => s.project);
  const s = () => useStore.getState();
  if (!project) return null;

  return (
    <Panel
      title="Tactical Pages"
      count={project.pages.length}
      storageKey="pages"
      actions={
        <Tip label="Add page" side="bottom">
          <button className="icon-btn" onClick={() => s().addPage()}>
            <Plus size={14} />
          </button>
        </Tip>
      }
      flush
    >
      <div style={{ padding: '2px 4px' }}>
        {project.pages.map((page, i) => (
          <div
            key={page.id}
            className={`row${page.id === project.activePageId ? ' active' : ''}`}
            onClick={() => s().setActivePage(page.id)}
          >
            <span className="idx">{String(i + 1).padStart(2, '0')}</span>
            <InlineEdit value={page.name} onCommit={(v) => s().renamePage(page.id, v)} className="row-label" />
            <div className="row-actions">
              <button className="icon-btn" title="Move up" onClick={(e) => { e.stopPropagation(); s().reorderPage(page.id, -1); }}>
                <ArrowUp size={11} />
              </button>
              <button className="icon-btn" title="Move down" onClick={(e) => { e.stopPropagation(); s().reorderPage(page.id, 1); }}>
                <ArrowDown size={11} />
              </button>
              <button className="icon-btn" title="Duplicate" onClick={(e) => { e.stopPropagation(); s().duplicatePage(page.id); }}>
                <Copy size={11} />
              </button>
              <button
                className="icon-btn danger"
                title="Delete page"
                onClick={(e) => { e.stopPropagation(); s().deletePage(page.id); }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function MapPanel() {
  const page = useStore(getActivePage);
  const maps = useStore((s) => s.maps);
  const s = () => useStore.getState();
  if (!page) return null;

  const map = maps.find((m) => m.id === page.mapId) ?? null;

  return (
    <Panel
      title="Map"
      storageKey="map"
      actions={
        <>
          <Tip label="Import map image" side="bottom">
            <button className="icon-btn" onClick={() => void s().importMaps()}>
              <ImageIcon size={13} />
            </button>
          </Tip>
          <Tip label="Map manager" side="bottom">
            <button className="icon-btn" onClick={() => s().openModal('maps')}>
              <MapIcon size={13} />
            </button>
          </Tip>
        </>
      }
    >
      <select value={page.mapId ?? ''} onChange={(e) => s().setPageMap(e.target.value || null)}>
        <option value="">— No map —</option>
        {maps.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      {map && (
        <div className="faint mono" style={{ fontSize: 10.5, margin: '5px 2px' }}>
          {(map.widthMeters / 1000).toFixed(0)} × {(map.heightMeters / 1000).toFixed(0)} km · grid{' '}
          {page.mapView.gridCols ?? map.gridCols} × {page.mapView.gridRows ?? map.gridRows}
        </div>
      )}

      <div style={{ marginTop: 4 }}>
        <Check label="Grid" checked={page.mapView.showGrid} onChange={(v) => s().patchMapView({ showGrid: v })} />
        <Check
          label="Coordinate labels"
          checked={page.mapView.showCoordinates}
          onChange={(v) => s().patchMapView({ showCoordinates: v })}
        />
        <Check label="Map border" checked={page.mapView.showBorder} onChange={(v) => s().patchMapView({ showBorder: v })} />
      </div>

      <Field label="Grid opacity">
        <Slider value={page.mapView.gridOpacity} onChange={(v) => s().patchMapView({ gridOpacity: v })} />
      </Field>
      <Field label="Map opacity">
        <Slider value={page.mapView.mapOpacity} onChange={(v) => s().patchMapView({ mapOpacity: v })} />
      </Field>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function ShipBrowserPanel() {
  const ships = useStore((s) => s.ships);
  const icons = useStore((s) => s.icons);
  const project = useStore((s) => s.project);
  const [query, setQuery] = useState('');
  const [nation, setNation] = useState('');
  const [cls, setCls] = useState<'' | ShipClass>('');
  const [tier, setTier] = useState('');
  const [team, setTeam] = useState<ID | ''>('');
  const s = () => useStore.getState();

  const nations = useMemo(() => [...new Set(ships.map((x) => x.nation))].sort(), [ships]);
  const tiers = useMemo(() => [...new Set(ships.map((x) => x.tier))].sort((a, b) => b - a), [ships]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ships.filter(
      (ship) =>
        (!q || ship.name.toLowerCase().includes(q) || ship.nation.toLowerCase().includes(q)) &&
        (!nation || ship.nation === nation) &&
        (!cls || ship.class === cls) &&
        (!tier || String(ship.tier) === tier),
    );
  }, [ships, query, nation, cls, tier]);

  const teamId = team || project?.settings.defaultTeamId || project?.teams[0]?.id || null;
  const iconById = useMemo(() => new Map(icons.map((i) => [i.id, i])), [icons]);

  return (
    <Panel
      title="Ships"
      count={`${filtered.length}/${ships.length}`}
      storageKey="ships"
      grow
      actions={
        <Tip label="Open ship database — add, edit and assign icons" side="bottom">
          <button className="icon-btn" onClick={() => s().openModal('shipDb')}>
            <Database size={13} />
          </button>
        </Tip>
      }
    >
      {ships.length === 0 ? (
        <div className="empty-note">
          No ships yet.
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <button className="btn sm block" onClick={() => void s().importShipData()}>
              Import ship data…
            </button>
            <button className="btn sm block ghost" onClick={() => void s().loadSampleShips()}>
              Load sample ship set
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ position: 'relative', marginBottom: 4 }}>
            <Search size={12} style={{ position: 'absolute', left: 7, top: 6, color: 'var(--fg-faint)' }} />
            <input
              type="search"
              placeholder="Search ships…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: 24 }}
            />
          </div>

          <div className="ship-filters">
            <select value={nation} onChange={(e) => setNation(e.target.value)}>
              <option value="">Nation</option>
              {nations.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <select value={cls} onChange={(e) => setCls(e.target.value as ShipClass | '')}>
              <option value="">Class</option>
              {SHIP_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">Tier</option>
              {tiers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {project && project.teams.length > 0 && (
            <select value={team} onChange={(e) => setTeam(e.target.value)} style={{ marginBottom: 5 }}>
              <option value="">Place on default team</option>
              {project.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  Place on {t.name}
                </option>
              ))}
            </select>
          )}

          <div className="ship-list">
            {filtered.map((ship) => {
              const iconAsset = ship.iconId ? iconById.get(ship.iconId) : undefined;
              return (
                <div
                  key={ship.id}
                  className="ship-item"
                  draggable
                  title="Drag onto the map, or double-click to place at the centre"
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-wows-ship', ship.id);
                    if (teamId) e.dataTransfer.setData('application/x-wows-team', teamId);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onDoubleClick={() => {
                    const api = canvasApi();
                    if (!api) return;
                    const centre = api.screenToWorld({
                      x: (document.querySelector('.canvas-host')?.clientWidth ?? 800) / 2,
                      y: (document.querySelector('.canvas-host')?.clientHeight ?? 600) / 2,
                    });
                    s().placeShip(ship.id, centre, teamId);
                  }}
                >
                  <ShipThumb file={iconAsset?.file} mime={iconAsset?.mime} cls={ship.class} />
                  <div className="ship-meta">
                    <div className="ship-name">{ship.name}</div>
                    <div className="ship-sub">{ship.nation}</div>
                  </div>
                  <span className="class-chip" style={{ background: `${CLASS_COLORS[ship.class]}22`, color: CLASS_COLORS[ship.class] }}>
                    {shipClassCode(ship)}
                  </span>
                  <span className="tier-chip">{ship.tier}</span>
                </div>
              );
            })}
            {!filtered.length && <div className="empty-note">No ships match those filters.</div>}
          </div>
        </>
      )}
    </Panel>
  );
}

function ShipThumb({ file, mime, cls }: { file?: string; mime?: string; cls: ShipClass }) {
  const img = useAsset('icon', file, mime ?? '');
  return (
    <div className="ship-icon">
      {img ? <img src={img.src} alt="" /> : <ClassIcon cls={cls} size={19} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TeamsPanel() {
  const project = useStore((s) => s.project);
  const page = useStore(getActivePage);
  const s = () => useStore.getState();
  if (!project) return null;

  const countFor = (teamId: ID) =>
    page?.objects.filter((o) => o.type === 'ship' && (o as { teamId?: ID }).teamId === teamId).length ?? 0;

  return (
    <Panel
      title="Teams"
      count={project.teams.length}
      storageKey="teams"
      actions={
        <Tip label="Add team" side="bottom">
          <button className="icon-btn" onClick={() => s().addTeam()}>
            <Plus size={14} />
          </button>
        </Tip>
      }
      flush
    >
      <div style={{ padding: '2px 4px' }}>
        {project.teams.map((team) => (
          <div key={team.id} className={`row${project.settings.defaultTeamId === team.id ? ' active' : ''}`}>
            <input
              type="color"
              value={team.color}
              style={{ width: 16, height: 16 }}
              onChange={(e) => s().updateTeam(team.id, { color: e.target.value })}
              title="Team colour"
            />
            <InlineEdit value={team.name} onCommit={(v) => s().updateTeam(team.id, { name: v })} className="row-label" />
            <span className="count mono">{countFor(team.id)}</span>
            <button
              className="icon-btn"
              title={team.visible ? 'Hide team' : 'Show team'}
              onClick={() => s().updateTeam(team.id, { visible: !team.visible })}
            >
              {team.visible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
            <button
              className="icon-btn"
              title={team.locked ? 'Unlock team' : 'Lock team'}
              onClick={() => s().updateTeam(team.id, { locked: !team.locked })}
            >
              {team.locked ? <Lock size={12} /> : <LockOpen size={12} />}
            </button>
            <div className="row-actions">
              <Tip label="Make default for new ships" side="bottom">
                <button
                  className="icon-btn"
                  onClick={() =>
                    useStore.setState({
                      project: { ...project, settings: { ...project.settings, defaultTeamId: team.id } },
                      dirty: true,
                    })
                  }
                >
                  <Users size={11} />
                </button>
              </Tip>
              <button className="icon-btn danger" title="Delete team" onClick={() => s().removeTeam(team.id)}>
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function LayersPanel() {
  const page = useStore(getActivePage);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const s = () => useStore.getState();
  if (!page) return null;

  // Displayed top-to-bottom, which is the reverse of paint order.
  const ordered = [...page.layers].reverse();

  return (
    <Panel
      title="Layers"
      count={page.layers.length}
      storageKey="layers"
      actions={
        <Tip label="Add layer" side="bottom">
          <button className="icon-btn" onClick={() => s().addLayer()}>
            <Plus size={14} />
          </button>
        </Tip>
      }
      flush
    >
      <div style={{ padding: '2px 4px' }}>
        {ordered.map((layer) => {
          const count = page.objects.filter((o) => o.layerId === layer.id).length;
          return (
            <div
              key={layer.id}
              className={`row layer-row${layer.id === activeLayerId ? ' active' : ''}`}
              onClick={() => s().setActiveLayer(layer.id)}
              title={
                layer.id === LAYER_IDS.grid
                  ? 'Background grid and coordinates — cannot hold objects'
                  : layer.system
                    ? 'System layer'
                    : 'Custom layer'
              }
              style={layer.id === LAYER_IDS.grid ? { opacity: 0.72 } : undefined}
            >
              <button
                className="icon-btn"
                title={layer.visible ? 'Hide layer' : 'Show layer'}
                onClick={(e) => {
                  e.stopPropagation();
                  s().updateLayer(layer.id, { visible: !layer.visible });
                }}
              >
                {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button
                className="icon-btn"
                title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                onClick={(e) => {
                  e.stopPropagation();
                  s().updateLayer(layer.id, { locked: !layer.locked });
                }}
              >
                {layer.locked ? <Lock size={12} /> : <LockOpen size={12} />}
              </button>
              <InlineEdit value={layer.name} onCommit={(v) => s().updateLayer(layer.id, { name: v })} className="row-label" />
              {count > 0 && <span className="count mono">{count}</span>}
              <div className="row-actions">
                <button className="icon-btn" title="Move up" onClick={(e) => { e.stopPropagation(); s().reorderLayer(layer.id, 1); }}>
                  <ArrowUp size={11} />
                </button>
                <button className="icon-btn" title="Move down" onClick={(e) => { e.stopPropagation(); s().reorderLayer(layer.id, -1); }}>
                  <ArrowDown size={11} />
                </button>
                {!layer.system && (
                  <button className="icon-btn danger" title="Delete layer" onClick={(e) => { e.stopPropagation(); s().removeLayer(layer.id); }}>
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {(() => {
        const layer = page.layers.find((l) => l.id === activeLayerId);
        if (!layer) return null;
        return (
          <div style={{ padding: '4px 8px 2px' }}>
            <Field label="Opacity">
              <Slider value={layer.opacity} onChange={(v) => s().updateLayer(layer.id, { opacity: v })} />
            </Field>
          </div>
        );
      })()}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function NotesPreviewPanel() {
  const page = useStore(getActivePage);
  const notesOpen = useStore((s) => s.notesOpen);
  const s = () => useStore.getState();
  if (!page) return null;

  return (
    <Panel
      title="Notes"
      storageKey="notes"
      actions={
        <Tip label={notesOpen ? 'Close notes editor' : 'Open notes editor'} shortcut="Ctrl+K" side="bottom">
          <button className={`icon-btn${notesOpen ? ' active' : ''}`} onClick={() => s().toggleNotes()}>
            <StickyNote size={13} />
          </button>
        </Tip>
      }
    >
      {page.notes.trim() ? (
        <div className="notes-preview" style={{ border: 0, padding: '2px 2px 4px', maxHeight: 220 }}>
          {renderMarkdown(page.notes)}
        </div>
      ) : (
        <div className="empty-note">
          No notes on this page.
          <div style={{ marginTop: 8 }}>
            <button className="btn sm block" onClick={() => s().toggleNotes()}>
              Write notes
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function LeftRailToggle() {
  const open = useStore((s) => s.leftOpen);
  const toggle = useStore((s) => s.toggleLeft);
  if (open) return null;
  return (
    <button className="rail-toggle left" onClick={toggle} title="Show left sidebar (Ctrl+B)">
      <ChevronLeft size={11} style={{ transform: 'rotate(180deg)' }} />
    </button>
  );
}
