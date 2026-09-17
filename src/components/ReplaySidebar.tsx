/**
 * The left sidebar in replay mode.
 *
 * Replaces the project panels with the three things watching a replay needs:
 * the archive to pick from, transport controls, and what to draw. The tool rail
 * and the right sidebar stay exactly as they are, because the drawing tools
 * keep working over a running replay.
 */

import { useMemo } from 'react';
import {
  ChevronsLeft,
  ChevronsRight,
  FolderInput,
  Pause,
  Play,
  Plus,
  SkipBack,
  Trash2,
  X,
} from 'lucide-react';
import type { ReplayViewOptions } from '@/canvas/ReplayLayer';
import { BAKE_FPS, SPEEDS, formatClock, useReplayStore } from '@/state/replay';
import { useStore } from '@/state/store';
import { Panel, Slider } from './common/ui';

/** Order and labels for the draw toggles. */
const VIEW_ROWS: { key: keyof ReplayViewOptions; label: string }[] = [
  { key: 'shipNames', label: 'Ship names' },
  { key: 'playerNames', label: 'Player names' },
  { key: 'healthBars', label: 'Health bars' },
  { key: 'tracers', label: 'Shell tracers' },
  { key: 'torpedoes', label: 'Torpedoes' },
  { key: 'smoke', label: 'Smoke' },
  { key: 'capturePoints', label: 'Capture points' },
  { key: 'planes', label: 'Aircraft' },
  { key: 'buildings', label: 'Buildings' },
  { key: 'rangeCircles', label: 'Range circles' },
  { key: 'cameraDirection', label: 'Camera direction' },
  { key: 'trails', label: 'Position trails' },
];

export function ReplaySidebar() {
  const status = useReplayStore((s) => s.status);

  if (status && !status.available) {
    return (
      <Panel title="Replay viewer">
        <div className="faint" style={{ fontSize: 12, lineHeight: 1.6 }}>
          {status.reason}
        </div>
      </Panel>
    );
  }

  return (
    <>
      <ArchivePanel />
      <PlaybackPanel />
      <ViewPanel />
    </>
  );
}

/* ------------------------------------------------------------------ */

