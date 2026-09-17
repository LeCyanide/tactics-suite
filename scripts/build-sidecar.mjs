/**
 * Compiles the replay viewer sidecar and stages it for packaging.
 *
 *   node scripts/build-sidecar.mjs
 *
 * The binary lands in `resources/sidecar/`, which the installer picks up as an
 * extra resource. It depends only on Windows system DLLs — the UCRT is part of
 * Windows 10 and later — so there is no redistributable to ship and nothing for
 * the user to download separately.
 *
 * Toolchain: this builds with the GNU target by default because the build
 * machine has no MSVC linker. Override with SIDECAR_TOOLCHAIN, or set it empty
 * to use whatever rustup has as default:
 *
 *   SIDECAR_TOOLCHAIN= node scripts/build-sidecar.mjs
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crateDir = path.join(root, 'sidecar');
const stageDir = path.join(root, 'resources', 'sidecar');

export const SIDECAR_EXE = process.platform === 'win32' ? 'wows-replay-sidecar.exe' : 'wows-replay-sidecar';

/** The staged binary, or null when the sidecar has not been built. */
export function stagedSidecar() {
  const file = path.join(stageDir, SIDECAR_EXE);
  return fs.existsSync(file) ? file : null;
}

/** Removes the staged binary. The portable build packs without it. */
export function clearStagedSidecar() {
  fs.rmSync(stageDir, { recursive: true, force: true });
}

export function buildSidecar() {
  if (!fs.existsSync(path.join(crateDir, 'Cargo.toml'))) {
    throw new Error('sidecar/Cargo.toml is missing; nothing to build.');
  }

  const toolchain =
    process.env.SIDECAR_TOOLCHAIN ?? (process.platform === 'win32' ? 'stable-x86_64-pc-windows-gnu' : '');

  const [cmd, args] = toolchain
    ? ['rustup', ['run', toolchain, 'cargo', 'build', '--release']]
    : ['cargo', ['build', '--release']];

  console.log(`[sidecar] ${cmd} ${args.join(' ')}`);
  // rustup and cargo are real executables, so no shell is needed. Spawning
  // through a shell on Windows would concatenate the arguments unescaped.
  const res = spawnSync(cmd, args, { cwd: crateDir, stdio: 'inherit' });
  if (res.error?.code === 'ENOENT') {
    throw new Error(`${cmd} is not on PATH. Install Rust (https://rustup.rs) to build the replay viewer sidecar.`);
  }
  if (res.status !== 0) {
    throw new Error(
      `sidecar build failed (exit ${res.status}). If this failed while linking, check that cargo is not ` +
        `running under Git Bash: its coreutils link.exe shadows the real linker.`,
    );
  }

  const built = path.join(crateDir, 'target', 'release', SIDECAR_EXE);
  if (!fs.existsSync(built)) throw new Error(`build reported success but ${built} is missing.`);

  fs.mkdirSync(stageDir, { recursive: true });
  const staged = path.join(stageDir, SIDECAR_EXE);
  fs.copyFileSync(built, staged);
  const mb = (fs.statSync(staged).size / 1024 / 1024).toFixed(1);
  console.log(`[sidecar] staged ${path.relative(root, staged)} (${mb} MB)`);
  return staged;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    buildSidecar();
  } catch (err) {
    console.error(`[sidecar] ${err.message}`);
    process.exit(1);
  }
}
