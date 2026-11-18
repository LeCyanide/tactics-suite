//! The header's `events` block: kills, cap flips and score changes from the
//! recording player's side, for the replay viewer's battle panel
//! (`ReplayEventsPanel`, typed as `BattleEvents` in `src/replay/timeline.ts`).
//!
//! Times are packet clock seconds, the clock frames are sampled on. Sides are
//! `ally` / `enemy` rather than team ids, `null` for a neutral cap or a draw.
//! Death causes are the game's `DEATH_REASON_NAME` constants (`TORPEDO`,
//! `BURNING`, …), named with the build's own table from `battle.xml` when the
//! install has one, else with replay-parser's default table.

use std::collections::BTreeMap;
use std::collections::HashMap;

use replay_parser::constants;
use replay_parser::draw::Labels;
use replay_parser::world::World;
use serde_json::Value;
use serde_json::json;

/// What has to be watched packet by packet; the rest is read from the world
/// once the pass is over.
#[derive(Default)]
pub struct EventLog {
    /// Team scores by team id, one entry per change.
    scores: Vec<(f32, Vec<i64>)>,
    /// Cap label and owning team id (-1 neutral), one entry per change.
    caps: Vec<(f32, String, i64)>,
    cap_owners: BTreeMap<u32, i64>,
    prev_left: Option<i64>,
    battle_start: Option<f32>,
    /// Seconds on the battle clock when it starts counting down.
    time_limit: Option<i64>,
    /// Health in whole percent by ship entity id, one entry per change:
    /// `(clock, id, percent)`. Ships out of view keep their last value, as
    /// the video's lineup does.
    health: Vec<(f32, u32, u8)>,
    last_health: HashMap<u32, u8>,
}

impl EventLog {
    /// Call after every packet has been applied.
    pub fn observe(&mut self, world: &World) {
        let clock = world.clock;
        if !world.scores.is_empty() && self.scores.last().map(|(_, s)| s) != Some(&world.scores) {
            self.scores.push((clock, world.scores.clone()));
        }
        for (id, c) in &world.caps {
            if !c.enabled {
                continue;
            }
            // A zone's first owner is its starting state, not a flip.
            if let Some(before) = self.cap_owners.insert(*id, c.team)
                && before != c.team
            {
                self.caps.push((clock, cap_label(c), c.team));
            }
        }
        // The countdown ends when the clock jumps up to the time limit (the
        // countdown itself starts with a small jump, 0 to 30), as the video
        // renderer finds it.
        if let Some(left) = world.time_left {
            if self.battle_start.is_none() && self.prev_left.is_some_and(|p| left > p + 60) {
                self.battle_start = Some(clock);
                self.time_limit = Some(left);
            }
            self.prev_left = Some(left);
        }
        for (id, s) in &world.ships {
            if s.player.is_none() || s.max_health <= 0.0 {
                continue;
            }
            let pct = if s.alive {
                (s.health / s.max_health * 100.0).round().clamp(0.0, 100.0) as u8
            } else {
                0
            };
            if self.last_health.insert(*id, pct) != Some(pct) {
                self.health.push((clock, *id, pct));
            }
        }
    }

