/**
 * Bundles and runs scripts/selftest.ts under plain Node.
 *
 * `electron/storage/db.ts` imports `app` from electron only to derive the
 * default storage directory; the self-test always sets WOWSPLAN_DATA_DIR, so a
 * stub is enough and the real storage code is exercised unmodified.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = path.join(root, 'node_modules', '.selftest.mjs');

const electronStub = {
  name: 'electron-stub',
  setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `export const app = { getPath: () => { throw new Error('WOWSPLAN_DATA_DIR must be set in tests'); } };`,
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [path.join(root, 'scripts', 'selftest.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: outFile,
  alias: { '@': path.join(root, 'src') },
  plugins: [electronStub],
  logLevel: 'warning',
});

const res = spawnSync(process.execPath, [outFile], { stdio: 'inherit' });
fs.rmSync(outFile, { force: true });
process.exit(res.status ?? 1);
