/**
 * Uploads the release built by `npm run dist` to the update server.
 *
 *   npm run dist && npm run release
 *
 * Installers go up first and the manifests last, each manifest under a temp
 * name and then renamed, so a client checking mid-upload never sees a version
 * whose files are not there yet. Once the new manifests are live, releases
 * older than the previous one are deleted from the server; the previous one
 * stays so its blockmap can serve differential downloads. Needs the OpenSSH client (ships with
 * Windows 10+) and key-based login to VPS_SSH.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');

function readEnv(file) {
  if (!fs.existsSync(file)) throw new Error(`${path.basename(file)} is missing; copy .env.release.example and fill it in.`);
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

function capture(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
  return res.stdout;
}

/** Release files on the server, by version. Anything else in the folder is left alone. */
const RELEASE_FILE = /^WoWS-Tactics-Toolkit-(?:Setup-)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.exe(?:\.blockmap)?$/;

const env = { ...readEnv(path.join(root, '.env.release')), ...process.env };
for (const key of ['VPS_SSH', 'VPS_DIR', 'UPDATE_URL', 'UPDATE_TOKEN']) {
  if (!env[key]) throw new Error(`${key} is not set in .env.release`);
}

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const setup = `WoWS-Tactics-Toolkit-Setup-${version}.exe`;
const portable = `WoWS-Tactics-Toolkit-${version}.exe`;
const binaries = [setup, `${setup}.blockmap`, portable];
for (const f of [...binaries, 'latest.yml']) {
  if (!fs.existsSync(path.join(releaseDir, f))) throw new Error(`release/${f} is missing; run npm run dist first.`);
}
const latest = fs.readFileSync(path.join(releaseDir, 'latest.yml'), 'utf8');
if (!new RegExp(`^version: ${version.replace(/\./g, '\.')}$`, 'm').test(latest)) {
  throw new Error(`release/latest.yml is not for ${version}; rebuild with npm run dist.`);
}

// A build without the token can never update again, so refuse to ship one.
const mainJs = fs.readFileSync(path.join(root, 'dist-electron', 'main.js'), 'utf8');
if (!mainJs.includes(env.UPDATE_TOKEN) || !mainJs.includes(env.UPDATE_URL)) {
  throw new Error('dist-electron/main.js was built without the update URL/token from .env.release; rebuild.');
}

const portableBytes = fs.readFileSync(path.join(releaseDir, portable));
const manifest = {
  version,
  file: portable,
  sha512: crypto.createHash('sha512').update(portableBytes).digest('base64'),
  size: portableBytes.length,
};
fs.writeFileSync(path.join(releaseDir, 'portable.json'), JSON.stringify(manifest, null, 2) + '\n');

const remote = (f) => `${env.VPS_SSH}:${env.VPS_DIR}/${f}`;
console.log(`Uploading ${version} to ${env.VPS_SSH}:${env.VPS_DIR}`);
run('scp', [...binaries.map((f) => path.join(releaseDir, f)), `${env.VPS_SSH}:${env.VPS_DIR}/`]);
run('scp', [path.join(releaseDir, 'latest.yml'), remote('latest.yml.tmp')]);
run('scp', [path.join(releaseDir, 'portable.json'), remote('portable.json.tmp')]);
run('ssh', [
  env.VPS_SSH,
  `cd '${env.VPS_DIR}' && chmod g+r,o-rwx * && mv -f latest.yml.tmp latest.yml && mv -f portable.json.tmp portable.json`,
]);
console.log(`Published ${version}.`);

// Keep this release and the newest one before it; delete everything else.
const remoteFiles = capture('ssh', [env.VPS_SSH, `ls -1 '${env.VPS_DIR}'`]).split(/\r?\n/).filter(Boolean);
const versions = [...new Set(remoteFiles.map((f) => RELEASE_FILE.exec(f)?.[1]).filter((v) => v && semver.valid(v)))];
const previous = versions.filter((v) => semver.lt(v, version)).sort(semver.rcompare)[0];
const stale = remoteFiles.filter((f) => {
  const v = RELEASE_FILE.exec(f)?.[1];
  return v && v !== version && v !== previous;
});
if (stale.length) {
  run('ssh', [env.VPS_SSH, `cd '${env.VPS_DIR}' && rm -f -- ${stale.map((f) => `'${f}'`).join(' ')}`]);
  console.log(`Removed from the server: ${stale.join(', ')}`);
}
console.log(`Server keeps ${previous ? `${version} and ${previous}` : version}.`);
