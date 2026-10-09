//! Replay viewer sidecar.
//!
//! Turns a `.wowsreplay` into a draw-command timeline the planner can play
//! back like a video. All of the hard work — decrypting the replay, parsing
//! the packet stream, simulating the battle world, deciding what is visible to
//! whom and resolving it into draw commands — belongs to landaire's
//! wows-toolkit crates. This binary only swaps the final step: instead of
//! rasterizing each frame and encoding an mp4, it writes the commands out in a
//! compact binary form (see `format`) so the renderer can draw them on the
//! planner's own map, in the planner's own coordinates, with the drawing tools
//! still live.
//!
//! Three subcommands:
//!
//!   probe --replay <file>
//!       Battle metadata only, as JSON on stdout. Fast — it reads the replay
//!       header and never touches the game install. This is what the replay
//!       archive list is built from.
//!
//!   bake --game <dir> --replay <file> [--fps 10] [--out <file>]
//!       The full timeline. Writes the blob to `--out`, or stdout if omitted.
//!
//!   caps --game <dir> --replay <file>
//!       The capture points the battle opens with, as JSON on stdout. This is
//!       what `scripts/import-cap-layouts.mjs` builds the layout library from.
//!
//! Progress and diagnostics go to stderr as newline-delimited JSON, so stdout
//! stays a clean byte stream.

mod format;

use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::time::Instant;

use wows_minimap_renderer::MapInfo;
use wows_minimap_renderer::RenderOptions;
use wows_minimap_renderer::renderer::MinimapRenderer;
use wows_replays::ReplayFile;
use wows_replays::analyzer::Analyzer;
use wows_replays::game_constants::GameConstants;
use wows_replays::types::GameClock;
use wowsunpack::data::Version;
use wowsunpack::game_data;
use wowsunpack::game_params::provider::GameMetadataProvider;

/// Pixel space positions are expressed in. Matches the renderer's own output
/// size so `MinimapPos` values need no rescaling before we write them.
const MINIMAP_SIZE: u32 = wows_minimap_renderer::MINIMAP_SIZE;

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
    let replay = ReplayFile::from_file(&path).map_err(|e| format!("could not read replay: {e:?}"))?;
    let meta = &replay.meta;

    let json = serde_json::json!({
        "file": path.file_name().map(|n| n.to_string_lossy().into_owned()),
        "clientVersion": meta.clientVersionFromExe,
        "dateTime": meta.dateTime,
        "map": { "name": meta.mapName, "displayName": meta.mapDisplayName, "id": meta.mapId },
        "mode": {
            "gameMode": meta.gameMode,
            "gameType": meta.gameType,
            "scenario": meta.scenario,
            "matchGroup": meta.matchGroup,
        },
        "player": { "name": meta.playerName, "vehicle": meta.playerVehicle },
        "durationSeconds": meta.duration,
        "playersPerTeam": meta.playersPerTeam,
        "teamsCount": meta.teamsCount,
        "vehicles": meta.vehicles.iter().map(|v| serde_json::json!({
            "name": v.name,
            "relation": v.relation,
        })).collect::<Vec<_>>(),
    });
    println!("{json}");
    Ok(())
}

