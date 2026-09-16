/**
 * Trims release/ to the current version (from package.json) and the one
 * before it. Older builds go to the Recycle Bin rather than being deleted
 * outright. `npm run release` runs this after publishing; it can also be run
 * on its own:
 *
 *   node scripts/prune-local-releases.mjs
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { staleReleases } from './release-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function pruneLocalReleases(version) {
  const dir = path.join(root, 'release');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  const { previous, stale } = staleReleases(files, version);
  if (stale.length) {
    const quote = (s) => `'${s.replace(/'/g, "''")}'`;
    const script = [
      "$ProgressPreference = 'SilentlyContinue'",
      'Add-Type -AssemblyName Microsoft.VisualBasic',
      ...stale.map(
        (f) =>
          `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(${quote(path.join(dir, f))}, 'OnlyErrorDialogs', 'SendToRecycleBin')`,
      ),
    ].join('; ');
    const res = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { stdio: 'inherit' },
    );
    if (res.status !== 0) throw new Error('Moving old releases to the Recycle Bin failed');
    console.log(`Moved to the Recycle Bin: ${stale.join(', ')}`);
  }
  console.log(`release/ keeps ${previous ? `${version} and ${previous}` : version}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  pruneLocalReleases(version);
}
