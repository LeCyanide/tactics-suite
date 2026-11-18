//! `bake`: the timeline, built on the suite's own replay parser
//! (`wows-replay-parser`). The format and its header are unchanged from the
//! toolkit-era bakes, so older blobs still load.

use std::path::Path;
use std::path::PathBuf;
use std::time::Instant;

use replay_parser::Replay;
use replay_parser::defs::EntityDefs;
use replay_parser::draw;
use replay_parser::entity::EntityDecoder;
use replay_parser::gameparams::GameParams;
use replay_parser::packet::Packets;
use replay_parser::res::InstallScripts;
use replay_parser::res::Resources;
use replay_parser::world::World;

use crate::emit;
use crate::format;

/// The game's native minimap size in pixels, which the header has always
/// carried (the old renderer's `NATIVE_MINIMAP_SIZE`).
const NATIVE_MINIMAP_SIZE: u32 = 760;

/// Bakes `replay` and returns the blob; `fps` as `bake` validated it.
pub fn bake(game_dir: &Path, replay_path: &PathBuf, fps: f32) -> Result<Vec<u8>, String> {
    let started = Instant::now();
    emit(&serde_json::json!({ "t": "stage", "stage": "loading-game-data" }));
    let replay =
        Replay::from_file(replay_path).map_err(|e| format!("could not read replay: {e}"))?;
    let version = replay
        .meta
        .version()
        .map_err(|e| format!("replay version: {e}"))?;
    let res = Resources::open_build(game_dir, version.build).map_err(|e| {
        format!(
            "could not open build {} of {}: {e}",
            version.build,
            game_dir.display()
        )
    })?;
    let defs = EntityDefs::load(&InstallScripts(&res)).map_err(|e| format!("entity defs: {e}"))?;
    let gp = GameParams::load(&res).map_err(|e| format!("could not load GameParams: {e}"))?;
    let names = res
        .catalog("en")
        .map_err(|e| format!("translation catalog: {e}"))?;
    let space = res
        .read(&format!("{}/space.settings", replay.meta.map_name))
        .map_err(|e| format!("no space.settings for map {:?}: {e}", replay.meta.map_name))?;
    let map = draw::MapGeometry::from_space_settings(&String::from_utf8_lossy(&space))
        .ok_or_else(|| format!("no bounds in space.settings for {:?}", replay.meta.map_name))?;

    emit(&serde_json::json!({ "t": "stage", "stage": "baking" }));
    // A first pass learns shell flight times from their hits: tracers are
    // paced by them.
    let mut decoder = EntityDecoder::new(&defs);
    let mut world = World::new(&replay.meta).with_params(&gp);
    for p in Packets::new(&replay.packets, version) {
        let event = decoder.feed(&p).ok().flatten();
        world.apply(&decoder, &p, event.as_ref());
    }
    let flights = draw::flights(&world.shell_hits);

    let mut decoder = EntityDecoder::new(&defs);
    let mut world = World::new(&replay.meta).with_params(&gp);
    let mut writer = format::TimelineWriter::new();
    let mut battle_secs = 0.0f32;
    // Frame n sits at n/fps exactly (an accumulated 0.1 step would drift by
    // a frame over a long battle), emitted once a packet at or past that
    // clock has been applied. A truncated tail just ends the packets.
    let frame_clock = |index: u32| (f64::from(index) / f64::from(fps)) as f32;
    let mut labels = draw::Labels::default();
    let expected_frames = (f64::from(replay.meta.duration) * f64::from(fps)).max(1.0) as u64;
    let mut last_reported = 0u32;
    for p in Packets::new(&replay.packets, version) {
        // An undecodable packet still moves the clock and positions.
        let event = decoder.feed(&p).ok().flatten();
        world.apply(&decoder, &p, event.as_ref());
        battle_secs = battle_secs.max(p.clock);
        while p.clock >= frame_clock(writer.frame_count()) {
            // Operations add players mid-battle.
            if labels.players.len() != world.players.len() {
                labels = draw::labels(&world.players, Some(&gp), &names);
            }
            let clock = frame_clock(writer.frame_count());
            let commands = draw::frame(&world, &map, &labels, Some(&gp), &flights, clock);
            writer.push_frame(&commands);
        }
        let frames = writer.frame_count();
        if frames >= last_reported + 250 {
            last_reported = frames;
            emit(&serde_json::json!({ "t": "progress", "frame": frames, "total": expected_frames }));
        }
    }

    let meta = &replay.meta;
    let header = serde_json::json!({
        "engine": "parser",
        "replay": replay_path.file_name().map(|n| n.to_string_lossy().into_owned()),
        "clientVersion": meta.client_version_from_exe,
        "dateTime": meta.date_time,
        "map": { "name": meta.map_name, "displayName": meta.map_display_name },
        "mode": {
            "gameMode": meta.game_mode,
            "gameType": meta.game_type,
            "scenario": meta.scenario,
            "matchGroup": meta.match_group,
        },
        "player": { "name": meta.player_name, "vehicle": meta.player_vehicle },
        "vehicles": meta.vehicles.iter().map(|v| serde_json::json!({ "name": v.name, "relation": v.relation })).collect::<Vec<_>>(),
        // How to get from a record position to planner coordinates:
        // world = (px / minimapSize - 0.5) * spaceSize, with y negated.
        "nativeMinimapSize": NATIVE_MINIMAP_SIZE,
    });
    let frames = writer.frame_count();
    let records = writer.record_count();
    let blob = writer.finish(fps, map.space_size, draw::MINIMAP_SIZE, battle_secs, header);
    emit(&serde_json::json!({
        "t": "done",
        "engine": "parser",
        "frames": frames,
        "records": records,
        "bytes": blob.len(),
        "bytesPerFrame": blob.len() as f64 / f64::from(frames.max(1)),
        "battleSeconds": battle_secs,
        "fps": fps,
        "spaceSize": map.space_size,
        "elapsedMs": started.elapsed().as_millis(),
    }));
    Ok(blob)
}