/// What we ask the renderer to produce. Map-layer commands are on; the HUD
/// panels are off because the planner draws its own chrome. Trails and range
/// circles are off by default too — both multiply the per-frame command count,
/// and the planner can draw range rings itself from its ship database.
fn render_options() -> RenderOptions {
    RenderOptions {
        show_hp_bars: true,
        show_tracers: true,
        show_torpedoes: true,
        show_planes: true,
        show_smoke: true,
        show_player_names: true,
        show_ship_names: true,
        show_capture_points: true,
        show_buildings: true,
        show_weather: true,
        show_camera_direction: true,
        show_consumables: true,
        show_armament: true,
        show_dead_ship_names: true,

        show_score: false,
        show_timer: false,
        show_kill_feed: false,
        show_battle_result: false,
        show_buffs: false,
        show_chat: false,
        show_advantage: false,
        show_score_timer: false,
        show_stats_panel: false,
        show_team_rosters: false,

        show_trails: false,
        show_dead_trails: false,
        show_speed_trails: false,
        show_ship_config: false,

        ..RenderOptions::default()
    }
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

    let started = Instant::now();

    // ---- game data. The expensive part (GameParams) is ~3.4 s, so a
    // long-lived sidecar process should eventually cache this across bakes
    // rather than paying it per replay.
    emit(&serde_json::json!({ "t": "stage", "stage": "loading-game-data" }));
    let replay = ReplayFile::from_file(&replay_path).map_err(|e| format!("could not read replay: {e:?}"))?;
    let version = Version::from_client_exe(&replay.meta.clientVersionFromExe);
    let resources = game_data::load_game_resources(&game_dir, &version)
        .map_err(|e| format!("could not load game data for {version:?}: {e}"))?;
    let vfs = resources.vfs;
    let specs = resources.specs;
    let game_params =
        GameMetadataProvider::from_vfs(&vfs).map_err(|e| format!("could not load GameParams: {e:?}"))?;
    // Ship names come from the game's gettext catalog. Without it the renderer
    // emits no ship_name, so the timeline would carry only player names.
    let build = version.build_number().ok_or("replay version carries no build number")?;
    let mo_path = game_data::translations_path(&game_dir, build);
    match std::fs::File::open(&mo_path).ok().and_then(|f| gettext::Catalog::parse(f).ok()) {
        Some(catalog) => game_params.set_translations(catalog),
        None => emit(&serde_json::json!({
            "t": "warning",
            "msg": format!("no readable translation catalog at {}; ship names will be missing", mo_path.display()),
        })),
    }
    let provider: &'static GameMetadataProvider = Box::leak(Box::new(game_params));
    let constants: &'static GameConstants = Box::leak(Box::new(GameConstants::from_vfs(&vfs)));

    let map_info = wows_minimap_renderer::assets::load_map_info(&replay.meta.mapName, &vfs)
        .ok_or_else(|| format!("no space.settings for map {:?}", replay.meta.mapName))?;
    let space_size = map_info.space_size;

    // ---- per-replay setup
    emit(&serde_json::json!({ "t": "stage", "stage": "preparing" }));
    let meta: &'static wows_replays::ReplayMeta = Box::leak(Box::new(replay.meta.clone()));
    let facts = wows_replays::analyzer::battle_controller::merged::gather_replay_facts(
        constants,
        version,
        &specs,
        &[&replay],
    );

    let mut world = wows_battle_world::BattleWorld::new(meta, provider, Some(constants));
    for (entity_id, fact) in &facts {
        let inventory = wows_replay_insights::build::build_inventory_from_facts(fact, provider, version);
        if !inventory.is_empty() {
            world.set_consumable_inventory(*entity_id, inventory);
        }
    }

    let mut renderer = MinimapRenderer::new(Some(MapInfo { space_size }), provider, version, render_options());
    let salvo_flight_times =
        wows_battle_world::scan::scan_salvo_flight_times(&replay.meta, provider, constants, version, &replay);
    renderer.set_salvo_flight_times(std::sync::Arc::new(salvo_flight_times));

    // ---- the bake itself
    //
    // The battle world is a forward-only state machine: packets go in, state
    // comes out, and there is no way to ask it about an earlier moment. So we
    // make exactly one pass, and every frame the viewer will ever want is
    // emitted during it. The render clock is continuous, which is what lets
    // positions interpolate and tracers animate between packets.
    emit(&serde_json::json!({ "t": "stage", "stage": "baking" }));
    let expected_frames = (f64::from(replay.meta.duration) * f64::from(fps)).max(1.0) as u64;
    let mut writer = format::TimelineWriter::new();
    let mut battle_secs = 0.0f32;
    let mut last_reported = 0u32;

    // Frame n sits at n/fps exactly. Accumulating a `1.0 / fps` step instead
    // would drift: at 10 fps the step is 0.1, which is not representable in
    // binary, and over the ~12k frames of a long battle the error grows past a
    // whole frame. That would quietly desync the client's frame index from the
    // battle clock it displays.
    let frame_clock = |index: u32| (f64::from(index) / f64::from(fps)) as f32;

    let mut parser = wows_replays::packet2::Parser::with_version(&specs, version);
    let mut remaining = replay.packet_data();

    while !remaining.is_empty() {
        // A truncated or unparseable tail is normal: replays are cut off when
        // the client exits. Everything up to that point is still good, so stop
        // rather than fail.
        let Ok(packet) = parser.parse_packet(&mut remaining) else { break };
        world.process(&packet);
        let clock = packet.clock.0;
        battle_secs = battle_secs.max(clock);

        while clock >= frame_clock(writer.frame_count()) {
            renderer.set_render_clock(GameClock(frame_clock(writer.frame_count())));
            let view = world.view();
            renderer.populate_players(&view);
            renderer.update_squadron_info(&view);
            renderer.update_ship_abilities(&view);
            let commands = renderer.draw_frame(&view);
            writer.push_frame(&commands);
        }

        let frames = writer.frame_count();
        if frames >= last_reported + 250 {
            last_reported = frames;
            emit(&serde_json::json!({ "t": "progress", "frame": frames, "total": expected_frames }));
        }
    }

    let frame_count = writer.frame_count();
    let record_count = writer.record_count();
    let skipped: serde_json::Map<String, serde_json::Value> =
        writer.skipped().iter().map(|(k, v)| ((*k).to_owned(), serde_json::json!(v))).collect();

    let header = serde_json::json!({
        "replay": replay_path.file_name().map(|n| n.to_string_lossy().into_owned()),
        "clientVersion": replay.meta.clientVersionFromExe,
        "dateTime": replay.meta.dateTime,
        "map": { "name": replay.meta.mapName, "displayName": replay.meta.mapDisplayName },
        "mode": {
            "gameMode": replay.meta.gameMode,
            "gameType": replay.meta.gameType,
            "scenario": replay.meta.scenario,
            "matchGroup": replay.meta.matchGroup,
        },
        "player": { "name": replay.meta.playerName, "vehicle": replay.meta.playerVehicle },
        "vehicles": replay.meta.vehicles.iter().map(|v| serde_json::json!({
            "name": v.name,
            "relation": v.relation,
        })).collect::<Vec<_>>(),
        // How to get from a record position to planner coordinates:
        // world = (px / minimapSize - 0.5) * spaceSize, with y negated.
        "nativeMinimapSize": wows_minimap_renderer::map_data::NATIVE_MINIMAP_SIZE,
    });

    let blob = writer.finish(fps, space_size, MINIMAP_SIZE, battle_secs, header);

    match &out_path {
        Some(path) => write_file(path, &blob)?,
        None => {
            let mut out = std::io::stdout().lock();
            out.write_all(&blob).map_err(|e| format!("could not write to stdout: {e}"))?;
            out.flush().map_err(|e| format!("could not flush stdout: {e}"))?;
        }
    }

    emit(&serde_json::json!({
        "t": "done",
        "frames": frame_count,
        "records": record_count,
        "bytes": blob.len(),
        "bytesPerFrame": blob.len() as f64 / f64::from(frame_count.max(1)),
        "battleSeconds": battle_secs,
        "fps": fps,
        "spaceSize": space_size,
        "elapsedMs": started.elapsed().as_millis(),
        "skipped": serde_json::Value::Object(skipped),
        "out": out_path.as_ref().map(|p| p.display().to_string()),
    }));
    Ok(())
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

    let replay = ReplayFile::from_file(&replay_path).map_err(|e| format!("could not read replay: {e:?}"))?;
    let version = Version::from_client_exe(&replay.meta.clientVersionFromExe);
    let resources = game_data::load_game_resources(&game_dir, &version)
        .map_err(|e| format!("could not load game data for {version:?}: {e}"))?;
    let vfs = resources.vfs;
    let specs = resources.specs;
    let provider =
        GameMetadataProvider::from_vfs(&vfs).map_err(|e| format!("could not load GameParams: {e:?}"))?;
    let constants = GameConstants::from_vfs(&vfs);

    let mut world = wows_battle_world::BattleWorld::new(&replay.meta, &provider, Some(&constants));
    let mut parser = wows_replays::packet2::Parser::with_version(&specs, version);
    let mut remaining = replay.packet_data();
    while !remaining.is_empty() {
        let Ok(packet) = parser.parse_packet(&mut remaining) else { break };
        if packet.clock.0 > 0.0 {
            break;
        }
        world.process(&packet);
    }

    let points: Vec<serde_json::Value> = world
        .capture_points()
        .iter()
        .filter_map(|cp| {
            let pos = cp.position?;
            // The game numbers these from Control = 0 in declaration order, and
            // a type this build of the crates does not know is drawn as one.
            let cp_type = cp.control_point_type.as_ref().and_then(|r| r.known().copied()).map_or(0, |t| t as i64);
            Some(serde_json::json!({
                "index": cp.index,
                "x": pos.x,
                "y": pos.z,
                "radius": cp.radius,
                "cpType": cp_type,
                "teamId": cp.team_id,
                "initiallyEnabled": cp.is_enabled,
            }))
        })
        .collect();

    let json = serde_json::json!({
        "file": replay_path.file_name().map(|n| n.to_string_lossy().into_owned()),
        "clientVersion": replay.meta.clientVersionFromExe,
        "mapId": replay.meta.mapId,
        "scenarioId": replay.meta.scenarioConfigId,
        "spaceName": replay.meta.mapName,
        "scenario": replay.meta.scenario,
        "gameMode": replay.meta.gameMode,
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
