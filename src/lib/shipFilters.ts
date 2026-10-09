/**
 * Ship list filtering, shared by the ship database and the sidebar picker so
 * the two can never disagree about which ships a set of filters leaves.
 */

import type { ID, Ship, ShipClass, ShipRuleset } from '@/types/model';
import { foldForSearch } from './util';

/** A yes/no question a filter may also decline to ask. */
export type Availability = '' | 'yes' | 'no';

export interface ShipFilter {
  query: string;
  /** Whether the search box also matches nation names. */
  searchNation?: boolean;
  nation: string;
  cls: '' | ShipClass;
  tier: string;
  radar: Availability;
  smoke: Availability;
  ruleset: ShipRuleset | null;
}

const hasConsumable = (ship: Ship, pattern: RegExp): boolean =>
  !!ship.consumables?.some((c) => pattern.test(c.name));

/** A radar range is the fact; a listed consumable covers data without one. */
export function hasRadar(ship: Ship): boolean {
  return (ship.radar_km ?? 0) > 0 || hasConsumable(ship, /radar/i);
}

/**
 * The explicit flag wins either way, so a ship can be marked as having no
 * smoke even where a stray radius survives in its data. Without one, any smoke
 * figure or a smoke consumable counts.
 */
export function hasSmoke(ship: Ship): boolean {
  if (ship.smoke !== undefined) return ship.smoke;
  return (ship.smokeRadius_km ?? 0) > 0 || (ship.smokeDuration_s ?? 0) > 0 || hasConsumable(ship, /smoke/i);
}

/**
 * Whether a ruleset lets a ship be brought. An empty tier or class list means
 * the ruleset does not restrict that at all, which is what a new one starts as.
 */
export function allowedBy(ruleset: ShipRuleset, ship: Ship): boolean {
  return inScope(ruleset, ship) && !ruleset.banned.includes(ship.id);
}

/** Whether a ship is of a tier and class the ruleset deals in at all, banned or not. */
export function inScope(ruleset: ShipRuleset, ship: Ship): boolean {
  if (ruleset.tiers.length && !ruleset.tiers.includes(ship.tier)) return false;
  if (ruleset.classes.length && !ruleset.classes.includes(ship.class)) return false;
  return true;
}

/**
 * How full the tightest limit covering a ship is, given the ships one side
 * already has on the page. Null when no limit names the ship.
 */
export function limitUse(
  ruleset: ShipRuleset,
  shipId: ID,
  placed: (ID | null)[],
): { used: number; max: number } | null {
  let tightest: { used: number; max: number } | null = null;
  for (const limit of ruleset.limits) {
    if (!limit.ships.includes(shipId)) continue;
    const used = placed.filter((id) => id !== null && limit.ships.includes(id)).length;
    if (!tightest || limit.max - used < tightest.max - tightest.used) tightest = { used, max: limit.max };
  }
  return tightest;
}

const wants = (want: Availability, has: boolean): boolean => !want || (want === 'yes') === has;

/** Every filter but the ruleset. */
export function matchesShip(ship: Ship, f: ShipFilter): boolean {
  const q = foldForSearch(f.query.trim());
  return (
    (!q || foldForSearch(ship.name).includes(q) || (!!f.searchNation && foldForSearch(ship.nation).includes(q))) &&
    (!f.nation || ship.nation === f.nation) &&
    (!f.cls || ship.class === f.cls) &&
    (!f.tier || String(ship.tier) === f.tier) &&
    wants(f.radar, hasRadar(ship)) &&
    wants(f.smoke, hasSmoke(ship))
  );
}

export function filterShips(ships: Ship[], f: ShipFilter): Ship[] {
  const { ruleset } = f;
  return ships.filter((ship) => matchesShip(ship, f) && (!ruleset || allowedBy(ruleset, ship)));
}
