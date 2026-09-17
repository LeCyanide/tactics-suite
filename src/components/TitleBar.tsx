import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Clapperboard, Crosshair, Map as MapIcon, Minus, Square, X, Copy as CopyIcon } from 'lucide-react';
import { TEST_BUILD_LABEL } from '@/lib/testBuild';
import { getActivePage, useStore } from '@/state/store';
import { useReplayStore } from '@/state/replay';

interface MenuEntry {
  label?: string;
  shortcut?: string;
  action?: () => void;
  enabled?: boolean;
  separator?: boolean;
  checked?: boolean;
}

export function TitleBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const project = useStore((s) => s.project);
  const page = useStore(getActivePage);
  const dirty = useStore((s) => s.dirty);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const selection = useStore((s) => s.selection);
  const clipboard = useStore((s) => s.clipboard);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const notesOpen = useStore((s) => s.notesOpen);
  const settings = useStore((s) => s.settings);

  useEffect(() => {
    void window.api.window.isMaximized().then(setMaximized);
    return window.api.window.onStateChange((s) => setMaximized(s.maximized));
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [openMenu]);

  const s = () => useStore.getState();
  const hasProject = !!project;

  const menus: Record<string, MenuEntry[]> = {
    File: [
      { label: 'New Project…', shortcut: 'Ctrl+N', action: () => s().openModal('newProject') },
      { label: 'Open Project…', shortcut: 'Ctrl+O', action: () => s().openModal('projects') },
      { separator: true },
      { label: 'Save', shortcut: 'Ctrl+S', action: () => void s().saveProject(), enabled: hasProject },
      { label: 'Save As…', action: () => s().openModal('newProject', { saveAs: true }), enabled: hasProject },
      { separator: true },
      { label: 'Import Project (.wowsplan)…', action: () => void s().importProject() },
      { label: 'Export Project (.wowsplan)…', action: () => void s().exportProject(), enabled: hasProject },
      { label: 'Export Image…', shortcut: 'Ctrl+E', action: () => s().openModal('export'), enabled: hasProject },
      { separator: true },
      { label: 'Backups…', action: () => s().openModal('backups'), enabled: hasProject },
      { separator: true },
      { label: 'Exit', action: () => window.api.window.close() },
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z', action: () => s().undo(), enabled: past > 0 },
      { label: 'Redo', shortcut: 'Ctrl+Y', action: () => s().redo(), enabled: future > 0 },
      { separator: true },
      { label: 'Copy', shortcut: 'Ctrl+C', action: () => s().copySelection(), enabled: selection.length > 0 },
      { label: 'Paste', shortcut: 'Ctrl+V', action: () => s().paste(), enabled: clipboard.length > 0 },
      { label: 'Duplicate', shortcut: 'Ctrl+D', action: () => s().duplicateSelection(), enabled: selection.length > 0 },
      { label: 'Delete', shortcut: 'Del', action: () => s().deleteSelection(), enabled: selection.length > 0 },
      { separator: true },
      {
        label: 'Select All',
        shortcut: 'Ctrl+A',
        action: () => {
          const p = getActivePage(s());
          if (p) s().select(p.objects.filter((o) => !o.locked).map((o) => o.id));
        },
        enabled: hasProject,
      },
      { label: 'Deselect', shortcut: 'Esc', action: () => s().clearSelection(), enabled: selection.length > 0 },
    ],
    View: [
      { label: 'Left Sidebar', checked: leftOpen, shortcut: 'Ctrl+B', action: () => s().toggleLeft() },
      { label: 'Right Sidebar', checked: rightOpen, shortcut: 'Ctrl+J', action: () => s().toggleRight() },
      { label: 'Notes Panel', checked: notesOpen, shortcut: 'Ctrl+K', action: () => s().toggleNotes() },
      { separator: true },
      {
        label: 'Grid',
        checked: page?.mapView.showGrid ?? false,
        action: () => page && s().patchMapView({ showGrid: !page.mapView.showGrid }),
        enabled: !!page,
      },
      {
        label: 'Coordinate Labels',
        checked: page?.mapView.showCoordinates ?? false,
        action: () => page && s().patchMapView({ showCoordinates: !page.mapView.showCoordinates }),
        enabled: !!page,
      },
    ],
    // Library and Help both collapsed into here: one place for everything that
    // is not about the document currently open.
    Settings: [
      { label: 'Preferences…', action: () => s().openModal('settings') },
      { separator: true },
      { label: 'Map Manager…', action: () => s().openModal('maps') },
      { label: 'Ship Database…', action: () => s().openModal('shipDb') },
      { separator: true },
      { label: 'Keyboard Shortcuts', shortcut: 'F1', action: () => s().openModal('shortcuts') },
      { label: 'Storage & About', action: () => s().openModal('settings') },
    ],
  };

  return (
    <div className="titlebar" ref={barRef}>
      <div className="brand">
        <Crosshair className="mark" size={15} />
        <span>WoWS Tactics Toolkit</span>
        {TEST_BUILD_LABEL && <span className="test-build">{TEST_BUILD_LABEL}</span>}
      </div>

      <div className="menus">
        {Object.entries(menus).map(([name, entries]) => (
          <div key={name} className={`menu-root${openMenu === name ? ' open' : ''}`}>
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                setOpenMenu(openMenu === name ? null : name);
              }}
              onMouseEnter={() => openMenu && setOpenMenu(name)}
            >
              {name}
            </button>
            {openMenu === name && (
              <div className="menu-pop">
                {entries.map((entry, i) =>
                  entry.separator ? (
                    <div key={i} className="menu-sep" />
                  ) : (
                    <button
                      key={i}
                      className="menu-item"
                      disabled={entry.enabled === false}
                      onClick={() => {
                        setOpenMenu(null);
                        entry.action?.();
                      }}
                    >
                      <span>
                        {entry.checked !== undefined && (
                          <span style={{ display: 'inline-block', width: 14, color: 'var(--accent)' }}>
                            {entry.checked ? '✓' : ''}
                          </span>
                        )}
                        {entry.label}
                      </span>
                      {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <ModeSwitch />

      <div className="title-center">
        {project ? (
          <>
            <span className="project-name">{project.name}</span>
            {page && <span>— {page.name}</span>}
            {dirty && <span className="dirty-dot" title="Unsaved changes" />}
          </>
        ) : (
          <span className="faint">No project open</span>
        )}
      </div>

      <div className="win-controls">
        <button onClick={() => window.api.window.minimize()} title="Minimize">
          <Minus size={14} />
        </button>
        <button onClick={() => window.api.window.maximize()} title={maximized ? 'Restore' : 'Maximize'}>
          {maximized ? <CopyIcon size={12} /> : <Square size={11} />}
        </button>
        <button className="close" onClick={() => window.api.window.close()} title="Close">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

/**
 * Tactics or Replay.
 *
 * Both modes share the map, the tool rail and the right sidebar; what changes
 * is the left sidebar and whether a replay is drawn over the plan. Replay mode
 * still needs a project open, because the map it draws on belongs to the page.
 */
function ModeSwitch() {
  const mode = useReplayStore((s) => s.mode);
  const setMode = useReplayStore((s) => s.setMode);
  const hasProject = useStore((s) => !!s.project);

  return (
    <div className="mode-switch">
      <button
        className={mode === 'tactics' ? 'active' : ''}
        onClick={() => setMode('tactics')}
        title="Plan on the map"
      >
        <MapIcon size={12} /> Tactics
      </button>
      <button
        className={mode === 'replay' ? 'active' : ''}
        onClick={() => setMode('replay')}
        disabled={!hasProject}
        title={hasProject ? 'Watch a replay on the map' : 'Open a project first'}
      >
        <Clapperboard size={12} /> Replay
      </button>
    </div>
  );
}

export function MenuSpacer(): ReactNode {
  return null;
}
