import type { ShipClass, Vec2 } from '@/types/model';

/**
 * Metres between rows and between ships in a row. The game uses 1.5 km for
 * both; these are wider so icons and names stay clear on the planner.
 */
export const ROW_GAP = 2000;
export const SHIP_GAP = 2500;

/**
 * Row of each class, counted forward from the cruisers. Measured in 45 clan
 * battle replays (15.9): destroyers 1.5 km ahead of the cruisers, battleships
 * 1.5 km behind.
 * shortcut: no submarine or carrier was in those battles, so their rows are a guess; measure them once clan replays with one exist.
 */
const ROW: Record<ShipClass, number> = { DD: 1, SS: 1, CA: 0, BB: -1, CV: -2 };

/**
 * Where a blueprint's ships land around the point clicked, laid out like a
 * team at an in-game spawn: one row per class, facing `facing` (a unit
 * vector), each row centred on the line through the click. The cruiser row
 * passes through the click. Ships keep the blueprint's order within a row.
 */
export function spawnFormation(classes: ShipClass[], centre: Vec2, facing: Vec2): Vec2[] {
  const right = { x: -facing.y, y: facing.x };
  const inRow = new Map<number, number>();
  for (const c of classes) inRow.set(ROW[c], (inRow.get(ROW[c]) ?? 0) + 1);
  const placed = new Map<number, number>();
  return classes.map((c) => {
    const row = ROW[c];
    const i = placed.get(row) ?? 0;
    placed.set(row, i + 1);
    const lat = (i - ((inRow.get(row) ?? 1) - 1) / 2) * SHIP_GAP;
    const fwd = row * ROW_GAP;
    return { x: centre.x + facing.x * fwd + right.x * lat, y: centre.y + facing.y * fwd + right.y * lat };
  });
}
