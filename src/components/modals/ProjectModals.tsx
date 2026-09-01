import { useEffect, useState } from 'react';
import { Copy, FileDown, FileUp, FolderOpen, RefreshCw, Trash2 } from 'lucide-react';
import { useStore } from '@/state/store';
import { Modal } from '../common/ui';
import { formatBytes, formatDate, formatRelative } from '@/lib/util';

export function ProjectsModal() {
  const projects = useStore((s) => s.projectList);
  const current = useStore((s) => s.project);
  const s = () => useStore.getState();

  useEffect(() => {
    void s().refreshProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal
      title="Projects"
      subtitle="Stored locally on this computer"
      size="wide"
      onClose={() => (current ? s().closeModal() : undefined)}
      headerExtra={
        <button className="icon-btn" title="Refresh" onClick={() => void s().refreshProjects()}>
          <RefreshCw size={13} />
        </button>
      }
      footer={
        <>
          <button className="btn primary" onClick={() => s().openModal('newProject')}>
            New Project
          </button>
          <button className="btn" onClick={() => void s().importProject()}>
            <FileUp size={13} /> Import .wowsplan
          </button>
          <span className="spacer" />
          {current && (
            <button className="btn ghost" onClick={() => s().closeModal()}>
              Close
            </button>
          )}
        </>
      }
    >
      {projects.length === 0 ? (
        <div className="empty-note" style={{ padding: 40 }}>
          No projects yet.
          <br />
          Create one to start planning, or import a <span className="mono">.wowsplan</span> file from another machine.
        </div>
      ) : (
        <div className="card-grid">
          {projects.map((p) => (
            <div key={p.id} className={`card${current?.id === p.id ? ' selected' : ''}`}>
              <div className="card-title">{p.name}</div>
              <div className="card-sub">
                {p.pageCount} page{p.pageCount === 1 ? '' : 's'} · {formatBytes(p.sizeBytes)} ·{' '}
                {formatRelative(p.updatedAt)}
              </div>
              <div className="card-sub faint" style={{ fontSize: 10 }}>
                created {formatDate(p.createdAt)}
              </div>
              <div className="card-actions">
                <button className="btn sm primary" style={{ flex: 1 }} onClick={() => void s().openProject(p.id)}>
                  <FolderOpen size={12} /> Open
                </button>
                <button className="btn sm" title="Duplicate" onClick={() => void s().duplicateProject(p.id)}>
                  <Copy size={12} />
                </button>
                <button className="btn sm danger" title="Delete" onClick={() => void s().deleteProject(p.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function NewProjectModal() {
  const arg = useStore((s) => s.modalArg) as { saveAs?: boolean } | null;
  const current = useStore((s) => s.project);
  const s = () => useStore.getState();
  const saveAs = !!arg?.saveAs;

  const [name, setName] = useState(saveAs ? `${current?.name ?? 'Project'} (copy)` : 'tactics-planner');

  const submit = async () => {
    const trimmed = name.trim() || 'Untitled Project';
    if (saveAs) await s().saveProjectAs(trimmed);
    else await s().newProject(trimmed);
    s().closeModal();
  };

  return (
    <Modal
      title={saveAs ? 'Save Project As' : 'New Project'}
      size="narrow"
      onClose={() => s().closeModal()}
      footer={
        <>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => s().closeModal()}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void submit()}>
            {saveAs ? 'Save Copy' : 'Create'}
          </button>
        </>
      }
    >
      <label className="section-label">Project name</label>
      <input
        type="text"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') void submit();
        }}
      />

    </Modal>
  );
}

export function BackupsModal() {
  const project = useStore((s) => s.project);
  const s = () => useStore.getState();
  const [rows, setRows] = useState<{ file: string; name: string; size: number; mtime: number }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!project) return;
    setRows(await window.api.projects.backups(project.id));
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  if (!project) return null;

  return (
    <Modal
      title="Backups"
      subtitle={project.name}
      onClose={() => s().closeModal()}
      footer={
        <>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await window.api.projects.backup(project.id, s().settings.maxBackupsPerProject);
              await load();
              setBusy(false);
              s().toast('Backup created', 'success');
            }}
          >
            <FileDown size={13} /> Create backup now
          </button>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => s().closeModal()}>
            Close
          </button>
        </>
      }
    >
      <div className="faint" style={{ fontSize: 11.5, marginBottom: 8, lineHeight: 1.5 }}>
        A backup is written every time you save (up to {s().settings.maxBackupsPerProject} kept). Restoring imports the
        backup as a separate project, so the current one is never overwritten.
      </div>
      {rows.length === 0 ? (
        <div className="empty-note">No backups yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Size</th>
              <th style={{ width: 100 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.file}>
                <td>{formatDate(r.mtime)}</td>
                <td className="num">{formatBytes(r.size)}</td>
                <td>
                  <button
                    className="btn sm"
                    onClick={async () => {
                      const doc = await window.api.projects.restoreBackup(r.file);
                      await s().refreshProjects();
                      if (doc?.id) await s().openProject(doc.id);
                      s().toast('Backup restored as a new project', 'success');
                    }}
                  >
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
