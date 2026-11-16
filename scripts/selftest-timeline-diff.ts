/**
 * Checks for the timeline diff (`src/replay/timelineDiff.ts`), on in-memory
 * timelines: what must pair, what must not, and what counts as a mismatch.
 */

import type { Record_, ShipRecord, TracerRecord } from '../src/replay/timeline';
import { diffTimelines, mismatchRate, type TimelineLike } from '../src/replay/timelineDiff';

function timeline(frames: Record_[][], fps = 10): TimelineLike {
  return { fps, frameCount: frames.length, spaceSize: 1400, minimapSize: 768, frame: (i) => frames[i] };
}

function ship(entityId: number, x: number, y: number, yaw = 0, extra: Partial<ShipRecord> = {}): ShipRecord {
  return {
    kind: 'ship',
    entityId,
    pos: { x, y },
    yaw,
    species: 'Destroyer',
    color: 0x4ce8aa,
    visibility: 0,
    opacity: 1,
    isSelf: false,
    isDetectedTeammate: false,
    isDisconnected: false,
    playerName: 'p',
    shipName: 's',
    nameColor: null,
    ...extra,
  };
}

function tracer(x: number, y: number): TracerRecord {
  return { kind: 'tracer', from: { x: 0, y: 0 }, to: { x, y }, color: 0xff0000, secondary: false };
}

export function testTimelineDiff(check: (l: string, c: boolean, d?: unknown) => void): void {
  console.log('\nreplay timeline diff');

  const base = [[ship(1, 100, 100), ship(2, 200, 200), tracer(50, 50)], [ship(1, 101, 100), ship(2, 201, 200)]];

  const same = diffTimelines(timeline(base), timeline(base));
  check('identical: no mismatches', mismatchRate(same) === 0 && same.header.length === 0, same);
  check('identical: every ship paired', same.kinds.ship?.paired === 4, same.kinds.ship);

  const jitter = [
    [ship(2, 200.5, 199.5), ship(1, 101, 100.5, 0.01), tracer(51, 50)],
    [ship(2, 201, 200), ship(1, 102, 100)],
  ];
  const j = diffTimelines(timeline(base), timeline(jitter));
  check('reordered and jittered within tolerance: clean', mismatchRate(j) === 0, j);

  const moved = [base[0], [ship(1, 111, 100), ship(2, 201, 200)]];
  const m = diffTimelines(timeline(base), timeline(moved));
  const pos = m.kinds.ship?.fields.pos;
  check('moved 10 px: one position mismatch', pos?.mismatches === 1, m.kinds.ship);
  check('moved 10 px: example names the frame and entity', pos?.examples[0]?.frame === 1 && /e1/.test(pos.examples[0].detail), pos);

  const noTracer = [[ship(1, 100, 100), ship(2, 200, 200)], base[1]];
  const t = diffTimelines(timeline(base), timeline(noTracer));
  check('missing keyless record: only in A', t.kinds.tracer?.onlyA === 1 && t.kinds.tracer.onlyB === 0, t.kinds.tracer);

  const farTracer = [[ship(1, 100, 100), ship(2, 200, 200), tracer(80, 80)], base[1]];
  const ft = diffTimelines(timeline(base), timeline(farTracer));
  check(
    'keyless records beyond tolerance do not pair',
    ft.kinds.tracer?.paired === 0 && ft.kinds.tracer.onlyA === 1 && ft.kinds.tracer.onlyB === 1,
    ft.kinds.tracer,
  );

  const consumable = (color: number, r: number): Record_ => ({
    kind: 'consumableRadius',
    entityId: 7,
    pos: { x: 10, y: 10 },
    radius: r,
    color,
    alpha: 0.5,
  });
  const ca = timeline([[consumable(0xff0000, 50), consumable(0x00ff00, 80)]]);
  const cb = timeline([[consumable(0x00ff00, 80), consumable(0xff0000, 50)]]);
  check('two consumables on one entity pair by color', mismatchRate(diffTimelines(ca, cb)) === 0);

  const wrapA = timeline([[ship(1, 0, 0, Math.PI - 0.01)]]);
  const wrapB = timeline([[ship(1, 0, 0, -Math.PI + 0.01)]]);
  check('yaw compares across the ±π wrap', mismatchRate(diffTimelines(wrapA, wrapB)) === 0);

  // 10 fps against 5 fps: frames pair by battle clock.
  const slow = timeline([base[0]], 5);
  const fast = timeline([base[0], base[1]], 10);
  const f = diffTimelines(fast, slow);
  check('different fps: reported in the header', f.header.some((h) => h.startsWith('fps')), f.header);
  check('different fps: compares only frames both cover', f.framesCompared === 2, f.framesCompared);

  const twoFields = timeline([[ship(1, 120, 100, 1.0)]]);
  const tf = diffTimelines(timeline([[ship(1, 100, 100, 0)]]), twoFields);
  check('a pair with two bad fields counts once', tf.kinds.ship?.pairedMismatched === 1 && mismatchRate(tf) === 1, tf.kinds.ship);

  const stepped = diffTimelines(timeline(base), timeline(moved), { frameStep: 2 });
  check('frame step skips frames', stepped.framesCompared === 1 && mismatchRate(stepped) === 0, stepped);
}
