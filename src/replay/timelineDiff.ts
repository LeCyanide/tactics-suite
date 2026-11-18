/**
 * Compares two replay timelines record by record.
 *
 * Built for one job: proving that a sidecar built on a different replay
 * parser produces the same timeline as the current one for the same replay.
 * Two independent simulations will never agree to the bit, so every numeric
 * field is compared with a tolerance, and records are paired by identity
 * rather than by their position in the frame:
 *
 * - records that carry an entity or plane id are paired by that id (plus the
 *   circle kind or color where one entity can own several);
 * - records with no id (tracers, torpedoes, smoke, capture points, …) are
 *   paired greedily by nearest position, within the position tolerance.
 *
 * What does not pair is reported as present in only one timeline. The result
 * is a summary per record kind and per field, with the first few concrete
 * differences of each so a mismatch can be found in the viewer.
 */

import type { Px, Record_ } from './timeline';

/** The part of `ReplayTimeline` the diff reads, so tests can pass plain arrays. */
export interface TimelineLike {
  readonly fps: number;
  readonly frameCount: number;
  readonly spaceSize: number;
  readonly minimapSize: number;
  frame(index: number): Record_[];
}

export interface DiffOptions {
  /** Max distance between paired positions, minimap pixels. */
  posTolerancePx: number;
  /** Max heading difference, radians. */
  yawTolerance: number;
  /** Max difference of 0..1 quantities (alpha, opacity, health, progress). */
  fractionTolerance: number;
  /** Max difference of radii and lengths, minimap pixels. */
  radiusTolerancePx: number;
  /** Compare every n-th frame; 1 compares all. */
  frameStep: number;
  /** Examples kept per (kind, field). */
  examples: number;
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  posTolerancePx: 2,
  yawTolerance: 0.05,
  fractionTolerance: 0.02,
  radiusTolerancePx: 2,
  frameStep: 1,
  examples: 3,
};

export interface Example {
  frame: number;
  seconds: number;
  detail: string;
}

export interface KindReport {
  /** Records in A / B over the compared frames. */
  countA: number;
  countB: number;
  paired: number;
  /** Paired records with at least one field beyond tolerance. */
  pairedMismatched: number;
  onlyA: number;
  onlyB: number;
  onlyAExamples: Example[];
  onlyBExamples: Example[];
  /** Paired records whose field differed beyond tolerance, per field. */
  fields: Record<string, { mismatches: number; examples: Example[] }>;
}

export interface DiffReport {
  /** Header-level differences (fps, frame count, map size). */
  header: string[];
  framesCompared: number;
  kinds: Record<string, KindReport>;
}

/** Fields compared per kind; anything else on a record is ignored. */
type FieldKind = 'pos' | 'yaw' | 'fraction' | 'radius' | 'exact' | 'points';

