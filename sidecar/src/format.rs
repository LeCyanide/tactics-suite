//! The baked timeline format.
//!
//! A replay bakes into one blob: a JSON header carrying everything constant
//! for the battle, then one fixed-width record per draw command, grouped into
//! frames, with an index so any frame is O(1) to reach.
//!
//! Strings are the whole reason this format exists. Every ship in every
//! frame carries its player name, ship name and species — about 15 ships, ten times a second, for fifteen minutes. They
//! never change, so they live in the header string table and each record
//! refers to them by a `u16` id. That alone is most of the difference between
//! ~14 KB and ~3 KB per frame.
//!
//! Layout, all little-endian:
//!
//! ```text
//! magic        u8[8]   "WTREPLY1"
//! version      u16
//! flags        u16     reserved, 0
//! fps          f32     frames per second of GAME time
//! frame_count  u32
//! space_size   i32     map extent in world units
//! minimap_size u32     pixel space positions are expressed in
//! battle_secs  f32     length of the baked window
//! header_len   u32
//! header       u8[header_len]                       UTF-8 JSON
//! index        (u32 offset, u32 len)[frame_count]    offsets relative to frames
//! frames       u8[...]                              each: u16 count, then records
//! ```
//!
//! A record is a `u8` tag followed by that tag's fixed payload, so a reader can
//! skip anything it does not need by consulting `RECORD_SIZES`.
//!
//! Positions stay in minimap pixel space rather than world metres.
//! `replay_parser::draw` produces them that way and radii come in pixels too, so converting here
//! would mean transforming two different quantities by two different rules.
//! `space_size` and `minimap_size` are in the header; one linear transform on
//! the client puts everything into the planner coordinate system at once.

use std::collections::HashMap;

use replay_parser::draw::Draw;

pub const MAGIC: &[u8; 8] = b"WTREPLY1";
pub const FORMAT_VERSION: u16 = 1;
pub const FIXED_HEADER_LEN: usize = 8 + 2 + 2 + 4 + 4 + 4 + 4 + 4 + 4;

/// Record tags. Values are part of the format; append, never renumber.
pub mod tag {
    pub const SHOT_TRACER: u8 = 1;
    pub const SHOT_TRACER_TIP: u8 = 2;
    pub const SECONDARY_SHOT_TRACER: u8 = 3;
    pub const SECONDARY_SHOT_TRACER_TIP: u8 = 4;
    pub const TORPEDO: u8 = 5;
    pub const SMOKE: u8 = 6;
    pub const SHIP: u8 = 7;
    pub const HEALTH_BAR: u8 = 8;
    pub const DEAD_SHIP: u8 = 9;
    pub const BUFF_ZONE: u8 = 10;
    pub const CAPTURE_POINT: u8 = 11;
    pub const CAMERA_DIRECTION: u8 = 12;
    pub const BUILDING: u8 = 13;
    pub const WEATHER_ZONE: u8 = 14;
    pub const PLANE: u8 = 15;
    pub const CONSUMABLE_RADIUS: u8 = 16;
    pub const PATROL_RADIUS: u8 = 17;
    /// Not written since the cut-over to `replay_parser` (range rings and
    /// trails were off in the old renderer too); the tags stay reserved.
    pub const SHIP_CONFIG_CIRCLE: u8 = 18;
    /// Variable length: the fixed part ends with a `u16` point count, followed
    /// by that many (f32 x, f32 y, u8 r, u8 g, u8 b) points.
    pub const POSITION_TRAIL: u8 = 19;
}

/// Payload size per tag, excluding the tag byte. `None` means variable length.
///
/// This is the table the client decoder mirrors, so it must not drift from what
/// `encode` actually writes. `push_frame` checks every record against it, which
/// turns a format mismatch into a failed test instead of a client that silently
/// misreads every frame after the first bad record.
pub const RECORD_SIZES: &[(u8, Option<usize>)] = &[
    (tag::SHOT_TRACER, Some(19)),
    (tag::SHOT_TRACER_TIP, Some(11)),
    (tag::SECONDARY_SHOT_TRACER, Some(19)),
    (tag::SECONDARY_SHOT_TRACER_TIP, Some(11)),
    (tag::TORPEDO, Some(11)),
    (tag::SMOKE, Some(14)),
    (tag::SHIP, Some(31)),
    (tag::HEALTH_BAR, Some(20)),
    (tag::DEAD_SHIP, Some(26)),
    (tag::BUFF_ZONE, Some(16)),
    (tag::CAPTURE_POINT, Some(21)),
    (tag::CAMERA_DIRECTION, Some(21)),
    (tag::BUILDING, Some(14)),
    (tag::WEATHER_ZONE, Some(10)),
    (tag::PLANE, Some(26)),
    (tag::CONSUMABLE_RADIUS, Some(18)),
    (tag::PATROL_RADIUS, Some(22)),
    (tag::SHIP_CONFIG_CIRCLE, Some(26)),
    (tag::POSITION_TRAIL, None),
];

