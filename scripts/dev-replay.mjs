/**
 * Launches the replay layer harness.
 *
 *   npm run dev:replay -- <file.wtreply>
 *
 * A launcher rather than a bare `vite --config` because vite's CLI reads its
 * first positional argument as the project root, so passing the timeline
 * directly would silently set the root to a replay file. The path goes through
 * the environment instead.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const given = process.argv[2] ?? process.env.REPLAY_TIMELINE ?? '';
const fallback = path.join(root, 'dev', 'fixtures', 'okinawa.wtreply');
const timeline = given || (fs.existsSync(fallback) ? fallback : '');

if (!timeline) {
  console.error(
    [
      'Usage: npm run dev:replay -- <file.wtreply>',
      '',
      'Bake one first:',
      '  sidecar\\target\\release\\wows-replay-sidecar.exe bake \\',
      '    --game <game dir> --replay <file.wowsreplay> --out dev\\fixtures\\okinawa.wtreply',
    ].join('\n'),
  );
  process.exit(2);
}
if (!fs.existsSync(timeline)) {
  console.error(`No such timeline: ${timeline}`);
  process.exit(2);
}

console.log(`[dev:replay] ${timeline}`);
const { bin } = require(require.resolve('vite/package.json'));
const entry = path.join(path.dirname(require.resolve('vite/package.json')), typeof bin === 'string' ? bin : bin.vite);

const res = spawnSync(process.execPath, [entry, '--config', path.join(root, 'dev', 'vite.replay.config.ts')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, REPLAY_TIMELINE: path.resolve(timeline) },
});
process.exit(res.status ?? 1);
