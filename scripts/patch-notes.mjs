/**
 * Reads PATCHNOTES.md.
 *
 * The file is the one place release notes are written. It is a heading per
 * version, and under it one or more headed lists:
 *
 *   ## 2.1.0
 *
 *   ### Changelog
 *   - Ships no longer land on top of each other when moved as a group
 *
 *   ### In testing
 *   - Share a page straight to Discord
 *
 * Each `###` heading becomes a header in the post. Notes written before any
 * heading are the changelog.
 *
 * `npm run release` publishes the section for the version being released as
 * patch-notes.json beside the update manifests, and the bot's /release command
 * reads it from there. Nothing here knows about Discord.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PATCH_NOTES_FILE = path.join(root, 'PATCHNOTES.md');

/** The name the notes are served under on the update server. */
export const PUBLISHED_NAME = 'patch-notes.json';

/** What notes with no heading of their own are filed under. */
const DEFAULT_TITLE = 'Changelog';

/**
 * The headed lists under one version's heading, or null when the file has no
 * heading for it. A leading "v" on the version heading is allowed. Text that
 * is neither a `###` heading nor a list item is not a note, and a heading with
 * nothing under it is dropped.
 */
export function sectionsFor(text, version) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const m = /^##\s+v?(\S+)\s*$/.exec(line);
    return m !== null && m[1] === version;
  });
  if (start < 0) return null;

  const sections = [];
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^##?\s/.test(line)) break;

    const heading = /^###\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      current = { title: heading[1].replace(/:$/, ''), notes: [] };
      sections.push(current);
      continue;
    }

    const item = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (!item) continue;
    if (current === null) {
      current = { title: DEFAULT_TITLE, notes: [] };
      sections.push(current);
    }
    current.notes.push(item[1]);
  }
  return sections.filter((section) => section.notes.length > 0);
}

/**
 * Every released version in the file, newest first as written, with its
 * sections. "Unreleased" and anything else that is not a version is skipped.
 */
export function allVersions(text) {
  const versions = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^##\s+v?(\d+\.\d+\.\d+\S*)\s*$/.exec(line);
    if (!m) continue;
    const sections = sectionsFor(text, m[1]);
    if (sections.length > 0) versions.push({ version: m[1], sections });
  }
  return versions;
}

/** What gets published for a version. Throws with what to do when there is nothing to publish. */
export function patchNotes(version) {
  if (!fs.existsSync(PATCH_NOTES_FILE)) throw new Error('PATCHNOTES.md is missing.');
  const sections = sectionsFor(fs.readFileSync(PATCH_NOTES_FILE, 'utf8'), version);
  if (sections === null) {
    throw new Error(`PATCHNOTES.md has no "## ${version}" section; rename "## Unreleased" or add one.`);
  }
  if (sections.length === 0) throw new Error(`The "## ${version}" section of PATCHNOTES.md has no notes in it.`);
  return { version, sections };
}
