/** Types for patch-notes.mjs, so TypeScript callers (the Vite configs) can import it. */

export interface PatchNoteSection {
  title: string;
  notes: string[];
}

export interface VersionNotes {
  version: string;
  sections: PatchNoteSection[];
}

export const PATCH_NOTES_FILE: string;
export const PUBLISHED_NAME: string;
export function sectionsFor(text: string, version: string): PatchNoteSection[] | null;
export function allVersions(text: string): VersionNotes[];
export function patchNotes(version: string): VersionNotes;
export function bundledPatchNotes(): VersionNotes[];
