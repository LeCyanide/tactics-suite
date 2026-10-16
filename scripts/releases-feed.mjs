/**
 * releases.json: what the download site at fw-suite.de shows. The site lives
 * in its own repo (fw-suite-site) and reads this file in the browser, so a
 * release updates the page without the site being redeployed.
 *
 *   {
 *     "current": { "version", "date", "setup": { "file", "size" }, "portable": { "file", "size" } },
 *     "releases": [ { "version", "date", "sections": [ { "title", "notes": [] } ] } ]
 *   }
 *
 * Releases are every version in PATCHNOTES.md, newest first. Notes are the
 * file's Markdown as written. Dates are the day of the "Release x" commit, or
 * null before it exists; sizes are in bytes, or null when the file is not in
 * release/. `npm run release` uploads it beside the update manifests; on its
 * own this prints it:
 *
 *   node scripts/releases-feed.mjs
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATCH_NOTES_FILE, allVersions } from './patch-notes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The name the feed is served under on the update server. */
export const FEED_NAME = 'releases.json';

function releaseDate(version) {
  const res = spawnSync('git', ['log', '-1', '--format=%cs', '--fixed-strings', `--grep=Release ${version}`], {
    cwd: root,
    encoding: 'utf8',
  });
  return res.status === 0 && res.stdout.trim() ? res.stdout.trim() : null;
}

function download(file) {
  const p = path.join(root, 'release', file);
  return { file, size: fs.existsSync(p) ? fs.statSync(p).size : null };
}

/** The feed for `version`. Throws when PATCHNOTES.md has nothing for it. */
export function releasesFeed(version) {
  const releases = allVersions(fs.readFileSync(PATCH_NOTES_FILE, 'utf8')).map((r) => ({
    version: r.version,
    date: releaseDate(r.version),
    sections: r.sections,
  }));
  const current = releases.find((r) => r.version === version);
  if (!current) throw new Error(`PATCHNOTES.md has no notes for ${version}, so the site would offer a version it says nothing about.`);
  return {
    current: {
      version,
      date: current.date,
      setup: download(`WoWs-Tactics-Suite-Setup-${version}.exe`),
      portable: download(`WoWs-Tactics-Suite-${version}.exe`),
    },
    releases,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  console.log(JSON.stringify(releasesFeed(version), null, 2));
}
