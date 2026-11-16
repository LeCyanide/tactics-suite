import { useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { formatBytes } from '@/lib/util';
import { restartToUpdate, useUpdateState } from '@/state/updates';
import { t } from '@/i18n';

/**
 * Asks before downloading a new version, then shows progress and offers the
 * restart. "Later" hides it for this session; the next launch asks again.
 */
export function UpdateNotice() {
  const state = useUpdateState();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [engaged, setEngaged] = useState(false);

  const key = `${state.status}:${'version' in state ? state.version : ''}`;
  if (dismissed === key) return null;
  const later = () => setDismissed(key);

  if (state.status === 'available') {
    return (
      <div className="update-notice">
        <div className="update-notice-head">
          <Download size={14} />
          <strong>{t('Version {version} is available', { version: state.version })}</strong>
          <button className="icon-btn" title={t('Later')} onClick={later}>
            <X size={13} />
          </button>
        </div>
        <div className="faint">
          {state.size
            ? t('Download it now ({size})? You can keep working while it downloads.', { size: formatBytes(state.size) })
            : t('Download it now? You can keep working while it downloads.')}
        </div>
        <div className="update-notice-actions">
          <button className="btn sm ghost" onClick={later}>
            {t('Later')}
          </button>
          <button
            className="btn sm primary"
            onClick={() => {
              setEngaged(true);
              void window.api.updates.download();
            }}
          >
            {t('Download')}
          </button>
        </div>
      </div>
    );
  }

  if (state.status === 'downloading') {
    return (
      <div className="update-notice">
        <div className="update-notice-head">
          <Download size={14} />
          <strong>{t('Downloading {version}…', { version: state.version })}</strong>
        </div>
        <div className="update-progress">
          <div style={{ width: `${Math.min(100, state.percent)}%` }} />
        </div>
      </div>
    );
  }

  if (state.status === 'ready') {
    return (
      <div className="update-notice">
        <div className="update-notice-head">
          <RefreshCw size={14} />
          <strong>{t('Version {version} is ready', { version: state.version })}</strong>
          <button className="icon-btn" title={t('Later')} onClick={later}>
            <X size={13} />
          </button>
        </div>
        <div className="faint">{t('Restart now to finish updating. Your project is saved first.')}</div>
        <div className="update-notice-actions">
          <button className="btn sm ghost" onClick={later}>
            {t('Later')}
          </button>
          <button className="btn sm primary" onClick={() => void restartToUpdate()}>
            {t('Restart')}
          </button>
        </div>
      </div>
    );
  }

  if (state.status === 'error' && engaged) {
    return (
      <div className="update-notice error">
        <div className="update-notice-head">
          <strong>{t('Update failed')}</strong>
          <button className="icon-btn" title={t('Dismiss')} onClick={later}>
            <X size={13} />
          </button>
        </div>
        <div className="faint">{t(state.message)}</div>
      </div>
    );
  }

  return null;
}
