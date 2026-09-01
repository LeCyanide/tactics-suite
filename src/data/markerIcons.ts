/**
 * Glyphs for the marker object.
 *
 * 24x24 SVG path data, drawn with Konva's Path shape so markers stay crisp at
 * every zoom level. These outlived the ping presets they were originally
 * shared with: markers are the one remaining stamp-a-symbol tool.
 */

export const MARKER_ICONS = {
  pin: 'M12 22 C12 22 19 14.6 19 9.6 A7 7 0 0 0 5 9.6 C5 14.6 12 22 12 22 Z M12 9.6 m-2.6 0 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0',
  cross: 'M4 4 L20 20 M20 4 L4 20',
  diamond: 'M12 2.5 L21.5 12 L12 21.5 L2.5 12 Z',
  star: 'M12 2.5 L14.9 9 L21.9 9.8 L16.7 14.6 L18.2 21.5 L12 18 L5.8 21.5 L7.3 14.6 L2.1 9.8 L9.1 9 Z',
  flag: 'M6 21.5 V3 H18.5 L15 7.8 L18.5 12.6 H6',
} as const;

export type MarkerShape = keyof typeof MARKER_ICONS;
