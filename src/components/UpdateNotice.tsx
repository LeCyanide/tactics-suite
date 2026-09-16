import { useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { formatBytes } from '@/lib/util';
import { restartToUpdate, useUpdateState } from '@/state/updates';

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
          <strong>Version {state.version} is available</strong>
          <button className="icon-btn" title="Later" onClick={later}>
            <X size={13} />
          </button>
        </div>
        <div className="faint">
          Download it now{state.size ? ` (${formatBytes(state.size)})` : ''}? You can keep working while it downloads.
        </div>
        <div className="update-notice-actions">
          <button className="btn sm ghost" onClick={later}>
            Later
          </button>
          <button
            className="btn sm primary"
            onClick={() => {
              setEngaged(true);
              void window.api.updates.download();
            }}
          >
            Download
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
          <strong>Downloading {state.version}…</strong>
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
          <strong>Version {state.version} is ready</strong>
          <button className="icon-btn" title="Later" onClick={later}>
            <X size={13} />
          </button>
        </div>
        <div className="faint">Restart now to finish updating. Your project is saved first.</div>
        <div className="update-notice-actions">
          <button className="btn sm ghost" onClick={later}>
            Later
          </button>
          <button className="btn sm primary" onClick={() => void restartToUpdate()}>
            Restart
          </button>
        </div>
      </div>
    );
  }

  if (state.status === 'error' && engaged) {
    return (
      <div className="update-notice error">
        <div className="update-notice-head">
          <strong>Update failed</strong>
          <button className="icon-btn" title="Dismiss" onClick={later}>
            <X size={13} />
          </button>
        </div>
        <div className="faint">{state.message}</div>
      </div>
    );
  }

  return null;
}
