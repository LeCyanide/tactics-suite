/**
 * Uploads the release built by `npm run dist` to the update server.
 *
 *   npm run dist && npm run release
 *
 * The version's section of PATCHNOTES.md goes up with it as patch-notes.json,
 * which is what the bot's /release command posts. This script never talks to
 * Discord: where and when the notes are posted is decided there, by whoever
 * runs the command.
 *
 * releases.json (scripts/releases-feed.mjs), which the download site at
 * fw-suite.de reads, goes up with the notes.
 *
 *   --notes-only           re-publish the notes and releases.json alone, to fix them after a release
 *
 * Installers go up first and the manifests last, each manifest under a temp
 * name and then renamed, so a client checking mid-upload never sees a version
 * whose files are not there yet. Once the new manifests are live, releases
 * older than the previous one are deleted from the server; the previous one
 * stays so its blockmap can serve differential downloads. release/ on this
 * machine is then trimmed the same way. Needs the OpenSSH client (ships with
 * Windows 10+) and key-based login to VPS_SSH.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLISHED_NAME, patchNotes } from './patch-notes.mjs';
import { pruneLocalReleases } from './prune-local-releases.mjs';
import { FEED_NAME, releasesFeed } from './releases-feed.mjs';
import { staleReleases } from './release-files.mjs';

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

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

const env = { ...readEnv(path.join(root, '.env.release')), ...process.env };
for (const key of ['VPS_SSH', 'VPS_DIR', 'UPDATE_URL', 'UPDATE_TOKEN']) {
  if (!env[key]) throw new Error(`${key} is not set in .env.release`);
}


const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// Read before anything is uploaded: a release with no notes written for it is
// refused here rather than discovered when someone asks the bot for them.
const notes = patchNotes(version);
const remote = (f) => `${env.VPS_SSH}:${env.VPS_DIR}/${f}`;

/** Under a temp name and then renamed, like the manifests, so a reader never sees half a file. */
function publishJson(name, data) {
  const file = path.join(releaseDir, name);
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  run('scp', [file, remote(`${name}.tmp`)]);
  run('ssh', [env.VPS_SSH, `cd '${env.VPS_DIR}' && chmod g+r,o-rwx ${name}.tmp && mv -f ${name}.tmp ${name}`]);
}

function publishNotes() {
  publishJson(PUBLISHED_NAME, notes);
  const count = notes.sections.reduce((sum, section) => sum + section.notes.length, 0);
  console.log(`Published ${count} patch note(s) for ${version} under ${notes.sections.map((s) => s.title).join(', ')}.`);
  publishJson(FEED_NAME, releasesFeed(version));
  console.log(`Published ${FEED_NAME} for the download site.`);
}

// The notes alone, for a typo found after the installers went out.
if (has('--notes-only')) {
  publishNotes();
  process.exit(0);
}

const setup = `WoWs-Tactics-Suite-Setup-${version}.exe`;
const portable = `WoWs-Tactics-Suite-${version}.exe`;
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

console.log(`Uploading ${version} to ${env.VPS_SSH}:${env.VPS_DIR}`);
run('scp', [...binaries.map((f) => path.join(releaseDir, f)), `${env.VPS_SSH}:${env.VPS_DIR}/`]);
run('scp', [path.join(releaseDir, 'latest.yml'), remote('latest.yml.tmp')]);
run('scp', [path.join(releaseDir, 'portable.json'), remote('portable.json.tmp')]);
run('ssh', [
  env.VPS_SSH,
  `cd '${env.VPS_DIR}' && chmod g+r,o-rwx * && mv -f latest.yml.tmp latest.yml && mv -f portable.json.tmp portable.json`,
]);
console.log(`Published ${version}.`);

// After the manifests: the notes describe a version, so they must not be
// readable before that version can be downloaded.
publishNotes();

// Keep this release and the newest one before it; delete everything else.
const remoteFiles = capture('ssh', [env.VPS_SSH, `ls -1 '${env.VPS_DIR}'`]).split(/\r?\n/).filter(Boolean);
const { previous, stale } = staleReleases(remoteFiles, version);
if (stale.length) {
  run('ssh', [env.VPS_SSH, `cd '${env.VPS_DIR}' && rm -f -- ${stale.map((f) => `'${f}'`).join(' ')}`]);
  console.log(`Removed from the server: ${stale.join(', ')}`);
}
console.log(`Server keeps ${previous ? `${version} and ${previous}` : version}.`);

pruneLocalReleases(version);
