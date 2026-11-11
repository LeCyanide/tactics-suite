import { useMemo } from 'react';
import { Panel } from './common/ui';
import { ClassIcon } from './common/ClassIcon';
import { classForSpecies } from '@/canvas/replayGlyphs';
import { formatClock, useReplayStore } from '@/state/replay';
import { cssColor, type BattleEvents, type Side } from '@/replay/timeline';

/** Lineup order, as the game's own team lists sort. */
const SPECIES_ORDER = ['AirCarrier', 'Battleship', 'Cruiser', 'Destroyer', 'Submarine'];

/** Seconds a timeline click lands before its event, so you see it happen. */
const LEAD_SECONDS = 5;

type Row =
  | { kind: 'kill'; t: number; killer?: Ship; victim?: Ship; cause: string | null }
  | { kind: 'cap'; t: number; cap: string; owner: Side | null };
type Ship = BattleEvents['roster'][number];

/** Score, caps and an event list for the loaded replay; takes the ship list's place in replay mode. */
export function ReplayEventsPanel() {
  const timeline = useReplayStore((s) => s.timeline);
  const frame = useReplayStore((s) => s.frame);
  const paths = useReplayStore((s) => s.paths);
  const trails = useReplayStore((s) => s.trails);
  const trailStyles = useReplayStore((s) => s.trailStyles);
  const events = timeline?.header.events;

  const rows = useMemo<Row[]>(() => {
    if (!events) return [];
    const byId = new Map(events.roster.map((s) => [s.id, s]));
    const kills: Row[] = events.kills.map((k) => ({
      kind: 'kill',
      t: k.t,
      killer: byId.get(k.killer),
      victim: byId.get(k.victim),
      cause: k.cause,
    }));
    const caps: Row[] = events.caps.map((c) => ({ kind: 'cap', ...c }));
    return [...kills, ...caps].sort((a, b) => a.t - b.t);
  }, [events]);

  const lineup = useMemo(() => {
    const rank = (s: Ship) => {
      const i = SPECIES_ORDER.indexOf(s.species ?? '');
      return i < 0 ? SPECIES_ORDER.length : i;
    };
    const sorted = [...(events?.roster ?? [])].sort(
      (a, b) => rank(a) - rank(b) || (a.ship ?? '').localeCompare(b.ship ?? ''),
    );
    return { ally: sorted.filter((s) => s.side === 'ally'), enemy: sorted.filter((s) => s.side === 'enemy') };
  }, [events]);
  const seen = useMemo(() => new Set(paths?.paths.filter((p) => p.points.length > 1).map((p) => p.entityId)), [paths]);

  if (!timeline) return null;
  if (!events) {
    return (
      <Panel title="Battle" storageKey="replayEvents">
        <div className="replay-events-empty">
          This timeline was baked before battle events existed, and rebaking it failed. Rebaking needs the game version
          the replay was recorded on.
        </div>
      </Panel>
    );
  }

  const now = timeline.clockAt(frame);
  let score = { ally: 0, enemy: 0 };
  for (const s of events.scores) if (s.t <= now) score = s;
  const max = events.maxScore ?? 1000;
  const caps = timeline.frame(frame).flatMap((r) => (r.kind === 'capturePoint' ? [r] : []));
  const sunk = new Set(events.kills.filter((k) => k.t <= now).map((k) => k.victim));
  const caption = events.winner && now >= timeline.battleSeconds - 1 ? (events.winner === 'ally' ? 'Victory' : 'Defeat') : null;

  return (
    <Panel title="Battle" storageKey="replayEvents" grow flush>
      <div className="replay-score">
        <div className="replay-score-nums">
          <span className="ally">{score.ally}</span>
          <span className="replay-score-mid">{caption ?? `of ${max}`}</span>
          <span className="enemy">{score.enemy}</span>
        </div>
        <div className="replay-score-bars">
          <div>
            <div className="ally" style={{ width: `${Math.min(100, (score.ally / max) * 100)}%` }} />
          </div>
          <div>
            <div className="enemy" style={{ width: `${Math.min(100, (score.enemy / max) * 100)}%` }} />
          </div>
        </div>
        {caps.length > 0 && (
          <div className="replay-caps">
            {caps.map((c, i) => (
              <span
                key={c.label ?? i}
                className="replay-cap"
                style={{
                  borderColor: cssColor(c.color),
                  // The capturing team's colour fills in as progress grows.
                  background: c.invaderColor
                    ? `linear-gradient(to top, ${cssColor(c.invaderColor)}55 ${c.progress * 100}%, transparent 0)`
                    : undefined,
                }}
              >
                {c.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="replay-lineup">
        {(['ally', 'enemy'] as const).map((side) => (
          <div key={side} className="replay-lineup-team">
            {lineup[side].map((s) => {
              const on = trails.includes(s.id);
              const style = trailStyles.get(s.id);
              const canTrail = seen.has(s.id);
              return (
                <button
                  key={s.id}
                  className={`replay-lineup-ship${on ? ' on' : ''}${sunk.has(s.id) ? ' sunk' : ''}`}
                  style={on && style ? { borderLeftColor: cssColor(style.color) } : undefined}
                  disabled={!canTrail}
                  aria-pressed={on}
                  onClick={() => useReplayStore.getState().toggleTrail(s.id)}
                  title={`${s.player}${canTrail ? (on ? ' · hide trail' : ' · show trail') : ' · never spotted'}`}
                >
                  <ClassIcon cls={classForSpecies(s.species ?? undefined)} size={12} />
                  <span>{s.ship ?? s.player}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="replay-events">
        {rows.length === 0 && <div className="replay-events-empty">No kills or captures in this battle.</div>}
        {rows.map((r, i) => (
          <button
            key={i}
            className={`replay-event${r.t > now ? ' future' : ''}`}
            onClick={() => useReplayStore.getState().seek(timeline.indexAt(r.t - LEAD_SECONDS))}
            title={`Jump to ${formatClock(r.t - LEAD_SECONDS)}`}
          >
            <span className="replay-event-time">{formatClock(r.t)}</span>
            {r.kind === 'kill' ? (
              <span className="replay-event-body">
                <ShipLabel ship={r.killer} />
                <span className="replay-event-verb">{causeLabel(r.cause)}</span>
                <ShipLabel ship={r.victim} />
              </span>
            ) : (
              <span className="replay-event-body">
                <span className="replay-cap-tag">{r.cap}</span>
                <span className={r.owner ?? undefined}>
                  {r.owner === 'ally' ? 'captured by allies' : r.owner === 'enemy' ? 'captured by enemies' : 'neutralised'}
                </span>
              </span>
            )}
          </button>
        ))}
      </div>
    </Panel>
  );
}

function ShipLabel({ ship }: { ship?: Ship }) {
  if (!ship) return <span className="replay-event-ship">?</span>;
  return (
    <span className={`replay-event-ship ${ship.side}`} title={ship.player}>
      <ClassIcon cls={classForSpecies(ship.species ?? undefined)} size={14} />
      {ship.ship ?? ship.player}
    </span>
  );
}

/** Death causes as the sidecar names them (the toolkit's `DeathCause` variants), in words. */
function causeLabel(cause: string | null): string {
  switch (cause) {
    case 'Artillery':
    case 'ApShell':
    case 'HeShell':
    case 'CsShell':
      return 'sank';
    case 'Secondaries':
      return 'sank (secondaries)';
    case 'Torpedo':
    case 'AerialTorpedo':
      return 'torpedoed';
    case 'Fire':
      return 'burned';
    case 'Flooding':
      return 'flooded';
    case 'Ramming':
      return 'rammed';
    case 'DiveBomber':
    case 'SkipBombs':
      return 'bombed';
    case 'AerialRocket':
      return 'rocketed';
    case 'DepthCharge':
    case 'AerialDepthCharge':
      return 'depth-charged';
    case 'Detonation':
      return 'detonated';
    default:
      return 'sank';
  }
}