function ArchivePanel() {
  const archive = useReplayStore((s) => s.archive);
  const loaded = useReplayStore((s) => s.archiveLoaded);
  const selectedId = useReplayStore((s) => s.selectedId);
  const gameDir = useStore((s) => s.settings.wowsGameDir);
  const s = () => useReplayStore.getState();

  return (
    <Panel
      title="Replay archive"
      count={archive.length}
      storageKey="replayArchive"
      actions={
        <>
          <button className="icon-btn" title="Add replay files…" onClick={() => void s().addReplays()}>
            <Plus size={13} />
          </button>
          <button
            className="icon-btn"
            title={gameDir ? 'Import new replays from the game folder' : 'Choose your game folder first'}
            onClick={() => void s().importFromGame()}
          >
            <FolderInput size={13} />
          </button>
        </>
      }
    >
      {!gameDir && (
        <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.6, marginBottom: 8 }}>
          Watching a replay needs your World of Warships folder, to read the ships and map it was played on.{' '}
          <button className="link" onClick={() => void s().chooseGameDir()}>
            Choose folder…
          </button>
        </div>
      )}

      {!archive.length ? (
        <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
          {loaded ? 'The archive is empty. Add replay files, or import them from the game folder.' : 'Reading…'}
        </div>
      ) : (
        // The archive grows without bound, but the transport controls below it
        // are what a viewer reaches for constantly. Cap the list and let it
        // scroll on its own rather than pushing playback off the panel.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 280, overflowY: 'auto' }}>
          {archive.map((r) => (
            <ReplayRow key={r.id} replay={r} selected={r.id === selectedId} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function ReplayRow({
  replay,
  selected,
}: {
  replay: ReturnType<typeof useReplayStore.getState>['archive'][number];
  selected: boolean;
}) {
  const s = () => useReplayStore.getState();
  const probe = replay.probe;
  const map = probe?.map?.displayName ?? probe?.map?.name ?? replay.originalName;
  // The recorded date is what people actually recognise a battle by.
  const when = probe?.dateTime ?? '';
  const ship = probe?.player?.vehicle ?? '';

  return (
    <div
      className={`row${selected ? ' selected' : ''}`}
      onClick={() => void s().open(replay.id)}
      style={{ cursor: 'pointer', alignItems: 'flex-start', gap: 6 }}
      title={replay.originalName}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{map}</div>
        <div className="faint" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {[when, probe?.mode?.scenario, ship].filter(Boolean).join(' · ') ||
            replay.probeError ||
            `${(replay.size / 1048576).toFixed(1)} MB`}
        </div>
      </div>
      <button
        className="icon-btn"
        title="Remove from the archive"
        onClick={(e) => {
          e.stopPropagation();
          void s().removeReplay(replay.id);
        }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PlaybackPanel() {
  const timeline = useReplayStore((s) => s.timeline);
  const bake = useReplayStore((s) => s.bake);
  const frame = useReplayStore((s) => s.frame);
  const playing = useReplayStore((s) => s.playing);
  const speed = useReplayStore((s) => s.speed);
  const selectedId = useReplayStore((s) => s.selectedId);
  const s = () => useReplayStore.getState();

  if (!selectedId) return null;

  if (bake.phase === 'baking') {
    const pct = bake.total > 0 ? Math.min(100, (bake.frame / bake.total) * 100) : 0;
    return (
      <Panel title="Playback">
        <div style={{ fontSize: 11.5, marginBottom: 6 }}>{stageLabel(bake.stage)}</div>
        <div className="progress">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>
          {/* Elapsed only. The sidecar sizes its estimate from the nominal
              20-minute battle length, so quoting a total would promise a
              finish line most battles never reach. */}
          {bake.frame > 0 ? `${formatClock(bake.frame / BAKE_FPS)} of battle replayed` : 'This takes a few seconds'}
        </div>
      </Panel>
    );
  }

  if (bake.phase === 'error') {
    return (
      <Panel title="Playback">
        <div style={{ fontSize: 11.5, lineHeight: 1.6, color: 'var(--danger, #ff8080)' }}>{bake.message}</div>
        <button className="btn" style={{ marginTop: 8 }} onClick={() => void s().open(selectedId)}>
          Try again
        </button>
      </Panel>
    );
  }

  if (!timeline) return null;

  const clock = timeline.clockAt(frame);
  const total = timeline.battleSeconds;

  return (
    <Panel
      title="Playback"
      storageKey="replayPlayback"
      actions={
        <button className="icon-btn" title="Close replay" onClick={() => s().close()}>
          <X size={13} />
        </button>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <button className="icon-btn" title="Back to the start" onClick={() => s().seek(0)}>
          <SkipBack size={14} />
        </button>
        <button className="icon-btn" title="Back one frame" onClick={() => s().step(-1)}>
          <ChevronsLeft size={14} />
        </button>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => s().togglePlay()}>
          {playing ? <Pause size={13} /> : <Play size={13} />}
          <span style={{ marginLeft: 6 }}>{playing ? 'Pause' : 'Play'}</span>
        </button>
        <button className="icon-btn" title="Forward one frame" onClick={() => s().step(1)}>
          <ChevronsRight size={14} />
        </button>
      </div>

      <input
        type="range"
        min={0}
        max={timeline.frameCount - 1}
        value={frame}
        onChange={(e) => {
          s().pause();
          s().seek(Number(e.target.value));
        }}
        style={{ width: '100%' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <code>{formatClock(clock)}</code>
        <code className="faint">{formatClock(total)}</code>
      </div>

      {/* Two rows: eight speeds across a sidebar this narrow would squeeze
          "0.25x" past the point of being readable. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3, marginTop: 8 }}>
        {SPEEDS.map((sp) => (
          <button
            key={sp}
            className={`btn sm${sp === speed ? ' primary' : ''}`}
            style={{ padding: '2px 0' }}
            onClick={() => s().setSpeed(sp)}
          >
            {sp}×
          </button>
        ))}
      </div>
    </Panel>
  );
}

/** Turns the sidecar's stage names into something worth reading. */
function stageLabel(stage: string): string {
  if (stage === 'loading-game-data') return 'Reading game data…';
  if (stage === 'preparing') return 'Preparing the replay…';
  if (stage === 'baking') return 'Replaying the battle…';
  return 'Working…';
}

/* ------------------------------------------------------------------ */

function ViewPanel() {
  const view = useReplayStore((s) => s.view);
  const opacity = useReplayStore((s) => s.opacity);
  const timeline = useReplayStore((s) => s.timeline);
  const s = () => useReplayStore.getState();

  const roster = useMemo(() => {
    const vehicles = timeline?.header.vehicles ?? [];
    return {
      allies: vehicles.filter((v) => v.relation === 0 || v.relation === 1).length,
      enemies: vehicles.filter((v) => v.relation === 2).length,
    };
  }, [timeline]);

  if (!timeline) return null;

  return (
    <Panel title="Replay display" storageKey="replayView">
      <div className="faint" style={{ fontSize: 10.5, marginBottom: 8, lineHeight: 1.6 }}>
        {timeline.header.map?.displayName} · {timeline.header.mode?.scenario}
        <br />
        {roster.allies} v {roster.enemies} · {formatClock(timeline.battleSeconds)} long
      </div>

      <label className="field" style={{ marginBottom: 8 }}>
        <span>Layer opacity</span>
        <Slider min={0.2} max={1} step={0.05} value={opacity} onChange={(v) => s().setOpacity(v)} />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px' }}>
        {VIEW_ROWS.map(({ key, label }) => (
          <label key={key} className="check" style={{ fontSize: 11 }}>
            <input type="checkbox" checked={view[key]} onChange={(e) => s().setView({ [key]: e.target.checked })} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </Panel>
  );
}
