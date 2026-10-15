/**
 * Reader for the `.wtreply` timeline the sidecar bakes.
 *
 * The blob is held as one ArrayBuffer and frames are decoded on demand. That
 * matters: a long battle is around 1.5 million records, far too many to
 * materialize as objects, but a single frame is about 165 — cheap to build
 * fresh every time it is drawn. Because the frame index gives O(1) access,
 * pause, seek, rewind, frame-step and speed are all index arithmetic; nothing
 * has to be re-simulated or re-decoded to move around the battle.
 *
 * `sidecar/README.md` is the format spec. `RECORD_SIZES` below mirrors the
 * table of the same name in `sidecar/src/format.rs`, which the sidecar checks
 * its own output against, so the two cannot drift silently.
 */

const MAGIC = 'WTREPLY1';

/** Format versions this reader understands. */
const SUPPORTED_VERSIONS = [1];

const FIXED_HEADER_LEN = 36;

export const Tag = {
  ShotTracer: 1,
  ShotTracerTip: 2,
  SecondaryShotTracer: 3,
  SecondaryShotTracerTip: 4,
  Torpedo: 5,
  Smoke: 6,
  Ship: 7,
  HealthBar: 8,
  DeadShip: 9,
  BuffZone: 10,
  CapturePoint: 11,
  CameraDirection: 12,
  Building: 13,
  WeatherZone: 14,
  Plane: 15,
  ConsumableRadius: 16,
  PatrolRadius: 17,
  ShipConfigCircle: 18,
  PositionTrail: 19,
} as const;

export type TagValue = (typeof Tag)[keyof typeof Tag];

/**
 * Payload width per tag, excluding the tag byte. `null` is variable length.
 * Mirrors `RECORD_SIZES` in the sidecar.
 */
const RECORD_SIZES: Record<number, number | null> = {
  [Tag.ShotTracer]: 19,
  [Tag.ShotTracerTip]: 11,
  [Tag.SecondaryShotTracer]: 19,
  [Tag.SecondaryShotTracerTip]: 11,
  [Tag.Torpedo]: 11,
  [Tag.Smoke]: 14,
  [Tag.Ship]: 31,
  [Tag.HealthBar]: 20,
  [Tag.DeadShip]: 26,
  [Tag.BuffZone]: 16,
  [Tag.CapturePoint]: 21,
  [Tag.CameraDirection]: 21,
  [Tag.Building]: 14,
  [Tag.WeatherZone]: 10,
  [Tag.Plane]: 26,
  [Tag.ConsumableRadius]: 18,
  [Tag.PatrolRadius]: 22,
  [Tag.ShipConfigCircle]: 26,
  [Tag.PositionTrail]: null,
};

export const Visibility = { Visible: 0, MinimapOnly: 1, Undetected: 2 } as const;

export const BuildingIcon = [
  null,
  'airbase',
  'airDefence',
  'artillery',
  'generator',
  'radar',
  'station',
  'supply',
  'tower',
] as const;

export const BuildingRelation = [
  'ally',
  'enemy',
  'neutral',
  'dead',
  'suppressedAlly',
  'suppressedEnemy',
  'suppressedNeutral',
] as const;

export const CircleKind = [
  'detection',
  'mainBattery',
  'secondaryBattery',
  'torpedoRange',
  'radar',
  'hydro',
] as const;

/** Bit positions in the ship and dead-ship flag byte. */
export const ShipFlag = {
  IsSelf: 1 << 0,
  HasColor: 1 << 1,
  DetectedTeammate: 1 << 2,
  Disconnected: 1 << 3,
  HasNameColor: 1 << 4,
} as const;

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

export interface TimelineVehicle {
  name: string;
  /** 0 = the recording player, 1 = ally, 2 = enemy. */
  relation: number;
}

