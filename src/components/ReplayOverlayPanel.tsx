import { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { Check, Field, Panel, Slider } from './common/ui';
import { getActivePage, useStore } from '@/state/store';
import { formatClock, useReplayStore } from '@/state/replay';
import { useOverlayStore } from '@/state/overlay';
import { shipName } from './ReplaySidebar';

/** Picks a replay played on the page's map and draws its paths behind the plan. */
export function ReplayOverlayPanel() {
  const mode = useReplayStore((s) => s.mode);
  const status = useReplayStore((s) => s.status);
  const archive = useReplayStore((s) => s.archive);
  const root = useReplayStore((s) => s.root);
  const page = useStore(getActivePage);
  const maps = useStore((s) => s.maps);
  const o = useOverlayStore();

  // The library only loads when replay mode is first opened; the list needs it here too.
  useEffect(() => {
    void useReplayStore.getState().init();
  }, []);

  const space = maps.find((m) => m.id === page?.mapId)?.spaceName;
  const choices = useMemo(
    () =>
      archive
        .filter((r) => r.state !== 'unplayable' && space && r.probe?.map?.name === space)
        .sort((a, b) => b.addedAt - a.addedAt),
    [archive, space],
  );

  const ships = useMemo(
    () =>
      [...(o.paths?.paths ?? [])].sort(
        (a, b) => Number(b.ally) - Number(a.ally) || (a.shipName ?? '').localeCompare(b.shipName ?? ''),
      ),
    [o.paths],
  );

  if (mode !== 'tactics' || !page || status?.available === false) return null;

  const onOtherMap = o.paths && o.paths.spaceName !== space;

  return (
    <Panel title="Replay overlay" storageKey="replayOverlay" defaultOpen={false}>
      <Field label="Replay">
        <div style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0 }}>
          <select
            style={{ flex: 1, minWidth: 0 }}
            value={o.replayId ?? ''}
            disabled={!choices.length}
            onChange={(e) => (e.target.value ? void o.show(e.target.value) : o.clear())}
          >
            <option value="">
              {choices.length ? 'None' : root ? 'No replays on this map' : 'Set up the library in Replay mode'}
            </option>
            {choices.map((r) => (
              <option key={r.id} value={r.id}>
                {[shipName(r.probe?.player?.vehicle), r.probe?.dateTime].filter(Boolean).join(' · ') || r.name}
              </option>
            ))}
          </select>
          {o.replayId && (
            <button className="icon-btn" title="Clear overlay" onClick={() => o.clear()}>
              <X size={13} />
            </button>
          )}
        </div>
      </Field>

      {o.load.phase === 'loading' && (
        <div className="faint mono" style={{ fontSize: 10.5 }}>
          Loading… {o.load.total > 1 ? Math.round((o.load.frame / o.load.total) * 100) + '%' : ''}
        </div>
      )}
      {o.load.phase === 'error' && (
        <div className="faint" style={{ fontSize: 11, color: 'var(--danger)' }}>
          {o.load.message}
        </div>
      )}
      {onOtherMap && (
        <div className="faint" style={{ fontSize: 11 }}>
          This replay was played on another map, so it is hidden on this page.
        </div>
      )}

      {o.paths && !onOtherMap && (
        <>
          <Field label="Up to">
            <Slider
              value={o.until}
              min={0}
              max={o.paths.duration}
              step={1}
              format={formatClock}
              onChange={(until) => o.set({ until })}
            />
          </Field>
          <Field label="Ship">
            <select
              style={{ flex: 1, minWidth: 0 }}
              value={o.only ?? ''}
              onChange={(e) => o.set({ only: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">All ships</option>
              {ships.map((p) => (
                <option key={p.entityId} value={p.entityId}>
                  {p.ally ? 'Ally' : 'Enemy'} · {p.shipName ?? '?'}
                  {p.playerName ? ` (${p.playerName})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Opacity">
            <Slider value={o.opacity} min={0.1} max={1} onChange={(opacity) => o.set({ opacity })} />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Check label="Allies" checked={o.allies} onChange={(allies) => o.set({ allies })} />
            <Check label="Enemies" checked={o.enemies} onChange={(enemies) => o.set({ enemies })} />
            <Check
              label="Unique colours"
              title="Give every ship its own colour, to tell the trails apart"
              checked={o.unique}
              onChange={(unique) => o.set({ unique })}
            />
          </div>
        </>
      )}
    </Panel>
  );
}
