//! `bake --engine parser`: the same timeline, built on the suite's own
//! replay parser (`wows-replay-parser`) instead of the toolkit's battle world
//! and renderer. Exists so `npm run diff-timeline` can compare the two bakes
//! of one replay while the parser catches up; the toolkit goes at cut-over.
//!
//! Only the record kinds `replay_parser::draw` emits so far are written;
//! everything else shows up in the diff as present in one timeline only.

use std::path::Path;
use std::path::PathBuf;
use std::time::Instant;

use replay_parser::Replay;
use replay_parser::defs::EntityDefs;
use replay_parser::draw;
use replay_parser::draw::Draw;
use replay_parser::entity::EntityDecoder;
use replay_parser::gameparams::GameParams;
use replay_parser::packet::Packets;
use replay_parser::res::InstallScripts;
use replay_parser::res::Resources;
use replay_parser::world::World;
use wows_minimap_renderer::DrawCommand;
use wows_minimap_renderer::ShipVisibility;
use wows_minimap_renderer::map_data::MinimapPos;

use crate::emit;
use crate::format;

fn pos([x, y]: [f32; 2]) -> MinimapPos {
    MinimapPos { x, y }
}

/// The toolkit renderer's command for ours; the format encodes those.
fn command(d: Draw<'_>) -> DrawCommand {
    let s = |v: Option<&str>| v.map(str::to_owned);
    match d {
        Draw::CapturePoint {
            pos: p,
            radius,
            color,
            alpha,
            label,
            progress,
            invader_color,
        } => DrawCommand::CapturePoint {
            pos: pos(p),
            radius,
            color,
            alpha,
            label,
            progress,
            invader_color,
            flag_icon: None,
        },
        Draw::Torpedo { pos: p, color } => DrawCommand::Torpedo { pos: pos(p), color },
        Draw::Smoke {
            pos: p,
            radius,
            color,
            alpha,
        } => DrawCommand::Smoke {
            pos: pos(p),
            radius,
            color,
            alpha,
        },
        Draw::Ship {
            entity_id,
            pos: p,
            yaw,
            species,
            color,
            detected,
            opacity,
            is_self,
            player_name,
            ship_name,
            is_detected_teammate,
        } => DrawCommand::Ship {
            entity_id: entity_id.into(),
            pos: pos(p),
            yaw,
            species: s(species),
            color,
            visibility: if detected {
                ShipVisibility::Visible
            } else {
                ShipVisibility::Undetected
            },
            opacity,
            is_self,
            player_name: s(player_name),
            ship_name: ship_name.map(|n| n.into_owned()),
            is_detected_teammate,
            is_disconnected: false,
            name_color: None,
        },
        Draw::HealthBar {
            entity_id,
            pos: p,
            fraction,
            fill_color,
            background_color,
            background_alpha,
        } => DrawCommand::HealthBar {
            entity_id: entity_id.into(),
            pos: pos(p),
            fraction,
            fill_color,
            background_color,
            background_alpha,
        },
        Draw::DeadShip {
            entity_id,
            pos: p,
            yaw,
            species,
            is_self,
            player_name,
            ship_name,
        } => DrawCommand::DeadShip {
            entity_id: entity_id.into(),
            pos: pos(p),
            yaw,
            species: s(species),
            color: None,
            is_self,
            player_name: s(player_name),
            ship_name: s(ship_name),
        },
        Draw::ShotTracer {
            from,
            to,
            color,
            secondary: false,
        } => DrawCommand::ShotTracer {
            from: pos(from),
            to: pos(to),
            color,
        },
        Draw::ShotTracer {
            from,
            to,
            color,
            secondary: true,
        } => DrawCommand::SecondaryShotTracer {
            from: pos(from),
            to: pos(to),
            color,
        },
        Draw::ShotTracerTip {
            at,
            color,
            secondary: false,
        } => DrawCommand::ShotTracerTip { at: pos(at), color },
        Draw::ShotTracerTip {
            at,
            color,
            secondary: true,
        } => DrawCommand::SecondaryShotTracerTip { at: pos(at), color },
        Draw::ConsumableRadius {
            entity_id,
            pos: p,
            radius,
            color,
            alpha,
        } => DrawCommand::ConsumableRadius {
            entity_id: entity_id.into(),
            pos: pos(p),
            radius_px: radius,
            color,
            alpha,
        },
        Draw::PatrolRadius {
            plane_id,
            pos: p,
            radius,
            color,
            alpha,
        } => DrawCommand::PatrolRadius {
            plane_id: plane_id.into(),
            pos: pos(p),
            radius_px: radius,
            color,
            alpha,
        },
        Draw::Plane {
            plane_id,
            owner_entity_id,
            pos: p,
            icon_key,
            player_name,
            ship_name,
        } => DrawCommand::Plane {
            plane_id: plane_id.into(),
            owner_entity_id: owner_entity_id.into(),
            pos: pos(p),
            icon_key,
            player_name: s(player_name),
            ship_name: s(ship_name),
        },
    }
}

/// Bakes `replay` and returns the blob; `fps` as `bake` validated it.
pub fn bake(game_dir: &Path, replay_path: &PathBuf, fps: f32) -> Result<Vec<u8>, String> {
    let started = Instant::now();
    emit(&serde_json::json!({ "t": "stage", "stage": "loading-game-data", "engine": "parser" }));
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

    emit(&serde_json::json!({ "t": "stage", "stage": "baking", "engine": "parser" }));
    // A first pass learns shell flight times from their hits, as the
    // toolkit bake pre-scans for them.
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
    // Same frame schedule as the toolkit bake: frame n at n/fps, emitted once
    // a packet at or past that clock has been applied.
    let frame_clock = |index: u32| (f64::from(index) / f64::from(fps)) as f32;
    let mut labels = draw::Labels::default();
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
            let commands: Vec<DrawCommand> =
                draw::frame(&world, &map, &labels, Some(&gp), &flights, clock)
                    .into_iter()
                    .map(command)
                    .collect();
            writer.push_frame(&commands);
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
        "nativeMinimapSize": wows_minimap_renderer::map_data::NATIVE_MINIMAP_SIZE,
    });
    let frames = writer.frame_count();
    let blob = writer.finish(fps, map.space_size, draw::MINIMAP_SIZE, battle_secs, header);
    emit(&serde_json::json!({
        "t": "done",
        "engine": "parser",
        "frames": frames,
        "bytes": blob.len(),
        "battleSeconds": battle_secs,
        "elapsedMs": started.elapsed().as_millis(),
    }));
    Ok(blob)
}