const FIELDS: Record<Record_['kind'], Record<string, FieldKind>> = {
  tracer: { from: 'pos', to: 'pos', color: 'exact', secondary: 'exact' },
  tracerTip: { at: 'pos', color: 'exact', secondary: 'exact' },
  torpedo: { pos: 'pos', color: 'exact' },
  smoke: { pos: 'pos', radius: 'radius', color: 'exact', alpha: 'fraction' },
  ship: {
    pos: 'pos',
    yaw: 'yaw',
    species: 'exact',
    color: 'exact',
    visibility: 'exact',
    opacity: 'fraction',
    isSelf: 'exact',
    isDetectedTeammate: 'exact',
    isDisconnected: 'exact',
    playerName: 'exact',
    shipName: 'exact',
    nameColor: 'exact',
  },
  healthBar: { pos: 'pos', fraction: 'fraction', fill: 'exact', background: 'exact', backgroundAlpha: 'fraction' },
  deadShip: { pos: 'pos', yaw: 'yaw', species: 'exact', color: 'exact', isSelf: 'exact', playerName: 'exact', shipName: 'exact' },
  buffZone: { pos: 'pos', radius: 'radius', color: 'exact', alpha: 'fraction', markerName: 'exact' },
  capturePoint: {
    pos: 'pos',
    radius: 'radius',
    color: 'exact',
    alpha: 'fraction',
    label: 'exact',
    progress: 'fraction',
    invaderColor: 'exact',
  },
  cameraDirection: { pos: 'pos', yaw: 'yaw', color: 'exact', length: 'radius' },
  building: { pos: 'pos', color: 'exact', isAlive: 'exact', icon: 'exact', relation: 'exact' },
  weatherZone: { pos: 'pos', radius: 'radius' },
  plane: { pos: 'pos', ownerEntityId: 'exact', iconKey: 'exact', playerName: 'exact', shipName: 'exact' },
  consumableRadius: { pos: 'pos', radius: 'radius', color: 'exact', alpha: 'fraction' },
  patrolRadius: { pos: 'pos', radius: 'radius', color: 'exact', alpha: 'fraction' },
  shipConfigCircle: {
    pos: 'pos',
    radius: 'radius',
    color: 'exact',
    alpha: 'fraction',
    dashed: 'exact',
    isSelf: 'exact',
    label: 'exact',
    playerName: 'exact',
  },
  positionTrail: { playerName: 'exact', points: 'points' },
};

/**
 * Pairing key. Records with equal keys are candidates for each other; an
 * empty key means "no identity, pair by position".
 */
function identity(r: Record_): string {
  switch (r.kind) {
    case 'ship':
    case 'healthBar':
    case 'deadShip':
    case 'cameraDirection':
    case 'positionTrail':
      return `e${r.entityId}`;
    // One entity can show several consumables at once; color separates them.
    case 'consumableRadius':
      return `e${r.entityId}:${r.color}`;
    case 'shipConfigCircle':
      return `e${r.entityId}:${r.circleKind}`;
    case 'plane':
    case 'patrolRadius':
      return `p${r.planeId}`;
    default:
      return '';
  }
}

/** The position pairing is judged by. */
function anchor(r: Record_): Px | null {
  switch (r.kind) {
    case 'tracer':
      return r.to;
    case 'tracerTip':
      return r.at;
    case 'positionTrail':
      return r.points.at(-1)?.pos ?? null;
    default:
      return r.pos;
  }
}

const dist = (a: Px, b: Px) => Math.hypot(a.x - b.x, a.y - b.y);

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

