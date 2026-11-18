import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from './common/ui';
import { ClassIcon } from './common/ClassIcon';
import { classForSpecies } from '@/canvas/replayGlyphs';
import { battleTimeLeft, formatClock, useReplayStore } from '@/state/replay';
import { cssColor, type BattleEvents, type Side } from '@/replay/timeline';

/** Lineup order, as the game's own team lists sort. */
const SPECIES_ORDER = ['AirCarrier', 'Battleship', 'Cruiser', 'Destroyer', 'Submarine'];

/** Seconds a timeline click lands before its event, so you see it happen. */
const LEAD_SECONDS = 5;

type Row =
  | { kind: 'kill'; t: number; killer?: Ship; victim?: Ship; cause: string | null }
  | { kind: 'cap'; t: number; cap: string; owner: Side | null };
type Ship = BattleEvents['roster'][number];

/** The seed's kill icons, loaded once per session. */
let killIconsOnce: Promise<Record<string, string>> | null = null;
function useKillIcons(): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    killIconsOnce ??= window.api.replay.killIcons().catch(() => ({}));
    let live = true;
    void killIconsOnce.then((i) => live && setIcons(i));
    return () => {
      live = false;
    };
  }, []);
  return icons;
}

/** Team colours, as the theme sets them. */
const SIDE_COLOR: Record<Side, string> = { ally: 'var(--success)', enemy: 'var(--danger)' };

/**
 * Score, caps, lineups and the event feed for the loaded replay; takes the
 * ship list's place in replay mode.
 *
 * Laid out after the replay videos' sidebar (replay-parser
 * `render/src/sidebar.rs`), which is the reference: change both together.
 * Where the suite differs it is for being interactive and themed: team
 * colours come from the theme, lineup rows toggle trails, events seek, and
 * the map, mode and clock live in the Playback panel. Kills show the game's
 * kill icons when the seed ships them, words otherwise.
 */
