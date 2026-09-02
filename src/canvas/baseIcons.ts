/**
 * The base marker for Standard battle.
 *
 * Traced from the game's own HUD art
 * (gui/battle_hud/markers/capture_point/icon_base_*_flag.png) at an 0.93
 * intersection-over-union against the source silhouette — close enough that
 * the difference is sub-pixel at any size it is actually drawn.
 *
 * A path rather than the original bitmap: the source is 20x24, so an image
 * export scales it several times over and goes soft, while a path stays sharp.
 * It also drops the three colour variants — the game ships an ally, enemy and
 * neutral PNG, but they differ only in tint, so one path filled with the cap's
 * own colour covers all three and can never drift out of step with the palette.
 *
 * Authored in the source artwork's own 20x24 box, so callers scale by
 * `size / BASE_FLAG_HEIGHT` and the proportions stay right.
 */
export const BASE_FLAG_PATH =
  'M3 2.9H4.95V22.7H3Z' +
  'M2.05 2.95C8.5 2.7 13.5 4.6 18.45 6.4L18.45 16C13.6 14.1 9.2 13.6 3.05 15.8Z';

export const BASE_FLAG_WIDTH = 20;
export const BASE_FLAG_HEIGHT = 24;
