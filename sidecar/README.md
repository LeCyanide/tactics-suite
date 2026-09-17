# Replay viewer sidecar

Turns a `.wowsreplay` into a draw-command timeline the planner plays back like a
video: pause, seek, rewind, frame-step and speed changes are all index
arithmetic on a baked array, so none of them need the replay re-simulated.

Everything difficult here belongs to [landaire's wows-toolkit][toolkit] —
decrypting the replay, parsing the packet stream, simulating the battle world,
adjudicating who could see whom, and resolving all of it into draw commands.
This crate swaps only the last step. Where `minimap_renderer` rasterizes each
frame and encodes an mp4, the sidecar writes the commands out structured, so the
renderer can draw them on the planner's own map, in the planner's own
coordinates, with the drawing tools still live.

The toolkit crates come from crates.io, so this builds standalone. The encoder
features (`vulkan`, `cpu`, `cpu-av1`) are off: nothing is ever rasterized, so
none of wgpu, openh264 or rav1e is linked.

[toolkit]: https://github.com/landaire/wows-toolkit

## Why bake instead of stream

The battle world is a forward-only state machine. Packets go in, state comes
out, and there is no way to ask it about an earlier moment — rewinding would
mean re-simulating from zero. So the sidecar makes exactly one pass and emits
every frame the viewer will ever want during it.

That is affordable because the expensive half of rendering is the half we
dropped. Measured on a 15-minute Random Battle (build 13187581): the full mp4
render takes **34.5 s**, while baking the same replay at 10 fps takes **1.8 s**
after game data is loaded. Packet parsing and world simulation account for only
0.12 s of that; `draw_frame` is the rest.

## Usage

```sh
# Battle metadata only — instant, and needs no game install. This is what the
# replay archive list is built from.
wows-replay-sidecar probe --replay <file.wowsreplay>

# The full timeline.
wows-replay-sidecar bake --game <game dir> --replay <file.wowsreplay> \
    [--fps 10] [--out <file.wtreply>]
```

`probe` prints JSON on stdout. `bake` writes the blob to `--out`, or stdout when
omitted. Progress, warnings and errors are newline-delimited JSON on stderr, so
stdout stays a clean byte stream:

```json
{"t":"stage","stage":"baking"}
{"t":"progress","frame":2500,"total":9215}
{"t":"done","frames":9215,"bytes":28386534,"elapsedMs":5292,"spaceSize":1400, ...}
```

Loading game data costs ~3.4 s per process (GameParams dominates), against
0.3–5 s for the bake itself. A long-lived sidecar should hold that open across
bakes rather than paying it per replay.

### Cadence

`--fps` is frames per second of **game** time, defaulting to 10. At that rate a
30-knot ship covers about 1.5 m per frame on a 30 km map, which is sub-pixel,
and the client can interpolate ship positions between frames anyway. Size and
bake time both scale linearly with it.

Frame *n* sits at exactly *n*/fps seconds. This matters: accumulating a
`1.0 / fps` step instead drifts, because 0.1 is not representable in binary, and
over the ~12k frames of a long battle the error passes a whole frame and
desyncs the frame index from the battle clock beside it.

## Measured output

At `--fps 10`, on the 15.8.0.0 replay corpus:

| Replay | Battle | Frames | Size | Per frame | Bake |
|---|---|---|---|---|---|
| Bremen — OP1 (operation) | 1029 s | 10289 | 40.9 MB | 4.2 KB | 8.4 s |
| Azur Hindenburg — OP3 (operation) | 1166 s | 11660 | 36.3 MB | 3.3 KB | 8.7 s |
| Des Moines — Okinawa | 921 s | 9215 | 27.1 MB | 3.1 KB | 5.3 s |
| Des Moines — Tierra del Fuego | 622 s | 6223 | 14.8 MB | 2.5 KB | 4.0 s |
| Smolensk — NE North Winter | 609 s | 6089 | 11.8 MB | 2.0 KB | 4.3 s |
| St. Vincent — Bees to Honey | 399 s | 3989 | 7.0 MB | 1.9 KB | 3.7 s |

Bake times include the one-time game data load.

These are too large to cache the whole corpus — 664 replays would run to several
GB — and small enough that they do not need caching. Bake on open, hold in
memory, discard on close.

## Format

`.wtreply`, all little-endian.

```text
magic        u8[8]   "WTREPLY1"
version      u16     refuse anything you do not know
flags        u16     reserved, 0
fps          f32     frames per second of game time
frame_count  u32
space_size   i32     map extent in world units
minimap_size u32     pixel space positions are expressed in
battle_secs  f32     length of the baked window
header_len   u32
header       u8[header_len]                      UTF-8 JSON
index        (u32 offset, u32 len)[frame_count]   offsets relative to frames
frames       u8[...]                             each: u16 count, then records
```

A record is a `u8` tag then that tag's fixed payload. `RECORD_SIZES` in
`format.rs` is the authoritative width table, and the writer checks every tag
against it on first use — a mismatch panics during the bake rather than
producing a blob the client silently misreads.

### Positions

Positions stay in minimap pixel space, `0..minimap_size`. The renderer produces
them that way and radii arrive in pixels too, so converting in Rust would mean
transforming two quantities by two different rules. One linear transform on the
client moves everything into planner coordinates at once:

```text
world_x = (px_x / minimap_size - 0.5) * space_size
world_z = -(px_y / minimap_size - 0.5) * space_size
```

`space_size` is the same quantity the planner already stores as
`GameMap.spaceSize`, from the same source, so a replay and its map agree without
a lookup table. `header.map.name` matches `GameMap.spaceName`.

### Strings

`DrawCommand` carries player names, ship names and species as owned strings on
every ship in every frame — about 15 ships, ten times a second, for fifteen
minutes. They never change, so they live in `header.strings` and records refer
to them by `u16` id, 1-based so that 0 can mean absent.

This is most of the difference between ~14 KB and ~3 KB per frame. For the
Okinawa battle above, the entire table is 58 entries and 270 bytes.

Ship names need the game's gettext catalog
(`bin/<build>/res/texts/en/LC_MESSAGES/global.mo`). Without it the renderer
emits no `ship_name` at all and the bake warns on stderr rather than failing.

### What is not carried

HUD chrome is turned off at the renderer and never reaches the format: score
bar, timer, kill feed, chat, battle result, stats panels and team rosters. The
planner draws its own chrome from `header` and its ship database, so the
renderer's pixel-positioned versions would be dead weight.

Position trails and ship-config range circles are off by default too. Both
multiply the per-frame record count, and the planner can already draw range
rings from its own ship data. `format.rs` encodes both, so enabling them is a
flag change rather than new format work.

`header.skipped` counts every variant that was dropped, so nothing disappears
silently. Currently that is `ConsumableIcons` (the icon strip above each ship —
worth adding) and `BattleResultOverlay`.

## Building

Requires a linker. This machine has no MSVC, so use the GNU toolchain:

```sh
rustup run stable-x86_64-pc-windows-gnu cargo build --release
```

Note that building from Git Bash breaks even with MSVC installed, because
`/usr/bin/link.exe` (coreutils) shadows the MSVC linker of the same name.
