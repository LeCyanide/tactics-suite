import { useStore } from '@/state/store';
import { activeLanguage, type Language } from './core';

export * from './core';

/**
 * Re-renders the caller when the language changes. Only components that skip
 * their parent's re-render (React.memo) need it: everything else re-renders
 * from App, which subscribes.
 */
export function useLanguage(): Language {
  useStore((s) => s.settings.language);
  return activeLanguage();
}