export interface TimelineHeader {
  replay?: string;
  clientVersion?: string;
  dateTime?: string;
  /** `map.name` matches `GameMap.spaceName`, e.g. `spaces/40_Okinawa`. */
  map?: { name?: string; displayName?: string };
  mode?: { gameMode?: number; gameType?: string | null; scenario?: string; matchGroup?: string | null };
  player?: { name?: string; vehicle?: string };
  vehicles?: TimelineVehicle[];
  strings: string[];
  /** Draw commands the sidecar dropped, by variant name, so gaps are visible. */
  skipped: Record<string, number>;
  records: number;
  nativeMinimapSize?: number;
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

/** A position in minimap pixel space, `0..minimapSize`. */
export interface Px {
  x: number;
  y: number;
}

/** Colors are packed 0xRRGGBB. `cssColor` turns one into a CSS string. */
export type Rgb = number;

interface Base<K extends string> {
  kind: K;
}

export interface TracerRecord extends Base<'tracer'> {
  from: Px;
  to: Px;
  color: Rgb;
  /** Secondary (ATBA) fire, which the renderer de-emphasizes. */
  secondary: boolean;
}

export interface TracerTipRecord extends Base<'tracerTip'> {
  at: Px;
  color: Rgb;
  secondary: boolean;
}

export interface TorpedoRecord extends Base<'torpedo'> {
  pos: Px;
  color: Rgb;
}

export interface SmokeRecord extends Base<'smoke'> {
  pos: Px;
  radius: number;
  color: Rgb;
  alpha: number;
}

export interface ShipRecord extends Base<'ship'> {
  entityId: number;
  pos: Px;
  /** Radians. */
  yaw: number;
  species?: string;
  /** Null means draw the icon in its native colors. */
  color: Rgb | null;
  visibility: number;
  opacity: number;
  isSelf: boolean;
  isDetectedTeammate: boolean;
  isDisconnected: boolean;
  playerName?: string;
  shipName?: string;
  /** Tints the player name by selected armament; null means default. */
  nameColor: Rgb | null;
}

export interface HealthBarRecord extends Base<'healthBar'> {
  entityId: number;
  pos: Px;
  fraction: number;
  fill: Rgb;
  background: Rgb;
  backgroundAlpha: number;
}

export interface DeadShipRecord extends Base<'deadShip'> {
  entityId: number;
  pos: Px;
  yaw: number;
  species?: string;
  color: Rgb | null;
  isSelf: boolean;
  playerName?: string;
  shipName?: string;
}

export interface BuffZoneRecord extends Base<'buffZone'> {
  pos: Px;
  radius: number;
  color: Rgb;
  alpha: number;
  markerName?: string;
}

export interface CapturePointRecord extends Base<'capturePoint'> {
  pos: Px;
  radius: number;
  color: Rgb;
  alpha: number;
  label?: string;
  progress: number;
  invaderColor: Rgb | null;
}

export interface CameraDirectionRecord extends Base<'cameraDirection'> {
  entityId: number;
  pos: Px;
  yaw: number;
  color: Rgb;
  length: number;
}

export interface BuildingRecord extends Base<'building'> {
  pos: Px;
  color: Rgb;
  isAlive: boolean;
  icon: (typeof BuildingIcon)[number];
  relation: (typeof BuildingRelation)[number];
}

export interface WeatherZoneRecord extends Base<'weatherZone'> {
  pos: Px;
  radius: number;
}

export interface PlaneRecord extends Base<'plane'> {
  planeId: bigint;
  ownerEntityId: number;
  pos: Px;
  iconKey?: string;
  playerName?: string;
  shipName?: string;
}

export interface ConsumableRadiusRecord extends Base<'consumableRadius'> {
  entityId: number;
  pos: Px;
  radius: number;
  color: Rgb;
  alpha: number;
}

export interface PatrolRadiusRecord extends Base<'patrolRadius'> {
  planeId: bigint;
  pos: Px;
  radius: number;
  color: Rgb;
  alpha: number;
}

export interface ShipConfigCircleRecord extends Base<'shipConfigCircle'> {
  entityId: number;
  pos: Px;
  radius: number;
  color: Rgb;
  alpha: number;
  dashed: boolean;
  isSelf: boolean;
  label?: string;
  circleKind: (typeof CircleKind)[number];
  playerName?: string;
}

export interface PositionTrailRecord extends Base<'positionTrail'> {
  entityId: number;
  playerName?: string;
  points: { pos: Px; color: Rgb }[];
}

export type Record_ =
  | TracerRecord
  | TracerTipRecord
  | TorpedoRecord
  | SmokeRecord
  | ShipRecord
  | HealthBarRecord
  | DeadShipRecord
  | BuffZoneRecord
  | CapturePointRecord
  | CameraDirectionRecord
  | BuildingRecord
  | WeatherZoneRecord
  | PlaneRecord
  | ConsumableRadiusRecord
  | PatrolRadiusRecord
  | ShipConfigCircleRecord
  | PositionTrailRecord;

/* ------------------------------------------------------------------ */
/* Colors                                                              */
/* ------------------------------------------------------------------ */

const cssCache = new Map<number, string>();

/** `0xRRGGBB` to `#rrggbb`, memoized — a battle only uses a few dozen colors. */
export function cssColor(rgb: Rgb): string {
  let css = cssCache.get(rgb);
  if (css === undefined) {
    css = '#' + rgb.toString(16).padStart(6, '0');
    cssCache.set(rgb, css);
  }
  return css;
}

/* ------------------------------------------------------------------ */
/* Reader                                                              */
/* ------------------------------------------------------------------ */

export class TimelineFormatError extends Error {}

export class ReplayTimeline {
  readonly fps: number;
  readonly frameCount: number;
  /** Map extent in world units; the same quantity as `GameMap.spaceSize`. */
  readonly spaceSize: number;
  /** Pixel space record positions live in. */
  readonly minimapSize: number;
  readonly battleSeconds: number;
  readonly header: TimelineHeader;