function show(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (v && typeof v === 'object' && 'x' in v && 'y' in v) {
    const p = v as Px;
    return `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
  }
  return JSON.stringify(v);
}

function label(r: Record_): string {
  const id = identity(r);
  const at = anchor(r);
  return `${r.kind}${id ? ' ' + id : ''}${at ? ' at ' + show(at) : ''}`;
}

/** Undefined when the values agree, else why not. */
function compareField(kind: FieldKind, a: unknown, b: unknown, o: DiffOptions): string | undefined {
  switch (kind) {
    case 'pos': {
      const d = dist(a as Px, b as Px);
      return d > o.posTolerancePx ? `${show(a)} vs ${show(b)} (${d.toFixed(1)} px)` : undefined;
    }
    case 'yaw': {
      const d = angleDiff(a as number, b as number);
      return d > o.yawTolerance ? `${show(a)} vs ${show(b)} (${d.toFixed(3)} rad)` : undefined;
    }
    case 'fraction':
      return Math.abs((a as number) - (b as number)) > o.fractionTolerance ? `${show(a)} vs ${show(b)}` : undefined;
    case 'radius':
      return Math.abs((a as number) - (b as number)) > o.radiusTolerancePx ? `${show(a)} vs ${show(b)}` : undefined;
    case 'exact':
      return a === b ? undefined : `${show(a)} vs ${show(b)}`;
    case 'points': {
      const pa = a as { pos: Px; color: number }[];
      const pb = b as { pos: Px; color: number }[];
      if (pa.length !== pb.length) return `${pa.length} vs ${pb.length} points`;
      for (let i = 0; i < pa.length; i++) {
        const d = dist(pa[i].pos, pb[i].pos);
        if (d > o.posTolerancePx) return `point ${i}: ${show(pa[i].pos)} vs ${show(pb[i].pos)}`;
        if (pa[i].color !== pb[i].color) return `point ${i}: color ${pa[i].color} vs ${pb[i].color}`;
      }
      return undefined;
    }
  }
}

/**
 * Pairs records of one kind within a frame. Same-key records pair by nearest
 * anchor; keyless ones additionally must lie within the position tolerance,
 * since without an id distance is the only evidence they are the same thing.
 */
function pair(as: Record_[], bs: Record_[], o: DiffOptions): { pairs: [Record_, Record_][]; onlyA: Record_[]; onlyB: Record_[] } {
  const groups = new Map<string, { a: Record_[]; b: Record_[] }>();
  const group = (k: string) => {
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { a: [], b: [] }));
    return g;
  };
  for (const r of as) group(identity(r)).a.push(r);
  for (const r of bs) group(identity(r)).b.push(r);

  const pairs: [Record_, Record_][] = [];
  const onlyA: Record_[] = [];
  const onlyB: Record_[] = [];
  for (const [key, g] of groups) {
    const keyless = key === '';
    // All candidate pairs, nearest first; then take greedily.
    const cand: [number, number, number][] = [];
    g.a.forEach((ra, i) =>
      g.b.forEach((rb, j) => {
        const pa = anchor(ra);
        const pb = anchor(rb);
        const d = pa && pb ? dist(pa, pb) : 0;
        if (!keyless || d <= o.posTolerancePx) cand.push([d, i, j]);
      }),
    );
    cand.sort((x, y) => x[0] - y[0]);
    const usedA = new Set<number>();
    const usedB = new Set<number>();
    for (const [, i, j] of cand) {
      if (usedA.has(i) || usedB.has(j)) continue;
      usedA.add(i);
      usedB.add(j);
      pairs.push([g.a[i], g.b[j]]);
    }
    g.a.forEach((r, i) => usedA.has(i) || onlyA.push(r));
    g.b.forEach((r, j) => usedB.has(j) || onlyB.push(r));
  }
  return { pairs, onlyA, onlyB };
}

function emptyKind(): KindReport {
  return { countA: 0, countB: 0, paired: 0, pairedMismatched: 0, onlyA: 0, onlyB: 0, onlyAExamples: [], onlyBExamples: [], fields: {} };
}

export function diffTimelines(a: TimelineLike, b: TimelineLike, options: Partial<DiffOptions> = {}): DiffReport {
  const o = { ...DEFAULT_DIFF_OPTIONS, ...options };
  const header: string[] = [];
  if (a.fps !== b.fps) header.push(`fps ${a.fps} vs ${b.fps}`);
  if (a.frameCount !== b.frameCount) header.push(`frame count ${a.frameCount} vs ${b.frameCount}`);
  if (a.spaceSize !== b.spaceSize) header.push(`space size ${a.spaceSize} vs ${b.spaceSize}`);
  if (a.minimapSize !== b.minimapSize) header.push(`minimap size ${a.minimapSize} vs ${b.minimapSize}`);

  const report: DiffReport = { header, framesCompared: 0, kinds: {} };
  // Frames pair by battle clock, so differing frame rates still line up.
  const frames = Math.min(a.frameCount, Math.floor((b.frameCount * a.fps) / b.fps));
  for (let fa = 0; fa < frames; fa += Math.max(1, o.frameStep)) {
    const seconds = fa / a.fps;
    const fb = Math.min(b.frameCount - 1, Math.round(seconds * b.fps));
    const ex = (detail: string): Example => ({ frame: fa, seconds, detail });
    report.framesCompared++;

    const byKind = new Map<string, { a: Record_[]; b: Record_[] }>();
    const kindOf = (k: string) => {
      let v = byKind.get(k);
      if (!v) byKind.set(k, (v = { a: [], b: [] }));
      return v;
    };
    for (const r of a.frame(fa)) kindOf(r.kind).a.push(r);
    for (const r of b.frame(fb)) kindOf(r.kind).b.push(r);

    for (const [kind, recs] of byKind) {
      const k = (report.kinds[kind] ??= emptyKind());
      k.countA += recs.a.length;
      k.countB += recs.b.length;
      const { pairs, onlyA, onlyB } = pair(recs.a, recs.b, o);
      k.paired += pairs.length;
      k.onlyA += onlyA.length;
      k.onlyB += onlyB.length;
      for (const r of onlyA) if (k.onlyAExamples.length < o.examples) k.onlyAExamples.push(ex(label(r)));
      for (const r of onlyB) if (k.onlyBExamples.length < o.examples) k.onlyBExamples.push(ex(label(r)));

      const fields = FIELDS[kind as Record_['kind']];
      for (const [ra, rb] of pairs) {
        let mismatched = false;
        for (const [field, fk] of Object.entries(fields)) {
          const why = compareField(fk, (ra as never)[field], (rb as never)[field], o);
          if (why === undefined) continue;
          mismatched = true;
          const f = (k.fields[field] ??= { mismatches: 0, examples: [] });
          f.mismatches++;
          if (f.examples.length < o.examples) f.examples.push(ex(`${label(ra)}: ${why}`));
        }
        if (mismatched) k.pairedMismatched++;
      }
    }
  }
  return report;
}

/**
 * Fraction of records that are unpaired or have any mismatched field, over
 * all records in A and B. 0 means identical within tolerance.
 */
export function mismatchRate(r: DiffReport): number {
  let bad = 0;
  let total = 0;
  for (const k of Object.values(r.kinds)) {
    total += k.countA + k.countB;
    bad += k.onlyA + k.onlyB;
    // A pair is a record on each side, as in the totals.
    bad += 2 * k.pairedMismatched;
  }
  return total === 0 ? 0 : bad / total;
}

export function formatReport(r: DiffReport, names: [string, string] = ['A', 'B']): string {
  const [na, nb] = names;
  const lines: string[] = [];
  for (const h of r.header) lines.push(`header: ${h}`);
  lines.push(`frames compared: ${r.framesCompared}`);
  const kinds = Object.entries(r.kinds).sort(([x], [y]) => x.localeCompare(y));
  for (const [kind, k] of kinds) {
    const clean = k.onlyA === 0 && k.onlyB === 0 && k.pairedMismatched === 0;
    lines.push(
      `${clean ? 'ok  ' : 'DIFF'} ${kind.padEnd(17)} ${na} ${k.countA}  ${nb} ${k.countB}  paired ${k.paired}` +
        (k.pairedMismatched ? `  mismatched ${k.pairedMismatched}` : '') +
        (k.onlyA ? `  only-${na} ${k.onlyA}` : '') +
        (k.onlyB ? `  only-${nb} ${k.onlyB}` : ''),
    );
    for (const e of k.onlyAExamples) lines.push(`       only in ${na}: frame ${e.frame} (${e.seconds.toFixed(1)} s) ${e.detail}`);
    for (const e of k.onlyBExamples) lines.push(`       only in ${nb}: frame ${e.frame} (${e.seconds.toFixed(1)} s) ${e.detail}`);
    for (const [field, f] of Object.entries(k.fields)) {
      lines.push(`       ${field}: ${f.mismatches} mismatched`);
      for (const e of f.examples) lines.push(`         frame ${e.frame} (${e.seconds.toFixed(1)} s) ${e.detail}`);
    }
  }
  lines.push(`mismatch rate: ${(mismatchRate(r) * 100).toFixed(3)}%`);
  return lines.join('\n');
}
