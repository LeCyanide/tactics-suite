import { useEffect, useState } from 'react';
import { Clipboard, HardDrive, ImageDown, Keyboard, RefreshCw, Scale, Send, Unplug } from 'lucide-react';
import { getActivePage, useStore } from '@/state/store';
import { Check, Field, Modal, NumInput, SectionLabel, Slider, Tip } from '../common/ui';
import { canvasApi, DEFAULT_EXPORT, type ExportOptions } from '@/canvas/canvasBridge';
import { SHORTCUT_REFERENCE } from '@/state/shortcuts';
import { formatBytes } from '@/lib/util';
import { pagePath } from '@/lib/pageTree';
import { TEST_BUILD_LABEL } from '@/lib/testBuild';
import { DEVELOPER_CREDIT } from '@/lib/credit';
import { restartToUpdate, useUpdateState, type UpdateState } from '@/state/updates';
import {
  cancelConnectDiscord,
  connectDiscord,
  disconnectDiscord,
  findChannel,
  refreshDiscord,
  useDiscord,
} from '@/state/discord';
import type { ThemeName } from '@/types/model';

/* ================================================================== */
/* Image export                                                        */
/* ================================================================== */

const RESOLUTIONS = [1280, 1920, 2560, 3840, 5120];

export function ExportModal() {
  const page = useStore(getActivePage);
  const project = useStore((s) => s.project);
  const channelId = useStore((st) => st.settings.discordChannel);
  const { discord } = useDiscord();
  const s = () => useStore.getState();
  const [opts, setOpts] = useState<ExportOptions>(DEFAULT_EXPORT);
  const [busy, setBusy] = useState(false);

  if (!page || !project) return null;
  const path = pagePath(project, page);
  const patch = (p: Partial<ExportOptions>) => setOpts((o) => ({ ...o, ...p }));
  const channel = findChannel(discord, channelId);
  const shareTip = channel
    ? `Post this page in #${channel.name}`
    : discord?.status === 'linked'
      ? (discord.error ?? 'Pick a channel in Settings first')
      : discord?.status === 'unavailable'
        ? 'This build has no clan bot to post through'
        : 'Connect Discord in Settings first';

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
        const name = path.join(' - ').replace(/[\\/:*?"<>|]/g, '_');
        const file = await window.api.exporter.image(url, name, opts.format === 'jpg' ? '.jpg' : '.png');
        if (file) s().toast('Image exported', 'success');
      }
    } catch (err) {
      s().toast(`Export failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  /**
   * The bot cannot read this machine's projects, so sharing is a push: render
   * the page here and hand the image to the bot's endpoint.
   */
  const share = async () => {
    setBusy(true);
    try {
      // Discord re-encodes anything it shows anyway, and a 5120px map makes a
      // file nobody can load on a phone.
      const image = await canvasApi()?.exportImage({ ...opts, format: 'png', width: Math.min(opts.width, 2560) });
      if (!image) {
        s().toast('Export failed', 'error');
        return;
      }

      const url = await window.api.discord.share({
        channelId,
        title: path.join(' — '),
        note: page.notes.trim() || undefined,
        image,
      });

      s().toast(url ? 'Posted to Discord' : 'Posted', 'success');
    } catch (err) {
      s().toast(`Share failed: ${(err as Error).message}`, 'error');
      // A refusal may mean the account was unlinked or lost the channel.
      void refreshDiscord();
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
      subtitle={path.join(' — ')}
      onClose={() => s().closeModal()}
      footer={
        <>
          <button className="btn primary" disabled={busy} onClick={() => void run(false)}>
            <ImageDown size={13} /> {busy ? 'Rendering…' : 'Export…'}
          </button>
          <button className="btn" disabled={busy} onClick={() => void run(true)}>
            <Clipboard size={13} /> Copy to clipboard
          </button>
          <Tip label={shareTip} side="top">
            <button className="btn" disabled={busy || !channel} onClick={() => void share()}>
              <Send size={13} /> Share to Discord
            </button>
          </Tip>
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

      <SectionLabel>Share to Discord</SectionLabel>
      <DiscordSection />

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
        WoWs Tactics Suite {info?.version ?? ''}
        {TEST_BUILD_LABEL && <strong style={{ color: 'var(--warn)' }}> ({TEST_BUILD_LABEL})</strong>} — Awooga I don't know what I am doing. language versions below:
        <div className="mono" style={{ marginTop: 6, fontSize: 10.5 }}>
          Electron {info?.electron} · Chromium {info?.chrome} · Node {info?.node}
        </div>
        <div style={{ marginTop: 6 }}>{DEVELOPER_CREDIT}</div>
      </div>

      <SectionLabel>Credits</SectionLabel>
      <Credits />

      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => void window.api.storage.revealLicenses()}>
        <Scale size={12} /> Open licence notices
      </button>
    </Modal>
  );
}

/** The mark from Discord's brand kit; lucide carries no brand icons. */
function DiscordMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.11 13.11 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

/**
 * Connecting a Discord account, and choosing where shared pages go.
 *
 * Nothing is typed in: the button opens Discord's own sign-in in the browser,
 * and the channels offered afterwards are the ones that account can post in.
 */
function DiscordSection() {
  const channelId = useStore((s) => s.settings.discordChannel);
  const { discord, linking } = useDiscord();
  const note = { fontSize: 11, marginTop: 8, lineHeight: 1.5 } as const;

  if (discord === null) {
    return (
      <div className="faint" style={note}>
        Checking…
      </div>
    );
  }

  if (discord.status === 'unavailable') {
    return (
      <div className="faint" style={note}>
        This build was made without a clan bot, so there is nowhere to share to.
      </div>
    );
  }

  if (discord.status === 'unlinked') {
    return (
      <>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn discord" disabled={linking} onClick={() => void connectDiscord()}>
            <DiscordMark /> {linking ? 'Waiting for Discord…' : 'Connect Discord'}
          </button>
          {linking && (
            <button className="btn ghost" onClick={cancelConnectDiscord}>
              Cancel
            </button>
          )}
        </div>
        <div className="faint" style={note}>
          {linking
            ? 'Approve the request in the browser window that just opened, then come back here.'
            : 'Opens Discord in your browser to sign in. The app learns who you are and nothing else, and can then post pages to the channels you can post in yourself.'}
        </div>
      </>
    );
  }

  const known = findChannel(discord, channelId) !== null;
  const servers = discord.guilds.filter((guild) => guild.channels.length > 0);

  return (
    <>
      <Field label="Account">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flex: 1, minWidth: 0 }}>
            <DiscordMark /> {discord.user.name}
          </span>
          <button className="btn sm" onClick={() => void disconnectDiscord()}>
            <Unplug size={12} /> Disconnect
          </button>
        </div>
      </Field>
      <Field label="Post in">
        <select
          value={known ? channelId : ''}
          disabled={servers.length === 0}
          onChange={(e) => useStore.getState().patchSettings({ discordChannel: e.target.value })}
        >
          <option value="" disabled>
            {servers.length === 0 ? 'No channels' : 'Choose a channel…'}
          </option>
          {servers.map((guild) => (
            <optgroup key={guild.id} label={guild.name}>
              {guild.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                  {channel.category ? ` — ${channel.category}` : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <div className="faint" style={{ ...note, color: discord.error ? 'var(--danger)' : undefined }}>
        {discord.error
          ? `${discord.error} The channel list will come back when it can be.`
          : servers.length === 0
            ? 'There is no channel where both you and the bot can send messages and attach files.'
            : 'Fills in the Share to Discord button on the export dialog. Listed are the channels where you can send messages and attach files, and the bot can too. The bot never reads anything from this machine — the app sends it the rendered image.'}
      </div>
    </>
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
