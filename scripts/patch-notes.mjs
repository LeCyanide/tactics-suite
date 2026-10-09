/**
 * Reads PATCHNOTES.md.
 *
 * The file is the one place release notes are written. It is a heading per
 * version with a list under it:
 *
 *   ## 2.1.0
 *   - Ships no longer land on top of each other when moved as a group
 *
 * A blank line between two items starts a new paragraph in the post, which is
 * how a group of notes is set apart from the rest.
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

/**
 * The notes under one version's heading, one per list item, or null when the
 * file has no heading for it. A leading "v" on the heading is allowed; text
 * that is not a list item is not a note. A blank line between two items comes
 * through as an empty note, which is the paragraph break.
 */
export function notesFor(text, version) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const m = /^##\s+v?(\S+)\s*$/.exec(line);
    return m !== null && m[1] === version;
  });
  if (start < 0) return null;

  const notes = [];
  let gap = false;
  for (const line of lines.slice(start + 1)) {
    if (/^##?\s/.test(line)) break;
    if (line.trim() === '') {
      gap = true;
      continue;
    }
    const item = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (!item) continue;
    if (gap && notes.length > 0) notes.push('');
    gap = false;
    notes.push(item[1]);
  }
  return notes;
}

/** What gets published for a version. Throws with what to do when there is nothing to publish. */
export function patchNotes(version) {
  if (!fs.existsSync(PATCH_NOTES_FILE)) throw new Error('PATCHNOTES.md is missing.');
  const notes = notesFor(fs.readFileSync(PATCH_NOTES_FILE, 'utf8'), version);
  if (notes === null) {
    throw new Error(`PATCHNOTES.md has no "## ${version}" section; rename "## Unreleased" or add one.`);
  }
  if (!notes.some((note) => note !== '')) throw new Error(`The "## ${version}" section of PATCHNOTES.md has no notes in it.`);
  return { version, notes };
}
