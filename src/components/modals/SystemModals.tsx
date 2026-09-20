import { useEffect, useState } from 'react';
import { Clipboard, HardDrive, ImageDown, Keyboard, RefreshCw, Scale } from 'lucide-react';
import { getActivePage, useStore } from '@/state/store';
import { Check, Field, Modal, NumInput, SectionLabel, Slider } from '../common/ui';
import { canvasApi, DEFAULT_EXPORT, type ExportOptions } from '@/canvas/canvasBridge';
import { SHORTCUT_REFERENCE } from '@/state/shortcuts';
import { formatBytes } from '@/lib/util';
import { TEST_BUILD_LABEL } from '@/lib/testBuild';
import { restartToUpdate, useUpdateState, type UpdateState } from '@/state/updates';
import type { ThemeName } from '@/types/model';

/* ================================================================== */
/* Image export                                                        */
/* ================================================================== */

const RESOLUTIONS = [1280, 1920, 2560, 3840, 5120];

export function ExportModal() {
  const page = useStore(getActivePage);
  const project = useStore((s) => s.project);
  const s = () => useStore.getState();
  const [opts, setOpts] = useState<ExportOptions>(DEFAULT_EXPORT);
  const [busy, setBusy] = useState(false);

  if (!page || !project) return null;
  const patch = (p: Partial<ExportOptions>) => setOpts((o) => ({ ...o, ...p }));

  const run = async (toClipboard: boolean) => {
    setBusy(true);
    try {
      const url = await canvasApi()?.exportImage(opts);
      if (!url) {
        s().toast('Export failed', 'error');
        return;
      }
      if (toClipboard) {
        await window.api.exporter.toClipboard(url);
        s().toast('Image copied to clipboard', 'success');
      } else {
        const name = `${project.name} - ${page.name}`.replace(/[\\/:*?"<>|]/g, '_');
        const file = await window.api.exporter.image(url, name, opts.format === 'jpg' ? '.jpg' : '.png');
        if (file) s().toast('Image exported', 'success');
      }
    } catch (err) {
      s().toast(`Export failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const cat = (key: keyof ExportOptions, label: string) => (
    <Check label={label} checked={opts[key] as boolean} onChange={(v) => patch({ [key]: v } as Partial<ExportOptions>)} />
  );

  return (
    <Modal
      title="Export Image"
      subtitle={`${project.name} — ${page.name}`}
      onClose={() => s().closeModal()}
      footer={
        <>
          <button className="btn primary" disabled={busy} onClick={() => void run(false)}>
            <ImageDown size={13} /> {busy ? 'Rendering…' : 'Export…'}
          </button>
          <button className="btn" disabled={busy} onClick={() => void run(true)}>
            <Clipboard size={13} /> Copy to clipboard
          </button>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => s().closeModal()}>
            Cancel
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <SectionLabel>Include</SectionLabel>
          {cat('background', 'Background Map')}
          {cat('grid', 'Grid & Coordinates')}
          {cat('caps', 'Capture Zones')}
          {cat('ships', 'Ships')}
          {cat('ranges', 'Ship Ranges')}
          {cat('annotations', 'Annotations')}
          <div className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
            Hidden layers, hidden teams and switched-off ship characteristics are never drawn — if Radar is off on the
            map, it is absent from the file too.
          </div>
        </div>

        <div>
          <SectionLabel>Output</SectionLabel>
          <Field label="Format">
            <select value={opts.format} onChange={(e) => patch({ format: e.target.value as 'png' | 'jpg' })}>
              <option value="png">PNG (lossless, transparent)</option>
              <option value="jpg">JPG (smaller)</option>
            </select>
          </Field>
          <Field label="Width">
            <select value={opts.width} onChange={(e) => patch({ width: parseInt(e.target.value, 10) })}>
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r} px
                </option>
              ))}
            </select>
          </Field>
          {opts.format === 'jpg' && (
            <Field label="Quality">
              <Slider value={opts.quality} min={0.4} max={1} step={0.02} onChange={(v) => patch({ quality: v })} />
            </Field>
          )}
          <div className="faint mono" style={{ fontSize: 11, marginTop: 10 }}>
            Approx. {opts.width} × {Math.round((opts.width * (canvasApi()?.worldSize().height ?? 1)) / (canvasApi()?.worldSize().width ?? 1))} px
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* Settings                                                            */
/* ================================================================== */

export function SettingsModal() {
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.project);
  const s = () => useStore.getState();
  const [info, setInfo] = useState<Record<string, string> | null>(null);
  const [usage, setUsage] = useState<{ path: string; bytes: number; files: number }[]>([]);

  useEffect(() => {
    void window.api.app.info().then(setInfo);
    void window.api.storage.usage().then(setUsage);
  }, []);

  return (
    <Modal title="Settings" onClose={() => s().closeModal()} footer={
      <>
        <span className="spacer" />
        <button className="btn ghost" onClick={() => s().closeModal()}>
          Close
        </button>
      </>
    }>
      <SectionLabel>Appearance</SectionLabel>
      <Field label="Theme">
        <select
          value={settings.theme}
          onChange={(e) => s().patchSettings({ theme: e.target.value as ThemeName })}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </Field>

      <SectionLabel>Editor</SectionLabel>
      {project && (
        <>
          <Check
            label="Snap to grid"
            checked={project.settings.snapToGrid}
            onChange={(v) =>
              useStore.setState({ project: { ...project, settings: { ...project.settings, snapToGrid: v } }, dirty: true })
            }
          />
          <Field label="Snap step">
            <NumInput
              value={project.settings.snapStep / 1000}
              step={0.1}
              min={0.05}
              suffix="km"
              onChange={(v) =>
                useStore.setState({
                  project: { ...project, settings: { ...project.settings, snapStep: v * 1000 } },
                  dirty: true,
                })
              }
            />
          </Field>
          <Field label="Ship icon size">
            <Slider
              value={project.settings.shipIconSize}
              min={16}
              max={72}
              step={1}
              format={(v) => `${Math.round(v)}px`}
              onChange={(v) =>
                useStore.setState({
                  project: { ...project, settings: { ...project.settings, shipIconSize: v } },
                  dirty: true,
                })
              }
            />
          </Field>
        </>
      )}

      <SectionLabel>Saving</SectionLabel>
      <Check label="Autosave while editing" checked={settings.autosave} onChange={(v) => s().patchSettings({ autosave: v })} />
      <Check
        label="Write a backup on every manual save"
        checked={settings.backupOnSave}
        onChange={(v) => s().patchSettings({ backupOnSave: v })}
      />
      <Field label="Keep">
        <NumInput
          value={settings.maxBackupsPerProject}
          min={1}
          max={100}
          step={1}
          suffix="backups"
          onChange={(v) => s().patchSettings({ maxBackupsPerProject: Math.round(v) })}
        />
      </Field>

      <SectionLabel>Local storage</SectionLabel>
      <div className="mono faint" style={{ fontSize: 11, wordBreak: 'break-all', marginBottom: 8 }}>
        {info?.storageRoot ?? '…'}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Location</th>
            <th style={{ width: 70 }}>Files</th>
            <th style={{ width: 90 }}>Size</th>
          </tr>
        </thead>
        <tbody>
          {usage.map((u) => (
            <tr key={u.path}>
              <td>{u.path}</td>
              <td className="num">{u.files}</td>
              <td className="num">{formatBytes(u.bytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => void window.api.storage.reveal()}>
        <HardDrive size={12} /> Open storage folder
      </button>

      <SectionLabel>Updates</SectionLabel>
      <UpdateSection />

      <SectionLabel>About</SectionLabel>
      <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
        WoWS Tactics Toolkit {info?.version ?? ''}
        {TEST_BUILD_LABEL && <strong style={{ color: 'var(--warn)' }}> ({TEST_BUILD_LABEL})</strong>} — Awooga I don't know what I am doing. language versions below:
        <div className="mono" style={{ marginTop: 6, fontSize: 10.5 }}>
          Electron {info?.electron} · Chromium {info?.chrome} · Node {info?.node}
        </div>
      </div>

      <SectionLabel>Credits</SectionLabel>
      <Credits />

      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => void window.api.storage.revealLicenses()}>
        <Scale size={12} /> Open licence notices
      </button>
    </Modal>
  );
}

/**
 * Who else's work is in here.
 *
 * The replay viewer is not ours in any meaningful sense: decrypting replays,
 * parsing the packet stream, simulating the battle and deciding what each side
 * could see is all landaire's wows-toolkit, used through its draw-command seam.
 * It is MIT, which asks that the copyright and permission notice travel with
 * every copy — hence the notice below and the file shipped beside the app.
 */
function Credits() {
  return (
    <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
      The replay viewer is built on{' '}
      <a className="link" href={TOOLKIT_URL} target="_blank" rel="noreferrer noopener">
        wows-toolkit
      </a>{' '}
      by Lander Brandt (landaire), which does all of the real work of reading a replay: decrypting it, parsing the
      packet stream, simulating the battle and resolving it into the draw commands this app renders on its own map.
      Used under the MIT licence.
      <pre className="licence">{TOOLKIT_LICENCE}</pre>
    </div>
  );
}

const TOOLKIT_URL = 'https://github.com/landaire/wows-toolkit';

/** Verbatim, because MIT requires exactly that. */
const TOOLKIT_LICENCE = `Copyright 2026 Lander Brandt

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

function describeUpdate(u: UpdateState): string {
  switch (u.status) {
    case 'disabled':
      return u.reason;
    case 'idle':
      return 'Not checked yet.';
    case 'checking':
      return 'Checking…';
    case 'current':
      return `You have the latest version (${u.version}).`;
    case 'available':
      return `Version ${u.version} is available.`;
    case 'downloading':
      return `Downloading ${u.version}… ${Math.round(u.percent)}%`;
    case 'ready':
      return `Version ${u.version} is downloaded and ready.`;
    case 'error':
      return u.message;
  }
}

function UpdateSection() {
  const u = useUpdateState();
  return (
    <>
      <div className="faint" style={{ fontSize: 11.5, marginBottom: 8, color: u.status === 'error' ? 'var(--danger)' : undefined }}>
        {describeUpdate(u)}
      </div>
      {u.status === 'available' ? (
        <button className="btn sm primary" onClick={() => void window.api.updates.download()}>
          Download {u.version}
        </button>
      ) : u.status === 'ready' ? (
        <button className="btn sm primary" onClick={() => void restartToUpdate()}>
          Restart to update
        </button>
      ) : (
        <button
          className="btn sm"
          disabled={u.status === 'disabled' || u.status === 'checking' || u.status === 'downloading'}
          onClick={() => void window.api.updates.check()}
        >
          <RefreshCw size={12} /> Check for updates
        </button>
      )}
    </>
  );
}

/* ================================================================== */
/* Shortcuts                                                           */
/* ================================================================== */

export function ShortcutsModal() {
  const s = () => useStore.getState();
  return (
    <Modal
      title="Keyboard Shortcuts"
      size="wide"
      onClose={() => s().closeModal()}
      headerExtra={<Keyboard size={14} style={{ color: 'var(--fg-faint)' }} />}
      footer={
        <>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => s().closeModal()}>
            Close
          </button>
        </>
      }
    >
      <div style={{ columns: 2, columnGap: 26 }}>
        {SHORTCUT_REFERENCE.map((group) => (
          <div key={group.group} style={{ breakInside: 'avoid', marginBottom: 14 }}>
            <SectionLabel>{group.group}</SectionLabel>
            {group.rows.map((row) => (
              <div key={row.keys} className="shortcut-row">
                <span>{row.action}</span>
                <kbd>{row.keys}</kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
