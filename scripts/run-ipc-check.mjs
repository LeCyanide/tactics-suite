/**
 * Runs the IPC check inside a real Electron process.
 *
 *   npm run ipc-check
 *
 * The self-test covers the main process and the renderer separately, each in
 * plain Node, and both dev previews stub `window.api` outright. That leaves one
 * seam untested: the hop itself — `ipcMain.handle` to contextBridge — which is
 * the only thing standing between a working sidecar and a working application,
 * and which carries tens of megabytes of timeline on every replay opened.
 *
 * Set WOWSPLAN_REPLAY and WOWSPLAN_GAME_DIR to exercise a real bake; without
 * them the check still covers the bridge, the archive calls and error
 * propagation, and says what it skipped.
 */

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'node_modules', '.ipc-check');
fs.mkdirSync(outDir, { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  alias: { '@': path.join(root, 'src') },
  // Supplied to the main process at build time by vite; the updater is not
  // under test and must not reach for a server.
  define: { __UPDATE_URL__: '""', __UPDATE_TOKEN__: '""' },
  // electron-updater reaches this bundle through ipc.ts and its dependencies
  // are CommonJS. esbuild's ESM output shims `require` with a stub that throws
  // ("Dynamic require of \"events\" is not supported"), so the main process is
  // emitted as CommonJS, which is what Electron loads a .js file as anyway.
  packages: 'external',
  external: ['electron'],
  logLevel: 'warning',
};

await build({
  ...shared,
  entryPoints: [path.join(root, 'scripts', 'ipc-check-main.ts')],
  outfile: path.join(outDir, 'main.js'),
  format: 'cjs',
});

// The preload runs in a context without ESM, so it is bundled as CommonJS.
await build({
  ...shared,
  entryPoints: [path.join(root, 'scripts', 'ipc-check-preload.ts')],
  outfile: path.join(outDir, 'ipc-check-preload.js'),
  format: 'cjs',
});

await build({
  ...shared,
  entryPoints: [path.join(root, 'scripts', 'ipc-check-renderer.ts')],
  outfile: path.join(outDir, 'renderer.js'),
  platform: 'browser',
  format: 'iife',
});

fs.writeFileSync(
  path.join(outDir, 'ipc-check.html'),
  '<!doctype html><meta charset="utf-8"><title>ipc check</title><script src="./renderer.js"></script>',
);

// A throwaway store, so the check never touches the real archive or projects.
const dataDir = fs.mkdtempSync(path.join(outDir, 'store-'));

console.log('\nIPC check (real Electron)');
const res = spawnSync(electronPath, [path.join(outDir, 'main.js')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    WOWSPLAN_DATA_DIR: dataDir,
    // The locator's packaged and repo-relative candidates do not apply to a
    // bundle living under node_modules, so point straight at the binary.
    WOWSPLAN_SIDECAR:
      process.env.WOWSPLAN_SIDECAR ??
      path.join(root, 'sidecar', 'target', 'release', process.platform === 'win32' ? 'wows-replay-sidecar.exe' : 'wows-replay-sidecar'),
    // Add-ons are installer-only; the check is not running from one.
    PORTABLE_EXECUTABLE_FILE: '',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  },
});

fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(res.status ?? 1);
