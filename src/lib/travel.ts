import type { Ship } from '@/types/model';

/**
 * Ships cover the map 5.2× faster than their listed knots. Measured in a baked
 * replay (Okinawa, 19 ships): ships at full speed ran at a median of 5.24×,
 * the small excess being speed flags and skills.
 */
export const MAP_SPEED_FACTOR = 5.2;
const KNOT = 0.514444;

/**
 * Seconds a ship needs to cover `metres` of map at top speed: without Engine
 * Boost, and with one activation of it. The boost only lasts its duration, so
 * on a long run the rest of the distance is at plain speed. No acceleration
 * or turning: a straight run from full speed.
 */
export function travelTime(metres: number, ship: Ship): { plain: number; boosted: number | null } | null {
  if (!ship.speed_kn) return null;
  const v = ship.speed_kn * KNOT * MAP_SPEED_FACTOR;
  const plain = metres / v;
  if (!ship.engineBoostSpeed_pct || !ship.engineBoostDuration_s) return { plain, boosted: null };
  const vb = v * (1 + ship.engineBoostSpeed_pct / 100);
  const onBoost = Math.min(metres, vb * ship.engineBoostDuration_s);
  return { plain, boosted: onBoost / vb + (metres - onBoost) / v };
}

/** 112 → "1:52". */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
