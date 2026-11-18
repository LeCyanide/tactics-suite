//! Replay viewer sidecar.
//!
//! Turns a `.wowsreplay` into a draw-command timeline the planner can play
//! back like a video. Decrypting the replay, parsing the packet stream,
//! tracking the battle world and resolving each frame into draw commands
//! belong to the suite's own `wows-replay-parser` (whose format knowledge
//! owes much to landaire's wows-toolkit). This binary writes those commands
//! out in a compact binary form (see `format`) so the renderer can draw them
//! on the planner's own map, in the planner's own coordinates, with the
//! drawing tools still live.
//!
//! Three subcommands:
//!
//!   probe --replay <file>
//!       Battle metadata only, as JSON on stdout. Fast — it reads the replay
//!       header and never touches the game install. This is what the replay
//!       library list is built from.
//!
//!   bake --game <dir> --replay <file> [--fps 10] [--out <file>]
//!       The full timeline (see `bake`). Writes the blob to `--out`, or
//!       stdout if omitted.
//!
//!   caps --game <dir> --replay <file>
//!       The capture points the battle opens with, as JSON on stdout. This is
//!       what `scripts/import-cap-layouts.mjs` builds the layout library from.
//!
//! Progress and diagnostics go to stderr as newline-delimited JSON, so stdout
//! stays a clean byte stream.

mod bake;
mod events;
mod format;

use std::io::Write;
use std::path::Path;
use std::path::PathBuf;

use replay_parser::Replay;
use replay_parser::defs::EntityDefs;
use replay_parser::entity::EntityDecoder;
use replay_parser::packet::Packets;
use replay_parser::res::InstallScripts;
use replay_parser::res::Resources;
use replay_parser::world::World;

/// Frames per second of game time when the caller does not say. Ships move
/// about 1.5 m per frame at this rate on a 30 km map, which is sub-pixel, and
/// the client can interpolate between frames anyway.
const DEFAULT_FPS: f32 = 10.0;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("probe") => probe(&args[1..]),
        Some("bake") => bake(&args[1..]),
        Some("caps") => caps(&args[1..]),
        Some("--help") | Some("-h") | None => {
            eprintln!("{USAGE}");
            return;
        }
        Some(other) => Err(format!("unknown subcommand {other:?}\n\n{USAGE}")),
    };

    if let Err(msg) = result {
        emit(&serde_json::json!({ "t": "error", "msg": msg }));
        std::process::exit(1);
    }
}

const USAGE: &str = "\
wows-replay-sidecar

  probe --replay <file>
  bake  --game <dir> --replay <file> [--fps <n>] [--out <file>]
  caps  --game <dir> --replay <file>

Progress and errors are newline-delimited JSON on stderr.";

/// One JSON line on stderr.
fn emit(value: &serde_json::Value) {
    let mut err = std::io::stderr().lock();
    let _ = writeln!(err, "{value}");
    let _ = err.flush();
}

/// Minimal flag parsing. The sidecar is driven by the app, not by hand, so it
/// takes exact long flags and rejects anything else rather than guessing.
fn parse_flags(args: &[String], allowed: &[&str]) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let key = args[i].strip_prefix("--").ok_or_else(|| format!("expected a --flag, got {:?}", args[i]))?;
        if !allowed.contains(&key) {
            return Err(format!("unknown flag --{key}"));
        }
        let value = args.get(i + 1).ok_or_else(|| format!("--{key} needs a value"))?;
        out.push((key.to_owned(), value.clone()));
        i += 2;
    }
    Ok(out)
}

fn flag<'a>(flags: &'a [(String, String)], name: &str) -> Option<&'a str> {
    flags.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
}

fn require<'a>(flags: &'a [(String, String)], name: &str) -> Result<&'a str, String> {
    flag(flags, name).ok_or_else(|| format!("--{name} is required"))
}

/// Battle metadata, without needing the game install.
fn probe(args: &[String]) -> Result<(), String> {
    let flags = parse_flags(args, &["replay"])?;
    let path = PathBuf::from(require(&flags, "replay")?);
    let replay = Replay::from_file(&path).map_err(|e| format!("could not read replay: {e}"))?;
    let meta = &replay.meta;

    let json = serde_json::json!({
        "file": path.file_name().map(|n| n.to_string_lossy().into_owned()),
        "clientVersion": meta.client_version_from_exe,
        "dateTime": meta.date_time,
        "map": { "name": meta.map_name, "displayName": meta.map_display_name, "id": meta.map_id },
        "mode": {
            "gameMode": meta.game_mode,
            "gameType": meta.game_type,
            "scenario": meta.scenario,
            "matchGroup": meta.match_group,
        },
        "player": { "name": meta.player_name, "vehicle": meta.player_vehicle },
        "durationSeconds": meta.duration,
        "playersPerTeam": meta.players_per_team,
        "teamsCount": meta.teams_count,
        "vehicles": meta.vehicles.iter().map(|v| serde_json::json!({
            "name": v.name,
            "relation": v.relation,
        })).collect::<Vec<_>>(),
    });
    println!("{json}");
    Ok(())
}

