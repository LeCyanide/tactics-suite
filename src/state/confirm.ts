/**
 * In-app yes/no questions, drawn by `ConfirmDialog` in the app's own style
 * rather than as a Windows message box.
 */

import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  /** Paints the confirm button as destructive. */
  danger?: boolean;
}

interface ConfirmState {
  open: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
}

export const useConfirmStore = create<ConfirmState>(() => ({ open: null }));

/** Asks the question and resolves true on confirm, false on cancel or close. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  // A second question replaces the first; the first counts as cancelled.
  useConfirmStore.getState().open?.resolve(false);
  return new Promise((resolve) => useConfirmStore.setState({ open: { ...opts, resolve } }));
}

export function answerConfirm(ok: boolean): void {
  const open = useConfirmStore.getState().open;
  useConfirmStore.setState({ open: null });
  open?.resolve(ok);
}
