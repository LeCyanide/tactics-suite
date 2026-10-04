/**
 * Uploads the release built by `npm run dist` to the update server.
 *
 *   npm run dist && npm run release
 *
 * Once the manifests are live it announces the release in Discord, if
 * BOT_URL, BOT_TOKEN and BOT_CHANNEL are set. The notes come from the commit
 * subjects since the previous tag, which already read as release notes.
 *
 *   --no-announce          upload without posting
 *   --announce-only        post without uploading, for a retry
 *   --notes-file <path>    one note per line, instead of the commit log
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
import { pruneLocalReleases } from './prune-local-releases.mjs';
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
const arg = (flag) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
};

const env = { ...readEnv(path.join(root, '.env.release')), ...process.env };
for (const key of ['VPS_SSH', 'VPS_DIR', 'UPDATE_URL', 'UPDATE_TOKEN']) {
  if (!env[key]) throw new Error(`${key} is not set in .env.release`);
}


/* ------------------------------------------------------------------ */
/* Announcing                                                          */
/* ------------------------------------------------------------------ */

/**
 * Commit subjects since the previous tag. They are written as release notes
 * already ("Name the replay in the title bar"), so there is no changelog file
 * to keep in step with the code.
 */
function notesFromGit(version) {
  const tags = capture('git', ['tag', '--sort=-creatordate']).split(/\r?\n/).filter(Boolean);
  const previous = tags.find((tag) => tag !== `v${version}`);
  const range = previous ? `${previous}..HEAD` : 'HEAD';

  return capture('git', ['log', '--no-merges', '--format=%s', range])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^release\b/i.test(line));
}

async function announce(version) {
  for (const key of ['BOT_URL', 'BOT_TOKEN', 'BOT_CHANNEL']) {
    if (!env[key]) {
      console.log(`Not announcing: ${key} is not set in .env.release.`);
      return;
    }
  }

  const notesFile = arg('--notes-file');
  const notes = notesFile
    ? fs.readFileSync(notesFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    : notesFromGit(version);

  const base = env.BOT_URL.trim().replace(/\/+$/, '');

  const response = await fetch(`${base}/release`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.BOT_TOKEN}` },
    body: JSON.stringify({ channelId: env.BOT_CHANNEL, version, notes, url: env.UPDATE_URL }),
    signal: AbortSignal.timeout(30_000),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error ?? `the bot answered ${response.status}`);
  }

  if (body.skipped) console.log(`${version} had already been announced.`);
  else console.log(`Announced ${version} with ${notes.length} note(s): ${body.url ?? ''}`);
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

// Posting without uploading, for when the upload worked and the announcement
// did not.
if (has('--announce-only')) {
  await announce(version);
  process.exit(0);
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
const { previous, stale } = staleReleases(remoteFiles, version);
if (stale.length) {
  run('ssh', [env.VPS_SSH, `cd '${env.VPS_DIR}' && rm -f -- ${stale.map((f) => `'${f}'`).join(' ')}`]);
  console.log(`Removed from the server: ${stale.join(', ')}`);
}
console.log(`Server keeps ${previous ? `${version} and ${previous}` : version}.`);

pruneLocalReleases(version);

// Last, and never fatal: the download already works from the moment the
// manifests landed, so a Discord outage must not fail a good release or stop
// the server being tidied.
if (!has('--no-announce')) {
  try {
    await announce(version);
  } catch (err) {
    console.error(`Release published, but announcing it failed: ${err.message}`);
    console.error('Retry with:  npm run release -- --announce-only');
  }
}
