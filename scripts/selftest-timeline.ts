/**
 * Checks for the replay timeline reader.
 *
 * The fixture is encoded here by hand from the format spec in
 * `sidecar/README.md`, deliberately not by calling anything the reader uses.
 * Two independent implementations agreeing on every byte offset is the point:
 * a reader tested against its own writer would pass with both of them wrong.
 *
 * Set WOWSPLAN_TIMELINE to a real `.wtreply` to additionally read a blob the
 * sidecar actually produced. That path is skipped when unset, so this runs on
 * a machine with no game install.
 */

import fs from 'node:fs/promises';

import { ReplayTimeline, TimelineFormatError, cssColor } from '../src/replay/timeline';
import { extractPaths, lastIndexAt, type ShipPath } from '../src/replay/paths';
import { DISTINCT_COLORS, colorDistance, distinctStyles } from '../src/replay/colors';
import { extractPage } from '../src/replay/extract';
import type { GameMap, Ship, ShipObject, Team } from '../src/types/model';

/** Minimal little-endian writer, so the fixture shares no code with the reader. */
class W {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    return this.u8(v).u8(v >>> 8);
  }
  u32(v: number) {
    return this.u16(v).u16(v >>> 16);
  }
  i16(v: number) {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  u64(v: bigint) {
    for (let i = 0n; i < 8n; i++) this.u8(Number((v >> (8n * i)) & 0xffn));
    return this;
  }
  f32(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    for (const x of b) this.u8(x);
    return this;
  }
  ascii(s: string) {
    for (const c of s) this.u8(c.charCodeAt(0));
    return this;
  }
  raw(a: number[]) {
    this.bytes.push(...a);
    return this;
  }
  pos(x: number, y: number) {
    return this.f32(x).f32(y);
  }
  rgb(r: number, g: number, b: number) {
    return this.u8(r).u8(g).u8(b);
  }
  get length() {
    return this.bytes.length;
  }
  toArray() {
    return this.bytes.slice();
  }
}

const STRINGS = ['Destroyer', 'SyeRex', 'Shimakaze', 'A', 'airsupport/bomber'];
const S = {
  destroyer: 1,
  syerex: 2,
  shimakaze: 3,
  capA: 4,
  bomber: 5,
};

/** One frame holding a record of each shape the reader has to get right. */
function buildFrame(): number[] {
  const f = new W();
  f.u16(6); // record count

  // Ship: string ids, flag bits, present color, absent name color.
  f.u8(7)
    .u32(1234)
    .pos(100.5, 200.25)
    .f32(1.5)
    .u16(S.destroyer)
    .rgb(0x4c, 0xe8, 0xaa)
    .u8(1) // visibility = MinimapOnly
    .u8(128) // opacity
    .u8(1 | 2 | 8) // IsSelf | HasColor | Disconnected
    .u16(S.syerex)
    .u16(S.shimakaze)
    .rgb(0, 0, 0); // name color, not flagged present

  // Secondary tracer: distinguished from the primary only by its tag.
  f.u8(3).pos(1, 2).pos(3, 4).rgb(255, 0, 0);

  // Torpedo.
  f.u8(5).pos(10, 20).rgb(0, 255, 0);

  // Capture point: quantized progress and a flagged invader color.
  f.u8(11)
    .pos(384, 384)
    .i16(60)
    .rgb(1, 2, 3)
    .u8(255) // alpha
    .u16(S.capA)
    .u8(128) // progress
    .rgb(9, 9, 9)
    .u8(1); // invader color present

  // Plane: the only record with a u64 id.
  f.u8(15)
    .u64(0x1_0000_0002n)
    .u32(1234)
    .pos(5, 6)
    .u16(S.bomber)
    .u16(S.syerex)
    .u16(0); // no ship name

  // Position trail: the only variable-length record.
  f.u8(19).u32(1234).u16(S.syerex).u16(2).pos(1, 1).rgb(10, 20, 30).pos(2, 2).rgb(40, 50, 60);

  return f.toArray();
}

