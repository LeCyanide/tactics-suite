/**
 * Packages both Windows targets.
 *
 *   npm run dist
 *
 * The installer and the portable exe are built in separate electron-builder
 * passes because they do not carry the same payload: add-ons ship with the
 * installer only. electron-builder has no per-target file rules, so the two
 * passes each get a generated config derived from the `build` block in
 * package.json — one source of truth, with the extra resource added for the
 * installer pass alone.
 *
 * Packing the sidecar into the portable exe would add ~17 MB that the portable
 * build cannot use anyway: the replay viewer is gated on being installed, which
 * the app detects through PORTABLE_EXECUTABLE_FILE.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIDECAR_EXE, buildSidecar, clearStagedSidecar } from './build-sidecar.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The JS entry point of a dependency's command, from its own `bin` field.
 *
 * The `.bin` shims cannot be used here: on Windows they are `.cmd` files,
 * which `spawnSync` can only run through a shell, and a shell concatenates
 * arguments unescaped — so a project path containing a space would break the
 * build. Running the entry point under this same node avoids both problems.
 */
function binEntry(pkgName, binName = pkgName) {
  const manifestPath = require.resolve(`${pkgName}/package.json`);
  const { bin } = require(manifestPath);
  const rel = typeof bin === 'string' ? bin : bin?.[binName];
  if (!rel) throw new Error(`${pkgName} declares no bin entry for ${binName}`);
  return path.join(path.dirname(manifestPath), rel);
}

function runNode(entry, args) {
  const res = spawnSync(process.execPath, [entry, ...args], { cwd: root, stdio: 'inherit' });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${path.basename(entry)} ${args.join(' ')} failed with exit ${res.status}`);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/**
 * A config for one target, derived from package.json so the two cannot drift.
 *
 * The file is written into the project root, not a temp directory: every path
 * inside it — `files`, `extraResources`, `directories.output` — is relative,
 * and putting the config elsewhere risks those resolving against the wrong
 * base.
 */
function configFor(target, { withSidecar }) {
  const build = structuredClone(pkg.build);
  build.win = { ...build.win, target: [target] };
  if (withSidecar) {
    build.extraResources = [...(build.extraResources ?? []), { from: 'resources/sidecar', to: 'sidecar' }];
  }
  const file = path.join(root, `.electron-builder.${target}.json`);
  fs.writeFileSync(file, JSON.stringify(build, null, 2));
  return file;
}

function pack(target, options) {
  const config = configFor(target, options);
  console.log(`\n[dist] ${target}${options.withSidecar ? ' (with replay viewer sidecar)' : ''}`);
  try {
    runNode(binEntry('electron-builder'), ['--project', root, '--config', config, '--publish', 'never']);
  } finally {
    fs.rmSync(config, { force: true });
  }
}

runNode(binEntry('typescript', 'tsc'), ['--noEmit']);
runNode(binEntry('vite'), ['build']);

// The installer carries the sidecar. Build it first: a stale or missing binary
// would otherwise produce an installer that silently lacks the replay viewer.
buildSidecar();
pack('nsis', { withSidecar: true });

// The portable exe must not carry it. Clearing the staging directory is not
// enough on its own — the portable config never references it — but it keeps
// the tree honest about what was packed.
clearStagedSidecar();
pack('portable', { withSidecar: false });

const setup = path.join(root, 'release', `WoWs-Tactics-Suite-Setup-${pkg.version}.exe`);
const portable = path.join(root, 'release', `WoWs-Tactics-Suite-${pkg.version}.exe`);
for (const [label, file] of [
  ['installer', setup],
  ['portable', portable],
]) {
  if (!fs.existsSync(file)) throw new Error(`${label} was not produced at ${file}`);
  console.log(`[dist] ${label.padEnd(9)} ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`);
}
console.log(`[dist] ${SIDECAR_EXE} is in the installer only.`);