export function ReplayEventsPanel() {
  const timeline = useReplayStore((s) => s.timeline);
  const frame = useReplayStore((s) => s.frame);
  const paths = useReplayStore((s) => s.paths);
  const trails = useReplayStore((s) => s.trails);
  const trailStyles = useReplayStore((s) => s.trailStyles);
  const events = timeline?.header.events;
  const killIcons = useKillIcons();

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

  // Each ship's health changes, in time order, for a lookup at any clock.
  const healthTracks = useMemo(() => {
    const tracks = new Map<number, [number, number][]>();
    for (const [t, id, pct] of events?.health ?? []) {
      let track = tracks.get(id);
      if (!track) tracks.set(id, (track = []));
      track.push([t, pct]);
    }
    return tracks;
  }, [events]);

  const lineup = useMemo(() => {
    const rank = (s: Ship) => {
      const i = SPECIES_ORDER.indexOf(s.species ?? '');
      return i < 0 ? SPECIES_ORDER.length : i;
    };
    const sorted = [...(events?.roster ?? [])].sort(
      (a, b) => rank(a) - rank(b) || (a.ship ?? a.player).localeCompare(b.ship ?? b.player),
    );
    return { ally: sorted.filter((s) => s.side === 'ally'), enemy: sorted.filter((s) => s.side === 'enemy') };
  }, [events]);
  const seen = useMemo(() => new Set(paths?.paths.filter((p) => p.points.length > 1).map((p) => p.entityId)), [paths]);

  // The feed grows at the bottom, as the video's does; keep the newest in view.
  const feed = useRef<HTMLDivElement>(null);
  const now = timeline ? timeline.clockAt(frame) : 0;
  const shown = rows.filter((r) => r.t <= now).length;
  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);

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

  let score = { ally: 0, enemy: 0 };
  for (const s of events.scores) if (s.t <= now) score = s;
  const max = events.maxScore ?? 1000;
  const caps = timeline
    .frame(frame)
    .flatMap((r) => (r.kind === 'capturePoint' ? [r] : []))
    .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''));
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
              const isSunk = sunk.has(s.id);
              // A ship with no health data is drawn full, as the video does; no bars
              // at all on bakes from before health was recorded.
              const health = isSunk ? 0 : (healthAt(healthTracks.get(s.id), now) ?? (events.health ? 100 : null));
              return (
                <button
                  key={s.id}
                  className={`replay-lineup-ship${on ? ' on' : ''}${isSunk ? ' sunk' : ''}${s.isSelf ? ' self' : ''}`}
                  style={on && style ? { borderLeftColor: cssColor(style.color) } : undefined}
                  disabled={!canTrail}
                  aria-pressed={on}
                  onClick={() => useReplayStore.getState().toggleTrail(s.id)}
                  title={`${s.player}${canTrail ? (on ? ' · hide trail' : ' · show trail') : ' · never spotted'}`}
                >
                  <ClassIcon cls={classForSpecies(s.species ?? undefined)} size={12} color={SIDE_COLOR[side]} />
                  <span className="replay-lineup-name">
                    <span>{s.ship ?? s.player}</span>
                    {health !== null && !isSunk && (
                      <span className="replay-health">
                        <span className={side} style={{ width: `${health}%` }} />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="replay-events-head">Battle events</div>
      <div className="replay-events" ref={feed}>
        {shown === 0 && <div className="replay-events-empty">No kills or captures yet.</div>}
        {rows.slice(0, shown).map((r, i) => (
          <button
            key={i}
            className="replay-event"
            // Newest is brightest, as in the video.
            style={{ opacity: Math.max(0.55, 1 - (shown - 1 - i) * 0.06) }}
            onClick={() => useReplayStore.getState().seek(timeline.indexAt(r.t - LEAD_SECONDS))}
            title={`Jump to ${LEAD_SECONDS} s before this`}
          >
            <span className="replay-event-time">{formatClock(battleTimeLeft(events, r.t) ?? r.t)}</span>
            {r.kind === 'kill' ? (
              <span className="replay-event-body">
                {r.killer && r.killer !== r.victim && <ShipLabel ship={r.killer} />}
                <KillMark cause={r.cause} icons={killIcons} sunk={!r.killer || r.killer === r.victim} />
                <ShipLabel ship={r.victim} />
              </span>
            ) : (
              <span className="replay-event-body">
                <span className="replay-cap-tag">{r.cap}</span>
                <span className={r.owner ?? 'replay-event-verb'}>
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

/**
 * Between the names: the game's kill icon, as its kill feed shows it, or the
 * verb; with no killer and no icon, "Sunk:". The video's sidebar does the same.
 */
function KillMark({ cause, icons, sunk }: { cause: string | null; icons: Record<string, string>; sunk: boolean }) {
  const icon = icons[fragIcon(cause)] ?? icons['frags'];
  const verb = causeLabel(cause);
  if (icon) return <img className="replay-event-icon" src={icon} alt={verb} title={verb} />;
  return <span className="replay-event-verb">{sunk ? 'Sunk:' : verb}</span>;
}

function ShipLabel({ ship }: { ship?: Ship }) {
  if (!ship) return <span className="replay-event-ship">?</span>;
  return (
    <span className={`replay-event-ship ${ship.side}`} title={ship.player}>
      <ClassIcon cls={classForSpecies(ship.species ?? undefined)} size={13} color={SIDE_COLOR[ship.side]} />
      {ship.ship ?? ship.player}
    </span>
  );
}

/**
 * Death causes as the sidecar names them: the game's `DEATH_REASON_NAME`
 * constants, via replay-parser's `constants::death_reason`. The same words as
 * the video renderer's `kill_verb` (replay-parser `render/src/sidebar.rs`);
 * change both together. Shell hits (ARTILLERY, AP_SHELL, HE_SHELL, CS_SHELL)
 * and anything unnamed read as "sank".
 */
function causeLabel(cause: string | null): string {
  switch (cause) {
    case 'TORPEDO':
    case 'TBOMB':
      return 'torpedoed';
    case 'BURNING':
      return 'burned';
    case 'FLOOD':
      return 'flooded';
    case 'RAM':
      return 'rammed';
    case 'BOMB':
    case 'SKIP_BOMB':
      return 'bombed';
    case 'ROCKET':
      return 'rocketed';
    case 'DBOMB':
    case 'ADBOMB':
      return 'depth-charged';
    case 'DETONATE':
      return 'detonated';
    case 'SEA_MINE':
      return 'mined';
    case 'ATBA':
      return 'sank (secondaries)';
    default:
      return 'sank';
  }
}

/** A ship's health in percent at clock `t`; null with no data (bakes from before health was recorded). */
function healthAt(track: [number, number][] | undefined, t: number): number | null {
  if (!track || track.length === 0) return null;
  let lo = 0;
  let hi = track.length - 1;
  if (track[0]![0] > t) return 100;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track[mid]![0] <= t) lo = mid;
    else hi = mid - 1;
  }
  return track[lo]![1];
}

/**
 * The kill icon for a death cause, by file stem in `battle_hud/icon_frag/`.
 * Copied from the video renderer's `frag_icon` (replay-parser
 * `render/src/sidebar.rs`); change both together.
 */
function fragIcon(cause: string | null): string {
  switch (cause) {
    case 'ARTILLERY':
    case 'AP_SHELL':
    case 'HE_SHELL':
    case 'CS_SHELL':
      return 'icon_frag_main_caliber';
    case 'ATBA':
      return 'icon_frag_atba';
    case 'TORPEDO':
    case 'TBOMB':
      return 'icon_frag_torpedo';
    case 'BOMB':
      return 'icon_frag_bomb';
    case 'SKIP_BOMB':
      return 'icon_frag_skip';
    case 'BURNING':
      return 'icon_frag_burning';
    case 'FLOOD':
      return 'icon_frag_flood';
    case 'RAM':
      return 'icon_frag_ram';
    case 'DETONATE':
      return 'icon_frag_detonate';
    case 'SEA_MINE':
      return 'icon_frag_naval_mine';
    case 'DBOMB':
    case 'ADBOMB':
      return 'icon_frag_depthbomb';
    case 'ROCKET':
      return 'icon_frag_rocket';
    case 'MISSILE':
      return 'icon_frag_missile';
    case 'ACID':
      return 'icon_frag_acid';
    case 'LASER':
      return 'icon_frag_laser';
    case 'FEL':
      return 'icon_frag_fel';
    case 'PORTAL':
      return 'icon_frag_portal';
    case 'SECTOR_WAVE':
      return 'icon_frag_wave';
    default:
      return 'frags';
  }
}
