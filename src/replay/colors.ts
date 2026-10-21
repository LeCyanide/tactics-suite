/**
 * Per-ship colours for the replay overlay's "unique colours" mode.
 *
 * Hue steps alone put several ships in the same band (two greens side by side
 * are unreadable), so this uses a fixed set of colours picked to stay apart on
 * dark water. Ships whose trails come close are handed the most different
 * colours; past the palette's length a colour is reused with a dashed trail.
 */

import type { ShipPath } from './paths';

export const DISTINCT_COLORS = [
  0xff5252, // red
  0x448aff, // blue
  0xffeb3b, // yellow
  0x69f0ae, // green
  0xff9100, // orange
  0xe040fb, // magenta
  0x18ffff, // cyan
  0xffffff, // white
  0xc6ff00, // lime
  0xff80ab, // pink
  0xb388ff, // lavender
  0xbcaaa4, // taupe
  0x00a88f, // teal
  0xffd180, // apricot
] as const;

export interface TrailStyle {
  color: number;
  dashed: boolean;
}

/** Trails that pass within this share of the map count as neighbours. */
const NEAR_SHARE = 0.06;
/** Every n-th point is enough to judge how close two trails come. */
const SAMPLE_EVERY = 10;

/** One style per path, in the same order as `paths`. */
export function distinctStyles(paths: ShipPath[], minimapSize: number): TrailStyle[] {
  const near = (minimapSize * NEAR_SHARE) ** 2;
  const samples = paths.map((p) => p.points.filter((_, i) => i % SAMPLE_EVERY === 0).map((q) => q.pos));
  const neighbours: number[][] = paths.map(() => []);
  for (let a = 0; a < paths.length; a++) {
    for (let b = a + 1; b < paths.length; b++) {
      if (comesClose(samples[a]!, samples[b]!, near)) {
        neighbours[a]!.push(b);
        neighbours[b]!.push(a);
      }
    }
  }

  const combos = DISTINCT_COLORS.length * 2;
  const chosen: (number | null)[] = paths.map(() => null);
  const used = new Set<number>();
  // The most crowded ships pick first, while the most choice is left.
  const order = paths.map((_, i) => i).sort((a, b) => neighbours[b]!.length - neighbours[a]!.length || a - b);
  for (const i of order) {
    let best = -1;
    let bestScore = -1;
    for (let c = 0; c < combos; c++) {
      if (used.has(c) && used.size < combos) continue;
      let score = Infinity;
      for (const j of neighbours[i]!) {
        const other = chosen[j];
        if (other == null) continue;
        score = Math.min(score, colorDistance(colorOf(c), colorOf(other)) + (dashedOf(c) !== dashedOf(other) ? 1 : 0));
      }
      // Solid before dashed when nothing nearby tells them apart.
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    chosen[i] = best;
    used.add(best);
  }
  return chosen.map((c) => ({ color: colorOf(c!), dashed: dashedOf(c!) }));
}

const colorOf = (combo: number) => DISTINCT_COLORS[combo % DISTINCT_COLORS.length]!;
const dashedOf = (combo: number) => combo >= DISTINCT_COLORS.length;

function comesClose(a: { x: number; y: number }[], b: { x: number; y: number }[], near: number): boolean {
  for (const p of a) {
    for (const q of b) {
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      if (dx * dx + dy * dy < near) return true;
    }
  }
  return false;
}

/** "Redmean" colour distance: cheap, and much closer to what the eye sees than plain RGB. */
export function colorDistance(a: number, b: number): number {
  const r1 = a >> 16;
  const r2 = b >> 16;
  const dr = r1 - r2;
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff);
  const db = (a & 0xff) - (b & 0xff);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
