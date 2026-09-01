import type { ShipClass } from '@/types/model';

/**
 * Fallback ship glyphs, modelled on the in-game class markers.
 *
 * The default representation of a ship is still the icon the user imported for
 * it; these are used ONLY when a ship has no icon assigned yet.
 *
 * All five are filled hulls with a pointed bow, told apart by what is cut out
 * of them:
 *
 *   BB  two diagonal stripes
 *   CA  one diagonal stripe      (CL uses the same marker)
 *   CV  one lengthwise stripe    (the flight deck, running bow to stern)
 *   DD  filled triangle, no stripe
 *   SS  filled rounded hull      (no counterpart in the reference set)
 *
 * Authored in a 24x24 box with the bow pointing UP, because a ship's rotation
 * on the map is its heading and 0 deg is north. In the game's own panels the
 * markers are side profiles, so the list views rotate this same data by 90.
 *
 * Stripes are gaps between separate filled pieces (or, for the carrier, a slot
 * cut in from the stern) rather than holes in one path, so no fill-rule
 * handling is needed and the shapes render identically at any size.
 */

export interface ClassGlyph {
  /** Filled silhouette, one path with one or more subpaths. */
  solid: string;
  /** Relative on-screen scale, so a BB reads bigger than a DD. */
  scale: number;
}

/* Hull reference points, bow up:
     bow tip     (12, 1.4)
     shoulders   (7.2 / 16.8, 8.0)
     stern       (7.2 / 16.8, 21.6)
   Every stripe is a 1.7-unit gap. */

export const CLASS_GLYPHS: Record<ShipClass, ClassGlyph> = {
  BB: {
    // Three pieces: bow, midships, stern — two diagonal stripes between them.
    solid: [
      'M12 1.4 L16.8 8 L16.8 10.2 L7.2 12.4 L7.2 8 Z',
      'M16.8 11.9 L16.8 14.4 L7.2 16.6 L7.2 14.1 Z',
      'M16.8 16.1 L16.8 21.6 L7.2 21.6 L7.2 18.3 Z',
    ].join(' '),
    scale: 1.16,
  },
  CA: {
    // Two pieces, one diagonal stripe.
    solid: [
      'M12 1.4 L16.8 8 L16.8 12 L7.2 14.2 L7.2 8 Z',
      'M16.8 13.7 L16.8 21.6 L7.2 21.6 L7.2 15.9 Z',
    ].join(' '),
    scale: 1.02,
  },
  CV: {
    // One concave piece: the flight-deck stripe is a slot cut in from the
    // stern, stopping short of the bow so the point stays solid.
    solid:
      'M12 1.4 L16.8 8 L16.8 21.6 L12.9 21.6 L12.9 10.6 L11.1 10.6 L11.1 21.6 L7.2 21.6 L7.2 8 Z',
    scale: 1.18,
  },
  DD: {
    solid: 'M12 2.4 L17 21.2 L7 21.2 Z',
    scale: 0.88,
  },
  SS: {
    solid:
      'M12 2.4 C14.6 6.2 15.7 10.6 15.7 14.4 C15.7 18.6 14.2 21.4 12 21.4 C9.8 21.4 8.3 18.6 8.3 14.4 C8.3 10.6 9.4 6.2 12 2.4 Z',
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
