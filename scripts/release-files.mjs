/**
 * Which release files to keep: the current version and the newest one before
 * it. Shared by the update server cleanup and the local release/ folder, so
 * both follow the same rule.
 */

import semver from 'semver';

/**
 * Installers, portable exes, blockmaps and zips, in both the current dashed
 * names and the spaced names older builds used. Captures the version.
 */
export const RELEASE_FILE =
  /^WoWS[- ]Tactics[- ]Toolkit[- ](?:Setup[- ])?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?: \([^)]*\))?\.(?:exe|zip)(?:\.blockmap)?$/;

/** Splits a folder listing into what the rule keeps and what it removes. Other files are never touched. */
export function staleReleases(files, version) {
  const versionOf = (f) => {
    const v = RELEASE_FILE.exec(f)?.[1];
    return v && semver.valid(v) ? v : null;
  };
  const versions = [...new Set(files.map(versionOf).filter(Boolean))];
  const previous = versions.filter((v) => semver.lt(v, version)).sort(semver.rcompare)[0] ?? null;
  const stale = files.filter((f) => {
    const v = versionOf(f);
    return v && v !== version && v !== previous;
  });
  return { previous, stale };
}
