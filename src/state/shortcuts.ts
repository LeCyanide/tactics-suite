import { useEffect } from 'react';
import { getActivePage, useStore, type ToolId } from '@/state/store';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  f: 'freehand',
  l: 'line',
  a: 'arrow',
  r: 'rect',
  c: 'circle',
  t: 'text',
  m: 'ruler',
  n: 'number',
  g: 'polygon',
};

export interface ShortcutRow {
  keys: string;
  action: string;
}

export const SHORTCUT_REFERENCE: { group: string; rows: ShortcutRow[] }[] = [
  {
    group: 'Tools',
    rows: [
      { keys: 'V', action: 'Select' },
      { keys: 'Shift+V', action: 'Multi-select' },
      { keys: 'F', action: 'Freehand' },
      { keys: 'L', action: 'Line' },
      { keys: 'A', action: 'Arrow' },
      { keys: 'R', action: 'Rectangle' },
      { keys: 'C', action: 'Circle' },
      { keys: 'G', action: 'Polygon' },
      { keys: 'T', action: 'Text' },
      { keys: 'N', action: 'Number' },
      { keys: 'M', action: 'Ruler' },
    ],
  },
  {
    group: 'Editing',
    rows: [
      { keys: 'Ctrl+Z', action: 'Undo' },
      { keys: 'Ctrl+Y / Ctrl+Shift+Z', action: 'Redo' },
      { keys: 'Ctrl+C', action: 'Copy' },
      { keys: 'Ctrl+V', action: 'Paste' },
      { keys: 'Ctrl+D', action: 'Duplicate' },
      { keys: 'Ctrl+A', action: 'Select all' },
      { keys: 'Delete', action: 'Delete selection' },
      { keys: 'Esc', action: 'Deselect / cancel drawing' },
      { keys: 'Arrow keys', action: 'Nudge selection' },
      { keys: 'Shift+Arrows', action: 'Nudge by 10x' },
      { keys: 'Enter', action: 'Finish polygon' },
    ],
  },
  {
    group: 'File',
    rows: [
      { keys: 'Ctrl+N', action: 'New project' },
      { keys: 'Ctrl+O', action: 'Open project' },
      { keys: 'Ctrl+S', action: 'Save project' },
      { keys: 'Ctrl+E', action: 'Export image' },
    ],
  },
  {
    group: 'View',
    rows: [
      { keys: 'Ctrl+B', action: 'Toggle left sidebar' },
      { keys: 'Ctrl+J', action: 'Toggle properties' },
      { keys: 'Ctrl+K', action: 'Toggle notes' },
      { keys: 'Ctrl+Tab', action: 'Next page' },
      { keys: 'F1', action: 'This list' },
    ],
  },
];

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Installs the global keyboard map. */
export function useShortcuts(): void {
  useEffect(() => {
    const s = () => useStore.getState();

    const onKeyDown = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target);
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl) {
        const key = e.key.toLowerCase();
        const handled = () => {
          e.preventDefault();
          e.stopPropagation();
        };
        switch (key) {
          case 'z':
            handled();
            if (e.shiftKey) s().redo();
            else s().undo();
            return;
          case 'y':
            handled();
            s().redo();
            return;
          case 's':
            handled();
            void s().saveProject();
            return;
          case 'o':
            handled();
            s().openModal('projects');
            return;
          case 'n':
            handled();
            s().openModal('newProject');
            return;
          case 'e':
            handled();
            if (s().project) s().openModal('export');
            return;
          case 'b':
            handled();
            s().toggleLeft();
            return;
          case 'j':
            handled();
            s().toggleRight();
            return;
          case 'k':
            handled();
            s().toggleNotes();
            return;
          default:
            break;
        }

        if (typing) return;

        switch (key) {
          case 'c':
            handled();
            s().copySelection();
            return;
          case 'v':
            handled();
            s().paste();
            return;
          case 'd':
            handled();
            s().duplicateSelection();
            return;
          case 'a': {
            handled();
            const page = getActivePage(s());
            if (page) s().select(page.objects.filter((o) => !o.locked).map((o) => o.id));
            return;
          }
          case 'tab': {
            handled();
            const project = s().project;
            if (!project) return;
            const tabs = project.openPageIds;
            const i = project.activePageId ? tabs.indexOf(project.activePageId) : -1;
            const next = tabs[(i + 1) % tabs.length];
            if (next) s().setActivePage(next);
            return;
          }
          default:
            return;
        }
      }

      if (typing) return;

      if (e.key === 'F1') {
        e.preventDefault();
        s().openModal('shortcuts');
        return;
      }

      if (e.key === 'Escape') {
        s().clearSelection();
        if (s().tool !== 'select') s().setTool('select');
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s().deleteSelection();
        return;
      }

      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) * (s().project?.settings.snapStep ?? 500) * 0.2;
        const map: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const [dx, dy] = map[e.key] ?? [0, 0];
        s().nudgeSelection(dx, dy);
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'v' && e.shiftKey) {
        s().setTool('marquee');
        return;
      }
      const tool = TOOL_KEYS[key];
      if (tool && !e.shiftKey && !e.altKey) s().setTool(tool);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
