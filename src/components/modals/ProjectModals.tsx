import { useEffect, useState } from 'react';
import { Copy, FileDown, FileUp, FolderOpen, RefreshCw, Trash2 } from 'lucide-react';
import { useStore } from '@/state/store';
import { Modal } from '../common/ui';
import { formatBytes, formatDate, formatRelative } from '@/lib/util';
import { t, tn } from '@/i18n';

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
      title={t('Projects')}
      subtitle={t('Stored locally on this computer')}
      size="wide"
      onClose={() => (current ? s().closeModal() : undefined)}
      headerExtra={
        <button className="icon-btn" title={t('Refresh')} onClick={() => void s().refreshProjects()}>
          <RefreshCw size={13} />
        </button>
      }
      footer={
        <>
          <button className="btn primary" onClick={() => s().openModal('newProject')}>
            {t('New project')}
          </button>
          <button className="btn" onClick={() => void s().importProject()}>
            <FileUp size={13} /> {t('Import project…')}
          </button>
          <span className="spacer" />
          {current && (
            <button className="btn ghost" onClick={() => s().closeModal()}>
              {t('Close')}
            </button>
          )}
        </>
      }
    >
      {projects.length === 0 ? (
        <div className="empty-note" style={{ padding: 40 }}>
          {t('No projects yet.')}
          <br />
          {t('Create one to start planning, or import a .wowsplan file from another machine.')}
        </div>
      ) : (
        <div className="card-grid">
          {projects.map((p) => (
            <div key={p.id} className={`card${current?.id === p.id ? ' selected' : ''}`}>
              <div className="card-title">{p.name}</div>
              <div className="card-sub">
                {tn(p.pageCount, '{n} page', '{n} pages')} · {formatBytes(p.sizeBytes)} ·{' '}
                {formatRelative(p.updatedAt)}
              </div>
              <div className="card-sub faint" style={{ fontSize: 10 }}>
                {t('created {date}', { date: formatDate(p.createdAt) })}
              </div>
              <div className="card-actions">
                <button className="btn sm primary" style={{ flex: 1 }} onClick={() => void s().openProject(p.id)}>
                  <FolderOpen size={12} /> {t('Open')}
                </button>
                <button className="btn sm" title={t('Duplicate')} onClick={() => void s().duplicateProject(p.id)}>
                  <Copy size={12} />
                </button>
                <button className="btn sm danger" title={t('Delete')} onClick={() => void s().deleteProject(p.id)}>
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

  const [name, setName] = useState(saveAs ? t('{name} (copy)', { name: current?.name ?? t('Project') }) : 'tactics-planner');

  const submit = async () => {
    const trimmed = name.trim() || t('Untitled project');
    if (saveAs) await s().saveProjectAs(trimmed);
    else await s().newProject(trimmed);
    s().closeModal();
  };

  return (
    <Modal
      title={saveAs ? t('Save Project As') : t('New Project')}
      size="narrow"
      onClose={() => s().closeModal()}
      footer={
        <>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => s().closeModal()}>
            {t('Cancel')}
          </button>
          <button className="btn primary" onClick={() => void submit()}>
            {saveAs ? t('Save copy') : t('Create')}
          </button>
        </>
      }
    >
      <label className="section-label">{t('Project name')}</label>
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
      title={t('Backups')}
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
              s().toast(t('Backup created'), 'success');
            }}
          >
            <FileDown size={13} /> {t('Create backup now')}
          </button>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => s().closeModal()}>
            {t('Close')}
          </button>
        </>
      }
    >
      <div className="faint" style={{ fontSize: 11.5, marginBottom: 8, lineHeight: 1.5 }}>
        A backup is written on every save (last {s().settings.maxBackupsPerProject} kept). Restoring opens it as a new
        project; the current one is never overwritten.
      </div>
      {rows.length === 0 ? (
        <div className="empty-note">{t('No backups yet.')}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('Created')}</th>
              <th>{t('Size')}</th>
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
                      s().toast(t('Backup restored as a new project'), 'success');
                    }}
                  >
                    {t('Restore')}
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
