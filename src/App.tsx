import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { LeftRailToggle, LeftSidebar } from './components/LeftSidebar';
import { RightRailToggle, RightSidebar } from './components/RightSidebar';
import { ToolRail } from './components/ToolRail';
import { NotesPanel, PageTabs, StatusBar } from './components/Workspace';
import MapCanvas from './canvas/MapCanvas';
import { useStore } from './state/store';
import { useShortcuts } from './state/shortcuts';
import { BackupsModal, NewProjectModal, ProjectsModal } from './components/modals/ProjectModals';
import { MapManagerModal, ShipDatabaseModal } from './components/modals/LibraryModals';
import { ExportModal, SettingsModal, ShortcutsModal } from './components/modals/SystemModals';
import { preloadIcons } from './state/assets';
import { UpdateNotice } from './components/UpdateNotice';
import { ConfirmDialog } from './components/modals/ConfirmDialog';

export default function App() {
  const booted = useStore((s) => s.booted);
  const project = useStore((s) => s.project);
  const modal = useStore((s) => s.modal);
  const toasts = useStore((s) => s.toasts);
  const icons = useStore((s) => s.icons);

  useShortcuts();

  useEffect(() => {
    void useStore.getState().boot();
  }, []);

  // Warm the icon cache so ships do not pop in as the user pans around.
  useEffect(() => {
    if (icons.length) void preloadIcons(icons.map((i) => ({ file: i.file, mime: i.mime })));
  }, [icons]);

  // Flush pending work before the window goes away.
  useEffect(() => {
    const onBeforeUnload = () => {
      const s = useStore.getState();
      if (s.dirty && s.project) void window.api.projects.save(s.project);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <div className="app">
      <TitleBar />

      <div className="app-body">
        <LeftSidebar />

        <div className="workspace">
          {project ? (
            <>
              <PageTabs />
              <div className="canvas-wrap">
                <LeftRailToggle />
                <MapCanvas />
                <RightRailToggle />
                <ToolRail />
              </div>
              <NotesPanel />
            </>
          ) : (
            <WelcomeScreen booted={booted} />
          )}
        </div>

        <RightSidebar />
      </div>

      <StatusBar />

      {modal === 'projects' && <ProjectsModal />}
      {modal === 'newProject' && <NewProjectModal />}
      {modal === 'maps' && <MapManagerModal />}
      {modal === 'shipDb' && <ShipDatabaseModal />}
      {modal === 'export' && <ExportModal />}
      {modal === 'settings' && <SettingsModal />}
      {modal === 'shortcuts' && <ShortcutsModal />}
      {modal === 'backups' && <BackupsModal />}
      {/* After the other modals, so a question asked from one sits on top of it. */}
      <ConfirmDialog />

      <UpdateNotice />

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => useStore.getState().dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function WelcomeScreen({ booted }: { booted: boolean }) {
  const s = () => useStore.getState();
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        background:
          'radial-gradient(circle at 50% 40%, var(--canvas-void-hi) 0%, var(--canvas-void) 70%)',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 460 }}>
        <div style={{ fontSize: 17, fontWeight: 650, letterSpacing: '0.02em', marginBottom: 6 }}>
          WoWs Tactics Suite
        </div>
        <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.7, marginBottom: 18 }}>
          {booted
            ? 'Plan tactics on the real maps. Create a project to start, or open one you already have.'
            : 'Loading local storage…'}
        </div>
        {booted && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => s().openModal('newProject')}>
              New project
            </button>
            <button className="btn" onClick={() => s().openModal('projects')}>
              Open project
            </button>
            <button className="btn" onClick={() => void s().importProject()}>
              Import project…
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
