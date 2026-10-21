import type { ShipClass } from '@/types/model';

/**
 * Fallback ship glyphs, traced from the game's own class markers
 * (gui/battle_cards/service/ship_classes/*.png).
 *
 * The default representation of a ship is still the icon the user imported for
 * it; these are used ONLY when a ship has no icon assigned yet.
 *
 * The game builds three of the five marks out of one silhouette — pointed bow,
 * parallel sides, flat stern — cut by diagonal gaps, and gives the other two
 * their own shape:
 *
 *   DD  bare wedge, no gaps
 *   CA  silhouette with one diagonal gap   (CL uses the same marker)
 *   BB  silhouette with two diagonal gaps
 *   CV  blunt arrowhead over two side-by-side bars (the flight deck)
 *   SS  slender wedge over a single stern bar
 *
 * Authored in a 24x24 box with the bow pointing UP, because a ship's rotation
 * on the map is its heading and 0 deg is north. In the game's own panels the
 * markers are side profiles, so the list views rotate this same data by 90.
 *
 * The gaps are exactly that — space between separate filled pieces, not holes
 * in one path — so no fill-rule handling is needed and the shapes render
 * identically at any size.
 */

export interface ClassGlyph {
  /** Filled silhouette, one path with one or more subpaths. */
  solid: string;
  /** Relative on-screen scale, so a BB reads bigger than a DD. */
  scale: number;
}

/* Hull reference points, bow up:
     bow tip     (12, 1.1)
     shoulders   (6.9 / 17.1, 6.6)
     stern       (6.9 / 17.1, 22.9)
   Every gap is 1.7 units wide, measured down either side. The gaps run
   diagonally: each one sits higher on the port side than on the starboard. */

export const CLASS_GLYPHS: Record<ShipClass, ClassGlyph> = {
  BB: {
    // Three pieces: bow, a thin midships sliver, stern — two diagonal gaps.
    solid: [
      'M12 1.1 L17.1 6.6 L17.1 13.5 L6.9 8.4 L6.9 6.6 Z',
      'M6.9 10.1 L17.1 15.2 L17.1 17.8 L6.9 12.6 Z',
      'M17.1 19.5 L17.1 22.9 L6.9 22.9 L6.9 14.4 Z',
    ].join(' '),
    scale: 1.16,
  },
  CA: {
    // Two pieces, one diagonal gap.
    solid: [
      'M12 1.1 L17.1 6.6 L17.1 16.1 L6.9 10.9 L6.9 6.6 Z',
      'M17.1 17.8 L17.1 22.9 L6.9 22.9 L6.9 12.6 Z',
    ].join(' '),
    scale: 1.02,
  },
  CV: {
    // Blunt arrowhead, then the flight deck as two bars split lengthwise.
    solid: [
      'M12 1.1 L17.1 6.6 L17.1 9.6 L6.9 9.6 L6.9 6.6 Z',
      'M6.9 11.8 L11.1 11.8 L11.1 22.9 L6.9 22.9 Z',
      'M12.9 11.8 L17.1 11.8 L17.1 22.9 L12.9 22.9 Z',
    ].join(' '),
    scale: 1.18,
  },
  DD: {
    // The bare wedge the other silhouettes are cut from.
    solid: 'M12 1.1 L17.1 22.9 L6.9 22.9 Z',
    scale: 0.88,
  },
  SS: {
    // Slender wedge, detached stern bar.
    solid: [
      'M12 1.1 L17.1 19.5 L6.9 19.5 Z',
      'M6.9 21.2 L17.1 21.2 L17.1 22.9 L6.9 22.9 Z',
    ].join(' '),
    scale: 0.84,
  },
};

export const CLASS_ORDER: ShipClass[] = ['DD', 'CA', 'BB', 'CV', 'SS'];

export const CLASS_COLORS: Record<ShipClass, string> = {
  DD: '#7ee787',
  CA: '#5ad2f4',
  BB: '#ff9f43',
  CV: '#c792ea',
  SS: '#6ee7d5',
};

/**
 * Dark edge drawn around every glyph. It doubles as the stripe colour: the
 * stroke sits on both sides of each gap, so a stripe reads as a dark line
 * whether the ship is over open sea or over bright island terrain.
 */
export const GLYPH_CONTRAST = '#080c11';
export const GLYPH_CONTRAST_WIDTH = 1;

/**
 * Extra lengthwise squash for glyphs drawn away from 1x icon scale.
 *
 * The hulls are about twice as long as wide, so at small sizes they thin out
 * into needles and at large sizes they read as overlong. Shortening them a
 * little more than they narrow keeps them reading as ships; the large side
 * gets a gentler squash. 0.85 at 0.5x, 1 at 1x, 0.9 at 1.5x.
 */
export const hullLength = (scale: number) => 1 - (scale < 1 ? 0.3 * (1 - scale) : 0.2 * (scale - 1));
