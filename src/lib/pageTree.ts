/**
 * The page list as the sidebar shows it: folders and loose pages in one order,
 * with each folder's pages under it.
 *
 * Folders are sorting and nothing more. `project.pages` stays the one flat
 * list everything else reads — the page shortcuts, export — and
 * every function here leaves it in the order the sidebar shows, so the two
 * never disagree about which page comes next.
 */

import type { ID, Page, PageFolder, Project } from '@/types/model';
import { clamp } from './util';

export type PageTreeItem =
  | { kind: 'page'; page: Page }
  | { kind: 'folder'; folder: PageFolder; pages: Page[] };

/** The top level of the list, in order. Expects a settled project. */
export function pageTree(project: Project): PageTreeItem[] {
  const folders = new Map(project.pageFolders.map((f) => [f.id, f]));
  const pages = new Map(project.pages.map((p) => [p.id, p]));
  const items: PageTreeItem[] = [];
  for (const id of project.pageLayout) {
    const folder = folders.get(id);
    const page = pages.get(id);
    if (folder) items.push({ kind: 'folder', folder, pages: project.pages.filter((p) => p.folderId === id) });
    else if (page) items.push({ kind: 'page', page });
  }
  return items;
}

/**
 * What a page is called outside the app, outermost first: the project, the
 * folder it is sorted into if any, and the page itself.
 */
export function pagePath(project: Project, page: Page): string[] {
  const folder = folderNameOf(project, page);
  return [project.name, ...(folder !== null ? [folder] : []), page.name];
}

/** The name of the folder a page is sorted into, or null for a loose page. */
export function folderNameOf(project: Project, page: Page): string | null {
  return project.pageFolders?.find((f) => f.id === page.folderId)?.name ?? null;
}

/**
 * Makes the tabs agree with the pages: each names a page that exists, once,
 * and the active page is among them. A project from before tabs were their
 * own list opens with just the page it was left on.
 */
export function settleTabs(project: Project): void {
  const exists = new Set(project.pages.map((p) => p.id));
  const open = [...new Set(project.openPageIds ?? [])].filter((id) => exists.has(id));
  if (project.activePageId && exists.has(project.activePageId) && !open.includes(project.activePageId)) {
    open.push(project.activePageId);
  }
  project.openPageIds = open;
}

/** Opens a page as a tab just after the active one, unless it is open already. */
export function openTab(project: Project, id: ID): void {
  if (project.openPageIds.includes(id)) return;
  const at = project.activePageId ? project.openPageIds.indexOf(project.activePageId) : -1;
  project.openPageIds.splice(at < 0 ? project.openPageIds.length : at + 1, 0, id);
}

/**
 * Makes the three parts agree: every page is in a folder that exists or in
 * none, the layout names each folder and each loose page exactly once, and
 * `pages` follows the layout.
 *
 * Anything the layout does not place (a project without folders, or a
 * hand-edited one) goes to the end, pages first, in their existing order.
 */
export function settlePages(project: Project): void {
  project.pageFolders ??= [];
  const folderIds = new Set(project.pageFolders.map((f) => f.id));
  for (const page of project.pages) {
    if (page.folderId == null || !folderIds.has(page.folderId)) page.folderId = null;
  }
  const loose = new Map(project.pages.filter((p) => p.folderId === null).map((p) => [p.id, p]));

  const layout: ID[] = [];
  const placed = new Set<ID>();
  for (const id of [...(project.pageLayout ?? []), ...loose.keys(), ...folderIds]) {
    if (placed.has(id) || !(loose.has(id) || folderIds.has(id))) continue;
    placed.add(id);
    layout.push(id);
  }

  project.pageLayout = layout;
  project.pages = layout.flatMap((id) =>
    folderIds.has(id) ? project.pages.filter((p) => p.folderId === id) : [loose.get(id)!],
  );
}

/** The ids a page or folder is ordered among: its folder's pages, or the top level. */
function siblings(project: Project, folderId: ID | null): ID[] {
  return folderId === null
    ? project.pageLayout
    : project.pages.filter((p) => p.folderId === folderId).map((p) => p.id);
}

/**
 * Puts a page into `folderId`, or at the top level for null, in front of
 * `beforeId` — a page of that folder, or anything at the top level. Without
 * one it goes to the end.
 */
export function placePage(project: Project, id: ID, folderId: ID | null, beforeId: ID | null = null): void {
  const page = project.pages.find((p) => p.id === id);
  if (!page || beforeId === id) return;
  if (folderId !== null && !project.pageFolders.some((f) => f.id === folderId)) return;

  page.folderId = folderId;
  project.pageLayout = project.pageLayout.filter((x) => x !== id);
  project.pages = project.pages.filter((p) => p !== page);
  if (folderId === null) {
    const at = beforeId === null ? -1 : project.pageLayout.indexOf(beforeId);
    project.pageLayout.splice(at < 0 ? project.pageLayout.length : at, 0, id);
    // Anywhere will do: settling puts it where the layout says.
    project.pages.push(page);
  } else {
    // Within a folder the order is simply that of `pages`.
    const at = project.pages.findIndex((p) => p.id === beforeId && p.folderId === folderId);
    project.pages.splice(at < 0 ? project.pages.length : at, 0, page);
  }
  settlePages(project);
}

/** Moves a folder in front of `beforeId` at the top level, or to the end. */
export function placeFolder(project: Project, id: ID, beforeId: ID | null = null): void {
  if (beforeId === id || !project.pageFolders.some((f) => f.id === id)) return;
  project.pageLayout = project.pageLayout.filter((x) => x !== id);
  const at = beforeId === null ? -1 : project.pageLayout.indexOf(beforeId);
  project.pageLayout.splice(at < 0 ? project.pageLayout.length : at, 0, id);
  settlePages(project);
}

/**
 * Where something lands when it is put next to `targetId`: the id to place it
 * in front of, or null for the end of the list `targetId` is in.
 */
export function beforeIdFor(
  project: Project,
  movingId: ID,
  targetId: ID,
  folderId: ID | null,
  side: 'before' | 'after',
): ID | null {
  if (side === 'before') return targetId;
  const rest = siblings(project, folderId).filter((x) => x !== movingId);
  return rest[rest.indexOf(targetId) + 1] ?? null;
}

/** Moves a page up or down among the pages of its folder, or along the top level. */
export function stepPage(project: Project, id: ID, delta: number): void {
  const page = project.pages.find((p) => p.id === id);
  if (!page) return;
  const list = siblings(project, page.folderId);
  const at = list.indexOf(id);
  const to = clamp(at + delta, 0, list.length - 1);
  if (at === to) return;
  placePage(project, id, page.folderId, list.filter((x) => x !== id)[to] ?? null);
}

/** Moves a folder up or down the top level. */
export function stepFolder(project: Project, id: ID, delta: number): void {
  const at = project.pageLayout.indexOf(id);
  const to = clamp(at + delta, 0, project.pageLayout.length - 1);
  if (at < 0 || at === to) return;
  placeFolder(project, id, project.pageLayout.filter((x) => x !== id)[to] ?? null);
}

/** Removes a folder and leaves its pages where it was, in the same order. */
export function dissolveFolder(project: Project, id: ID): void {
  const held = project.pages.filter((p) => p.folderId === id);
  for (const page of held) page.folderId = null;
  project.pageLayout = project.pageLayout.flatMap((x) => (x === id ? held.map((p) => p.id) : [x]));
  project.pageFolders = project.pageFolders.filter((f) => f.id !== id);
  settlePages(project);
}