function buildTimeline(opts: { version?: number; magic?: string } = {}): Uint8Array {
  const header = JSON.stringify({
    replay: 'fixture.wowsreplay',
    map: { name: 'spaces/40_Okinawa', displayName: '40_Okinawa' },
    player: { name: 'SyeRex' },
    strings: STRINGS,
    skipped: { ConsumableIcons: 7 },
    records: 6,
  });
  const headerBytes = [...new TextEncoder().encode(header)];
  const frame = buildFrame();

  const w = new W();
  w.ascii(opts.magic ?? 'WTREPLY1')
    .u16(opts.version ?? 1)
    .u16(0)
    .f32(10)
    .u32(1) // one frame
    .u32(1400) // spaceSize
    .u32(768) // minimapSize
    .f32(0.1)
    .u32(headerBytes.length)
    .raw(headerBytes)
    .u32(0) // frame 0 offset
    .u32(frame.length)
    .raw(frame);
  return new Uint8Array(w.toArray());
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * A view that does not start at offset zero, which is what a Uint8Array
 * arriving over IPC can look like. Reading `.buffer` and ignoring byteOffset
 * would silently decode from the wrong place.
 */
function offsetView(bytes: Uint8Array): Uint8Array {
  const padded = new Uint8Array(bytes.byteLength + 7);
  padded.set(bytes, 7);
  return padded.subarray(7);
}

export async function testReplayTimeline(check: (l: string, c: boolean, d?: unknown) => void): Promise<void> {
  console.log('\nreplay timeline reader');

  const t = new ReplayTimeline(buffer(buildTimeline()));

  // Same blob, reached through a view with a non-zero byteOffset.
  const viewed = new ReplayTimeline(offsetView(buildTimeline()));
  check('view: offset view reads the same header', viewed.frameCount === 1 && viewed.spaceSize === 1400, {
    frames: viewed.frameCount,
    spaceSize: viewed.spaceSize,
  });
  // A plain JSON.stringify would throw here: the plane record carries a
  // bigint id, which JSON cannot represent.
  const dump = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
  check('view: offset view decodes the same frame', dump(viewed.frame(0)) === dump(t.frame(0)));

  check('header: fps', t.fps === 10, t.fps);
  check('header: frame count', t.frameCount === 1, t.frameCount);
  check('header: space size', t.spaceSize === 1400, t.spaceSize);
  check('header: minimap size', t.minimapSize === 768, t.minimapSize);
  check('header: map name matches GameMap.spaceName', t.header.map?.name === 'spaces/40_Okinawa', t.header.map);
  check('header: skipped variants surfaced', t.header.skipped.ConsumableIcons === 7, t.header.skipped);

  // Frame n sits at exactly n/fps, and the inverse clamps rather than throwing.
  check('clock: frame 0', t.clockAt(0) === 0, t.clockAt(0));
  check('clock: frame 25 at 10 fps', t.clockAt(25) === 2.5, t.clockAt(25));
  check('clock: index clamps past the end', t.indexAt(9999) === 0, t.indexAt(9999));
  check('clock: index clamps below zero', t.indexAt(-5) === 0, t.indexAt(-5));

  // Minimap centre is the world origin; the y axis is flipped.
  const centre = t.toWorld({ x: 384, y: 384 });
  check('world: minimap centre is the origin', centre.x === 0 && centre.z === 0, centre);
  const corner = t.toWorld({ x: 0, y: 0 });
  check('world: top-left corner', corner.x === -700 && corner.z === 700, corner);

  const frame = t.frame(0);
  check('frame: record count', frame.length === 6, frame.length);

  const ship = frame[0];
  if (ship.kind !== 'ship') {
    check('frame: first record is a ship', false, ship.kind);
  } else {
    check('ship: entity id', ship.entityId === 1234, ship.entityId);
    check('ship: position', ship.pos.x === 100.5 && ship.pos.y === 200.25, ship.pos);
    check('ship: yaw', ship.yaw === 1.5, ship.yaw);
    check('ship: species interned', ship.species === 'Destroyer', ship.species);
    check('ship: player name interned', ship.playerName === 'SyeRex', ship.playerName);
    check('ship: ship name interned', ship.shipName === 'Shimakaze', ship.shipName);
    check('ship: color packed', ship.color === 0x4ce8aa, ship.color?.toString(16));
    check('ship: absent name color is null', ship.nameColor === null, ship.nameColor);
    check('ship: visibility', ship.visibility === 1, ship.visibility);
    check('ship: opacity dequantized', Math.abs(ship.opacity - 128 / 255) < 1e-6, ship.opacity);
    check('ship: isSelf flag', ship.isSelf === true, ship.isSelf);
    check('ship: disconnected flag', ship.isDisconnected === true, ship.isDisconnected);
    check('ship: detectedTeammate flag not set', ship.isDetectedTeammate === false, ship.isDetectedTeammate);
  }

  const tracer = frame[1];
  check('tracer: secondary tag recognized', tracer.kind === 'tracer' && tracer.secondary === true, tracer);

  const torp = frame[2];
  check('torpedo: decoded', torp.kind === 'torpedo' && torp.color === 0x00ff00, torp);

  const cap = frame[3];
  if (cap.kind !== 'capturePoint') {
    check('frame: fourth record is a capture point', false, cap.kind);
  } else {
    check('cap: label interned', cap.label === 'A', cap.label);
    check('cap: radius', cap.radius === 60, cap.radius);
    check('cap: progress dequantized', Math.abs(cap.progress - 128 / 255) < 1e-6, cap.progress);
    check('cap: invader color present', cap.invaderColor === 0x090909, cap.invaderColor);
  }

  const plane = frame[4];
  if (plane.kind !== 'plane') {
    check('frame: fifth record is a plane', false, plane.kind);
  } else {
    // Beyond 2^32, so a u32 read would silently truncate this.
    check('plane: 64-bit id survives', plane.planeId === 0x1_0000_0002n, plane.planeId.toString());
    check('plane: owner entity', plane.ownerEntityId === 1234, plane.ownerEntityId);
    check('plane: icon key interned', plane.iconKey === 'airsupport/bomber', plane.iconKey);
    check('plane: absent ship name', plane.shipName === undefined, plane.shipName);
  }

  const trail = frame[5];
  if (trail.kind !== 'positionTrail') {
    check('frame: sixth record is a trail', false, trail.kind);
  } else {
    check('trail: variable length walked', trail.points.length === 2, trail.points.length);
    check('trail: second point', trail.points[1].color === 0x28323c, trail.points[1].color.toString(16));
  }

  // A frame whose records did not consume exactly its declared length means an
  // offset is wrong somewhere, which is the failure this reader must not
  // paper over. Reaching here at all proves the walk landed exactly.
  check('frame: out of range is rejected', rejects(() => t.frame(1)), 'frame(1)');
  check('frame: negative index is rejected', rejects(() => t.frame(-1)), 'frame(-1)');

  check('cssColor: packed to hex', cssColor(0x4ce8aa) === '#4ce8aa', cssColor(0x4ce8aa));
  check('cssColor: pads short values', cssColor(0x0000ff) === '#0000ff', cssColor(0x0000ff));

  // Refusing an unknown version matters more than it looks: a future version
  // may renumber tags or change a record width, and a wrong width desyncs
  // every record after it rather than failing outright.
  check(
    'guard: unknown version refused',
    throwsFormatError(() => new ReplayTimeline(buffer(buildTimeline({ version: 99 })))),
    'version 99',
  );
  check(
    'guard: wrong magic refused',
    throwsFormatError(() => new ReplayTimeline(buffer(buildTimeline({ magic: 'NOTATIME' })))),
    'bad magic',
  );
  check(
    'guard: truncated file refused',
    throwsFormatError(() => new ReplayTimeline(buffer(buildTimeline().subarray(0, 20)))),
    'truncated',
  );
  const clipped = buildTimeline();
  check(
    'guard: index past EOF refused',
    throwsFormatError(() => new ReplayTimeline(buffer(clipped.subarray(0, clipped.length - 40)))),
    'clipped frames',
  );

  // Overlay paths: the fixture's one ship is the recording player, seen on the minimap.
  const op = extractPaths(t);
  const own = op.paths[0];
  check(
    'paths: the self ship is one ally path with its position',
    op.paths.length === 1 && own?.ally === true && own.points.length === 1 && own.points[0]!.pos.x === 100.5,
    op.paths,
  );
  check('paths: self keeps no tint of its own', own?.color === null, own?.color);
  check('paths: carry the map for matching', op.spaceName === 'spaces/40_Okinawa' && op.minimapSize === 768, op.spaceName);
  const pts = [0, 1, 2, 5].map((t) => ({ t, pos: { x: 0, y: 0 }, yaw: 0 }));
  check(
    'paths: lastIndexAt finds the last point at or before a time',
    lastIndexAt(pts, -1) === -1 && lastIndexAt(pts, 0) === 0 && lastIndexAt(pts, 3) === 2 && lastIndexAt(pts, 9) === 3,
  );

  // Unique colours: crowded trails get far-apart colours, and every style is used once.
  const line = (id: number, x0: number, y: number): ShipPath => ({
    entityId: id,
    ally: true,
    color: null,
    diedAt: null,
    points: Array.from({ length: 30 }, (_, i) => ({ t: i, pos: { x: x0 + i, y }, yaw: 0 })),
  });
  const crowd = Array.from({ length: 24 }, (_, i) => line(i, 0, 100 + i)); // all within reach of each other
  const crowdStyles = distinctStyles(crowd, 768);
  check(
    'colours: 24 crowded ships get 24 different styles',
    new Set(crowdStyles.map((st) => `${st.color}:${st.dashed}`)).size === 24,
  );
  const pair = distinctStyles([line(1, 0, 100), line(2, 0, 102)], 768);
  const best = Math.max(...DISTINCT_COLORS.map((c) => colorDistance(DISTINCT_COLORS[0], c)));
  check('colours: two neighbours are as far apart as the first colour allows', colorDistance(pair[0]!.color, pair[1]!.color) === best, pair);

  await testRealTimeline(check);
}

function rejects(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

function throwsFormatError(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    return err instanceof TimelineFormatError;
  }
}

/** Reads a blob the sidecar really produced, when one is pointed at. */
async function testRealTimeline(check: (l: string, c: boolean, d?: unknown) => void): Promise<void> {
  const file = process.env.WOWSPLAN_TIMELINE;
  if (!file) {
    console.log('  skip  real .wtreply (set WOWSPLAN_TIMELINE to a baked file)');
    return;
  }
  console.log(`\nreplay timeline reader — ${file}`);
  const bytes = await fs.readFile(file);
  const t = new ReplayTimeline(buffer(new Uint8Array(bytes)));
  check('real: frames present', t.frameCount > 0, t.frameCount);
  check('real: frame count matches battle length', Math.round(t.battleSeconds * t.fps) === t.frameCount, {
    frames: t.frameCount,
    implied: Math.round(t.battleSeconds * t.fps),
  });

  // Walk every frame. Any offset error anywhere trips the reader's own
  // end-of-frame check, so this is a full structural pass over the file.
  let records = 0;
  let ships = 0;
  const kinds = new Set<string>();
  for (let i = 0; i < t.frameCount; i++) {
    for (const r of t.frame(i)) {
      records++;
      kinds.add(r.kind);
      if (r.kind === 'ship') {
        ships++;
        if (r.pos.x < -64 || r.pos.x > t.minimapSize + 64) {
          check(`real: ship position in range at frame ${i}`, false, r.pos);
          return;
        }
      }
    }
  }
  check('real: every frame decodes', records > 0, records);
  check('real: record count matches the header', records === t.header.records, {
    decoded: records,
    header: t.header.records,
  });
  check('real: ships present in every battle', ships > 0, ships);
  console.log(`  info  ${records} records, ${kinds.size} kinds: ${[...kinds].sort().join(', ')}`);

  checkHeadings(check, t);

  const started = performance.now();
  const op = extractPaths(t);
  const ms = Math.round(performance.now() - started);
  check('real paths: both teams present', op.paths.some((p) => p.ally) && op.paths.some((p) => !p.ally), op.paths.length);
  check(
    'real paths: points in time order',
    op.paths.every((p) => p.points.every((q, i) => i === 0 || q.t >= p.points[i - 1]!.t)),
  );
  check('real paths: extracted in under half a second', ms < 500, ms);
  console.log(`  info  ${op.paths.length} paths in ${ms} ms`);

  const t0 = performance.now();
  const styles = distinctStyles(op.paths, op.minimapSize);
  const styleMs = Math.round(performance.now() - t0);
  check('real colours: every ship has its own style', new Set(styles.map((st) => `${st.color}:${st.dashed}`)).size === op.paths.length);
  check('real colours: assigned in under half a second', styleMs < 500, styleMs);

  // Tactics extractor, at the end of the battle so sunk ships are in play.
  const teams = [
    { id: 'alpha', name: 'Alpha', color: '#4ce8aa', visible: true, locked: false },
    { id: 'bravo', name: 'Bravo', color: '#fe4d2a', visible: true, locked: false },
  ] as Team[];
  const map = { id: 'map-okinawa', name: 'Okinawa', widthMeters: 42000, heightMeters: 42000 } as GameMap;
  const db = [{ id: 'dm', name: 'Des Moines', nation: 'USA', class: 'CA', tier: 10 }] as Ship[];
  const { page, unmatched } = extractPage({
    timeline: t, frame: t.frameCount - 1, windowSeconds: 120, map, ships: db, teams, capLayouts: [], replayName: 'test',
  });
  const placed = page.objects.filter((o): o is ShipObject => o.type === 'ship');
  const arrows = page.objects.filter((o) => o.type === 'arrow');
  check('extract: every ship seen in the battle is placed, sunk ones too', placed.length === op.paths.length, placed.length);
  check('extract: the page is named after the map and the player ship, no time', page.name === 'Okinawa – Des Moines', page.name);
  const dm = placed.find((o) => o.shipName === 'Des Moines');
  check('extract: a known ship is linked to the database', dm?.shipId === 'dm' && dm.teamId === 'alpha', dm?.shipId);
  const sunk = placed.filter((o) => o.label?.includes('sunk'));
  check('extract: sunk ships are black and say when they sank', sunk.length > 0 && sunk.every((o) => o.iconColor === '#000000'), sunk.length);
  check('extract: unknown ships are listed, not dropped', unmatched.length === new Set(placed.map((o) => o.shipName)).size - 1 && page.notes.includes('Not in the ship database'));
  check('extract: routes become arrows on the annotations layer', arrows.length > 0 && arrows.every((a) => a.layerId === 'layer-annotations'), arrows.length);
  check('extract: ships stay inside the map', placed.every((o) => o.x >= -500 && o.x <= 42500 && o.y >= -500 && o.y <= 42500));
  console.log(`  info  ${placed.length} ships (${sunk.length} sunk), ${arrows.length} arrows`);
}

/**
 * Checks that a ship's heading matches the direction it actually travels.
 *
 * This is the one property that cannot be eyeballed from a still frame and
 * cannot be checked against the renderer's own output without reconstructing
 * its timelapse frame-to-clock mapping. But it needs neither: ships go forwards.
 * Over a couple of seconds, the bearing from one position to the next must
 * agree with where the bow is pointing.
 *
 * It also pins the whole orientation chain at once. The renderer states its
 * convention in `drawing.rs` — icons point up, game yaw is 0 at east and
 * increases counter-clockwise — which puts the bow at `(cos yaw, -sin yaw)` in
 * minimap pixels, y down. A sign error in the yaw conversion, a flipped axis in
 * the pixel transform, or a mixed-up sine would each show up here as a large,
 * systematic angular error rather than as a plausible-looking picture.
 */
function checkHeadings(check: (l: string, c: boolean, d?: unknown) => void, t: ReplayTimeline): void {
  const gap = Math.max(1, Math.round(t.fps * 2));
  /** Minimap pixels. Below this a ship is manoeuvring or stopped, and its
      course says nothing useful. */
  const MIN_TRAVEL = 3;

  const errors: number[] = [];
  for (let f = 0; f + gap < t.frameCount; f += Math.max(1, Math.floor(t.frameCount / 40))) {
    const a = new Map<number, { x: number; y: number; yaw: number }>();
    for (const r of t.frame(f)) {
      if (r.kind === 'ship' && r.visibility === 0) a.set(r.entityId, { x: r.pos.x, y: r.pos.y, yaw: r.yaw });
    }
    for (const r of t.frame(f + gap)) {
      if (r.kind !== 'ship' || r.visibility !== 0) continue;
      const prev = a.get(r.entityId);
      if (!prev) continue;
      const dx = r.pos.x - prev.x;
      const dy = r.pos.y - prev.y;
      if (Math.hypot(dx, dy) < MIN_TRAVEL) continue;

      // Bow direction implied by the yaw halfway through the interval.
      const bowX = Math.cos(prev.yaw);
      const bowY = -Math.sin(prev.yaw);
      const dot = (dx * bowX + dy * bowY) / Math.hypot(dx, dy);
      errors.push((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI);
    }
  }

  if (errors.length < 20) {
    console.log(`  skip  heading check (only ${errors.length} usable samples)`);
    return;
  }
  errors.sort((x, y) => x - y);
  const median = errors[Math.floor(errors.length / 2)]!;
  const within30 = errors.filter((e) => e < 30).length / errors.length;

  // A ship under helm genuinely points off its track, and a reversing ship
  // points the opposite way entirely, so this asserts the bulk rather than
  // every sample. A wrong convention puts the median near 90 or 180 degrees.
  check(`heading: median error is small (${median.toFixed(1)} deg over ${errors.length} samples)`, median < 20, median);
  check(`heading: most ships travel bow-first (${(within30 * 100).toFixed(0)}%)`, within30 > 0.8, within30);
}