  private readonly dv: DataView;
  private readonly bytes: Uint8Array;
  /** Byte offset of the frame index. */
  private readonly indexAt_: number;
  /** Byte offset frame offsets are relative to. */
  private readonly framesAt: number;

  /**
   * True for a bake without player data (no names, relations or view
   * direction). Detected by the recording player's name missing from the
   * string table, since their ship is in every battle.
   */
  get lacksPlayers(): boolean {
    const name = this.header.player?.name;
    return !!name && !this.header.strings.includes(name);
  }

  /**
   * Accepts either an ArrayBuffer or a view of one. A `Uint8Array` arriving
   * over IPC need not start at offset zero, and every read here is relative to
   * the start of the timeline, so the view's own bounds are what count — taking
   * `.buffer` and ignoring `byteOffset` would read from the wrong place.
   */
  constructor(source: ArrayBuffer | Uint8Array) {
    this.bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    this.dv = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    const size = this.bytes.byteLength;

    if (size < FIXED_HEADER_LEN) {
      throw new TimelineFormatError(`timeline is only ${size} bytes; it cannot hold a header`);
    }
    const magic = String.fromCharCode(...this.bytes.subarray(0, 8));
    if (magic !== MAGIC) {
      throw new TimelineFormatError(`not a timeline: magic is ${JSON.stringify(magic)}`);
    }
    const version = this.dv.getUint16(8, true);
    if (!SUPPORTED_VERSIONS.includes(version)) {
      // Refusing beats guessing: an unknown version may have renumbered tags
      // or changed record widths, and a wrong width desyncs every later record.
      throw new TimelineFormatError(
        `timeline format version ${version} is not supported (this build reads ${SUPPORTED_VERSIONS.join(', ')})`,
      );
    }

    this.fps = this.dv.getFloat32(12, true);
    this.frameCount = this.dv.getUint32(16, true);
    this.spaceSize = this.dv.getInt32(20, true);
    this.minimapSize = this.dv.getUint32(24, true);
    this.battleSeconds = this.dv.getFloat32(28, true);
    const headerLen = this.dv.getUint32(32, true);

    const headerEnd = FIXED_HEADER_LEN + headerLen;
    this.indexAt_ = headerEnd;
    this.framesAt = headerEnd + this.frameCount * 8;
    if (this.framesAt > size) {
      throw new TimelineFormatError('timeline is truncated: the frame index runs past the end of the file');
    }

    try {
      this.header = JSON.parse(new TextDecoder().decode(this.bytes.subarray(FIXED_HEADER_LEN, headerEnd)));
    } catch (err) {
      throw new TimelineFormatError(`timeline header is not valid JSON: ${(err as Error).message}`);
    }
    if (!Array.isArray(this.header.strings)) {
      throw new TimelineFormatError('timeline header has no string table');
    }

    // A truncated file would otherwise only be noticed when playback reached
    // the missing frames. The last index entry says where the frame data ends,
    // so one read up front catches it — worth doing, because the sidecar writes
    // the blob to disk or streams it over a pipe, and either can be cut short.
    if (this.frameCount > 0) {
      const last = this.indexAt_ + (this.frameCount - 1) * 8;
      const end = this.framesAt + this.dv.getUint32(last, true) + this.dv.getUint32(last + 4, true);
      if (end > size) {
        throw new TimelineFormatError(`timeline is truncated: frames end at ${end} but the file is ${size} bytes`);
      }
    }
  }

  /** Battle clock of a frame, in seconds. Exact: frame n sits at n/fps. */
  clockAt(index: number): number {
    return index / this.fps;
  }

  /** The frame covering a battle clock, clamped to the baked range. */
  indexAt(seconds: number): number {
    const i = Math.floor(seconds * this.fps);
    return i < 0 ? 0 : i >= this.frameCount ? this.frameCount - 1 : i;
  }

