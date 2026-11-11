import type { Vec2 } from '@/types/model';

/**
 * Where the ships of a blueprint land around the point clicked: rows abreast,
 * with every other row shifted half a gap so no ship sits straight behind
 * another. Up to four ships make one row, up to twelve two, more three.
 *
 * NOTE: this is a stand-in. The game's own spawn layout (how far apart ships
 * start, how rows are staggered, whether classes are sorted into lines) is
 * not known to the app. Replays carry every ship's starting position, so the
 * real pattern can be measured from a batch of them and put here; until then
 * this only keeps a lineup tidy and easy to drag into place.
 */
export function spawnFormation(count: number, centre: Vec2, spacing: number): Vec2[] {
  if (count <= 0) return [];
  const rows = count <= 4 ? 1 : count <= 12 ? 2 : 3;
  const perRow = Math.ceil(count / rows);
  const rowGap = spacing * 0.8;
  const out: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const inRow = Math.min(perRow, count - row * perRow);
    // A short row centres itself and is staggered already; a full one is
    // pushed half a gap sideways on odd rows.
    const stagger = row % 2 === 1 && inRow === perRow ? spacing / 2 : 0;
    out.push({
      x: centre.x + (col - (inRow - 1) / 2) * spacing + stagger,
      y: centre.y + (row - (rows - 1) / 2) * rowGap,
    });
  }
  return out;
}
