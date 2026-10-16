/**
 * Builds the download site into release/site from site/index.html and
 * PATCHNOTES.md: the current version's download buttons on top, every
 * released version's notes below. `npm run release` builds and uploads it;
 * on its own it only builds, for a look in the browser:
 *
 *   node scripts/build-site.mjs
 *
 * Download links point at /download/<file>, which the site's Caddy config
 * serves straight out of the update folder, so the installers are uploaded
 * once and the site only carries the page.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATCH_NOTES_FILE, allVersions } from './patch-notes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SITE_DIR = path.join(root, 'release', 'site');

/** The files that make up the site, as uploaded. */
export const SITE_FILES = ['index.html', 'icon.png'];

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The little Markdown patch notes use: links, `code` and **bold**. */
function inline(text) {
  return escape(text)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** The day a version's "Release x" commit was made, or null before it exists. */
function releaseDate(version) {
  const res = spawnSync('git', ['log', '-1', '--format=%cs', '--fixed-strings', `--grep=Release ${version}`], {
    cwd: root,
    encoding: 'utf8',
  });
  return res.status === 0 && res.stdout.trim() ? res.stdout.trim() : null;
}

const formatDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function formatSize(file) {
  const p = path.join(root, 'release', file);
  return fs.existsSync(p) ? `${Math.round(fs.statSync(p).size / 1e6)} MB` : 'Windows';
}

function renderRelease({ version, sections }, latest) {
  const date = releaseDate(version);
  const lists = sections
    .map((s) => {
      const cls = /testing/i.test(s.title) ? ' class="testing"' : '';
      const items = s.notes.map((n) => `        <li>${inline(n)}</li>`).join('\n');
      return `      <h4${cls}>${escape(s.title)}</h4>\n      <ul>\n${items}\n      </ul>`;
    })
    .join('\n');
  return [
    `  <details class="release" id="v${escape(version)}"${latest ? ' open' : ''}>`,
    `    <summary><h3>${escape(version)}</h3>${date ? `<time datetime="${date}">${formatDate(date)}</time>` : ''}${latest ? '<span class="latest">Latest</span>' : ''}</summary>`,
    lists,
    '  </details>',
  ].join('\n');
}

/** Writes the site for `version` to SITE_DIR. Throws when PATCHNOTES.md has nothing for it. */
export function buildSite(version) {
  const releases = allVersions(fs.readFileSync(PATCH_NOTES_FILE, 'utf8'));
  if (!releases.some((r) => r.version === version)) {
    throw new Error(`PATCHNOTES.md has no notes for ${version}, so the site would offer a version it says nothing about.`);
  }
  const setup = `WoWs-Tactics-Suite-Setup-${version}.exe`;
  const portable = `WoWs-Tactics-Suite-${version}.exe`;
  const date = releaseDate(version);
  const values = {
    version: escape(version),
    date: date ? formatDate(date) : 'today',
    setup,
    portable,
    setupSize: formatSize(setup),
    portableSize: formatSize(portable),
    releases: releases.map((r) => renderRelease(r, r.version === version)).join('\n'),
  };
  const html = fs
    .readFileSync(path.join(root, 'site', 'index.html'), 'utf8')
    .replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!(key in values)) throw new Error(`site/index.html uses {{${key}}}, which build-site.mjs does not fill in.`);
      return values[key];
    });

  fs.mkdirSync(SITE_DIR, { recursive: true });
  fs.writeFileSync(path.join(SITE_DIR, 'index.html'), html);
  fs.copyFileSync(path.join(root, 'resources', 'icon.png'), path.join(SITE_DIR, 'icon.png'));
  return SITE_DIR;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  console.log(`Built the site for ${version} in ${path.relative(root, buildSite(version))}.`);
}