  /**
   * Minimap pixels to world coordinates. The planner and the replay agree on
   * `spaceSize` because both take it from the game's own space settings, so no
   * per-map calibration is needed.
   */
  toWorld(p: Px): { x: number; z: number } {
    const unit = this.spaceSize / this.minimapSize;
    const half = this.spaceSize / 2;
    return { x: p.x * unit - half, z: -(p.y * unit - half) };
  }

  /** A string-table entry. Id 0 means absent. */
  private str(id: number): string | undefined {
    return id === 0 ? undefined : this.header.strings[id - 1];
  }

  /**
   * Decode one frame. Returns a fresh array; callers should not hold onto it
   * across frames.
   */
  frame(index: number): Record_[] {
    if (!Number.isInteger(index) || index < 0 || index >= this.frameCount) {
      throw new RangeError(`frame ${index} is outside 0..${this.frameCount - 1}`);
    }
    const dv = this.dv;
    const offset = dv.getUint32(this.indexAt_ + index * 8, true);
    const length = dv.getUint32(this.indexAt_ + index * 8 + 4, true);
    const base = this.framesAt + offset;
    const end = base + length;
    if (end > this.bytes.byteLength) {
      throw new TimelineFormatError(`frame ${index} runs past the end of the file`);
    }

    const count = dv.getUint16(base, true);
    const out: Record_[] = new Array(count);
    let p = base + 2;

    for (let i = 0; i < count; i++) {
      const tag = dv.getUint8(p);
      const width = RECORD_SIZES[tag];
      if (width === undefined) {
        throw new TimelineFormatError(`frame ${index}: unknown record tag ${tag}`);
      }
      p += 1;
      out[i] = this.decode(tag, p);
      p += width ?? 8 + dv.getUint16(p + 6, true) * 11;
    }
    if (p !== end) {
      throw new TimelineFormatError(`frame ${index}: records end at ${p - base} but the frame is ${length} bytes`);
    }
    return out;
  }

  private pos(p: number): Px {
    return { x: this.dv.getFloat32(p, true), y: this.dv.getFloat32(p + 4, true) };
  }

  private rgb(p: number): Rgb {
    return (this.dv.getUint8(p) << 16) | (this.dv.getUint8(p + 1) << 8) | this.dv.getUint8(p + 2);
  }