    pub fn finish(self, world: &World, labels: &Labels, death_reasons: Option<&[String]>) -> Value {
        let own = world.own_team();
        let side = |team: i64| match own {
            Some(o) if team == o => json!("ally"),
            Some(_) if team == 0 || team == 1 => json!("enemy"),
            _ => Value::Null,
        };

        // Kills name ships by entity id, so the roster does too. A player
        // whose ship entity never came into view still has a vehicle id in
        // the arena roster, which a death names; failing that, a negative
        // placeholder keeps ids unique.
        let mut ids: HashMap<usize, i64> = HashMap::new();
        for (id, s) in &world.ships {
            if let Some(p) = s.player {
                ids.entry(p).or_insert(i64::from(*id));
            }
        }
        for d in &world.deaths {
            for id in [d.victim, d.killer] {
                if id != 0
                    && let Some(p) = world.player_of(id)
                {
                    ids.entry(p).or_insert(i64::from(id));
                }
            }
        }
        let roster: Vec<Value> = world
            .players
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let label = labels.players.get(i);
                json!({
                    "id": ids.get(&i).copied().unwrap_or(-(i as i64) - 1),
                    "player": label.map_or_else(|| p.name.clone(), |l| l.player.trim_matches(':').to_owned()),
                    "ship": label.and_then(|l| l.ship.clone()),
                    "species": label.and_then(|l| l.species.clone()),
                    "side": if p.relation == 2 { "enemy" } else { "ally" },
                    "isSelf": p.relation == 0,
                })
            })
            .collect();

        let kills: Vec<Value> = world
            .deaths
            .iter()
            .map(|d| {
                json!({
                    "t": d.clock,
                    "killer": d.killer,
                    "victim": d.victim,
                    "cause": constants::death_reason(d.reason, death_reasons),
                })
            })
            .collect();

        // Scores come in team-id order; ally first.
        let (ally, enemy) = if own == Some(1) { (1, 0) } else { (0, 1) };
        let scores: Vec<Value> = self
            .scores
            .iter()
            .filter(|(_, s)| s.len() >= 2)
            .map(|(t, s)| json!({ "t": t, "ally": s[ally], "enemy": s[enemy] }))
            .collect();
        let caps: Vec<Value> = self
            .caps
            .iter()
            .map(|(t, label, team)| json!({ "t": t, "cap": label, "owner": side(*team) }))
            .collect();

        json!({
            "battleStart": self.battle_start,
            "timeLimit": self.time_limit,
            // [clock, ship id, percent]: arrays, not objects, as there are
            // thousands of them.
            "health": self.health.iter().map(|(t, id, pct)| json!([t, id, pct])).collect::<Vec<_>>(),
            "maxScore": world.win_score,
            "winner": world.winner.map_or(Value::Null, side),
            "roster": roster,
            "kills": kills,
            "scores": scores,
            "caps": caps,
        })
    }
}

/// The zone's letter as the map draws it: index 0 is "A"; bases get a flag.
fn cap_label(c: &replay_parser::world::CapturePoint) -> String {
    match c.kind {
        2 | 3 | 5 => "\u{2691}".to_owned(),
        _ => char::from_u32('A' as u32 + c.index.clamp(0, 25) as u32)
            .unwrap_or('?')
            .to_string(),
    }
}

#[cfg(test)]
mod tests {
    //! Runs the fixture replays of replay-parser (its `scripts/fetch-fixtures.sh`
    //! and `scripts/fetch-entity-defs.sh`) through the parser and checks the
    //! events block. No game install is needed, so causes use the default
    //! table and labels have no GameParams. Skipped unless
    //! `SIDECAR_FIXTURES` names that `tests/fixtures` directory.

    use std::path::PathBuf;

    use replay_parser::Replay;
    use replay_parser::defs::EntityDefs;
    use replay_parser::defs::ScriptDir;
    use replay_parser::draw;
    use replay_parser::entity::EntityDecoder;
    use replay_parser::packet::Packets;
    use replay_parser::world::World;

    use super::EventLog;