/// Little-endian append-only byte buffer.
#[derive(Default)]
struct Buf(Vec<u8>);

impl Buf {
    fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    fn u16(&mut self, v: u16) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn u64(&mut self, v: u64) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn i16(&mut self, v: i16) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn i32(&mut self, v: i32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn f32(&mut self, v: f32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn rgb(&mut self, v: [u8; 3]) {
        self.0.extend_from_slice(&v);
    }
    fn pos(&mut self, [x, y]: [f32; 2]) {
        self.f32(x);
        self.f32(y);
    }
    fn len(&self) -> usize {
        self.0.len()
    }
}

/// Quantize a 0..1 float to a byte. Alpha, opacity, HP fraction and capture
/// progress are display-only, so a byte is finer than the eye needs and saves
/// three bytes each.
fn q8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// Clamp a pixel radius to i16. Minimap radii top out near the map pixel size,
/// so this never actually saturates in practice.
fn r16(v: i32) -> i16 {
    v.clamp(i16::MIN as i32, i16::MAX as i32) as i16
}

/// `replay_parser::draw`'s building icon names, by format id (0 is none).
fn building_icon_id(v: Option<&str>) -> u8 {
    match v {
        None => 0,
        Some("airbase") => 1,
        Some("air_defence") => 2,
        Some("artillery") => 3,
        Some("generator") => 4,
        Some("radar") => 5,
        Some("station") => 6,
        Some("supply") => 7,
        Some(_) => 8,
    }
}

fn building_relation_id(v: &str) -> u8 {
    match v {
        "ally" => 0,
        "neutral" => 2,
        "dead" => 3,
        "suppressed_ally" => 4,
        "suppressed_enemy" => 5,
        "suppressed_neutral" => 6,
        _ => 1,
    }
}

/// String table. Ids are 1-based so 0 can mean absent without a separate
/// presence flag.
#[derive(Default)]
struct Interner {
    strings: Vec<String>,
    index: HashMap<String, u16>,
}

impl Interner {
    fn intern(&mut self, s: &str) -> u16 {
        if let Some(&id) = self.index.get(s) {
            return id;
        }
        assert!(self.strings.len() < u16::MAX as usize, "string table overflow");
        self.strings.push(s.to_owned());
        let id = self.strings.len() as u16;
        self.index.insert(s.to_owned(), id);
        id
    }

    fn intern_opt(&mut self, s: Option<&str>) -> u16 {
        match s {
            Some(s) => self.intern(s),
            None => 0,
        }
    }
}

/// Bit positions in the ship record flag byte.
mod ship_flags {
    pub const IS_SELF: u8 = 1 << 0;
    pub const HAS_COLOR: u8 = 1 << 1;
    pub const DETECTED_TEAMMATE: u8 = 1 << 2;
    pub const DISCONNECTED: u8 = 1 << 3;
    pub const HAS_NAME_COLOR: u8 = 1 << 4;
}

pub struct TimelineWriter {
    frames: Buf,
    /// (offset into `frames`, byte length) per frame.
    index: Vec<(u32, u32)>,
    interner: Interner,
    records: u64,
    /// Tags whose encoded width has already been checked against
    /// `RECORD_SIZES`, indexed by tag byte.
    verified: [bool; 256],
}

impl TimelineWriter {
    pub fn new() -> Self {
        Self {
            frames: Buf::default(),
            index: Vec::new(),
            interner: Interner::default(),
            records: 0,
            verified: [false; 256],
        }
    }

    pub fn frame_count(&self) -> u32 {
        self.index.len() as u32
    }

    pub fn record_count(&self) -> u64 {
        self.records
    }

    /// Append one frame.
    pub fn push_frame(&mut self, cmds: &[Draw<'_>]) {
        let start = self.frames.len();
        let written = u16::try_from(cmds.len()).expect("under 65536 records a frame");
        self.frames.u16(written);
        for cmd in cmds {
            let before = self.frames.len();
            self.encode(cmd);
            self.verify_record_size(before);
        }
        let len = self.frames.len() - start;
        self.index.push((start as u32, len as u32));
        self.records += u64::from(written);
    }

    /// Check the record just appended at `start` against `RECORD_SIZES`, once
    /// per tag. Checking every record would cost a table scan in the hot loop
    /// for no extra safety: a tag either encodes at the declared width or it
    /// never does, so the first occurrence settles it.
    fn verify_record_size(&mut self, start: usize) {
        let tag = self.frames.0[start];
        if std::mem::replace(&mut self.verified[tag as usize], true) {
            return;
        }
        let written = self.frames.len() - start - 1;
        match RECORD_SIZES.iter().find(|(t, _)| *t == tag) {
            Some((_, Some(expected))) => assert_eq!(
                written, *expected,
                "tag {tag} wrote {written} payload bytes but RECORD_SIZES declares {expected}"
            ),
            Some((_, None)) => {}
            None => panic!("tag {tag} was encoded but is missing from RECORD_SIZES"),
        }
    }

    fn encode(&mut self, cmd: &Draw<'_>) {
        match cmd {
            Draw::ShotTracer { from, to, color, secondary } => {
                self.frames.u8(if *secondary { tag::SECONDARY_SHOT_TRACER } else { tag::SHOT_TRACER });
                self.frames.pos(*from);
                self.frames.pos(*to);
                self.frames.rgb(*color);
            }
            Draw::ShotTracerTip { at, color, secondary } => {
                self.frames.u8(if *secondary { tag::SECONDARY_SHOT_TRACER_TIP } else { tag::SHOT_TRACER_TIP });
                self.frames.pos(*at);
                self.frames.rgb(*color);
            }
            Draw::Torpedo { pos, color } => {
                self.frames.u8(tag::TORPEDO);
                self.frames.pos(*pos);
                self.frames.rgb(*color);
            }
            Draw::Smoke { pos, radius, color, alpha } => {
                self.frames.u8(tag::SMOKE);
                self.frames.pos(*pos);
                self.frames.i16(r16(*radius));
                self.frames.rgb(*color);
                self.frames.u8(q8(*alpha));
            }
            Draw::Ship {
                entity_id,
                pos,
                yaw,
                species,
                color,
                detected,
                opacity,
                is_self,
                player_name,
                ship_name,
                is_detected_teammate,
                is_disconnected,
                name_color,
            } => {
                let species_id = self.interner.intern_opt(*species);
                let player_id = self.interner.intern_opt(*player_name);
                let ship_id = self.interner.intern_opt(ship_name.as_deref());
                let mut flags = 0u8;
                if *is_self {
                    flags |= ship_flags::IS_SELF;
                }
                if color.is_some() {
                    flags |= ship_flags::HAS_COLOR;
                }
                if *is_detected_teammate {
                    flags |= ship_flags::DETECTED_TEAMMATE;
                }
                if *is_disconnected {
                    flags |= ship_flags::DISCONNECTED;
                }
                if name_color.is_some() {
                    flags |= ship_flags::HAS_NAME_COLOR;
                }
                self.frames.u8(tag::SHIP);
                self.frames.u32(*entity_id);
                self.frames.pos(*pos);
                self.frames.f32(*yaw);
                self.frames.u16(species_id);
                self.frames.rgb(color.unwrap_or([0, 0, 0]));
                // Visibility: 0 visible, 1 minimap only (never drawn), 2 undetected.
                self.frames.u8(if *detected { 0 } else { 2 });
                self.frames.u8(q8(*opacity));
                self.frames.u8(flags);
                self.frames.u16(player_id);
                self.frames.u16(ship_id);
                self.frames.rgb(name_color.unwrap_or([0, 0, 0]));
            }
            Draw::HealthBar { entity_id, pos, fraction, fill_color, background_color, background_alpha } => {
                self.frames.u8(tag::HEALTH_BAR);
                self.frames.u32(*entity_id);
                self.frames.pos(*pos);
                self.frames.u8(q8(*fraction));
                self.frames.rgb(*fill_color);
                self.frames.rgb(*background_color);
                self.frames.u8(q8(*background_alpha));
            }
            Draw::DeadShip { entity_id, pos, yaw, species, is_self, player_name, ship_name } => {
                let species_id = self.interner.intern_opt(*species);
                let player_id = self.interner.intern_opt(*player_name);
                let ship_id = self.interner.intern_opt(*ship_name);
                // Wrecks carry no colour (the flag stays clear).
                let flags = if *is_self { ship_flags::IS_SELF } else { 0 };
                self.frames.u8(tag::DEAD_SHIP);
                self.frames.u32(*entity_id);
                self.frames.pos(*pos);
                self.frames.f32(*yaw);
                self.frames.u16(species_id);
                self.frames.rgb([0, 0, 0]);
                self.frames.u8(flags);
                self.frames.u16(player_id);
                self.frames.u16(ship_id);
            }
            Draw::BuffZone { pos, radius, color, alpha, marker_name } => {
                let marker_id = self.interner.intern_opt(*marker_name);
                self.frames.u8(tag::BUFF_ZONE);
                self.frames.pos(*pos);
                self.frames.i16(r16(*radius));
                self.frames.rgb(*color);
                self.frames.u8(q8(*alpha));
                self.frames.u16(marker_id);
            }
            Draw::CapturePoint { pos, radius, color, alpha, label, progress, invader_color } => {
                let label_id = self.interner.intern(label);
                self.frames.u8(tag::CAPTURE_POINT);
                self.frames.pos(*pos);
                self.frames.i16(r16(*radius));
                self.frames.rgb(*color);
                self.frames.u8(q8(*alpha));
                self.frames.u16(label_id);
                self.frames.u8(q8(*progress));
                self.frames.rgb(invader_color.unwrap_or([0, 0, 0]));
                self.frames.u8(u8::from(invader_color.is_some()));
            }
            Draw::CameraDirection { entity_id, pos, yaw, color, length } => {
                self.frames.u8(tag::CAMERA_DIRECTION);
                self.frames.u32(*entity_id);
                self.frames.pos(*pos);
                self.frames.f32(*yaw);
                self.frames.rgb(*color);
                self.frames.i16(r16(*length));
            }
            Draw::Building { pos, color, is_alive, icon, relation } => {
                self.frames.u8(tag::BUILDING);
                self.frames.pos(*pos);
                self.frames.rgb(*color);
                self.frames.u8(u8::from(*is_alive));
                self.frames.u8(building_icon_id(*icon));
                self.frames.u8(building_relation_id(relation));
            }
            Draw::WeatherZone { pos, radius } => {
                self.frames.u8(tag::WEATHER_ZONE);
                self.frames.pos(*pos);
                self.frames.i16(r16(*radius));
            }
            Draw::Plane { plane_id, owner_entity_id, pos, icon_key, player_name, ship_name } => {
                let icon_id = self.interner.intern(icon_key);
                let player_id = self.interner.intern_opt(*player_name);
                let ship_id = self.interner.intern_opt(*ship_name);
                self.frames.u8(tag::PLANE);
                self.frames.u64(*plane_id);
                self.frames.u32(*owner_entity_id);
                self.frames.pos(*pos);
                self.frames.u16(icon_id);
                self.frames.u16(player_id);
                self.frames.u16(ship_id);
            }
            Draw::ConsumableRadius { entity_id, pos, radius, color, alpha } => {
                self.frames.u8(tag::CONSUMABLE_RADIUS);
                self.frames.u32(*entity_id);
                self.frames.pos(*pos);
                self.frames.i16(r16(*radius));
                self.frames.rgb(*color);
                self.frames.u8(q8(*alpha));
            }
            Draw::PatrolRadius { plane_id, pos, radius, color, alpha } => {
                self.frames.u8(tag::PATROL_RADIUS);
                self.frames.u64(*plane_id);
                self.frames.pos(*pos);
                self.frames.i16(r16(*radius));
                self.frames.rgb(*color);
                self.frames.u8(q8(*alpha));
            }
        }
    }

    /// Serialize the blob. The string table and diagnostics are merged into
    /// `header`, so callers pass battle metadata and nothing else.
    pub fn finish(
        mut self,
        fps: f32,
        space_size: i32,
        minimap_size: u32,
        battle_secs: f32,
        mut header: serde_json::Value,
    ) -> Vec<u8> {
        let strings = std::mem::take(&mut self.interner.strings);

        if let Some(obj) = header.as_object_mut() {
            obj.insert("strings".into(), serde_json::json!(strings));
            // Kept for readers of older bakes: nothing is dropped any more.
            obj.insert("skipped".into(), serde_json::json!({}));
            obj.insert("records".into(), serde_json::json!(self.records));
        }
        let header_bytes = serde_json::to_vec(&header).expect("header serializes");

        let frame_count = self.index.len() as u32;
        let mut out = Buf::default();
        out.0.extend_from_slice(MAGIC);
        out.u16(FORMAT_VERSION);
        out.u16(0); // flags
        out.f32(fps);
        out.u32(frame_count);
        out.i32(space_size);
        out.u32(minimap_size);
        out.f32(battle_secs);
        out.u32(header_bytes.len() as u32);
        debug_assert_eq!(out.len(), FIXED_HEADER_LEN);
        out.0.extend_from_slice(&header_bytes);
        for (off, len) in &self.index {
            out.u32(*off);
            out.u32(*len);
        }
        out.0.extend_from_slice(&self.frames.0);
        out.0
    }
}
