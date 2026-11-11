/**
 * Checks for undo and redo.
 *
 * Undo steps hold project versions themselves, not copies (see pushHistory
 * and commitPage in the store), so they are sound only while no version is
 * ever changed in place. Every version is frozen here as soon as the store
 * holds it: an edit that writes into one throws, and the check fails, rather
 * than undo quietly bringing back something other than what was there.
 */

import { useStore } from '../src/state/store';
import { createPage, createProject, createText } from '../src/lib/factory';
import type { Project } from '../src/types/model';

type Check = (label: string, condition: boolean, detail?: unknown) => void;

function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key], seen);
  return Object.freeze(value);
}

/** What undo and redo must bring back exactly: each page's name and where its objects are. */
function snapshot(project: Project | null): string {
  return JSON.stringify(project?.pages.map((p) => ({ name: p.name, objects: p.objects.map((o) => [o.id, o.x, o.y]) })));
}

export async function testHistory(check: Check): Promise<void> {
  console.log('\nundo and redo');

  // The store saves through the Electron bridge; here, nowhere.
  const g = globalThis as unknown as { window?: { api?: unknown } };
  const hadWindow = 'window' in g;
  const ok = async () => undefined;
  g.window = { api: { projects: { save: ok, backup: ok }, settings: { save: ok } } };

  const project = createProject('History', ['Alpha']);
  const [alpha] = project.pages;
  const bravo = createPage('Bravo');
  project.pages.push(bravo);
  const layer = alpha!.layers[0]!.id;
  const moving = createText(layer, { x: 1000, y: 1000 }, 'moves');
  alpha!.objects.push(moving);
  bravo.objects.push(createText(bravo.layers[0]!.id, { x: 5, y: 5 }, 'stays'));
  project.activePageId = alpha!.id;
  project.openPageIds = [alpha!.id];

  const st = () => useStore.getState();
  useStore.setState({ project: deepFreeze(project), past: [], future: [], selection: [] });
  const unfreeze = useStore.subscribe((s) => {
    if (s.project) deepFreeze(s.project);
  });

  // A drag as the map makes one: history once at the start, then a write per move.
  const drag = (x: number, y: number) => {
    st().pushHistory();
    for (let i = 1; i <= 5; i++) st().moveObjectsTo([{ id: moving.id, x: x - 5 + i, y }]);
  };

  const states: string[] = [snapshot(st().project)];
  let threw: unknown = null;
  try {
    drag(2000, 3000);
    states.push(snapshot(st().project));
    const before = st().past[st().past.length - 1]!;
    const bravoNow = st().project!.pages.find((p) => p.id === bravo.id);
    const bravoThen = before.pages.find((p) => p.id === bravo.id);
    check('a page the edit did not touch is shared with the undo step, not copied', bravoNow === bravoThen);

    st().renamePage(alpha!.id, 'Alpha renamed');
    states.push(snapshot(st().project));
    drag(4000, 5000);
    states.push(snapshot(st().project));
    st().addPage('Charlie');
    states.push(snapshot(st().project));
  } catch (err) {
    threw = err;
  }
  check('no edit changes a stored version in place', threw === null, String(threw));

  check('every edit is one undo step', st().past.length === 4, st().past.length);

  const back: string[] = [];
  for (let i = 0; i < 4; i++) {
    st().undo();
    back.push(snapshot(st().project));
  }
  check(
    'undo steps back through every edit exactly',
    back.every((s, i) => s === states[3 - i]),
    back.map((s, i) => s === states[3 - i]),
  );
  check('nothing left to undo at the start', st().past.length === 0);

  const forward: string[] = [];
  for (let i = 0; i < 4; i++) {
    st().redo();
    forward.push(snapshot(st().project));
  }
  check(
    'redo steps forward through every edit exactly',
    forward.every((s, i) => s === states[i + 1]),
    forward.map((s, i) => s === states[i + 1]),
  );
  check('nothing left to redo at the end', st().future.length === 0);

  // A new edit after an undo replaces what could be redone.
  try {
    st().undo();
    st().undo();
    drag(9000, 9000);
    check('a new edit after undo clears redo', st().future.length === 0, st().future.length);
    st().undo();
    check('and undoing it goes back to before it', snapshot(st().project) === states[2]);
  } catch (err) {
    check('a new edit after undo clears redo', false, String(err));
  }

  unfreeze();
  useStore.setState({ project: null, past: [], future: [], selection: [] });
  if (!hadWindow) delete g.window;
}