    #[test]
    fn fixture_replays_give_a_consistent_events_block() {
        let Some(root) = std::env::var_os("SIDECAR_FIXTURES").map(PathBuf::from) else {
            eprintln!("SIDECAR_FIXTURES not set; skipped");
            return;
        };
        let mut replays: Vec<_> = std::fs::read_dir(root.join("replays"))
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "wowsreplay"))
            .collect();
        replays.sort();
        assert!(!replays.is_empty(), "no fixture replays");

        for path in replays {
            let replay = Replay::from_file(&path).unwrap();
            let v = replay.meta.version().unwrap();
            let defs = EntityDefs::load(&ScriptDir(
                root.join("scripts")
                    .join(format!("{}_{}_{}", v.major, v.minor, v.patch)),
            ))
            .unwrap();
            let mut decoder = EntityDecoder::new(&defs);
            let mut world = World::new(&replay.meta);
            let mut log = EventLog::default();
            for p in Packets::new(&replay.packets, v) {
                let event = decoder.feed(&p).ok().flatten();
                world.apply(&decoder, &p, event.as_ref());
                log.observe(&world);
            }
            let labels = draw::labels(&world.players, None, &Default::default());
            let e = log.finish(&world, &labels, None);
            let name = path.file_name().unwrap().to_string_lossy();

            let roster = e["roster"].as_array().unwrap();
            let kills = e["kills"].as_array().unwrap();
            assert_eq!(roster.len(), world.players.len(), "{name}");
            let ids: std::collections::HashSet<i64> =
                roster.iter().map(|r| r["id"].as_i64().unwrap()).collect();
            assert_eq!(ids.len(), roster.len(), "{name}: roster ids are unique");
            let allies = roster.iter().filter(|r| r["side"] == "ally").count();
            assert!(
                allies > 0 && allies < roster.len(),
                "{name}: both sides present"
            );

            assert!(!kills.is_empty(), "{name}: kills");
            for k in kills {
                let victim = k["victim"].as_i64().unwrap();
                assert!(
                    ids.contains(&victim),
                    "{name}: victim {victim} is in the roster"
                );
                let killer = k["killer"].as_i64().unwrap();
                assert!(
                    killer == 0 || killer == victim || ids.contains(&killer),
                    "{name}: killer {killer} is in the roster"
                );
                assert!(
                    k["cause"].is_string(),
                    "{name}: every cause has a name ({k})"
                );
            }
            let times: Vec<f64> = kills.iter().map(|k| k["t"].as_f64().unwrap()).collect();
            assert!(
                times.windows(2).all(|w| w[0] <= w[1]),
                "{name}: kills in time order"
            );

            assert!(e["battleStart"].is_number(), "{name}: battle start found");
            assert!(
                e["timeLimit"].as_i64().is_some_and(|l| l >= 300),
                "{name}: time limit {}",
                e["timeLimit"]
            );
            assert_eq!(
                roster.iter().filter(|r| r["isSelf"] == true).count(),
                1,
                "{name}: one recording player"
            );
            let health = e["health"].as_array().unwrap();
            assert!(!health.is_empty(), "{name}: health track");
            for h in health {
                let id = h[1].as_i64().unwrap();
                assert!(
                    ids.contains(&id),
                    "{name}: health for ship {id} in the roster"
                );
                assert!(h[2].as_u64().unwrap() <= 100, "{name}");
            }
            // Every ship sunk ends at 0 %.
            for k in kills {
                let victim = k["victim"].as_i64().unwrap();
                if let Some(last) = health.iter().rev().find(|h| h[1].as_i64() == Some(victim)) {
                    assert_eq!(
                        last[2].as_u64(),
                        Some(0),
                        "{name}: sunk {victim} ends at 0 %"
                    );
                }
            }
            assert!(e["winner"].is_string() || e["winner"].is_null(), "{name}");
            let scores = e["scores"].as_array().unwrap();
            assert!(!scores.is_empty(), "{name}: scores");
            let caps = e["caps"].as_array().unwrap();
            for c in caps {
                assert!(
                    c["owner"].is_null() || c["owner"] == "ally" || c["owner"] == "enemy",
                    "{name}"
                );
            }
            let causes: std::collections::BTreeSet<&str> =
                kills.iter().filter_map(|k| k["cause"].as_str()).collect();
            eprintln!(
                "{name}: {} players, {} kills, {} score changes, {} cap flips, {} health changes, winner {}, causes {causes:?}",
                roster.len(),
                kills.len(),
                scores.len(),
                caps.len(),
                health.len(),
                e["winner"],
            );
        }
    }
}
