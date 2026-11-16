import { useEffect } from 'react';
import { getActivePage, useStore, type ToolId } from '@/state/store';
import { N_ } from '@/i18n/core';

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
    group: N_('Tools'),
    rows: [
      { keys: 'V', action: N_('Select') },
      { keys: 'Shift+V', action: N_('Multi-select') },
      { keys: 'F', action: N_('Freehand') },
      { keys: 'L', action: N_('Line') },
      { keys: 'A', action: N_('Arrow') },
      { keys: 'R', action: N_('Rectangle') },
      { keys: 'C', action: N_('Circle') },
      { keys: 'G', action: N_('Polygon') },
      { keys: 'T', action: N_('Text') },
      { keys: 'N', action: N_('Number') },
      { keys: 'M', action: N_('Ruler') },
    ],
  },
  {
    group: N_('Editing'),
    rows: [
      { keys: 'Ctrl+Z', action: N_('Undo') },
      { keys: 'Ctrl+Y / Ctrl+Shift+Z', action: N_('Redo') },
      { keys: 'Ctrl+C', action: N_('Copy') },
      { keys: 'Ctrl+V', action: N_('Paste') },
      { keys: 'Ctrl+D', action: N_('Duplicate') },
      { keys: 'Ctrl+A', action: N_('Select all') },
      { keys: 'Delete', action: N_('Delete selection') },
      { keys: 'Esc', action: N_('Deselect / cancel drawing') },
      { keys: 'Arrow keys', action: N_('Nudge selection') },
      { keys: 'Shift+Arrows', action: N_('Nudge by 10x') },
      { keys: 'Enter', action: N_('Finish polygon') },
    ],
  },
  {
    group: N_('File'),
    rows: [
      { keys: 'Ctrl+N', action: N_('New project') },
      { keys: 'Ctrl+O', action: N_('Open project') },
      { keys: 'Ctrl+S', action: N_('Save project') },
      { keys: 'Ctrl+E', action: N_('Export image') },
    ],
  },
  {
    group: N_('View'),
    rows: [
      { keys: 'Ctrl+B', action: N_('Toggle left sidebar') },
      { keys: 'Ctrl+J', action: N_('Toggle properties') },
      { keys: 'Ctrl+K', action: N_('Toggle notes') },
      { keys: 'Ctrl+Tab', action: N_('Next page') },
      { keys: 'F1', action: N_('This list') },
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

      // The blueprint picker keeps focus after a pick, so Esc must work from a field too.
      if (e.key === 'Escape' && s().blueprintSpawn) {
        s().armBlueprint(null);
        return;
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
        const step = e.shiftKey ? 1000 : 100; // metres
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
