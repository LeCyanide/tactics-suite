/**
 * Compares two `.wtreply` timelines baked from the same replay.
 *
 *   npm run diff-timeline -- old.wtreply new.wtreply [--max-rate 0.5]
 *
 * This is the acceptance test for swapping the sidecar's replay parser: bake
 * a replay with the current sidecar and with the candidate, and diff. Records
 * are paired by entity/plane id or, without one, by position; numeric fields
 * are compared within tolerances (see --help). Exits 1 when the header
 * differs or the mismatch rate is above --max-rate.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = path.join(root, 'node_modules', '.diff-timeline.mjs');

await build({
  entryPoints: [path.join(root, 'scripts', 'diff-timeline-main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: outFile,
  logLevel: 'warning',
});

const res = spawnSync(process.execPath, [outFile, ...process.argv.slice(2)], { stdio: 'inherit' });
fs.rmSync(outFile, { force: true });
process.exit(res.status ?? 1);