fn bake(args: &[String]) -> Result<(), String> {
    let flags = parse_flags(args, &["game", "replay", "fps", "out"])?;
    let game_dir = PathBuf::from(require(&flags, "game")?);
    let replay_path = PathBuf::from(require(&flags, "replay")?);
    let fps: f32 = match flag(&flags, "fps") {
        Some(s) => s.parse().map_err(|_| format!("--fps {s:?} is not a number"))?,
        None => DEFAULT_FPS,
    };
    if !(fps > 0.0 && fps <= 60.0) {
        return Err(format!("--fps must be between 0 and 60, got {fps}"));
    }
    let out_path = flag(&flags, "out").map(PathBuf::from);
    let blob = bake::bake(&game_dir, &replay_path, fps)?;
    match &out_path {
        Some(path) => write_file(path, &blob),
        None => {
            let mut out = std::io::stdout().lock();
            out.write_all(&blob).map_err(|e| format!("could not write to stdout: {e}"))?;
            out.flush().map_err(|e| format!("could not flush stdout: {e}"))
        }
    }
}

/// The capture point layout a battle opens with.
///
/// Every zone is created in the burst of packets at clock zero, before anything
/// has moved, so that burst is all this reads — a replay abandoned seconds into
/// a training room is as good a source as a full battle. Positions are BigWorld
/// units from the centre of the map with +y north, the same frame the planner's
/// importer already expects.
fn caps(args: &[String]) -> Result<(), String> {
    let flags = parse_flags(args, &["game", "replay"])?;
    let game_dir = PathBuf::from(require(&flags, "game")?);
    let replay_path = PathBuf::from(require(&flags, "replay")?);

    let replay = Replay::from_file(&replay_path).map_err(|e| format!("could not read replay: {e}"))?;
    let version = replay.meta.version().map_err(|e| format!("replay version: {e}"))?;
    let res = Resources::open_build(&game_dir, version.build)
        .map_err(|e| format!("could not open build {} of {}: {e}", version.build, game_dir.display()))?;
    let defs = EntityDefs::load(&InstallScripts(&res)).map_err(|e| format!("entity defs: {e}"))?;

    let mut decoder = EntityDecoder::new(&defs);
    let mut world = World::new(&replay.meta);
    for p in Packets::new(&replay.packets, version) {
        if p.clock > 0.0 {
            break;
        }
        let event = decoder.feed(&p).ok().flatten();
        world.apply(&decoder, &p, event.as_ref());
    }

    // Negative indices are arms-race buff zones, not capture points. By
    // index, as the importer compares layouts as written.
    let mut caps: Vec<_> = world.caps.values().filter(|cp| cp.index >= 0).collect();
    caps.sort_by_key(|cp| cp.index);
    let points: Vec<serde_json::Value> = caps
        .into_iter()
        .map(|cp| {
            // `kind` is 1-based (Control = 1); the planner numbers from
            // Control = 0 and draws an unknown type as one.
            let cp_type = if (1..=6).contains(&cp.kind) { cp.kind - 1 } else { 0 };
            serde_json::json!({
                "index": cp.index,
                "x": cp.position.x,
                "y": cp.position.z,
                "radius": cp.radius,
                "cpType": cp_type,
                "teamId": cp.team,
                "initiallyEnabled": cp.enabled,
            })
        })
        .collect();

    let json = serde_json::json!({
        "file": replay_path.file_name().map(|n| n.to_string_lossy().into_owned()),
        "clientVersion": replay.meta.client_version_from_exe,
        "mapId": replay.meta.map_id,
        "scenarioId": replay.meta.scenario_config_id,
        "spaceName": replay.meta.map_name,
        "scenario": replay.meta.scenario,
        "gameMode": replay.meta.game_mode,
        "points": points,
    });
    println!("{json}");
    Ok(())
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    std::fs::write(path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))
}