  private decode(tag: number, p: number): Record_ {
    const dv = this.dv;
    switch (tag) {
      case Tag.ShotTracer:
      case Tag.SecondaryShotTracer:
        return {
          kind: 'tracer',
          from: this.pos(p),
          to: this.pos(p + 8),
          color: this.rgb(p + 16),
          secondary: tag === Tag.SecondaryShotTracer,
        };
      case Tag.ShotTracerTip:
      case Tag.SecondaryShotTracerTip:
        return {
          kind: 'tracerTip',
          at: this.pos(p),
          color: this.rgb(p + 8),
          secondary: tag === Tag.SecondaryShotTracerTip,
        };
      case Tag.Torpedo:
        return { kind: 'torpedo', pos: this.pos(p), color: this.rgb(p + 8) };
      case Tag.Smoke:
        return {
          kind: 'smoke',
          pos: this.pos(p),
          radius: dv.getInt16(p + 8, true),
          color: this.rgb(p + 10),
          alpha: dv.getUint8(p + 13) / 255,
        };
      case Tag.Ship: {
        const flags = dv.getUint8(p + 23);
        return {
          kind: 'ship',
          entityId: dv.getUint32(p, true),
          pos: this.pos(p + 4),
          yaw: dv.getFloat32(p + 12, true),
          species: this.str(dv.getUint16(p + 16, true)),
          color: flags & ShipFlag.HasColor ? this.rgb(p + 18) : null,
          visibility: dv.getUint8(p + 21),
          opacity: dv.getUint8(p + 22) / 255,
          isSelf: !!(flags & ShipFlag.IsSelf),
          isDetectedTeammate: !!(flags & ShipFlag.DetectedTeammate),
          isDisconnected: !!(flags & ShipFlag.Disconnected),
          playerName: this.str(dv.getUint16(p + 24, true)),
          shipName: this.str(dv.getUint16(p + 26, true)),
          nameColor: flags & ShipFlag.HasNameColor ? this.rgb(p + 28) : null,
        };
      }
      case Tag.HealthBar:
        return {
          kind: 'healthBar',
          entityId: dv.getUint32(p, true),
          pos: this.pos(p + 4),
          fraction: dv.getUint8(p + 12) / 255,
          fill: this.rgb(p + 13),
          background: this.rgb(p + 16),
          backgroundAlpha: dv.getUint8(p + 19) / 255,
        };
      case Tag.DeadShip: {
        const flags = dv.getUint8(p + 21);
        return {
          kind: 'deadShip',
          entityId: dv.getUint32(p, true),
          pos: this.pos(p + 4),
          yaw: dv.getFloat32(p + 12, true),
          species: this.str(dv.getUint16(p + 16, true)),
          color: flags & ShipFlag.HasColor ? this.rgb(p + 18) : null,
          isSelf: !!(flags & ShipFlag.IsSelf),
          playerName: this.str(dv.getUint16(p + 22, true)),
          shipName: this.str(dv.getUint16(p + 24, true)),
        };
      }
      case Tag.BuffZone:
        return {
          kind: 'buffZone',
          pos: this.pos(p),
          radius: dv.getInt16(p + 8, true),
          color: this.rgb(p + 10),
          alpha: dv.getUint8(p + 13) / 255,
          markerName: this.str(dv.getUint16(p + 14, true)),
        };
      case Tag.CapturePoint:
        return {
          kind: 'capturePoint',
          pos: this.pos(p),
          radius: dv.getInt16(p + 8, true),
          color: this.rgb(p + 10),
          alpha: dv.getUint8(p + 13) / 255,
          label: this.str(dv.getUint16(p + 14, true)),
          progress: dv.getUint8(p + 16) / 255,
          invaderColor: dv.getUint8(p + 20) ? this.rgb(p + 17) : null,
        };
      case Tag.CameraDirection:
        return {
          kind: 'cameraDirection',
          entityId: dv.getUint32(p, true),
          pos: this.pos(p + 4),
          yaw: dv.getFloat32(p + 12, true),
          color: this.rgb(p + 16),
          length: dv.getInt16(p + 19, true),
        };
      case Tag.Building:
        return {
          kind: 'building',
          pos: this.pos(p),
          color: this.rgb(p + 8),
          isAlive: !!dv.getUint8(p + 11),
          icon: BuildingIcon[dv.getUint8(p + 12)] ?? null,
          relation: BuildingRelation[dv.getUint8(p + 13)] ?? 'neutral',
        };
      case Tag.WeatherZone:
        return { kind: 'weatherZone', pos: this.pos(p), radius: dv.getInt16(p + 8, true) };
      case Tag.Plane:
        return {
          kind: 'plane',
          planeId: dv.getBigUint64(p, true),
          ownerEntityId: dv.getUint32(p + 8, true),
          pos: this.pos(p + 12),
          iconKey: this.str(dv.getUint16(p + 20, true)),
          playerName: this.str(dv.getUint16(p + 22, true)),
          shipName: this.str(dv.getUint16(p + 24, true)),
        };
      case Tag.ConsumableRadius:
        return {
          kind: 'consumableRadius',
          entityId: dv.getUint32(p, true),
          pos: this.pos(p + 4),
          radius: dv.getInt16(p + 12, true),
          color: this.rgb(p + 14),
          alpha: dv.getUint8(p + 17) / 255,
        };
      case Tag.PatrolRadius:
        return {
          kind: 'patrolRadius',
          planeId: dv.getBigUint64(p, true),
          pos: this.pos(p + 8),
          radius: dv.getInt16(p + 16, true),
          color: this.rgb(p + 18),
          alpha: dv.getUint8(p + 21) / 255,
        };
      case Tag.ShipConfigCircle: {
        const flags = dv.getUint8(p + 20);
        return {
          kind: 'shipConfigCircle',
          entityId: dv.getUint32(p, true),
          pos: this.pos(p + 4),
          radius: dv.getFloat32(p + 12, true),
          color: this.rgb(p + 16),
          alpha: dv.getUint8(p + 19) / 255,
          dashed: !!(flags & 1),
          isSelf: !!(flags & 2),
          label: this.str(dv.getUint16(p + 21, true)),
          circleKind: CircleKind[dv.getUint8(p + 23)] ?? 'detection',
          playerName: this.str(dv.getUint16(p + 24, true)),
        };
      }
      case Tag.PositionTrail: {
        const n = dv.getUint16(p + 6, true);
        const points = new Array<{ pos: Px; color: Rgb }>(n);
        for (let i = 0; i < n; i++) {
          const at = p + 8 + i * 11;
          points[i] = { pos: this.pos(at), color: this.rgb(at + 8) };
        }
        return {
          kind: 'positionTrail',
          entityId: dv.getUint32(p, true),
          playerName: this.str(dv.getUint16(p + 4, true)),
          points,
        };
      }
      default:
        throw new TimelineFormatError(`unhandled record tag ${tag}`);
    }
  }
}
