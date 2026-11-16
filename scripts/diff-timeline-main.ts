/**
 * Entry point for `npm run diff-timeline`; see scripts/diff-timeline.mjs.
 */

import fs from 'node:fs';

import { ReplayTimeline } from '../src/replay/timeline';
import { DEFAULT_DIFF_OPTIONS, diffTimelines, formatReport, mismatchRate, type DiffOptions } from '../src/replay/timelineDiff';

const USAGE = `usage: npm run diff-timeline -- <a.wtreply> <b.wtreply> [options]

  --pos <px>         position tolerance, minimap px     (default ${DEFAULT_DIFF_OPTIONS.posTolerancePx})
  --yaw <rad>        heading tolerance                  (default ${DEFAULT_DIFF_OPTIONS.yawTolerance})
  --fraction <x>     tolerance for 0..1 values          (default ${DEFAULT_DIFF_OPTIONS.fractionTolerance})
  --radius <px>      radius/length tolerance            (default ${DEFAULT_DIFF_OPTIONS.radiusTolerancePx})
  --step <n>         compare every n-th frame           (default ${DEFAULT_DIFF_OPTIONS.frameStep})
  --examples <n>     examples kept per kind and field   (default ${DEFAULT_DIFF_OPTIONS.examples})
  --max-rate <pct>   exit 1 when the mismatch rate is above this percentage (default 0)
  --json             print the report as JSON`;

const FLAGS: Record<string, keyof DiffOptions> = {
  '--pos': 'posTolerancePx',
  '--yaw': 'yawTolerance',
  '--fraction': 'fractionTolerance',
  '--radius': 'radiusTolerancePx',
  '--step': 'frameStep',
  '--examples': 'examples',
};

const args = process.argv.slice(2);
const files: string[] = [];
const options: Partial<DiffOptions> = {};
let maxRate = 0;
let json = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') json = true;
  else if (a === '--max-rate' || a in FLAGS) {
    const v = Number(args[++i]);
    if (!Number.isFinite(v) || v < 0) {
      console.error(`${a} needs a non-negative number\n\n${USAGE}`);
      process.exit(2);
    }
    if (a === '--max-rate') maxRate = v / 100;
    else options[FLAGS[a]] = v;
  } else if (a.startsWith('--')) {
    console.error(`unknown option ${a}\n\n${USAGE}`);
    process.exit(2);
  } else files.push(a);
}
if (files.length !== 2) {
  console.error(USAGE);
  process.exit(2);
}

const [a, b] = files.map((f) => new ReplayTimeline(fs.readFileSync(f)));
const report = diffTimelines(a, b, options);
const rate = mismatchRate(report);
if (json) {
  console.log(JSON.stringify({ ...report, mismatchRate: rate }, (_k, v) => (typeof v === 'bigint' ? `${v}` : v), 2));
} else {
  console.log(formatReport(report, ['A', 'B']));
}
process.exit(rate > maxRate || report.header.length > 0 ? 1 : 0);
