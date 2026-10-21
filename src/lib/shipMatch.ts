/**
 * Finds the ship database entry for a name as a replay spells it.
 *
 * Replays use the game's short display names: "V. Veneto", "Almte. Irízar",
 * "A. da Barbiano". The part after the shortened word is what identifies the
 * ship, so when the plain name does not match, the match is made on that part,
 * with the shortened word kept as a check on the database name's first letters.
 */

import type { Ship, ShipClass } from '@/types/model';
import { foldForSearch } from './util';

const words = (name: string) =>
  foldForSearch(name)
    .replace(/[ \s]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/** Prefers the class the replay gives, then the only candidate left; null when unsure. */
function pick(candidates: Ship[], shipClass: ShipClass | undefined): Ship | null {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const sameClass = shipClass ? candidates.filter((s) => s.class === shipClass) : candidates;
  return sameClass.length === 1 ? sameClass[0]! : null;
}

export function matchShip(name: string, ships: Ship[], shipClass?: ShipClass): Ship | null {
  const found = matchName(name, ships, shipClass);
  // The game tags some variants in brackets, "U-2501 (Scope)"; the ship is the same.
  const bare = name.replace(/\s*\(.*\)\s*$/, '');
  return found ?? (bare !== name ? matchName(bare, ships, shipClass) : null);
}

function matchName(name: string, ships: Ship[], shipClass?: ShipClass): Ship | null {
  const target = words(name);
  if (!target.length) return null;
  const key = target.join(' ');
  const indexed = ships.map((s) => ({ ship: s, w: words(s.name) }));

  const exact = pick(
    indexed.filter((e) => e.w.join(' ') === key).map((e) => e.ship),
    shipClass,
  );
  if (exact) return exact;

  // "V. Veneto": match on what follows the last shortened word.
  const lastShort = target.map((w) => w.endsWith('.')).lastIndexOf(true);
  if (lastShort < 0 || lastShort === target.length - 1) return null;
  const tail = target.slice(lastShort + 1);
  const prefixes = target.slice(0, lastShort + 1).map((w) => w.replace(/\.$/, ''));
  const candidates = indexed.filter(({ w }) => {
    if (w.length < tail.length || w.slice(w.length - tail.length).join(' ') !== tail.join(' ')) return false;
    // The shortened words must still fit the start of the full name: "V." in "Vittorio".
    const head = w.slice(0, w.length - tail.length);
    return prefixes.every((p, i) => abbreviates(p, head[i] ?? ''));
  });
  return pick(
    candidates.map((e) => e.ship),
    shipClass,
  );
}

/** "almte" abbreviates "almirante": same first letter, the rest in order. */
function abbreviates(short: string, word: string): boolean {
  if (!short || short[0] !== word[0]) return false;
  let at = 1;
  for (let i = 1; i < short.length; i++) {
    at = word.indexOf(short[i]!, at) + 1;
    if (at === 0) return false;
  }
  return true;
}
